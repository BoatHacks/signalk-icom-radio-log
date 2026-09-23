@no-slop.md

# signalk-m510e-connector

Planned SignalK plugin that records incoming radio transmissions from the
Icom IC-M510E/CT-M500 (RX-only for v1; TX/hailer is v2 — see Scope
decisions). Package/plugin id renamed from `signalk-icom-radio-log` to
`signalk-m510e-connector`; the GitHub repo itself
(BoatHacks/signalk-icom-radio-log, private) has not been renamed to match.

## Phased plan
Phase 0: hardware research spike (codec identification, multi-client
behavior, busy-flag accuracy for v1; TX-audio/hailer availability deferred
to v2) — done via a standalone tool, not the plugin itself (see below). RX
codec identified: plain RTP, payload type 0 (PCMU/G.711 µ-law),
320-byte/40ms frames — no proprietary Icom vocoder, decodable with any
standard library. Busy-flag replay finding: against the sample capture, a
single continuous RX transmission fragments into 3 separate
`tx-start`/`tx-end` cycles in `lib/radioClient.js`, because the radio
dual-watches/scans two channel numbers and each switch reads as
squelch-closed even though no audio was lost — needs a fix before Phase 1
clip boundaries can be trusted. TX/hailer codec is v2 scope, not blocking.
Phase 1: RX-only MVP with SQLite storage.
Phase 2: REST endpoints + Preact/htm frontend (style like
signalk-stowage-mgmt).
Phase 3: enrichment via DSC/NMEA0183 correlation.
Phase 4: retention/export.
v2: TX (PTT mic) and hailer/PA transmission logging.

## Scope decisions
- Compliance-grade log vs. pure convenience tool: not yet decided, so the data
  model is designed to be append-only/immutable-leaning either way.
- No real-time alerting on distress calls — that's
  [[signalk-notification-dispatcher]]'s job; this plugin only logs.
- TX-less logging is acceptable for v1 — hailer/PA and outgoing (TX) audio
  from the CT-M500 moved to v2.
- Runs fully standalone, no dependency on signalk-icom-m510e-plugin.
- Retention configurable both by age (days) and by total log-directory size
  (`retentionMaxSizeMB`), independently — whichever limit is hit first deletes
  oldest entries first.
- Final project name: `signalk-m510e-connector`.

## Current state (Phase 1 backend implemented, not yet validated against real
hardware)
- `tools/capture-spike/` — the Phase-0 research tool (`icom-capture-spike`,
  own package.json/deps, not part of the plugin runtime): a standalone Node
  script that logs in as a silent fourth client to the M510E and captures raw
  voice/RTP traffic for codec analysis. Includes `capture.sanitized.pcap`, a
  real sample capture (GPS fix and MACs pseudonymized) confirming the RX
  codec finding above.
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
format). Both scaffold-era open decisions are now resolved — see Scope
decisions above.
