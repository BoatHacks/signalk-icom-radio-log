# icom-capture-spike

Phase 0 research tool for `signalk-icom-radio-log`. **Not the plugin** — a
throwaway script to run on the boat's WiFi next to a real IC-M510E, to answer
the open questions from the project plan before writing any plugin code.

It joins the radio's session as a 4th silent client (alongside any real
RS-M500 phone apps in use), and logs everything it can about:

- discovery / sign-in / keepalive behaviour
- channel status changes (the "busy" squelch flag, used here as transmission
  start/end boundaries)
- the raw voice/RTP UDP stream, saved per-transmission

All protocol details are taken from
[htool/signalk-icom-m510e-plugin](https://github.com/htool/signalk-icom-m510e-plugin)
and [htool/signalk-icom-ct-m500-plugin](https://github.com/htool/signalk-icom-ct-m500-plugin)
— unofficial reverse engineering, not an Icom spec. Treat this script as
likely to need patching after the first real run.

## Setup

```
npm install
```

## Running it on the boat

Connect your laptop to the same WiFi network the M510E is on or is
broadcasting (SSID from the radio's own settings, or the boat's shared
WiFi if the radio joined that instead — check the radio's WLAN menu if
unsure).

```
node index.js --out ./captures --bind <your-laptop-ip-on-that-network>
```

Use `--bind` explicitly if your laptop has more than one active interface
(e.g. a wired boat LAN plus the WiFi hotspot) — otherwise the `ip` package's
auto-detected address may be the wrong one and discovery will silently never
find the radio.

Let it run, then:
1. Key up on a few different channels from a handheld or another station,
   confirm they show up as `tx-start` / `tx-end` events.
2. Try transmitting from the M510E's own PTT mic and watch for whether
   `voice-packet` events fire during your own transmission — this answers
   the "is TX audio visible on WiFi" question.
3. Try it with a real RS-M500 phone app connected at the same time, confirm
   the app isn't disrupted.

Stop with Ctrl-C — it flushes and closes cleanly.

## What to do with the output

- **`session.jsonl`** — one JSON object per line, full event history.
  Grep for `"type":"tx-start"` / `"type":"tx-end"` to get a quick list of
  detected transmissions with duration and packet counts.
- **`voice/<n>-<timestamp>.raw`** — the concatenated raw UDP payloads for
  transmission number `n`. This is *not* a playable audio file yet — it's
  raw RTP packets back-to-back, deliberately undecoded.

### Identifying the codec

Look at the `rtp.payloadType` values logged in `voice-packet` events (and
summarized in each `tx-end` event's `payloadTypes` array):

- If it's a standard RTP payload type from the [IANA RTP profile
  registry](https://www.iana.org/assignments/rtp-parameters/rtp-parameters.xhtml)
  (e.g. `0` = PCMU/G.711 µ-law, `8` = PCMA/G.711 A-law), you can pull the
  RTP payload bytes straight out of the `.raw` file (12-byte RTP header per
  packet, rest is payload) and decode with `ffmpeg -f mulaw -ar 8000 -ac 1
  -i payload.raw out.wav` (or `alaw` for PT 8).
- If it's a dynamic payload type (96–127) or something `is-rtp` fails to
  parse cleanly, the codec is Icom-proprietary and will need more work —
  try feeding a `.raw` file into `ffmpeg`/`ffprobe` with guessed codecs, or
  compare byte patterns against known Icom D-STAR/AMBE framing if this
  turns out to be a digital vocoder rather than PCM.

### Sanity-checking the busy-flag boundaries

Compare `tx-start`/`tx-end` timestamps in `session.jsonl` against your own
notes of when you actually kept the PTT down. If there's a consistent lag
or the flag chatters (rapid start/end/start), that changes how Phase 1
should trim clips — e.g. debounce the busy flag rather than trusting it
directly.

## Known limitations of this script (intentional, for a Phase 0 spike)

- Single radio only — doesn't handle a boat with two M510Es.
- No reconnect/resilience logic — if the radio reboots or drops WiFi,
  restart the script.
- No channel-name resolution (that requires the channel-table request
  sequence from the full plugin) — transmissions are logged with a raw
  channel number, not a friendly name.
- Doesn't touch NMEA0183/DSC correlation — that's Phase 3 in the project
  plan, and needs the working codec/clip pipeline first.
