const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { readUdpPackets } = require('./helpers/pcap')
const protocol = require('../lib/protocol')
const RadioClient = require('../lib/radioClient')

// Replays tools/capture-spike/capture.sanitized.pcap — a real WiFi capture
// of an M510E session — through the protocol/radioClient layer directly
// (bypassing sockets), so Phase 1 parsing logic can be checked against real
// bytes without a live radio. See CHANGELOG.md "Phase 0 findings".

const PCAP_PATH = path.join(__dirname, '..', 'tools', 'capture-spike', 'capture.sanitized.pcap')
const RADIO_IP = '192.168.1.146'

function loadCapture () {
  const buf = fs.readFileSync(PCAP_PATH)
  return readUdpPackets(buf)
}

test('RTP voice stream: no dropped or reordered packets across the capture', () => {
  const pkts = loadCapture()
  const voice = pkts.filter((p) => p.srcIp === RADIO_IP && p.srcPort === 50001)
  assert.ok(voice.length > 0, 'capture should contain RTP voice packets')

  let prevSeq = null
  let prevTs = null
  for (const p of voice) {
    const rtp = p.payload
    assert.strictEqual(rtp[0] >> 6, 2, 'RTP version should be 2')
    assert.strictEqual(rtp[1] & 0x7f, 0, 'payload type should be 0 (PCMU/G.711 mu-law)')
    const seq = rtp.readUInt16BE(2)
    const ts = rtp.readUInt32BE(4)
    if (prevSeq !== null) {
      assert.strictEqual((seq - prevSeq) & 0xffff, 1, 'sequence should increment by 1')
      assert.strictEqual(ts - prevTs, 320, 'RTP timestamp should advance by 320 samples (40ms @ 8kHz)')
    }
    prevSeq = seq
    prevTs = ts
  }
})

test('parseChannelStatus: real 28-byte status packets are silently dropped as undersized', () => {
  const pkts = loadCapture()
  const status = pkts.filter((p) => p.srcIp === RADIO_IP && p.srcPort === 50003)
  const byLength = {}
  for (const p of status) {
    byLength[p.payload.length] = (byLength[p.payload.length] || 0) + 1
  }
  // Document what's actually on the wire: two distinct real packet shapes
  // share port 50003, and only the 40-byte one meets parseChannelStatus's
  // 36-byte minimum.
  assert.ok(byLength[28] > 0, 'capture should contain 28-byte status packets')
  assert.ok(byLength[40] > 0, 'capture should contain 40-byte status packets')

  for (const p of status) {
    const parsed = protocol.parseChannelStatus(p.payload)
    if (p.payload.length === 28) {
      assert.strictEqual(parsed, null)
    } else if (p.payload.length === 40) {
      assert.notStrictEqual(parsed, null)
    }
  }
})

test('busy-flag replay: one continuous RX transmission fragments into multiple tx-start/tx-end cycles', () => {
  const pkts = loadCapture()
  const statusPkts = pkts
    .filter((p) => p.srcIp === RADIO_IP && p.srcPort === 50003)
    .map((p) => ({ ...p, kind: 'status' }))
  const voicePkts = pkts
    .filter((p) => p.srcIp === RADIO_IP && p.srcPort === 50001)
    .map((p) => ({ ...p, kind: 'voice' }))
  const merged = [...statusPkts, ...voicePkts].sort((a, b) => a.ts - b.ts)

  const rc = new RadioClient()
  const events = []
  rc.on('tx-start', (e) => events.push({ type: 'tx-start', channelNr: e.channelNr }))
  rc.on('tx-end', (e) => events.push({ type: 'tx-end' }))
  let voiceDataCount = 0
  rc.on('voice-data', () => { voiceDataCount++ })

  for (const p of merged) {
    if (p.kind === 'status') {
      rc._onServerCMessage(p.payload)
    } else {
      rc._onVoiceMessage(p.payload)
    }
  }

  // Known-bad current behavior: busy-tracking ignores channelNr, so the
  // radio's dual-watch/scan between channel 84 and 93 in this capture
  // fragments one real transmission into 3 tx-start/tx-end cycles.
  const txStarts = events.filter((e) => e.type === 'tx-start')
  assert.strictEqual(txStarts.length, 3, 'currently fragments into 3 tx-start events (see CHANGELOG.md)')

  // No RTP packets are actually lost despite the fragmentation.
  assert.strictEqual(voiceDataCount, voicePkts.length)
})
