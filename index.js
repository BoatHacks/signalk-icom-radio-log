// signalk-icom-radio-log
//
// Records incoming (and, where the hardware allows, outgoing) VHF
// transmissions from an Icom IC-M510E/CT-M500 over WiFi as a searchable
// SignalK log.
//
// STATUS: v0.1.0 is a scaffold only. The radio-joining protocol (UDP
// discovery/sign-in/keepalive, busy-flag transmission boundaries, RTP
// voice capture) is reverse-engineered and prototyped in a standalone
// spike tool, not wired into this plugin yet — see README.md for the
// phased project plan and why:
//
//   - the RTP payload codec inside the voice stream isn't confirmed yet
//     (needs a capture against real hardware)
//   - whether outgoing (PTT mic) audio is visible on WiFi at all, or only
//     received traffic, is still an open question
//   - joining as a passive 4th client alongside real RS-M500 app sessions
//     needs to be confirmed not to disrupt the radio
//
// The protocol groundwork this plugin will build on comes from
// https://github.com/htool/signalk-icom-m510e-plugin and
// https://github.com/htool/signalk-icom-ct-m500-plugin (unofficial
// reverse engineering, not an Icom spec).

module.exports = function (app) {
  const plugin = {
    id: 'signalk-icom-radio-log',
    name: 'Icom Radio Log',
    description:
      'Records incoming (and, where the hardware allows, outgoing) VHF transmissions from an Icom IC-M510E/CT-M500 over WiFi',
  }

  let options = {}
  let unsubscribes = []

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

  plugin.start = function (pluginOptions) {
    options = pluginOptions || {}
    app.debug('Plugin started (scaffold — no radio connection implemented yet)')
    // TODO (Phase 1): discovery/sign-in/keepalive against the M510E,
    // busy-flag transmission boundaries, RTP capture to disk, SQLite
    // index. Prototype logic lives in the icom-capture-spike research
    // tool referenced in README.md.
  }

  plugin.stop = function () {
    app.debug('Plugin stopped')
    unsubscribes.forEach((f) => f())
    unsubscribes = []
  }

  plugin.registerWithRouter = function (router) {
    // Placeholder so the plugin's REST surface and admin-UI webapp wiring
    // are exercised end-to-end from v0.1.0, even before there's real data
    // to serve. Shape will change once Phase 1 lands.
    router.get('/status', (req, res) => {
      res.json({
        phase: 'scaffold',
        message: 'Radio connection not implemented yet — see README.md for the project plan.',
      })
    })

    router.get('/transmissions', (req, res) => {
      res.json([])
    })
  }

  return plugin
}
