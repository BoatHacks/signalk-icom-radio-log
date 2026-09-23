@no-slop.md

# signalk-m510e-connector

Planned SignalK plugin that records incoming radio transmissions from the
Icom IC-M510E/CT-M500 (RX-only for v1; TX/hailer is v2 — see Scope
decisions). Package/plugin id and the GitHub repo itself both renamed from
`signalk-icom-radio-log` to `signalk-m510e-connector`
(BoatHacks/signalk-m510e-connector, private).

## Phased plan
Phase 0: hardware research spike (codec identification, multi-client
behavior, busy-flag accuracy for v1; TX-audio/hailer availability deferred
to v2) — done via a standalone tool, not the plugin itself (see below). RX
codec identified: plain RTP, payload type 0 (PCMU/G.711 µ-law),
320-byte/40ms frames — no proprietary Icom vocoder, decodable with any
standard library. Busy-flag replay finding, fixed: a single continuous RX
transmission used to fragment into 3 separate `tx-start`/`tx-end` cycles in
`lib/radioClient.js`, because the radio dual-watches/scans two channel
numbers (each switch read as squelch-closed) and a genuine ~50ms squelch
blip between syllables on the active channel did too. `RadioClient` now
keys busy-tracking off `channelNr` and debounces a not-busy reading on the
active channel (`busyDebounceMs`, default 200ms — a guess from this one
capture, worth re-tuning against real hardware). `parseChannelStatus` also
fixed: the real 28-byte packets on port 50003 aren't truncated status
packets, they're a distinct ack/heartbeat response (byte `[17] === 0x01`);
the function now checks that type byte instead of only inferring shape
from length. TX/hailer codec is v2 scope, not blocking.
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

## Current state (Phase 1 backend + Phase 2 webapp implemented, not yet
validated against real hardware)
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
- `lib/rtpAudio.js` — RTP packet framing (for raw/forensic on-disk storage)
  and RTP/PCMU → WAV decoding (used on demand by the `/audio` route, not at
  capture time).
- `index.js` wires it together; `/status`, `/transmissions`,
  `/transmissions/:id`, `/transmissions/:id/audio` return real data, and
  emits `communication.vhf.recording.status` (`'recording'`/`'idle'`) via
  `app.handleMessage` on `tx-start`/`tx-end`/start/stop — the last open
  Phase 2 item, now done.
- `public/` — buildless Preact+htm webapp (vendored, no CDN): sortable/
  filterable transmission table, inline playback, WAV download, live
  status pill, light/dark theme. Verified interactively against a mock
  API server via a headless Chromium + puppeteer-core script (not
  committed — one-off verification, not project tooling); not yet run
  against the real plugin/database.
- Minimum Node version raised to 22.5.0 because of `node:sqlite`.
- 32 tests total; this sandbox's Node 20 can't load `lib/db.js`
  (`node:sqlite`), so `db.test.js`/`retention.test.js`/`plugin.test.js`
  fail here directly — confirmed pre-existing against unmodified `main`,
  not a regression. Verified the new recording-status logic anyway via a
  throwaway in-process `DatabaseSync` shim (not committed) good enough to
  let `plugin.test.js` run; not a substitute for the real thing on
  Node ≥22.5.0.

## Repo scaffold (v0.1.0)
`package.json`, `MIT-LICENSE`, `index.js` (plugin metadata/schema/placeholder
REST endpoints, radio connection not yet implemented at that point), framework-
less placeholder webapp, `node --test` tests, CI via SignalK's reusable
plugin-ci.yml, README with the phase plan, `CHANGELOG.md` (Keep-a-Changelog
format). Both scaffold-era open decisions are now resolved — see Scope
decisions above.
