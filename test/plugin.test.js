const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const createPlugin = require('../index.js')

function fakeApp (dataDir) {
  return {
    debug: () => {},
    error: () => {},
    getDataDirPath: () => dataDir,
    getSelfPath: () => undefined,
  }
}

function tempDataDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'radio-log-plugin-test-'))
}

test('exposes standard SignalK plugin metadata', () => {
  const plugin = createPlugin(fakeApp(tempDataDir()))
  assert.strictEqual(plugin.id, 'signalk-icom-radio-log')
  assert.strictEqual(typeof plugin.name, 'string')
  assert.strictEqual(typeof plugin.description, 'string')
  assert.strictEqual(typeof plugin.start, 'function')
  assert.strictEqual(typeof plugin.stop, 'function')
})

test('exposes a config schema with retention options', () => {
  const plugin = createPlugin(fakeApp(tempDataDir()))
  assert.ok(plugin.schema.properties.ipOverride)
  assert.ok(plugin.schema.properties.retentionDays)
  assert.ok(plugin.schema.properties.retentionMaxSizeMB)
})

test('start creates the data dir structure and stop cleans up without throwing', () => {
  const dataDir = tempDataDir()
  const plugin = createPlugin(fakeApp(dataDir))
  assert.doesNotThrow(() => plugin.start({ ipOverride: '127.0.0.1', retentionDays: 0, retentionMaxSizeMB: 0 }))
  assert.ok(fs.existsSync(path.join(dataDir, 'recordings')))
  assert.ok(fs.existsSync(path.join(dataDir, 'radio-log.sqlite')))
  assert.doesNotThrow(() => plugin.stop())
})

test('registerWithRouter exposes /status and /transmissions backed by real state', () => {
  const dataDir = tempDataDir()
  const plugin = createPlugin(fakeApp(dataDir))
  plugin.start({ ipOverride: '127.0.0.1' })

  const routes = {}
  const router = {
    get: (routePath, handler) => {
      routes[routePath] = handler
    },
  }
  plugin.registerWithRouter(router)
  assert.strictEqual(typeof routes['/status'], 'function')
  assert.strictEqual(typeof routes['/transmissions'], 'function')
  assert.strictEqual(typeof routes['/transmissions/:id'], 'function')
  assert.strictEqual(typeof routes['/transmissions/:id/audio'], 'function')

  let statusBody = null
  routes['/status']({}, { json: (body) => { statusBody = body } })
  assert.strictEqual(statusBody.recording, false)
  assert.strictEqual(statusBody.connected, false)

  let txBody = null
  routes['/transmissions']({ query: {} }, { json: (body) => { txBody = body } })
  assert.deepStrictEqual(txBody, [])

  let notFoundStatus = null
  let notFoundBody = null
  routes['/transmissions/:id']({ params: { id: '999' } }, {
    status: (code) => { notFoundStatus = code; return { json: (body) => { notFoundBody = body } } },
  })
  assert.strictEqual(notFoundStatus, 404)
  assert.ok(notFoundBody.error)

  plugin.stop()
})
