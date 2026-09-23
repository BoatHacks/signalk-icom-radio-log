const test = require('node:test')
const assert = require('node:assert')
const RadioClient = require('../lib/radioClient')
const protocol = require('../lib/protocol')

// Synthetic packets matching lib/protocol.js's parseChannelStatus offsets:
// response-type at [17], channel number little-endian at [26,27], squelch
// at [34], busy at [35].
function statusPacket ({ channelNr, busy }) {
  const buf = Buffer.alloc(36)
  buf[17] = protocol.CHANNEL_STATUS_RESPONSE_TYPE
  buf[26] = channelNr & 0xff
  buf[27] = (channelNr >> 8) & 0xff
  buf[34] = 0
  buf[35] = busy ? 0x80 : 0x00
  return buf
}

test('a dual-watch update for an idle channel does not close an active transmission', (t) => {
  const rc = new RadioClient()
  const events = []
  rc.on('tx-start', (e) => events.push({ type: 'tx-start', channelNr: e.channelNr }))
  rc.on('tx-end', () => events.push({ type: 'tx-end' }))

  rc._onServerCMessage(statusPacket({ channelNr: 84, busy: true })) // tx-start
  rc._onServerCMessage(statusPacket({ channelNr: 93, busy: true })) // scanned to other channel, also busy — ignored
  rc._onServerCMessage(statusPacket({ channelNr: 93, busy: false })) // other channel idle — must not end channel 84's tx
  assert.deepStrictEqual(events, [{ type: 'tx-start', channelNr: 84 }])
  assert.strictEqual(rc.busy, true)
})

test('a brief squelch-closed blip on the active channel is debounced, not treated as tx-end', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const rc = new RadioClient({ busyDebounceMs: 200 })
  const events = []
  rc.on('tx-start', (e) => events.push({ type: 'tx-start', channelNr: e.channelNr }))
  rc.on('tx-end', () => events.push({ type: 'tx-end' }))

  rc._onServerCMessage(statusPacket({ channelNr: 84, busy: true }))
  rc._onServerCMessage(statusPacket({ channelNr: 84, busy: false })) // brief blip
  t.mock.timers.tick(50) // well under the 200ms debounce
  rc._onServerCMessage(statusPacket({ channelNr: 84, busy: true })) // resumes — should cancel the pending end
  t.mock.timers.tick(300) // past the debounce window, nothing pending now

  assert.deepStrictEqual(events, [{ type: 'tx-start', channelNr: 84 }])
  assert.strictEqual(rc.busy, true)
})

test('a squelch-closed reading that outlasts the debounce window ends the transmission', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const rc = new RadioClient({ busyDebounceMs: 200 })
  const events = []
  rc.on('tx-start', (e) => events.push({ type: 'tx-start', channelNr: e.channelNr }))
  rc.on('tx-end', () => events.push({ type: 'tx-end' }))

  rc._onServerCMessage(statusPacket({ channelNr: 84, busy: true }))
  rc._onServerCMessage(statusPacket({ channelNr: 84, busy: false }))
  t.mock.timers.tick(201)

  assert.deepStrictEqual(events, [{ type: 'tx-start', channelNr: 84 }, { type: 'tx-end' }])
  assert.strictEqual(rc.busy, false)
})
