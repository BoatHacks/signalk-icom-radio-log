'use strict'

const net = require('net')
const { encodeEvent, EventDecoder } = require('./wyomingProtocol')

const DEFAULT_TIMEOUT_MS = 15000
const AUDIO_CHUNK_BYTES = 4096

function parseWyomingUri (uri) {
  let url
  try {
    url = new URL(uri)
  } catch (err) {
    throw new Error(`invalid Wyoming URI: ${uri}`)
  }
  if (url.protocol !== 'tcp:' || !url.hostname || !url.port) {
    throw new Error(`Wyoming URI must be tcp://host:port: ${uri}`)
  }
  return { host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port) }
}

// Sends 16-bit PCM audio to a Wyoming ASR service (e.g. signalk-whisper,
// reached through the optional signalk-wyoming installation) and resolves
// with the transcript. Talks raw Wyoming TCP directly to the ASR service —
// signalk-wyoming's own REST API only supports recording *live* from a
// satellite mic (POST /api/transcribe), not submitting audio that's
// already been recorded, which is what a saved transmission is.
function transcribeAudio ({ uri, pcm, sampleRate, channels = 1, bitsPerSample = 16, language, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const { host, port } = parseWyomingUri(uri)
  const width = bitsPerSample / 8
  const format = { rate: sampleRate, width, channels }

  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port })
    const decoder = new EventDecoder()
    let settled = false
    let timer = null

    function finish (err, result) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      if (err) reject(err)
      else resolve(result)
    }

    timer = setTimeout(() => {
      finish(new Error(`timed out waiting for transcript from ${uri}`))
    }, timeoutMs)

    socket.once('error', (err) => finish(new Error(`Wyoming ASR connection failed (${uri}): ${err.message}`)))

    socket.once('connect', () => {
      const transcribeData = language ? { language } : {}
      socket.write(encodeEvent('transcribe', transcribeData))
      socket.write(encodeEvent('audio-start', { ...format, timestamp: null }))
      for (let offset = 0; offset < pcm.length; offset += AUDIO_CHUNK_BYTES) {
        const chunk = pcm.subarray(offset, offset + AUDIO_CHUNK_BYTES)
        socket.write(encodeEvent('audio-chunk', { ...format, timestamp: null }, chunk))
      }
      socket.write(encodeEvent('audio-stop', { timestamp: null }))
    })

    socket.on('data', (data) => {
      let events
      try {
        events = decoder.feed(data)
      } catch (err) {
        finish(new Error(`malformed response from Wyoming ASR service: ${err.message}`))
        return
      }
      for (const event of events) {
        if (event.type === 'transcript') {
          finish(null, { text: event.data.text ?? '', language: event.data.language })
          return
        }
        if (event.type === 'error') {
          finish(new Error(`Wyoming ASR service error: ${event.data.text || event.data.code || 'unknown error'}`))
          return
        }
      }
    })

    socket.once('close', () => {
      finish(new Error(`Wyoming ASR connection to ${uri} closed before a transcript arrived`))
    })
  })
}

module.exports = { transcribeAudio, parseWyomingUri }
