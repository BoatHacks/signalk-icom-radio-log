const test = require('node:test')
const assert = require('node:assert')
const { encodeEvent, EventDecoder, FramingError } = require('../lib/wyomingProtocol')

test('encodeEvent + EventDecoder round-trips a header-only event', () => {
  const wire = encodeEvent('describe')
  const decoder = new EventDecoder()
  const events = decoder.feed(wire)
  assert.strictEqual(events.length, 1)
  assert.strictEqual(events[0].type, 'describe')
  assert.deepStrictEqual(events[0].data, {})
})

test('encodeEvent + EventDecoder round-trips data + payload', () => {
  const payload = Buffer.from([1, 2, 3, 4])
  const wire = encodeEvent('audio-chunk', { rate: 8000, width: 2, channels: 1, timestamp: null }, payload)
  const decoder = new EventDecoder()
  const events = decoder.feed(wire)
  assert.strictEqual(events.length, 1)
  assert.strictEqual(events[0].type, 'audio-chunk')
  assert.deepStrictEqual(events[0].data, { rate: 8000, width: 2, channels: 1, timestamp: null })
  assert.ok(events[0].payload.equals(payload))
})

test('EventDecoder handles multiple events arriving in one chunk', () => {
  const wire = Buffer.concat([
    encodeEvent('transcribe', { language: 'en' }),
    encodeEvent('audio-start', { rate: 8000, width: 2, channels: 1, timestamp: null }),
    encodeEvent('audio-stop', { timestamp: null }),
  ])
  const decoder = new EventDecoder()
  const events = decoder.feed(wire)
  assert.deepStrictEqual(events.map((e) => e.type), ['transcribe', 'audio-start', 'audio-stop'])
})

test('EventDecoder handles an event split across multiple feed() calls', () => {
  const wire = encodeEvent('transcript', { text: 'anchor alarm drag detected' })
  const decoder = new EventDecoder()
  const mid = Math.floor(wire.length / 2)
  const first = decoder.feed(wire.subarray(0, mid))
  assert.strictEqual(first.length, 0)
  const second = decoder.feed(wire.subarray(mid))
  assert.strictEqual(second.length, 1)
  assert.strictEqual(second[0].data.text, 'anchor alarm drag detected')
})

test('EventDecoder throws FramingError on malformed header JSON', () => {
  const decoder = new EventDecoder()
  assert.throws(() => decoder.feed(Buffer.from('not json\n')), FramingError)
})
