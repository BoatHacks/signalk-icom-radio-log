# signalk-m510e-connector

Records incoming VHF transmissions from an Icom IC-M510E / CT-M500 over
WiFi, as a searchable SignalK log — a "black box" for the radio. Outgoing
(TX/PTT and hailer) audio logging is a v2 feature; v1 is RX-only.

## Status

**v0.1.0 — scaffold only.** The plugin currently exposes SignalK plugin
metadata, a config schema, and two placeholder REST endpoints
(`/status`, `/transmissions`, both empty stubs). It does **not** yet talk
to the radio.

The radio-joining protocol itself is reverse-engineered and prototyped
separately, not wired into this plugin yet — see
[Phase 0](#phase-0--research-spike-in-progress) below.

## Background

The M510E and CT-M500 have no published protocol documentation from Icom.
Everything known about how they talk over WiFi comes from unofficial
reverse engineering by GitHub user [htool](https://github.com/htool):

- [signalk-icom-m510e-plugin](https://github.com/htool/signalk-icom-m510e-plugin)
  — channel read/control, posing as an RS-M500 app session
- [signalk-icom-ct-m500-plugin](https://github.com/htool/signalk-icom-ct-m500-plugin)
  — emulates the CT-M500 box itself, injecting NMEA0183/AIS/DSC sentences

This plugin builds on the same discovery/sign-in/keepalive groundwork
(UDP broadcast on port 50000, `"Icom"`-magic-byte packet headers, per-role
client identity strings), extended to capture the voice/RTP stream and
log transmissions rather than control the radio.

## Project plan

### Phase 0 — research spike (in progress)

Open questions that need a real M510E to answer, before the plugin's
actual recording logic can be designed. #1, #3, #4 block v1 (RX-only);
#2 and #5 are v2 (outgoing TX/PTT and hailer audio) and don't block v1:

1. **Answered.** RX voice codec is plain RTP, payload type 0 (PCMU/G.711
   µ-law) — see [`tools/capture-spike`](tools/capture-spike) and the
   Phase 0 findings in [CHANGELOG.md](CHANGELOG.md).
2. *(v2)* Is outgoing (PTT mic) audio visible on WiFi at all, or only
   received traffic?
3. Does a 4th silent client signing in alongside real RS-M500 app
   sessions disrupt the radio?
4. How clean is the busy/squelch flag as a transmission start/end
   boundary? A replay of the sample capture against `lib/radioClient.js`
   shows a single continuous RX transmission getting fragmented into 3
   separate `tx-start`/`tx-end` cycles, because the radio's status
   responses alternate between two channel numbers (dual-watch/scan) and
   each switch reads as squelch-closed even though no audio was lost.
   Needs fixing before Phase 1 can trust its clip boundaries.
5. *(v2)* Hailer/PA is a different audio path than ship's VHF — does
   hailer/RX-hailer audio transit the WiFi link at all (same voice/RTP
   port, a separate port, or is it entirely analog on the CT-M500's own
   circuitry with nothing to capture over WiFi)? The CT-M500 plugin only
   ever decoded horn on/off/volume *control* messages, never audio for
   it — this may end up being metadata-only, same open question as #2.

A standalone capture tool for this lives at
[`tools/capture-spike`](tools/capture-spike) — joins the radio as a
silent 4th client and dumps raw voice/RTP traffic plus channel-status
events for analysis. It's deliberately kept separate from the plugin
itself (own `package.json`, own dependencies) since it's throwaway
research tooling, not part of the plugin's runtime.

### Phase 1 — RX-only MVP

**Backend implemented** (`lib/radioClient.js`, `lib/db.js`, `lib/retention.js`),
**not yet validated against real hardware** — everything here is protocol
logic that doesn't depend on the open Phase 0 questions, so it moved
ahead of the actual capture run. Still to prove once the radio is
reachable: does sign-in actually succeed, do clips line up with reality,
does the busy flag behave as cleanly as assumed.

- Discovery/sign-in/keepalive client, own module (no longer duplicated
  research-script code) — `RadioClient` in `lib/radioClient.js`.
- RX transmissions captured to disk as raw, length-prefix-framed RTP
  packets (forensic — exact captured bytes, undecoded), bounded by the
  busy flag (`lib/protocol.js` for the packet-level parsing,
  `lib/rtpAudio.js` for the framing).
- `node:sqlite` index (`lib/db.js`): direction, channel, start/end
  timestamp, duration, audio path, byte count, squelch, vessel position
  at start (best-effort from `navigation.position`).
- Retention enforcement (`lib/retention.js`) wired in after every capture.
- REST surface live: `GET /status`, `GET /transmissions` (filterable by
  channel/time range/direction), `GET /transmissions/:id`,
  `GET /transmissions/:id/audio` (decoded to playable WAV on demand, per
  request, from the stored raw RTP — `lib/rtpAudio.js`).
- No UI yet (see Phase 2).

### Phase 2 — SignalK surface + UI

- `GET /transmissions`, `GET /transmissions/:id`,
  `GET /transmissions/:id/audio` — done (Phase 1).
- **Buildless Preact+htm webapp implemented** (`public/`; vendored
  dependencies, no CDN — matches [[signalk-stowage-mgmt]] and the rest of
  the BoatHacks plugins): sortable/filterable transmission table (start
  time, channel, duration, direction, position, size), filter by channel
  number and date range, inline playback via a bottom player bar, WAV
  download per row, live radio-connection status pill, light/dark theme
  (red-shifted night mode). Verified against a mock API server (see
  CHANGELOG.md) — not yet checked against a real, populated database.
- `communication.vhf.recording.status` SignalK path — not started.

### Phase 3 — enrichment

- Correlate DSC sentences (via the NMEA0183 receive path from
  `signalk-icom-ct-m500-plugin`) so distress/individual calls show the
  calling MMSI against the relevant clip.
- Auto-tag entries (e.g. Ch16 distress/urgency from the DSC category
  field).

### v2 — outgoing audio

- TX (PTT mic) and hailer/PA transmission logging, once Phase 0's open
  questions #2 and #5 above are answered. Not part of v1.

### Phase 4 — retention & polish

- Configurable retention (days or max disk size), oldest-first pruning.
- Export a date range as a zip.
- Local transcription is an explicit stretch goal, not v1 scope — most
  SignalK hosts are Pi-class hardware.

## Scope decisions

- **Compliance-grade log vs personal convenience tool: undecided.**
  Whether this needs to double as an immutable, exportable record (the
  kind commercial/GMDSS record-keeping expects) or is just a personal
  incident-review tool is still open. Leaning the data model toward
  immutability-friendly now (append-only, no destructive edit of a
  logged clip's core fields) costs little and keeps both options open —
  retrofitting that guarantee later would be much harder than relaxing
  it later if it turns out convenience is all that's needed.
- **No real-time alerting.** This plugin only logs, after the fact.
  Surfacing distress/urgency calls live (SignalK notifications, etc.)
  is explicitly out of scope — that's [[signalk-notification-dispatcher]]'s
  job, not this plugin's. If DSC correlation (Phase 3) reveals a
  distress call, this plugin records it richly; it does not alert
  anyone.
- **Hailer/PA and TX (outgoing) audio are v2 scope**, not v1 — see the
  open Phase 0 questions above about whether either is even visible
  over WiFi.
- **Fully standalone — no dependency on `signalk-icom-m510e-plugin`.**
  This plugin implements its own discovery/sign-in/keepalive client
  rather than reusing or requiring that plugin's session. Simpler
  install, no coupling between two plugins' radio sessions.
- **Retention is configurable two ways, independently: by age (days)
  and by total log directory size.** Whichever limit is hit first
  prunes oldest-first. Either can be set to unlimited.
- **TX-less logging is acceptable for v1.** Outgoing (TX/PTT and
  hailer/PA) audio moved to v2, see above.
- **Final project name: `signalk-m510e-connector`.**

## Development

```
npm install
npm test
```

## License

MIT
