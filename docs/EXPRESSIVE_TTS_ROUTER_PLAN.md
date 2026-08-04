# Expressive TTS Router

## Production contract

Route A remains the only authoring route. `storyboard-to-tts.ts` writes
schema-v2 `tts_scenes.json`; `tts_router.py --project <id>` synthesizes and
verifies each scene before it atomically publishes `voice.wav`,
`durations.json`, `words.json`, `alignment.json`, and `tts-generation.json`.
No Route-B command is involved.

`spokenText` always derives from `SceneBrief.narration`; it is the sole source
for subtitles and content verification. `ttsInstruction` is hand-authored
performance direction and is never rendered or matched as narration.

## Backend selection

The router reads `.env`, then `.env.local`, then process environment. Non-secret
language routing is stored in `.env`:

```dotenv
TTS_BACKEND_EN=qwen3
TTS_BACKEND_JA=kokoro
TTS_BACKEND_KO=qwen3
TTS_BACKEND_VI=edge
TTS_VOICE_JA=jf_alpha:0.80,jf_nezumi:0.20
TTS_KOKORO_PROFILE_JA=tokyo-female-conversational-v1
TTS_KOKORO_SPEED_JA=0.96
```

Supported backend values are `qwen3`, `cosy`, `style_bert_vits2`, `kokoro`, and
`edge`. Style-Bert-VITS2 is Japanese-only. Qwen/Cosy/Style-Bert use a private
HTTP service; Edge/Kokoro remain local compatibility backends. URLs and model
selection are configured with the `TTS_*_BASE_URL` and `TTS_*_MODEL` keys in
`.env`. Put `TTS_API_TOKEN` only in ignored `.env.local` or system environment.

Each remote service must implement:

```text
GET /health
GET /v1/capabilities
POST /v1/synthesize
```

`POST /v1/synthesize` accepts `requestId`, `language`, `spokenText`,
`ttsInstruction`, `voice`, `seed`, `sampleRate`, and `model`; it returns mono
24 kHz WAV with `X-TTS-Model`, `X-TTS-Version`, and `X-TTS-Seed` headers.

Deploy each model in an isolated Python environment/container on the Linux GPU
host: Qwen on port 8020, CosyVoice on 50000, and Style-Bert-VITS2 on 50001.
Expose ports only through LAN/VPN/reverse proxy with bearer authentication.
Qwen remains available for EN/JA/KO; this workstation's Japanese route uses the
local Kokoro profile below. Cosy and JP-Extra are opt-in A/B routes.

## Local Kokoro Japanese profile

Japanese Kokoro runs inside `tts_router.py`; its `KPipeline(lang_code="j")` and
weighted voice embedding are loaded once and reused for every scene in the run.
The versioned baseline in `config/tts/kokoro-ja-profiles.json` is an adult female
neutral-conversational blend, `jf_alpha:0.80,jf_nezumi:0.20`, at speed `0.96`.
It targets stable Standard Japanese within Kokoro's G2P/prosody limits; it is not
a voice clone or a guarantee of a specific Tokyo speaker/accent.

Weighted profiles accept at most two same-language, same-gender voices. Weights
are normalized before synthesis. Profile ID, normalized blend, speed, Kokoro
repository and installed package version are recorded in generation settings;
changing voice, weights or speed invalidates the accepted-scene cache.

Kokoro has no instruction channel, so `ttsInstruction` is never appended to
`spokenText`. The same narrator profile is used throughout the video.

## Fidelity gate and retries

For every scene the router:

1. Generates staging WAV and re-transcribes it with Faster Whisper.
2. Computes lexical precision, recall, Levenshtein edit rate, and contiguous
   lexical insertions against `spokenText`.
3. Accepts only precision/recall >= 0.98, edit rate <= 0.03, and zero lexical
   insertion runs.
4. Retries only a rejected scene up to three times for stochastic backends, always on the same backend
   and voice; later attempts use a new seed and stricter no-add/no-omit direction.
5. Treats Kokoro as deterministic and performs one attempt per unchanged setting,
   avoiding three identical WAVs. A failed scene hard-fails without publication.
6. Hard-fails after the final allowed attempt without replacing any production artifact.

Accepted scene audio is cached by backend, model, voice, language, text, and
instruction hash. Rejected WAV and reports live under
`projects/<id>/.tts-runs/<run-id>/`; this directory is ignored by Git.

English and Korean use normalized lexical units. Japanese production runs
require `sudachipy` + `sudachidict_core`: the canonical text is segmented with
Sudachi's reading form, converted from Katakana to Hiragana, compared to ASR at
the kana-character level, then its timestamps are grouped back onto the
original Kanji/kana subtitle characters. This avoids false Kanji-versus-kana
mismatches and avoids inserted spaces in subtitle cues.

The workstation environment for the router needs `faster-whisper`, `numpy`,
`soundfile`, `sudachipy`, and `sudachidict_core`; the GPU service requirements
and launch commands are in `services/tts/README.md`.

The compiler treats schema-v2 alignment without a per-scene fidelity report as
a blocker. `alignment.json` and `tts-generation.json` checksums are included in
timeline timing provenance and checked again before render/publish.

## Verification

Create fidelity-gated blind Japanese comparisons without touching production:

```bash
py -3.11 scripts/evaluate_kokoro_ja.py --round 1
py -3.11 scripts/evaluate_kokoro_ja.py --round 2 --voice-a jf_alpha --voice-b jf_nezumi
```

Round 1 compares the four Japanese female voices at speed 0.96. Round 2 compares
90/10, 80/20, 70/30 and 50/50 blends at speeds 0.94, 0.96 and 0.98. Only
candidates whose 20-scene corpus passes the Japanese fidelity gate appear in
`accepted/`; `blind-manifest.json` hides the profile and `answer-key.json` reveals
it after listening. The selected result must be written explicitly to the
versioned profile and `.env`; until then, the baseline remains active.

Run `npm run check` for TypeScript, existing engine tests, canonical alignment
tests, and lexical-fidelity unit tests. GPU smoke tests must generate the same
EN/JA/KO fixture set through each remote backend and pass the router before
production use. Japanese Qwen vs JP-Extra selection is an A/B quality decision;
only a backend that passes the fidelity gate may be compared or promoted.
