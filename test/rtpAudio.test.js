const test = require('node:test')
const assert = require('node:assert')
const {
  RTP_HEADER_LENGTH,
  frameRtpPackets,
  unframeRtpPackets,
  extractMuLawPayload,
  muLawToPcm16,
  pcm16ToWav,
  rtpPcmuPacketsToWav,
  rawPathToWavPath
} = require('../lib/rtpAudio')

function rtpPacket ({ payloadType = 0, payload = Buffer.alloc(4, 0xff) } = {}) {
  const header = Buffer.alloc(RTP_HEADER_LENGTH)
  header[0] = 0x80 // version 2
  header[1] = payloadType & 0x7f
  return Buffer.concat([header, payload])
}

test('frameRtpPackets/unframeRtpPackets round-trip preserves exact packet boundaries', () => {
  const packets = [
    rtpPacket({ payload: Buffer.from([1, 2, 3]) }),
    rtpPacket({ payload: Buffer.from([4]) }),
    rtpPacket({ payload: Buffer.alloc(0) })
  ]
  const framed = frameRtpPackets(packets)
  const recovered = unframeRtpPackets(framed)
  assert.strictEqual(recovered.length, packets.length)
  for (let i = 0; i < packets.length; i++) {
    assert.ok(recovered[i].equals(packets[i]), `packet ${i} should round-trip exactly`)
  }
})

test('unframeRtpPackets stops cleanly at a truncated trailing record', () => {
  const framed = frameRtpPackets([rtpPacket({ payload: Buffer.from([1, 2]) })])
  const truncated = framed.subarray(0, framed.length - 1) // chop the last byte
  const recovered = unframeRtpPackets(truncated)
  assert.strictEqual(recovered.length, 0)
})

test('extractMuLawPayload strips the 12-byte RTP header from each packet', () => {
  const packets = [
    rtpPacket({ payload: Buffer.from([1, 2, 3]) }),
    rtpPacket({ payload: Buffer.from([4, 5]) })
  ]
  assert.deepStrictEqual(extractMuLawPayload(packets), Buffer.from([1, 2, 3, 4, 5]))
})

test('extractMuLawPayload skips non-PCMU and undersized packets', () => {
  const packets = [
    rtpPacket({ payloadType: 8, payload: Buffer.from([9, 9]) }), // PCMA, not PCMU
    Buffer.alloc(4), // shorter than an RTP header
    rtpPacket({ payload: Buffer.from([7]) })
  ]
  assert.deepStrictEqual(extractMuLawPayload(packets), Buffer.from([7]))
})

test('muLawToPcm16 decodes mu-law silence (0xFF) to a near-zero sample', () => {
  const pcm = muLawToPcm16(Buffer.from([0xff]))
  assert.strictEqual(pcm.length, 2)
  assert.ok(Math.abs(pcm.readInt16LE(0)) < 10)
})

test('pcm16ToWav produces a valid 44-byte RIFF/WAVE header for 8kHz mono 16-bit', () => {
  const pcm = Buffer.from([0x01, 0x00, 0x02, 0x00]) // 2 samples
  const wav = pcm16ToWav(pcm)
  assert.strictEqual(wav.subarray(0, 4).toString('ascii'), 'RIFF')
  assert.strictEqual(wav.subarray(8, 12).toString('ascii'), 'WAVE')
  assert.strictEqual(wav.readUInt16LE(22), 1) // channels
  assert.strictEqual(wav.readUInt32LE(24), 8000) // sample rate
  assert.strictEqual(wav.readUInt16LE(34), 16) // bits per sample
  assert.strictEqual(wav.readUInt32LE(40), pcm.length) // data chunk size
  assert.strictEqual(wav.length, 44 + pcm.length)
})

test('rtpPcmuPacketsToWav round-trips packets straight to a playable WAV buffer', () => {
  const packets = [rtpPacket({ payload: Buffer.from([0xff, 0xff]) })]
  const wav = rtpPcmuPacketsToWav(packets)
  assert.strictEqual(wav.subarray(0, 4).toString('ascii'), 'RIFF')
  assert.strictEqual(wav.length, 44 + 2 * 2) // 2 mu-law bytes -> 2 PCM16 samples
})

test('rtpPcmuPacketsToWav on an empty transmission produces a valid, empty WAV', () => {
  const wav = rtpPcmuPacketsToWav([])
  assert.strictEqual(wav.length, 44)
  assert.strictEqual(wav.readUInt32LE(40), 0)
})

test('rawPathToWavPath swaps the .raw extension for .wav, same basename', () => {
  assert.strictEqual(rawPathToWavPath('/data/recordings/1700000000-ch16.raw'), '/data/recordings/1700000000-ch16.wav')
})
