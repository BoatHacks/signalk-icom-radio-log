'use strict'

// Minimal Wyoming protocol wire framing (https://github.com/rhasspy/wyoming).
//
// signalk-wyoming (the optional plugin this talks to) publishes its own
// protocol library as `signalk-wyoming/protocol`, but it isn't on npm yet —
// its own DEVELOPERS.md notes sibling plugins reference it only as a
// devDependency for tests and "embed a tiny self-contained [...] instead" in
// production. Doing the same here: this is a small, self-contained
// reimplementation of just the framing this plugin needs (transcribe/
// audio-start/audio-chunk/audio-stop/transcript), not a dependency on an
// unpublished package.
//
// Wire format, one event:
//   <header JSON, one line, UTF-8>\n
//   <data JSON, exactly data_length bytes>     (only when data_length > 0)
//   <payload, exactly payload_length bytes>    (only when payload_length > 0)

const WYOMING_VERSION = '1.10.0'
const MAX_HEADER_BYTES = 1024 * 1024
const MAX_BLOCK_BYTES = 64 * 1024 * 1024

function encodeEvent (type, data, payload) {
  const header = { type, version: WYOMING_VERSION }
  let dataBuf
  if (data !== undefined && Object.keys(data).length > 0) {
    const json = JSON.stringify(data)
    dataBuf = Buffer.from(json, 'utf8')
    header.data_length = dataBuf.length
  }
  if (payload !== undefined && payload.length > 0) {
    header.payload_length = payload.length
  }
  const parts = [Buffer.from(JSON.stringify(header) + '\n', 'utf8')]
  if (dataBuf !== undefined) parts.push(dataBuf)
  if (payload !== undefined && payload.length > 0) parts.push(payload)
  return Buffer.concat(parts)
}

class FramingError extends Error {}

// Incremental push-parser: feed() with socket chunks, get back every
// complete event, buffering partial reads across header/data/payload
// boundaries. Malformed input throws FramingError; the connection must be
// dropped afterward (mirrors the Wyoming reference implementation).
class EventDecoder {
  constructor () {
    this.buf = Buffer.alloc(0)
    this.pos = 0
    this.header = null
    this.dataDone = false
    this.data = undefined
  }

  feed (chunk) {
    this.buf = this.pos === this.buf.length ? chunk : Buffer.concat([this.buf.subarray(this.pos), chunk])
    this.pos = 0
    const events = []
    for (;;) {
      if (this.header === null && !this._readHeader()) break
      if (!this.dataDone && !this._readData()) break
      const payload = this._readPayload()
      if (payload === null) break
      const event = { type: this.header.type, data: this.data ?? {} }
      if (this.header.payloadLength > 0) event.payload = payload
      events.push(event)
      this.header = null
      this.data = undefined
      this.dataDone = false
    }
    if (this.pos > 0) {
      this.buf = this.buf.subarray(this.pos)
      this.pos = 0
    }
    return events
  }

  _available () {
    return this.buf.length - this.pos
  }

  _readHeader () {
    const nl = this.buf.indexOf(0x0a, this.pos)
    if (nl === -1) {
      if (this._available() > MAX_HEADER_BYTES) throw new FramingError('header line too long')
      return false
    }
    const line = this.buf.subarray(this.pos, nl).toString('utf8')
    this.pos = nl + 1
    let parsed
    try {
      parsed = JSON.parse(line)
    } catch (err) {
      throw new FramingError('malformed header JSON')
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) || typeof parsed.type !== 'string') {
      throw new FramingError('invalid header')
    }
    this.header = {
      type: parsed.type,
      dataLength: this._lengthField(parsed.data_length),
      payloadLength: this._lengthField(parsed.payload_length),
      inlineData: parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data) ? parsed.data : undefined,
    }
    if (this.header.dataLength === 0) {
      this.data = this.header.inlineData
      this.dataDone = true
    }
    return true
  }

  _lengthField (value) {
    if (value === undefined || value === null) return 0
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_BLOCK_BYTES) {
      throw new FramingError('invalid length field')
    }
    return value
  }

  _readData () {
    if (this._available() < this.header.dataLength) return false
    const raw = this.buf.subarray(this.pos, this.pos + this.header.dataLength).toString('utf8')
    this.pos += this.header.dataLength
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch (err) {
      throw new FramingError('malformed data JSON')
    }
    this.data = { ...(this.header.inlineData ?? {}), ...parsed }
    this.dataDone = true
    return true
  }

  _readPayload () {
    if (this.header.payloadLength === 0) return Buffer.alloc(0)
    if (this._available() < this.header.payloadLength) return null
    const payload = Buffer.from(this.buf.subarray(this.pos, this.pos + this.header.payloadLength))
    this.pos += this.header.payloadLength
    return payload
  }
}

module.exports = { encodeEvent, EventDecoder, FramingError }
