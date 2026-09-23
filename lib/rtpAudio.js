'use strict'

// Frames the RX voice stream's raw RTP/PCMU packets for on-disk storage
// (forensic — exact captured bytes, undecoded), and decodes that framed
// form into a playable WAV on demand, per request, rather than storing a
// decoded copy.
//
// Confirmed against a real capture (tools/capture-spike/capture.sanitized.pcap,
// see CHANGELOG.md "Phase 0 findings"): the M510E/CT-M500 sends plain RTP,
// payload type 0 (PCMU/G.711 mu-law), 8kHz mono, 320-byte payloads. No
// proprietary Icom vocoder for RX audio — v1 scope only, TX/hailer codec
// is still unconfirmed (v2).

const RTP_HEADER_LENGTH = 12
const FRAME_LENGTH_PREFIX_BYTES = 4
const PCMU_PAYLOAD_TYPE = 0
const SAMPLE_RATE = 8000
const CHANNELS = 1
const BITS_PER_SAMPLE = 16

// ITU-T G.711 mu-law decode table (mu-law byte -> 16-bit signed PCM sample).
function muLawByteToPcm16 (byte) {
  const u = ~byte & 0xff
  const sign = u & 0x80
  const exponent = (u >> 4) & 0x07
  const mantissa = u & 0x0f
  let sample = ((mantissa << 3) + 0x84) << exponent
  sample -= 0x84
  return sign ? -sample : sample
}

// On-disk storage keeps the raw captured RTP packets (forensic — exact
// bytes as received, undecoded), not a decoded WAV. Concatenating packets
// directly would lose each packet's boundary, so each one is stored with
// a 4-byte big-endian length prefix; decoding to WAV happens on demand,
// per request, from this framed form.
function frameRtpPackets (rtpPackets) {
  const parts = []
  for (const pkt of rtpPackets) {
    const lengthPrefix = Buffer.alloc(FRAME_LENGTH_PREFIX_BYTES)
    lengthPrefix.writeUInt32BE(pkt.length, 0)
    parts.push(lengthPrefix, pkt)
  }
  return Buffer.concat(parts)
}

// Reverses frameRtpPackets. Stops cleanly (rather than throwing) at a
// truncated trailing record, e.g. from an interrupted write.
function unframeRtpPackets (framedBuffer) {
  const packets = []
  let offset = 0
  while (offset + FRAME_LENGTH_PREFIX_BYTES <= framedBuffer.length) {
    const length = framedBuffer.readUInt32BE(offset)
    offset += FRAME_LENGTH_PREFIX_BYTES
    if (offset + length > framedBuffer.length) break
    packets.push(framedBuffer.subarray(offset, offset + length))
    offset += length
  }
  return packets
}

// Strips the 12-byte RTP header from each captured packet and returns just
// the mu-law payload bytes, skipping anything that isn't a well-formed
// PCMU packet (defensive — v1 only expects PT 0, but a captured stream
// could contain other traffic if this is ever called on unfiltered data).
function extractMuLawPayload (rtpPackets) {
  const payloads = []
  for (const pkt of rtpPackets) {
    if (!Buffer.isBuffer(pkt) || pkt.length <= RTP_HEADER_LENGTH) continue
    const version = pkt[0] >> 6
    const payloadType = pkt[1] & 0x7f
    if (version !== 2 || payloadType !== PCMU_PAYLOAD_TYPE) continue
    payloads.push(pkt.subarray(RTP_HEADER_LENGTH))
  }
  return Buffer.concat(payloads)
}

function muLawToPcm16 (muLawBuffer) {
  const pcm = Buffer.alloc(muLawBuffer.length * 2)
  for (let i = 0; i < muLawBuffer.length; i++) {
    pcm.writeInt16LE(muLawByteToPcm16(muLawBuffer[i]), i * 2)
  }
  return pcm
}

// Wraps 16-bit signed little-endian PCM in a standard RIFF/WAVE header.
function pcm16ToWav (pcmBuffer, { sampleRate = SAMPLE_RATE, channels = CHANNELS, bitsPerSample = BITS_PER_SAMPLE } = {}) {
  const blockAlign = channels * (bitsPerSample / 8)
  const byteRate = sampleRate * blockAlign
  const header = Buffer.alloc(44)

  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + pcmBuffer.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16) // fmt chunk size
  header.writeUInt16LE(1, 20) // PCM format
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bitsPerSample, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(pcmBuffer.length, 40)

  return Buffer.concat([header, pcmBuffer])
}

// Convenience entry point: raw captured RTP packets (as emitted by
// RadioClient's 'voice-data' event) straight to a playable WAV buffer.
function rtpPcmuPacketsToWav (rtpPackets) {
  const muLaw = extractMuLawPayload(rtpPackets)
  const pcm = muLawToPcm16(muLaw)
  return pcm16ToWav(pcm)
}

module.exports = {
  RTP_HEADER_LENGTH,
  PCMU_PAYLOAD_TYPE,
  SAMPLE_RATE,
  frameRtpPackets,
  unframeRtpPackets,
  extractMuLawPayload,
  muLawToPcm16,
  pcm16ToWav,
  rtpPcmuPacketsToWav
}
