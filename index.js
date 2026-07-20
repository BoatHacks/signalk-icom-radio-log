// signalk-icom-radio-log
//
// Records incoming (and, where the hardware allows, outgoing) VHF
// transmissions from an Icom IC-M510E/CT-M500 over WiFi as a searchable
// SignalK log.
//
// STATUS: the connection layer (discovery/sign-in/keepalive, busy-flag
// transmission boundaries) and RX voice capture are wired up. Two things
// are still open, both requiring a real M510E to resolve — see README.md:
//
//   - the RTP payload codec inside the voice stream isn't confirmed yet,
//     so captured audio is stored as raw RTP payloads (.raw), not
//     anything directly playable
//   - whether outgoing (PTT mic) audio and hailer/PA audio are visible on
//     WiFi at all, or only received traffic, is still unknown — this
//     plugin currently only captures RX
//
// Protocol details (packet shapes, port roles) are reverse-engineered
// from https://github.com/htool/signalk-icom-m510e-plugin and
// https://github.com/htool/signalk-icom-ct-m500-plugin — not an Icom
// spec. See lib/protocol.js for specifics.

const fs = require('fs')
const path = require('path')
const ip = require('ip')
const RadioClient = require('./lib/radioClient')
const db = require('./lib/db')
const retention = require('./lib/retention')

module.exports = function (app) {
  const plugin = {
    id: 'signalk-icom-radio-log',
    name: 'Icom Radio Log',
    description:
      'Records incoming (and, where the hardware allows, outgoing) VHF transmissions from an Icom IC-M510E/CT-M500 over WiFi',
  }

  let options = {}
  let radioClient = null
  let database = null
  let recordingsDir = null
  let currentTx = null // { channelNr, startTs, chunks: Buffer[], byteCount }
  let radioStatus = { connected: false, ip: null, port: null }

  plugin.schema = {
    type: 'object',
    properties: {
      ipOverride: {
        type: 'string',
        title: 'Radio IP override',
        description:
          'Only needed if this host has more than one network interface and auto-detection picks the wrong one.',
        default: '',
      },
      retentionDays: {
        type: 'number',
        title: 'Retention (days)',
        description: 'Delete recordings older than this many days. 0 = unlimited.',
        default: 30,
      },
      retentionMaxSizeMB: {
        type: 'number',
        title: 'Retention (max total size, MB)',
        description:
          'Delete oldest recordings once the log directory exceeds this size. 0 = unlimited. Applied independently of the age-based limit above — whichever limit is hit first prunes.',
        default: 0,
      },
    },
  }

  function finishTransmission (reason, endTs) {
    if (!currentTx) return
    const tx = currentTx
    currentTx = null

    const audioBuffer = Buffer.concat(tx.chunks)
    const fileName = `${tx.startTs}-ch${tx.channelNr ?? 'unknown'}.raw`
    const audioPath = path.join(recordingsDir, fileName)
    try {
      fs.writeFileSync(audioPath, audioBuffer)
    } catch (err) {
      app.error(`Failed writing recording ${audioPath}: ${err.message}`)
      return
    }

    let position = null
    try {
      const pos = app.getSelfPath && app.getSelfPath('navigation.position')
      if (pos && pos.value) position = pos.value
    } catch (err) {
      // position not available; leave null
    }

    const id = db.insertTransmission(database, {
      direction: 'rx',
      channelNr: tx.channelNr,
      startTs: tx.startTs,
      endTs,
      durationMs: endTs - tx.startTs,
      audioPath,
      byteCount: audioBuffer.length,
      lat: position ? position.latitude : null,
      lon: position ? position.longitude : null,
    })
    app.debug(`Recorded transmission #${id} (${reason}), ${audioBuffer.length} bytes, channel ${tx.channelNr}`)

    try {
      retention.enforce(database, recordingsDir, {
        retentionDays: options.retentionDays,
        retentionMaxSizeMB: options.retentionMaxSizeMB,
      })
    } catch (err) {
      app.error(`Retention enforcement failed: ${err.message}`)
    }
  }

  plugin.start = function (pluginOptions) {
    options = pluginOptions || {}

    const dataDir = app.getDataDirPath()
    recordingsDir = path.join(dataDir, 'recordings')
    fs.mkdirSync(recordingsDir, { recursive: true })
    database = db.openDb(path.join(dataDir, 'radio-log.sqlite'))

    const bindAddress = options.ipOverride || ip.address()
    app.debug(`Starting radio client, binding to ${bindAddress}`)
    radioClient = new RadioClient({ bindAddress })

    radioClient.on('connected', ({ ip: radioIp, port }) => {
      radioStatus = { connected: true, ip: radioIp, port }
      app.debug(`Radio found at ${radioIp}:${port}`)
    })

    radioClient.on('tx-start', ({ channelNr, startTs }) => {
      currentTx = { channelNr, startTs, chunks: [], byteCount: 0 }
    })

    radioClient.on('voice-data', ({ data }) => {
      if (currentTx) {
        currentTx.chunks.push(data)
        currentTx.byteCount += data.length
      }
    })

    radioClient.on('tx-end', ({ reason, endTs }) => {
      finishTransmission(reason, endTs)
    })

    radioClient.on('error', (err) => {
      app.error(`Radio client error (${err.server || '?'}): ${err.message}`)
    })

    radioClient.start().catch((err) => {
      app.error(`Failed to start radio client: ${err.message}`)
    })
  }

  plugin.stop = function () {
    app.debug('Plugin stopped')
    if (radioClient) {
      radioClient.stop()
      radioClient = null
    }
    if (database) {
      database.close()
      database = null
    }
    radioStatus = { connected: false, ip: null, port: null }
    currentTx = null
  }

  plugin.registerWithRouter = function (router) {
    router.get('/status', (req, res) => {
      res.json({
        ...radioStatus,
        recording: !!currentTx,
      })
    })

    router.get('/transmissions', (req, res) => {
      if (!database) return res.json([])
      const query = {}
      if (req.query.channelNr !== undefined) query.channelNr = Number(req.query.channelNr)
      if (req.query.from !== undefined) query.from = Number(req.query.from)
      if (req.query.to !== undefined) query.to = Number(req.query.to)
      if (req.query.direction !== undefined) query.direction = req.query.direction
      if (req.query.limit !== undefined) query.limit = Number(req.query.limit)
      if (req.query.offset !== undefined) query.offset = Number(req.query.offset)
      res.json(db.listTransmissions(database, query))
    })

    router.get('/transmissions/:id', (req, res) => {
      if (!database) return res.status(404).json({ error: 'not found' })
      const tx = db.getTransmission(database, Number(req.params.id))
      if (!tx) return res.status(404).json({ error: 'not found' })
      res.json(tx)
    })

    router.get('/transmissions/:id/audio', (req, res) => {
      if (!database) return res.status(404).json({ error: 'not found' })
      const tx = db.getTransmission(database, Number(req.params.id))
      if (!tx || !tx.audio_path || !fs.existsSync(tx.audio_path)) {
        return res.status(404).json({ error: 'not found' })
      }
      // Served as-is: raw RTP payloads, not yet decoded to a playable
      // format (codec unconfirmed — see README.md Phase 0).
      res.setHeader('Content-Type', 'application/octet-stream')
      fs.createReadStream(tx.audio_path).pipe(res)
    })
  }

  return plugin
}
