# signalk-icom-radio-log

Planned SignalK plugin that records incoming and outgoing radio transmissions
from the Icom IC-M510E/CT-M500. Repo: BoatHacks/signalk-icom-radio-log
(private).

## Phased plan
Phase 0: hardware research spike (codec identification, multi-client
behavior, TX-audio availability, busy-flag accuracy) — done via a standalone
tool, not the plugin itself (see below).
Phase 1: RX-only MVP with SQLite storage.
Phase 2: REST endpoints + Preact/htm frontend (style like
signalk-stowage-mgmt).
Phase 3: enrichment via DSC/NMEA0183 correlation.
Phase 4: retention/export.

## Scope decisions
- Compliance-grade log vs. pure convenience tool: not yet decided, so the data
  model is designed to be append-only/immutable-leaning either way.
- No real-time alerting on distress calls — that's
  [[signalk-notification-dispatcher]]'s job; this plugin only logs.
- Hailer/PA audio from the CT-M500 is in scope (in addition to normal VHF),
  but whether hailer audio is even visible over WiFi is still open.
- Runs fully standalone, no dependency on signalk-icom-m510e-plugin.
- Retention configurable both by age (days) and by total log-directory size
  (`retentionMaxSizeMB`), independently — whichever limit is hit first deletes
  oldest entries first.

## Current state (Phase 1 backend implemented, not yet validated against real
hardware)
- `tools/capture-spike/` — the Phase-0 research tool (`icom-capture-spike`,
  own package.json/deps, not part of the plugin runtime): a standalone Node
  script that logs in as a silent fourth client to the M510E and captures raw
  voice/RTP traffic for codec analysis.
- `lib/protocol.js` — pure, tested packet encode/decode helpers.
- `lib/radioClient.js` — `RadioClient` EventEmitter for
  discovery/sign-in/keepalive/busy-flag-tracking/RX-voice-capture, no file I/O.
- `lib/db.js` — `node:sqlite` transmissions table.
- `lib/retention.js` — age- and size-based pruning.
- `index.js` wires it together; `/status`, `/transmissions`,
  `/transmissions/:id`, `/transmissions/:id/audio` return real data.
- Minimum Node version raised to 22.5.0 because of `node:sqlite`.
- 26 tests passing.

## Repo scaffold (v0.1.0)
`package.json`, `MIT-LICENSE`, `index.js` (plugin metadata/schema/placeholder
REST endpoints, radio connection not yet implemented at that point), framework-
less placeholder webapp, `node --test` tests, CI via SignalK's reusable
plugin-ci.yml, README with the phase plan, `CHANGELOG.md` (Keep-a-Changelog
format). Open decisions still outstanding: final project name, whether
TX-less logging is acceptable for v1.
