# Private model gateways

These are Linux GPU-host processes, not part of the Windows Remotion runtime.
They expose the one contract consumed by `scripts/tts_router.py`:

```text
GET  /health
GET  /v1/capabilities
POST /v1/synthesize     # audio/wav, 24 kHz mono
```

Do not expose these ports publicly. Bind to a LAN/VPN address or put a
TLS/authenticated reverse proxy in front. Set the same bearer value in the GPU
host's `TTS_SERVICE_TOKEN` and the workstation's untracked `.env.local` as
`TTS_API_TOKEN`.

## Qwen3-TTS (default; port 8020)

On a Linux NVIDIA host with the Qwen `qwen-tts` package installed:

```bash
cd services/tts
python -m venv .venv-qwen && source .venv-qwen/bin/activate
pip install -r requirements-qwen.txt
export TTS_MODEL=Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice
export TTS_SERVICE_TOKEN='long-random-value'
uvicorn qwen_server:app --host 127.0.0.1 --port 8020
```

`qwen_server.py` loads the model once, maps `en`/`ja`/`ko` to Qwen's language
names, honours the requested voice/instruction/seed, and resamples its result
to the contract's requested sample rate.

## CosyVoice 3 (optional; port 50000)

Install the official CosyVoice checkout into a separate venv, then add its
repository to `PYTHONPATH`. Configure a static approved reference WAV per
language (and retain its approved transcript as host metadata); reference
assets remain on the GPU host rather than being accepted from a request. The
gateway uses CosyVoice 3's instruction-aware `inference_instruct2` path.

```bash
cd services/tts
source .venv-cosy/bin/activate
export PYTHONPATH=/opt/CosyVoice:$PYTHONPATH
export TTS_MODEL=/models/Fun-CosyVoice3-0.5B-2512
export COSY_REFERENCE_WAV_JA=/models/references/ja-speaker.wav
export COSY_REFERENCE_TEXT_JA='approved reference transcript (metadata)'
uvicorn cosy_server:app --host 127.0.0.1 --port 50000
```

## Style-Bert-VITS2 JP-Extra (optional; port 50001)

First inspect and accept the license of the exact JP-Extra checkpoint. Then
configure an explicit installed model and one explicit model style; no request
can silently fall back to `Neutral`.

```bash
cd services/tts
source .venv-style-bert/bin/activate
export PYTHONPATH=/opt/Style-Bert-VITS2:$PYTHONPATH
export STYLE_BERT_MODEL_DIR=/models/style-bert-vits2
export TTS_MODEL='JP-Extra-model-name'
export STYLE_BERT_STYLE_JA='Neutral'
export STYLE_BERT_LICENSE_ACCEPTED=true
uvicorn style_bert_vits2_server:app --host 127.0.0.1 --port 50001
```

The router sends `ttsInstruction` as the selected style for this backend. If it
does not exactly match `TTS_STYLE_BERT_STYLE_JA`, the workstation and server
both fail the scene before any production artifact is published.
