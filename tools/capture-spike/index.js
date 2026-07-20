#!/usr/bin/env node
'use strict'

/*
 * icom-capture-spike
 * -------------------
 * Phase 0 research spike for signalk-icom-radio-log.
 *
 * This is NOT the plugin. It's a standalone script to run next to a real
 * IC-M510E on the boat's WiFi, to answer the open questions from the
 * project plan before any plugin code gets written:
 *
 *   1. What codec is inside the "voice" UDP stream's RTP payload?
 *   2. Does a 4th silent client signing in alongside real RS-M500 apps
 *      cause any problems (kicked sessions, radio hiccups)?
 *   3. Is TX (mic/PTT) audio visible on WiFi at all, or only RX?
 *   4. How clean is the busy-flag transition as a clip start/end marker?
 *
 * All protocol details below (magic bytes, port layout, sign-in packet
 * shape, ip2hex/port2hex byte-swapping) are taken directly from
 * https://github.com/htool/signalk-icom-m510e-plugin and
 * https://github.com/htool/signalk-icom-ct-m500-plugin — this is
 * unofficial, reverse-engineered behaviour, not an Icom spec. Expect to
 * have to patch this after the first real capture.
 *
 * Usage:
 *   node index.js [--out ./captures] [--bind <local-ip>] [--duration 0]
 *
 *   --out       Directory to write captures into (default ./captures)
 *   --bind      Local IP to bind/advertise (default: first non-internal
 *               IPv4 from the `ip` package). Set this explicitly if the
 *               machine has more than one interface (e.g. boat LAN +
 *               laptop WiFi hotspot).
 *   --duration  Seconds to run before exiting automatically. 0 = run
 *               until Ctrl-C (default).
 *   --quiet     Suppress the live hex dump of every packet (metadata
 *               and transmission events still print).
 *
 * Output layout:
 *   <out>/session.jsonl        One JSON line per event (see logEvent)
 *   <out>/voice/<n>-<ts>.raw   Raw UDP payloads for each detected
 *                              transmission, concatenated as-received.
 *                              This is deliberately NOT decoded/muxed
 *                              into a .wav — the point of phase 0 is to
 *                              figure out what's actually inside these
 *                              bytes first (see README.md).
 */

const dgram = require('dgram')
const fs = require('fs')
const path = require('path')
const ip = require('ip')
const isRtp = require('is-rtp')
const RTPParser = require('@penggy/easy-rtp-parser')

// ---------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------

function parseArgs (argv) {
  const args = { out: './captures', bind: ip.address(), duration: 0, quiet: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--out') args.out = argv[++i]
    else if (a === '--bind') args.bind = argv[++i]
    else if (a === '--duration') args.duration = Number(argv[++i]) || 0
    else if (a === '--quiet') args.quiet = true
    else if (a === '--help' || a === '-h') {
      console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0])
      process.exit(0)
    }
  }
  return args
}

const args = parseArgs(process.argv.slice(2))

// ---------------------------------------------------------------------
// Output setup
// ---------------------------------------------------------------------

const OUT_DIR = path.resolve(args.out)
const VOICE_DIR = path.join(OUT_DIR, 'voice')
fs.mkdirSync(VOICE_DIR, { recursive: true })
const sessionLogPath = path.join(OUT_DIR, 'session.jsonl')
const sessionLogFd = fs.openSync(sessionLogPath, 'a')

function logEvent (type, data) {
  const line = JSON.stringify({ ts: new Date().toISOString(), type, ...data })
  fs.writeSync(sessionLogFd, line + '\n')
  if (!args.quiet || type !== 'raw') {
    console.log(`[${type}]`, JSON.stringify(data))
  }
}

// ---------------------------------------------------------------------
// Protocol constants (from htool's plugins — see file header)
// ---------------------------------------------------------------------

const ICOM_HEX = '49636f6d' // ASCII "Icom" — magic prefix on every packet
const RS_M500_HEX = '52532d4d353030' // ASCII "RS-M500" — client identity we sign in as
const DISCOVERY_PORT = 50000
const CHANNEL_CMD_PORT = 50003
const NMEA_INJECT_PORT = 50004

function ip2hex (addr) {
  return addr.split('.')
    .map(n => ('00' + parseInt(n, 10).toString(16)).slice(-2))
    .reverse()
    .join('')
}

function port2hex (port) {
  const hex = ('0000' + port.toString(16)).slice(-4)
  // byte-swap: htool's plugins consistently do porthex[2,3,0,1]
  return hex[2] + hex[3] + hex[0] + hex[1]
}

// ---------------------------------------------------------------------
// State
// ---------------------------------------------------------------------

const myIP = args.bind
const myIPHex = ip2hex(myIP)

const radio = { ip: null, port: null }
let signedIn = false
let keepAliveTimer = null
let findRadioTimer = null

