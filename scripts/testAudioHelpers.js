'use strict'

// Encode-direction helpers for turning synthesized speech into something
// that looks like real M510E RX audio, for testing the transcription
// pipeline without a real radio. Encode-only — the plugin itself (v1,
// RX-only) never needs to *produce* mu-law/RTP, only decode it
// (lib/rtpAudio.js), which is why these live here rather than in lib/.

const RTP_PAYLOAD_BYTES = 320 // matches the real M510E capture, see CHANGELOG.md

// Simple linear-interpolation resampler — good enough for speech, not
// broadcast quality. Piper's native rate (22050Hz) doesn't match the
// radio's real RX rate (8000Hz, see CHANGELOG.md Phase 0 findings), so
// this mimics what actually happens to a voice on its way through a real
// VHF radio's audio chain.
function resamplePcm16 (pcm, fromRate, toRate) {
  const inSamples = pcm.length / 2
  const outSamples = Math.round(inSamples * toRate / fromRate)
  const out = Buffer.alloc(outSamples * 2)
  for (let i = 0; i < outSamples; i++) {
    const srcPos = i * fromRate / toRate
    const idx0 = Math.floor(srcPos)
    const idx1 = Math.min(idx0 + 1, inSamples - 1)
    const frac = srcPos - idx0
    const s0 = pcm.readInt16LE(idx0 * 2)
    const s1 = pcm.readInt16LE(idx1 * 2)
    const sample = Math.round(s0 + (s1 - s0) * frac)
    out.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), i * 2)
  }
  return out
}

// Standard G.711 mu-law encoder (ITU-T G.711 reference algorithm) — the
// inverse of lib/rtpAudio.js's muLawByteToPcm16.
function pcm16ToMuLawByte (sample) {
  const BIAS = 0x84
  const CLIP = 32635
  let sign = (sample >> 8) & 0x80
  if (sign !== 0) sample = -sample
  if (sample > CLIP) sample = CLIP
  sample += BIAS
  let exponent = 7
  for (let mask = 0x4000; (sample & mask) === 0 && exponent > 0; exponent--, mask >>= 1) {}
  const mantissa = (sample >> (exponent + 3)) & 0x0f
  return ~(sign | (exponent << 4) | mantissa) & 0xff
}

function pcm16ToMuLaw (pcm) {
  const out = Buffer.alloc(pcm.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = pcm16ToMuLawByte(pcm.readInt16LE(i * 2))
  return out
}

// Wraps mu-law payload bytes into fake RTP packets matching the real
// M510E's wire format (RTP v2, PT=0, 320-byte payloads, seq/timestamp
// incrementing) — see test/pcap-replay.test.js for the real capture this
// mirrors.
function muLawToFakeRtpPackets (muLaw) {
  const packets = []
  let seq = 1000
  let timestamp = 0
  for (let offset = 0; offset < muLaw.length; offset += RTP_PAYLOAD_BYTES) {
    const payload = muLaw.subarray(offset, offset + RTP_PAYLOAD_BYTES)
    const header = Buffer.alloc(12)
    header[0] = 0x80 // V=2
    header[1] = 0x00 // PT=0 (PCMU)
    header.writeUInt16BE(seq++, 2)
    header.writeUInt32BE(timestamp, 4)
    header.writeUInt32BE(0x2250b644, 8) // arbitrary SSRC
    timestamp += payload.length
    packets.push(Buffer.concat([header, payload]))
  }
  return packets
}

module.exports = { resamplePcm16, pcm16ToMuLaw, muLawToFakeRtpPackets, RTP_PAYLOAD_BYTES }
