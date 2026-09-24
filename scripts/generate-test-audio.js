#!/usr/bin/env node
'use strict'

// Generates the WAV pairs in scripts/examples/: synthesizes test radio
// phrases with a local Piper (Wyoming TTS) container, then runs each one
// through a simulated version of this plugin's real audio path (resample
// to the M510E's RX rate, mu-law encode, fake-RTP-frame, then the exact
// frame/unframe/decode round-trip lib/rtpAudio.js uses for real
// recordings) — without needing a real radio.
//
// Requires a Piper Wyoming service reachable at --piper-host:--piper-port
// (default 127.0.0.1:10200, e.g. via signalk-piper). Not part of the
// plugin runtime — a dev tool for testing/demonstrating the
// speech-to-text feature. See README.md's "Known limitation" section for
// what this surfaced.
//
// Usage: node scripts/generate-test-audio.js [--piper-host H] [--piper-port P]

const fs = require('fs')
const path = require('path')
const { synthesize } = require('./wyomingSynthesize')
const { resamplePcm16, pcm16ToMuLaw, muLawToFakeRtpPackets } = require('./testAudioHelpers')
const { frameRtpPackets, unframeRtpPackets, extractMuLawPayload, muLawToPcm16, pcm16ToWav, SAMPLE_RATE } = require('../lib/rtpAudio')

const EXAMPLES_DIR = path.join(__dirname, 'examples')

const CASES = [
  { name: 'mayday-single', text: 'Mayday.' },
  { name: 'mayday-triple', text: 'Mayday mayday mayday.' },
  { name: 'panpan-triple', text: 'Pan-pan pan-pan pan-pan.' },
  { name: 'securite-triple', text: 'Securite securite securite.' },
]

function parseArgs (argv) {
  const args = { piperHost: '127.0.0.1', piperPort: 10200 }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--piper-host') args.piperHost = argv[++i]
    else if (argv[i] === '--piper-port') args.piperPort = Number(argv[++i])
  }
  return args
}

async function main () {
  const { piperHost, piperPort } = parseArgs(process.argv.slice(2))
  fs.mkdirSync(EXAMPLES_DIR, { recursive: true })

  for (const { name, text } of CASES) {
    process.stdout.write(`synthesizing "${text}"... `)

    // Piper's raw output, before the radio-path simulation — lets you
    // tell whether a mis-transcription comes from Piper's pronunciation
    // or from the resample/mu-law/8kHz round-trip.
    const { format, pcm: rawPcm } = await synthesize({ host: piperHost, port: piperPort, text })
    fs.writeFileSync(path.join(EXAMPLES_DIR, `${name}-piper-raw.wav`), pcm16ToWav(rawPcm, { sampleRate: format.rate }))

    // What lib/wyomingClient.js actually sends to the ASR service: the
    // exact same frame -> write -> unframe -> extract -> decode path
    // index.js's /transcribe route runs on a real stored recording.
    const resampled = resamplePcm16(rawPcm, format.rate, SAMPLE_RATE)
    const muLaw = pcm16ToMuLaw(resampled)
    const rtpPackets = muLawToFakeRtpPackets(muLaw)
    const framed = frameRtpPackets(rtpPackets)
    const recovered = unframeRtpPackets(framed)
    const decodedPcm = muLawToPcm16(extractMuLawPayload(recovered))
    fs.writeFileSync(path.join(EXAMPLES_DIR, `${name}-whisper-input.wav`), pcm16ToWav(decodedPcm, { sampleRate: SAMPLE_RATE }))

    console.log('done')
  }
}

main().catch((err) => {
  console.error('FAILED:', err.message)
  process.exit(1)
})
