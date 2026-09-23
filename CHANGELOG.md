# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added

- `retentionMaxSizeMB` config option (size-based retention, independent
  of the existing `retentionDays`).
- Real backend implementation, ahead of Phase 0 hardware validation:
  - `lib/protocol.js` — pure, unit-tested packet encode/decode helpers
    (discovery, sign-in, keepalive, channel-status parsing).
  - `lib/radioClient.js` — `RadioClient` EventEmitter wrapping the UDP
    session (discovery/sign-in/keepalive/busy-flag tracking/RX voice
    capture). No file I/O — consumers persist via emitted events.
  - `lib/db.js` — `node:sqlite`-backed transmissions table and
    query/insert/delete helpers.
  - `lib/retention.js` — age- and size-based pruning, oldest-first,
    removes both the DB row and the audio file.
  - `index.js` now wires all of the above together and serves real data
    from `/status`, `/transmissions`, `/transmissions/:id`,
    `/transmissions/:id/audio`.
- Test coverage: `test/protocol.test.js`, `test/db.test.js`,
  `test/retention.test.js`, updated `test/plugin.test.js` exercising
  real start/stop/router wiring against a temp data dir.
- `tools/capture-spike/capture.sanitized.pcap` — a real ~10s Phase 0
  sample capture (GPS fix and MAC addresses pseudonymized) of an M510E
  WiFi session.
- `test/pcap-replay.test.js`, `test/helpers/pcap.js`,
  `test/radioClient.test.js` — replay real captured bytes (and synthetic
  edge cases) through `lib/protocol.js`/`lib/radioClient.js` without
  needing live hardware. See Phase 0 findings below.

### Fixed

- `RadioClient` busy-flag tracking now keys off `channelNr` and debounces
  a not-busy reading on the active channel (`busyDebounceMs`, default
  200ms), instead of flipping on any status packet. Fixes transmission
  fragmentation on a dual-watch/scanning radio.
- `parseChannelStatus` now checks the response-type byte explicitly
  (`CHANNEL_STATUS_RESPONSE_TYPE`) instead of only inferring the packet
  shape from length, correctly distinguishing the real 40-byte
  channel-status response from the 28-byte ack/heartbeat response that
  shares the same port.

### Changed

- Minimum Node version raised to 22.5.0 (first version with `node:sqlite`).
- Package/plugin renamed from `signalk-icom-radio-log` to
  `signalk-m510e-connector` (`package.json` name, `signalk.displayName`,
  `index.js` plugin `id`/`name`). The GitHub repo was also renamed to
  match: BoatHacks/signalk-icom-radio-log → BoatHacks/signalk-m510e-connector.

### Decided

- Standalone — no dependency on `signalk-icom-m510e-plugin`.
- Retention configurable by age and/or total log size, whichever limit
  hits first prunes oldest-first.
- Final project name: `signalk-m510e-connector`.
- TX-less logging is acceptable for v1 — outgoing (TX/PTT) and hailer/PA
  audio moved to v2.

### Phase 0 findings

- RX codec identified from the sample capture: plain RTP, payload type 0
  (PCMU/G.711 µ-law), 320-byte payloads at ~40ms intervals (320 samples
  at 8kHz) — no proprietary Icom vocoder. RTCP (sender reports + SDES)
  also standard.
- TX and hailer/PA codecs still unidentified — the sample capture is only
  ~10s of RX audio and caught neither. No longer a v1 blocker now that
  outgoing audio is v2 scope; still worth resolving on a future,
  longer capture-spike run.
- Busy-flag replay finding, **fixed**: replaying the sample capture's
  channel-status packets through `lib/radioClient.js` used to fragment
  one continuous ~7.4s RX transmission into 3 separate `tx-start`/`tx-end`
  cycles — the radio dual-watches/scans channel 84 and channel 93, and
  each status response for the idle channel (93) read as squelch-closed
  even though the busy channel (84) was still transmitting; a genuine
  ~50ms squelch blip on the active channel itself also briefly toggled
  not-busy between syllables of real speech. `RadioClient` now keys
  busy-tracking off `channelNr` (ignoring status for a channel other than
  the one currently open) and debounces a not-busy reading on the active
  channel for `busyDebounceMs` (default 200ms) before treating it as a
  real `tx-end`. Replaying the same capture now yields a single
  `tx-start` with no fragmentation (see `test/pcap-replay.test.js`,
  `test/radioClient.test.js`).
- `parseChannelStatus` undersized-packet finding, **fixed**: the real
  28-byte packets on `CHANNEL_CMD_PORT` (50003) aren't truncated status
  packets — they're a distinct ack/heartbeat response (response-type
  byte `[17] === 0x01`, no channel data), interleaved with the real
  40-byte status responses (`[17] === 0x02`). `parseChannelStatus` now
  checks that type byte explicitly instead of only inferring the packet
  shape from length (see `lib/protocol.js`, `CHANNEL_STATUS_RESPONSE_TYPE`).

## [0.1.0] - 2026-07-20

### Added

- Initial plugin scaffold: SignalK plugin metadata, config schema
  (`ipOverride`, `retentionDays`), and placeholder REST endpoints
  (`GET /status`, `GET /transmissions`).
- Placeholder webapp page.
- CI via SignalK's reusable `plugin-ci.yml` workflow.
- `node --test` smoke tests covering plugin metadata, lifecycle, and
  the placeholder routes.
- README documenting the phased project plan (Phase 0 research spike
  through Phase 4 retention/polish).

Radio-joining logic (discovery, sign-in, transmission capture) is not
implemented yet — see README.md.