let listenPortA, listenPortB, listenPortC, listenPortD, listenPortE, listenPortVoice

// Transmission (busy-flag) bookkeeping
let busy = false
let currentTx = null // { n, startTs, fd, path, packetCount, payloadTypes: Set }
let txCounter = 0

const serverA = dgram.createSocket('udp4') // discovery / sign-in
const serverB = dgram.createSocket('udp4') // keepalive / session heartbeat
const serverC = dgram.createSocket('udp4') // channel status (busy/squelch/channel)
const serverD = dgram.createSocket('udp4') // channel table / NMEA
const serverE = dgram.createSocket('udp4') // NMEA0183 in (CT-M500 side)
const serverVoice = dgram.createSocket('udp4') // RTP voice stream

// ---------------------------------------------------------------------
// Discovery + sign-in
// ---------------------------------------------------------------------

function broadcastDiscovery () {
  const portHex = port2hex(listenPortA)
  const msg = Buffer.from(
    ICOM_HEX + '01ff0000' + myIPHex + 'ffffffff' + '0000000004000000' + portHex + '0000',
    'hex'
  )
  serverA.send(msg, 0, msg.length, DISCOVERY_PORT, '255.255.255.255', (err) => {
    if (err) logEvent('error', { where: 'broadcastDiscovery', err: String(err) })
  })
}

function sendSignIn () {
  const portBhex = port2hex(listenPortB)
  const portChex = port2hex(listenPortC)
  const portDhex = port2hex(listenPortD)
  const portEhex = port2hex(listenPortE)
  const portVoicehex = port2hex(listenPortVoice)

  // Layout taken verbatim from htool's sendSignIn(): header, then D/Voice/B/C/E
  // ports (in that order!), then a 7-byte ASCII client-identity field, then
  // a fixed trailer that's currently unexplained (looks like it may be a
  // capability bitmask or padding — flag this if a real radio rejects it).
  const signIn = Buffer.from(
    ICOM_HEX + '01ff0000' + myIPHex + ip2hex(radio.ip) +
    '00020000380000000200' +
    portDhex + portVoicehex + portBhex + portChex + portEhex +
    RS_M500_HEX +
    '00000042134195000000000000000000000000000000000000000000000000000000000000',
    'hex'
  )
  serverA.send(signIn, 0, signIn.length, radio.port, radio.ip, (err) => {
    if (err) logEvent('error', { where: 'sendSignIn', err: String(err) })
  })
  logEvent('sign-in-sent', { radioIp: radio.ip, radioPort: radio.port })
}

function keepAlive () {
  const msg = Buffer.from('8001004', 'hex')
  serverB.send(msg, 0, msg.length, radio.port, radio.ip, () => {})
}

function askChannel () {
  const msg = Buffer.from(ICOM_HEX + '01000000' + myIPHex + ip2hex(radio.ip) + '0103000000000000', 'hex')
  serverC.send(msg, 0, msg.length, CHANNEL_CMD_PORT, radio.ip, () => {})
}

// ---------------------------------------------------------------------
// Transmission (busy-flag) tracking — RX clip boundaries
// ---------------------------------------------------------------------

function startTx (channelHint) {
  if (currentTx) endTx('overlap') // shouldn't happen, but don't leak fds
  txCounter++
  const startTs = Date.now()
  const filePath = path.join(VOICE_DIR, `${txCounter}-${startTs}.raw`)
  currentTx = {
    n: txCounter,
    startTs,
    channelHint,
    fd: fs.openSync(filePath, 'w'),
    path: filePath,
    packetCount: 0,
    byteCount: 0,
    payloadTypes: new Set()
  }
  logEvent('tx-start', { n: txCounter, channelHint })
}

function endTx (reason) {
  if (!currentTx) return
  const durationMs = Date.now() - currentTx.startTs
  fs.closeSync(currentTx.fd)
  logEvent('tx-end', {
    n: currentTx.n,
    reason,
    durationMs,
    packetCount: currentTx.packetCount,
    byteCount: currentTx.byteCount,
    payloadTypes: [...currentTx.payloadTypes],
    path: currentTx.path
  })
  currentTx = null
}

// ---------------------------------------------------------------------
// Socket handlers
// ---------------------------------------------------------------------

serverA.on('message', (msg, info) => {
  if (!signedIn) {
    clearInterval(findRadioTimer)
    radio.ip = info.address
    radio.port = info.port
    signedIn = true
    logEvent('radio-found', { ip: radio.ip, port: radio.port, header: msg.slice(0, 17).toString('hex') })
    sendSignIn()
  } else {
    logEvent('raw', { server: 'A', from: `${info.address}:${info.port}`, len: msg.length, hex: msg.toString('hex') })
  }
})

