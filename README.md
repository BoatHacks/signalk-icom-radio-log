# signalk-icom-radio-log

Records incoming (and, where the hardware allows, outgoing) VHF
transmissions from an Icom IC-M510E / CT-M500 over WiFi, as a searchable
SignalK log — a "black box" for the radio.

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
actual recording logic can be designed:

1. What codec is inside the voice stream's RTP payload?
2. Is outgoing (PTT mic) audio visible on WiFi at all, or only received
   traffic?
3. Does a 4th silent client signing in alongside real RS-M500 app
   sessions disrupt the radio?
4. How clean is the busy/squelch flag as a transmission start/end
   boundary?
5. Hailer/PA is in scope (see [Scope decisions](#scope-decisions)
   below), but it's a different audio path than ship's VHF — does
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

- Fold the discovery/sign-in/keepalive client into this plugin (shared
  logic currently duplicated across htool's two plugins).
- Capture received transmissions to disk, bounded by the busy flag.
- `node:sqlite` index: direction, channel, start/end timestamp, duration,
  audio path, squelch, vessel position at start.
- No UI yet — just prove clips match reality.

### Phase 2 — SignalK surface + UI

- `GET /transmissions`, `GET /transmissions/:id`,
  `GET /transmissions/:id/audio`.
- Buildless Preact+htm webapp (vendored dependencies, no CDN — matches
  [[signalk-stowage-mgmt]] and the rest of the BoatHacks plugins):
  chronological log, filter by channel/date, inline playback.
- `communication.vhf.recording.status` SignalK path.

### Phase 3 — enrichment

- Correlate DSC sentences (via the NMEA0183 receive path from
  `signalk-icom-ct-m500-plugin`) so distress/individual calls show the
  calling MMSI against the relevant clip.
- Auto-tag entries (e.g. Ch16 distress/urgency from the DSC category
  field).
- Add outgoing-transmission audio here if Phase 0 confirms it's
  capturable.

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
- **Hailer/PA audio is in scope**, alongside ship's VHF — see the open
  Phase 0 question above about whether it's even visible over WiFi.
- **Fully standalone — no dependency on `signalk-icom-m510e-plugin`.**
  This plugin implements its own discovery/sign-in/keepalive client
  rather than reusing or requiring that plugin's session. Simpler
  install, no coupling between two plugins' radio sessions.
- **Retention is configurable two ways, independently: by age (days)
  and by total log directory size.** Whichever limit is hit first
  prunes oldest-first. Either can be set to unlimited.

## Open decisions

- Is TX-less logging acceptable for v1, or does capturing your own
  transmissions need to work before shipping anything?

## Development

```
npm install
npm test
```

## License

MIT
