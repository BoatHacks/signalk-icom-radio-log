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
- Package/plugin renamed from `signalk-icom-radio-log` to
  `signalk-m510e-connector` (`package.json` name, `signalk.displayName`,
  `index.js` plugin `id`/`name`). The GitHub repo itself
  (BoatHacks/signalk-icom-radio-log) has not been renamed to match.

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
- Busy-flag replay finding: replaying the sample capture's channel-status
  packets through `lib/radioClient.js` fragments one continuous ~7.4s RX
  transmission into 3 separate `tx-start`/`tx-end` cycles. Cause: the
  radio dual-watches/scans channel 84 and channel 93, and each status
  response for the idle channel (93) reads as squelch-closed even though
  the busy channel (84) is still transmitting — no RTP packets were
  actually lost, but a real transmission would land in the DB as 3
  fragmented rows instead of 1. `RadioClient`'s busy-tracking needs to key
  off `channelNr` (or debounce) before Phase 1 clip boundaries can be
  trusted on a scanning radio.

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
