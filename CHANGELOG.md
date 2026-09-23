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

### Changed

- Minimum Node version raised to 22.5.0 (first version with `node:sqlite`).

### Decided

- Standalone — no dependency on `signalk-icom-m510e-plugin`.
- Retention configurable by age and/or total log size, whichever limit
  hits first prunes oldest-first.

### Phase 0 findings

- RX codec identified from the sample capture: plain RTP, payload type 0
  (PCMU/G.711 µ-law), 320-byte payloads at ~40ms intervals (320 samples
  at 8kHz) — no proprietary Icom vocoder. RTCP (sender reports + SDES)
  also standard.
- TX and hailer/PA codecs still unidentified — the sample capture is only
  ~10s of RX audio and caught neither. Needs a longer capture-spike
  re-run to resolve.

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
