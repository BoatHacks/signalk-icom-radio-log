'use strict'

// Icom M510E/CT-M500 WiFi protocol constants and pure encode/decode helpers.
//
// Reverse-engineered by GitHub user htool, not an Icom spec:
//   https://github.com/htool/signalk-icom-m510e-plugin
//   https://github.com/htool/signalk-icom-ct-m500-plugin
//
// Kept separate from RadioClient so every function here can be unit
// tested without a socket or real hardware.

const ICOM_HEX = '49636f6d' // ASCII "Icom" — magic prefix on every packet
const RS_M500_HEX = '52532d4d353030' // ASCII "RS-M500" — client identity we sign in as
const DISCOVERY_PORT = 50000
const CHANNEL_CMD_PORT = 50003

function ip2hex (addr) {
  const parts = addr.split('.')
  if (parts.length !== 4) throw new Error(`not an IPv4 address: ${addr}`)
  return parts
    .map((n) => {
      const v = parseInt(n, 10)
      if (!Number.isInteger(v) || v < 0 || v > 255) throw new Error(`not an IPv4 address: ${addr}`)
      return ('00' + v.toString(16)).slice(-2)
    })
    .reverse()
    .join('')
}

function port2hex (port) {
  if (!Number.isInteger(port) || port < 0 || port > 0xffff) throw new Error(`not a valid port: ${port}`)
  const hex = ('0000' + port.toString(16)).slice(-4)
  // byte-swap: htool's plugins consistently do porthex[2,3,0,1]
  return hex[2] + hex[3] + hex[0] + hex[1]
}

function buildDiscoveryPacket ({ myIP, listenPortA }) {
  const portHex = port2hex(listenPortA)
  return Buffer.from(
    ICOM_HEX + '01ff0000' + ip2hex(myIP) + 'ffffffff' + '0000000004000000' + portHex + '0000',
    'hex'
  )
}

function buildSignInPacket ({ myIP, radioIP, ports }) {
  const { d, voice, b, c, e } = ports
  return Buffer.from(
    ICOM_HEX + '01ff0000' + ip2hex(myIP) + ip2hex(radioIP) +
    '00020000380000000200' +
    port2hex(d) + port2hex(voice) + port2hex(b) + port2hex(c) + port2hex(e) +
    RS_M500_HEX +
    '00000042134195000000000000000000000000000000000000000000000000000000000000',
    'hex'
  )
}

function buildKeepAlivePacket () {
  return Buffer.from('8001004', 'hex')
}

function buildChannelQueryPacket ({ myIP, radioIP }) {
  return Buffer.from(ICOM_HEX + '01000000' + ip2hex(myIP) + ip2hex(radioIP) + '0103000000000000', 'hex')
}

// Port CHANNEL_CMD_PORT carries two distinct response shapes, both
// "Icom"-prefixed, distinguished by the response-type byte at [17]:
//   0x01 — a short (28-byte) ack/heartbeat, no channel data at all
//   0x02 — the full (40-byte) channel-status response this function parses
// Confirmed against a real capture (tools/capture-spike/capture.sanitized.pcap):
// every real status response was exactly 40 bytes with [17] === 0x02, and
// every 28-byte response had [17] === 0x01. The `msg.length < 36` guard
// below is a safety bound for the byte reads, not the actual packet-type
// discriminator — that's checked explicitly via [17].
//
// Byte offsets per htool's getChannel(): channel number is a little-endian
// pair at [26,27], squelch/busy flag is byte [34]/[35] (0x80 = busy).
const CHANNEL_STATUS_RESPONSE_TYPE = 0x02

function parseChannelStatus (msg) {
  if (!Buffer.isBuffer(msg) || msg.length < 36) return null
  if (msg[17] !== CHANNEL_STATUS_RESPONSE_TYPE) return null
  const channelNr = (msg[27] << 8) + msg[26]
  const squelchByte = msg[34]
  const busy = msg[35] === 128
  return { busy, channelNr, squelch: squelchByte }
}

module.exports = {
  ICOM_HEX,
  RS_M500_HEX,
  DISCOVERY_PORT,
  CHANNEL_CMD_PORT,
  CHANNEL_STATUS_RESPONSE_TYPE,
  ip2hex,
  port2hex,
  buildDiscoveryPacket,
  buildSignInPacket,
  buildKeepAlivePacket,
  buildChannelQueryPacket,
  parseChannelStatus
}
