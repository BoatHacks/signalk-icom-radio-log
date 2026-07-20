'use strict'

const dgram = require('dgram')
const { EventEmitter } = require('events')
const protocol = require('./protocol')

// RadioClient joins an Icom IC-M510E's WiFi session as a silent client
// (posing as an RS-M500 app, per the sign-in identity field) and tracks
// transmissions via the busy/squelch flag on the channel-status stream.
//
// This does no file I/O — it's a thin protocol layer. Consumers listen
// for events and decide what to persist:
//
//   'connected'      { ip, port }              — radio answered discovery
//   'channel-status'  { busy, channelNr, squelch, raw }
//   'tx-start'        { channelNr, startTs }    — busy flag went high
//   'voice-data'      { data: Buffer }          — raw voice/RTP payload, only while a tx is active
//   'tx-end'          { reason, endTs }         — busy flag went low (or stop() called mid-tx)
//   'error'           Error
//
// Protocol details (packet shapes, port roles) are reverse-engineered,
// not an Icom spec — see lib/protocol.js for sources.
class RadioClient extends EventEmitter {
  constructor ({ bindAddress } = {}) {
    super()
    this.bindAddress = bindAddress
    this.radio = { ip: null, port: null }
    this.signedIn = false
    this.busy = false
    this._stopped = true

    this._serverA = dgram.createSocket('udp4') // discovery / sign-in
    this._serverB = dgram.createSocket('udp4') // keepalive / session heartbeat
    this._serverC = dgram.createSocket('udp4') // channel status + commands
    this._serverD = dgram.createSocket('udp4') // channel table
    this._serverE = dgram.createSocket('udp4') // NMEA0183 in
    this._serverVoice = dgram.createSocket('udp4') // RTP voice stream

    this._ports = {}
    this._findRadioTimer = null
    this._keepAliveTimer = null

    for (const [name, sock] of Object.entries({
      A: this._serverA,
      B: this._serverB,
      C: this._serverC,
      D: this._serverD,
      E: this._serverE,
      Voice: this._serverVoice
    })) {
      sock.on('error', (err) => this.emit('error', Object.assign(err, { server: name })))
    }

    this._serverA.on('message', (msg, info) => this._onServerAMessage(msg, info))
    this._serverB.on('message', (msg) => this._onServerBMessage(msg))
    this._serverC.on('message', (msg) => this._onServerCMessage(msg))
    this._serverVoice.on('message', (msg) => this._onVoiceMessage(msg))
  }

  async start () {
    this._stopped = false
    const bind = (sock) =>
      new Promise((resolve, reject) => {
        sock.once('error', reject)
        sock.bind({ address: this.bindAddress }, () => resolve())
      })

    await Promise.all([
      bind(this._serverA),
      bind(this._serverB),
      bind(this._serverC),
      bind(this._serverD),
      bind(this._serverE),
      bind(this._serverVoice)
    ])

    this._serverA.setBroadcast(true)
    this._ports = {
      a: this._serverA.address().port,
      b: this._serverB.address().port,
      c: this._serverC.address().port,
      d: this._serverD.address().port,
      e: this._serverE.address().port,
      voice: this._serverVoice.address().port
    }
    this.myIP = this.bindAddress

    this._findRadioTimer = setInterval(() => this._broadcastDiscovery(), 1000)
    this._broadcastDiscovery()
  }

  stop () {
    this._stopped = true
    if (this.busy) {
      this.busy = false
      this.emit('tx-end', { reason: 'stopped', endTs: Date.now() })
    }
    clearInterval(this._findRadioTimer)
    clearInterval(this._keepAliveTimer)
    for (const sock of [this._serverA, this._serverB, this._serverC, this._serverD, this._serverE, this._serverVoice]) {
      try {
        sock.close()
      } catch (e) {
        // already closed
      }
    }
  }

  _broadcastDiscovery () {
    if (!this.myIP) return
    const msg = protocol.buildDiscoveryPacket({ myIP: this.myIP, listenPortA: this._ports.a })
    this._serverA.send(msg, 0, msg.length, protocol.DISCOVERY_PORT, '255.255.255.255', (err) => {
      if (err) this.emit('error', err)
    })
  }

  _sendSignIn () {
    const msg = protocol.buildSignInPacket({
      myIP: this.myIP,
      radioIP: this.radio.ip,
      ports: { d: this._ports.d, voice: this._ports.voice, b: this._ports.b, c: this._ports.c, e: this._ports.e }
    })
    this._serverA.send(msg, 0, msg.length, this.radio.port, this.radio.ip, (err) => {
      if (err) this.emit('error', err)
    })
  }

  _sendKeepAlive () {
    const msg = protocol.buildKeepAlivePacket()
    this._serverB.send(msg, 0, msg.length, this.radio.port, this.radio.ip, () => {})
  }

  _onServerAMessage (msg, info) {
    if (!this.signedIn) {
      clearInterval(this._findRadioTimer)
      this.radio.ip = info.address
      this.radio.port = info.port
      this.signedIn = true
      this.emit('connected', { ip: this.radio.ip, port: this.radio.port })
      this._sendSignIn()
    }
  }

  _onServerBMessage () {
    if (!this._keepAliveTimer) {
      this._keepAliveTimer = setInterval(() => this._sendKeepAlive(), 5000)
    }
  }

  _onServerCMessage (msg) {
    const status = protocol.parseChannelStatus(msg)
    if (!status) return
    if (status.busy && !this.busy) {
      this.busy = true
      this.emit('tx-start', { channelNr: status.channelNr, startTs: Date.now() })
    } else if (!status.busy && this.busy) {
      this.busy = false
      this.emit('tx-end', { reason: 'squelch-closed', endTs: Date.now() })
    }
    this.emit('channel-status', { ...status, raw: msg })
  }

  _onVoiceMessage (msg) {
    if (this.busy) {
      this.emit('voice-data', { data: msg })
    }
  }
}

module.exports = RadioClient
