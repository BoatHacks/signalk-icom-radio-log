'use strict'

// Minimal Wyoming TTS client — the synthesis-direction counterpart to
// lib/wyomingClient.js's transcribeAudio(). Talks to a Piper (or other
// Wyoming TTS) service directly: send `synthesize`, collect `audio-start`
// (format) + `audio-chunk`(s) (raw PCM payload) + `audio-stop`.
//
// Dev/test tooling only — not used by the plugin at runtime. See
// scripts/generate-test-audio.js.

const net = require('net')
const { encodeEvent, EventDecoder } = require('../lib/wyomingProtocol')

function synthesize ({ host, port, text, timeoutMs = 20000 }) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port })
    const decoder = new EventDecoder()
    let format = null
    const chunks = []
    let settled = false
    const timer = setTimeout(() => finish(new Error('timed out waiting for synthesis')), timeoutMs)

    function finish (err, result) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      if (err) reject(err)
      else resolve(result)
    }

    socket.once('error', (err) => finish(new Error(`connection failed: ${err.message}`)))
    socket.once('connect', () => {
      socket.write(encodeEvent('synthesize', { text }))
    })
    socket.on('data', (data) => {
      let events
      try {
        events = decoder.feed(data)
      } catch (err) {
        finish(new Error(`framing error: ${err.message}`))
        return
      }
      for (const event of events) {
        if (event.type === 'audio-start') {
          format = { rate: event.data.rate, width: event.data.width, channels: event.data.channels }
        } else if (event.type === 'audio-chunk') {
          chunks.push(event.payload)
        } else if (event.type === 'audio-stop') {
          finish(null, { format, pcm: Buffer.concat(chunks) })
        } else if (event.type === 'error') {
          finish(new Error(`piper error: ${event.data.text || 'unknown'}`))
        }
      }
    })
    socket.once('close', () => finish(new Error('connection closed before audio-stop')))
  })
}

module.exports = { synthesize }