serverB.on('message', (msg, info) => {
  if (!keepAliveTimer) {
    keepAliveTimer = setInterval(keepAlive, 5000)
    logEvent('keepalive-started', {})
    setTimeout(askChannel, 4000)
  }
  if (!msg.toString('hex').startsWith('80c9000')) {
    logEvent('raw', { server: 'B', from: `${info.address}:${info.port}`, len: msg.length, hex: msg.toString('hex') })
  }
})

serverC.on('message', (msg, info) => {
  const hex = Array.from(msg)
  if (msg.length < 35) {
    logEvent('raw', { server: 'C', from: `${info.address}:${info.port}`, len: msg.length, hex: msg.toString('hex') })
    return
  }
  const s = hex[35]
  const channelNr = (hex[27] << 8) + hex[26] // as decoded in htool's getChannel()
  if (s === 128 && !busy) {
    busy = true
    startTx(channelNr)
  } else if (s === 0 && busy) {
    busy = false
    endTx('squelch-closed')
  }
  logEvent('channel-status', { busy, channelNr, squelch: hex[34], raw: msg.toString('hex') })
})

serverD.on('message', (msg, info) => {
  logEvent('raw', { server: 'D', from: `${info.address}:${info.port}`, len: msg.length, hex: msg.toString('hex') })
})

serverE.on('message', (msg, info) => {
  logEvent('raw', { server: 'E', from: `${info.address}:${info.port}`, len: msg.length, hex: msg.toString('hex') })
})

serverVoice.on('message', (msg, info) => {
  const isRtpPacket = isRtp(msg)
  let rtpInfo = null
  if (isRtpPacket) {
    try {
      const rtp = RTPParser.parseRtpPacket(msg)
      rtpInfo = {
        payloadType: rtp.header ? rtp.header.pt : rtp.pt,
        seq: rtp.header ? rtp.header.sequenceNumber : rtp.sequenceNumber,
        payloadLen: rtp.payload ? rtp.payload.length : null
      }
    } catch (e) {
      rtpInfo = { parseError: String(e) }
    }
  }

  if (currentTx) {
    fs.writeSync(currentTx.fd, msg)
    currentTx.packetCount++
    currentTx.byteCount += msg.length
    if (rtpInfo && rtpInfo.payloadType !== undefined) currentTx.payloadTypes.add(rtpInfo.payloadType)
  }

  // Always log a summary line (not full hex — voice traffic is high rate)
  logEvent('voice-packet', {
    from: `${info.address}:${info.port}`,
    len: msg.length,
    isRtp: isRtpPacket,
    rtp: rtpInfo,
    inTx: !!currentTx,
    first16Hex: msg.slice(0, 16).toString('hex')
  })
})

for (const [name, sock] of [['A', serverA], ['B', serverB], ['C', serverC], ['D', serverD], ['E', serverE], ['Voice', serverVoice]]) {
  sock.on('error', (err) => {
    logEvent('error', { server: name, err: String(err) })
  })
}

// ---------------------------------------------------------------------
// Bind everything, then start discovery
// ---------------------------------------------------------------------

function bindAll () {
  const binds = [
    [serverA, s => { listenPortA = s.address().port }],
    [serverB, s => { listenPortB = s.address().port }],
    [serverC, s => { listenPortC = s.address().port }],
    [serverD, s => { listenPortD = s.address().port }],
    [serverE, s => { listenPortE = s.address().port }],
    [serverVoice, s => { listenPortVoice = s.address().port }]
  ]
  let remaining = binds.length
  binds.forEach(([sock, onBound]) => {
    sock.bind({ address: myIP }, () => {
      onBound(sock)
      if (sock === serverA) serverA.setBroadcast(true)
      remaining--
      if (remaining === 0) {
        logEvent('bound', {
          myIP,
          ports: { A: listenPortA, B: listenPortB, C: listenPortC, D: listenPortD, E: listenPortE, Voice: listenPortVoice }
        })
        findRadioTimer = setInterval(broadcastDiscovery, 1000)
        broadcastDiscovery()
      }
    })
  })
}

console.log(`icom-capture-spike starting. Binding to ${myIP}, writing captures to ${OUT_DIR}`)
console.log('Waiting for IC-M510E to answer discovery broadcast on UDP/50000 ...')
bindAll()

if (args.duration > 0) {
  setTimeout(shutdown, args.duration * 1000)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

function shutdown () {
  console.log('\nShutting down, closing sockets and any open capture file...')
  if (currentTx) endTx('shutdown')
  clearInterval(findRadioTimer)
  clearInterval(keepAliveTimer)
  for (const sock of [serverA, serverB, serverC, serverD, serverE, serverVoice]) {
    try { sock.close() } catch (e) { /* already closed */ }
  }
  fs.closeSync(sessionLogFd)
  console.log(`Session log: ${sessionLogPath}`)
  console.log(`Voice captures: ${VOICE_DIR}`)
  process.exit(0)
}
