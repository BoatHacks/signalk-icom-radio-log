'use strict'

const { DatabaseSync } = require('node:sqlite')

const SCHEMA = `
CREATE TABLE IF NOT EXISTS transmissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  direction TEXT NOT NULL DEFAULT 'rx',
  channel_nr INTEGER,
  start_ts INTEGER NOT NULL,
  end_ts INTEGER,
  duration_ms INTEGER,
  audio_path TEXT,
  byte_count INTEGER,
  squelch INTEGER,
  lat REAL,
  lon REAL,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_transmissions_start_ts ON transmissions(start_ts);
CREATE INDEX IF NOT EXISTS idx_transmissions_channel_nr ON transmissions(channel_nr);
`

function openDb (path) {
  const db = new DatabaseSync(path)
  db.exec(SCHEMA)
  return db
}

function insertTransmission (db, tx) {
  const stmt = db.prepare(`
    INSERT INTO transmissions
      (direction, channel_nr, start_ts, end_ts, duration_ms, audio_path, byte_count, squelch, lat, lon, notes)
    VALUES
      (@direction, @channel_nr, @start_ts, @end_ts, @duration_ms, @audio_path, @byte_count, @squelch, @lat, @lon, @notes)
  `)
  const result = stmt.run({
    direction: tx.direction || 'rx',
    channel_nr: tx.channelNr ?? null,
    start_ts: tx.startTs,
    end_ts: tx.endTs ?? null,
    duration_ms: tx.durationMs ?? null,
    audio_path: tx.audioPath ?? null,
    byte_count: tx.byteCount ?? null,
    squelch: tx.squelch ?? null,
    lat: tx.lat ?? null,
    lon: tx.lon ?? null,
    notes: tx.notes ?? null
  })
  return Number(result.lastInsertRowid)
}

function getTransmission (db, id) {
  const stmt = db.prepare('SELECT * FROM transmissions WHERE id = ?')
  return stmt.get(id) || null
}

function listTransmissions (db, { channelNr, from, to, direction, limit = 200, offset = 0 } = {}) {
  const clauses = []
  const params = {}
  if (channelNr !== undefined) {
    clauses.push('channel_nr = @channelNr')
    params.channelNr = channelNr
  }
  if (from !== undefined) {
    clauses.push('start_ts >= @from')
    params.from = from
  }
  if (to !== undefined) {
    clauses.push('start_ts <= @to')
    params.to = to
  }
  if (direction !== undefined) {
    clauses.push('direction = @direction')
    params.direction = direction
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  params.limit = limit
  params.offset = offset
  const stmt = db.prepare(`
    SELECT * FROM transmissions
    ${where}
    ORDER BY start_ts DESC
    LIMIT @limit OFFSET @offset
  `)
  return stmt.all(params)
}

function deleteTransmission (db, id) {
  const stmt = db.prepare('DELETE FROM transmissions WHERE id = ?')
  stmt.run(id)
}

// Oldest-first transmissions, for retention pruning.
function listOldestTransmissions (db, limit) {
  const stmt = db.prepare('SELECT * FROM transmissions ORDER BY start_ts ASC LIMIT @limit')
  return stmt.all({ limit })
}

module.exports = {
  openDb,
  insertTransmission,
  getTransmission,
  listTransmissions,
  deleteTransmission,
  listOldestTransmissions
}
