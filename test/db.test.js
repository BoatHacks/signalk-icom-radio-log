const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const db = require('../lib/db')

function tempDbPath () {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'radio-log-test-')), 'test.sqlite')
}

test('insertTransmission + getTransmission round-trip', () => {
  const database = db.openDb(tempDbPath())
  const id = db.insertTransmission(database, {
    channelNr: 16,
    startTs: 1000,
    endTs: 4000,
    durationMs: 3000,
    audioPath: '/tmp/x.raw',
    byteCount: 512,
    squelch: 1,
    lat: 51.5,
    lon: -0.1,
  })
  const tx = db.getTransmission(database, id)
  assert.strictEqual(tx.channel_nr, 16)
  assert.strictEqual(tx.duration_ms, 3000)
  assert.strictEqual(tx.audio_path, '/tmp/x.raw')
  assert.strictEqual(tx.direction, 'rx')
  database.close()
})

test('getTransmission returns null for missing id', () => {
  const database = db.openDb(tempDbPath())
  assert.strictEqual(db.getTransmission(database, 999), null)
  database.close()
})

test('listTransmissions orders newest first and respects limit', () => {
  const database = db.openDb(tempDbPath())
  db.insertTransmission(database, { channelNr: 16, startTs: 1000 })
  db.insertTransmission(database, { channelNr: 16, startTs: 3000 })
  db.insertTransmission(database, { channelNr: 16, startTs: 2000 })
  const rows = db.listTransmissions(database, { limit: 2 })
  assert.strictEqual(rows.length, 2)
  assert.strictEqual(rows[0].start_ts, 3000)
  assert.strictEqual(rows[1].start_ts, 2000)
  database.close()
})

test('listTransmissions filters by channelNr and time range', () => {
  const database = db.openDb(tempDbPath())
  db.insertTransmission(database, { channelNr: 16, startTs: 1000 })
  db.insertTransmission(database, { channelNr: 9, startTs: 2000 })
  db.insertTransmission(database, { channelNr: 16, startTs: 3000 })

  const ch16 = db.listTransmissions(database, { channelNr: 16 })
  assert.strictEqual(ch16.length, 2)

  const ranged = db.listTransmissions(database, { from: 1500, to: 2500 })
  assert.strictEqual(ranged.length, 1)
  assert.strictEqual(ranged[0].channel_nr, 9)
  database.close()
})

test('listOldestTransmissions orders oldest first', () => {
  const database = db.openDb(tempDbPath())
  db.insertTransmission(database, { channelNr: 16, startTs: 3000 })
  db.insertTransmission(database, { channelNr: 16, startTs: 1000 })
  const rows = db.listOldestTransmissions(database, 10)
  assert.strictEqual(rows[0].start_ts, 1000)
  assert.strictEqual(rows[1].start_ts, 3000)
  database.close()
})

test('deleteTransmission removes the row', () => {
  const database = db.openDb(tempDbPath())
  const id = db.insertTransmission(database, { channelNr: 16, startTs: 1000 })
  db.deleteTransmission(database, id)
  assert.strictEqual(db.getTransmission(database, id), null)
  database.close()
})
