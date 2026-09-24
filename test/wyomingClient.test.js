const test = require('node:test')
const assert = require('node:assert')
const net = require('net')
const { encodeEvent, EventDecoder } = require('../lib/wyomingProtocol')
const { transcribeAudio, parseWyomingUri } = require('../lib/wyomingClient')

// A minimal scriptable Wyoming ASR server: decodes incoming events and lets
// the test decide how to respond once audio-stop arrives. Mirrors the real
// transcribe/audio-start/audio-chunk/audio-stop -> transcript exchange
// without needing a real whisper/signalk-wyoming install.
function startMockAsrServer (onAudioStop) {
  const receivedEvents = []
  const server = net.createServer((socket) => {
    const decoder = new EventDecoder()
    socket.on('data', (chunk) => {
      const events = decoder.feed(chunk)
      for (const event of events) {
        receivedEvents.push(event)
        if (event.type === 'audio-stop') onAudioStop(socket, receivedEvents)
      }
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, receivedEvents }))
  })
}

function closeServer (server) {
  return new Promise((resolve) => server.close(resolve))
}

test('parseWyomingUri rejects non-tcp and malformed URIs', () => {
  assert.throws(() => parseWyomingUri('http://localhost:10300'))
  assert.throws(() => parseWyomingUri('not a uri'))
  assert.throws(() => parseWyomingUri('tcp://localhost'))
})

test('transcribeAudio sends transcribe/audio-start/audio-chunk/audio-stop and resolves with the transcript', async () => {
  const { server, port, receivedEvents } = await startMockAsrServer((socket) => {
    socket.write(encodeEvent('transcript', { text: 'mayday mayday' }))
  })
  try {
    const pcm = Buffer.alloc(9000, 0x11) // spans multiple 4096-byte audio-chunks
    const result = await transcribeAudio({ uri: `tcp://127.0.0.1:${port}`, pcm, sampleRate: 8000, language: 'en' })
    assert.strictEqual(result.text, 'mayday mayday')

    const types = receivedEvents.map((e) => e.type)
    assert.strictEqual(types[0], 'transcribe')
    assert.strictEqual(receivedEvents[0].data.language, 'en')
    assert.strictEqual(types[1], 'audio-start')
    assert.strictEqual(receivedEvents[1].data.rate, 8000)
    const chunkEvents = receivedEvents.filter((e) => e.type === 'audio-chunk')
    assert.strictEqual(chunkEvents.length, 3) // 9000 bytes / 4096-byte chunks
    const reassembled = Buffer.concat(chunkEvents.map((e) => e.payload))
    assert.ok(reassembled.equals(pcm))
    assert.strictEqual(types[types.length - 1], 'audio-stop')
  } finally {
    await closeServer(server)
  }
})

test('transcribeAudio ignores non-transcript events before the real transcript arrives', async () => {
  const { server, port } = await startMockAsrServer((socket) => {
    socket.write(encodeEvent('transcript-start', {}))
    socket.write(encodeEvent('transcript-chunk', { text: 'partial' }))
    socket.write(encodeEvent('transcript', { text: 'final answer' }))
  })
  try {
    const result = await transcribeAudio({ uri: `tcp://127.0.0.1:${port}`, pcm: Buffer.alloc(100), sampleRate: 8000 })
    assert.strictEqual(result.text, 'final answer')
  } finally {
    await closeServer(server)
  }
})

test('transcribeAudio rejects on a Wyoming error event', async () => {
  const { server, port } = await startMockAsrServer((socket) => {
    socket.write(encodeEvent('error', { text: 'model not loaded' }))
  })
  try {
    await assert.rejects(
      transcribeAudio({ uri: `tcp://127.0.0.1:${port}`, pcm: Buffer.alloc(100), sampleRate: 8000 }),
      /model not loaded/
    )
  } finally {
    await closeServer(server)
  }
})

test('transcribeAudio rejects when the connection is refused (service not running)', async () => {
  // Nothing listens on this port.
  await assert.rejects(
    transcribeAudio({ uri: 'tcp://127.0.0.1:1', pcm: Buffer.alloc(10), sampleRate: 8000, timeoutMs: 2000 }),
    /Wyoming ASR connection failed/
  )
})

test('transcribeAudio rejects on timeout when the service never replies', async () => {
  const { server, port } = await startMockAsrServer(() => { /* never respond */ })
  try {
    await assert.rejects(
      transcribeAudio({ uri: `tcp://127.0.0.1:${port}`, pcm: Buffer.alloc(10), sampleRate: 8000, timeoutMs: 100 }),
      /timed out/
    )
  } finally {
    await closeServer(server)
  }
})
