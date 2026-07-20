const test = require('node:test')
const assert = require('node:assert')
const createPlugin = require('../index.js')

function fakeApp () {
  return {
    debug: () => {},
  }
}

test('exposes standard SignalK plugin metadata', () => {
  const plugin = createPlugin(fakeApp())
  assert.strictEqual(plugin.id, 'signalk-icom-radio-log')
  assert.strictEqual(typeof plugin.name, 'string')
  assert.strictEqual(typeof plugin.description, 'string')
  assert.strictEqual(typeof plugin.start, 'function')
  assert.strictEqual(typeof plugin.stop, 'function')
})

test('start/stop do not throw with no options', () => {
  const plugin = createPlugin(fakeApp())
  assert.doesNotThrow(() => plugin.start({}))
  assert.doesNotThrow(() => plugin.stop())
})

test('registerWithRouter exposes /status and /transmissions', () => {
  const plugin = createPlugin(fakeApp())
  const routes = {}
  const router = {
    get: (path, handler) => {
      routes[path] = handler
    },
  }
  plugin.registerWithRouter(router)
  assert.strictEqual(typeof routes['/status'], 'function')
  assert.strictEqual(typeof routes['/transmissions'], 'function')

  let statusBody = null
  routes['/status']({}, { json: (body) => { statusBody = body } })
  assert.strictEqual(statusBody.phase, 'scaffold')

  let txBody = null
  routes['/transmissions']({}, { json: (body) => { txBody = body } })
  assert.deepStrictEqual(txBody, [])
})
