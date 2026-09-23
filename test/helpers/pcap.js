'use strict'

// Minimal classic-pcap (not pcapng) reader, just enough to pull UDP/IPv4
// payloads with their ports out of an Ethernet-linktype capture. Used to
// replay real captured bytes through lib/protocol.js and lib/radioClient.js
// without needing a live radio.

function readUdpPackets (buf) {
  if (buf.readUInt32LE(0) !== 0xa1b2c3d4) {
    throw new Error('not a little-endian classic pcap file')
  }
  const packets = []
  let off = 24 // global header
  while (off + 16 <= buf.length) {
    const tsSec = buf.readUInt32LE(off)
    const tsUsec = buf.readUInt32LE(off + 4)
    const inclLen = buf.readUInt32LE(off + 8)
    off += 16
    const frame = buf.subarray(off, off + inclLen)
    off += inclLen

    if (frame.length < 14) continue
    const ethertype = frame.readUInt16BE(12)
    if (ethertype !== 0x0800) continue // IPv4 only

    const ip = frame.subarray(14)
    const ihl = (ip[0] & 0x0f) * 4
    const proto = ip[9]
    if (proto !== 17) continue // UDP only

    const srcIp = `${ip[12]}.${ip[13]}.${ip[14]}.${ip[15]}`
    const dstIp = `${ip[16]}.${ip[17]}.${ip[18]}.${ip[19]}`
    const udp = ip.subarray(ihl)
    const srcPort = udp.readUInt16BE(0)
    const dstPort = udp.readUInt16BE(2)
    const payload = udp.subarray(8)

    packets.push({
      ts: tsSec + tsUsec / 1e6,
      srcIp,
      dstIp,
      srcPort,
      dstPort,
      payload: Buffer.from(payload)
    })
  }
  return packets
}

module.exports = { readUdpPackets }
