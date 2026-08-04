#!/usr/bin/env python3
"""CosyVoice 3 gateway with server-owned reference voices.

CosyVoice's native FastAPI endpoint is not its stable public interface, so this
small gateway isolates the video repo from upstream endpoint changes.
"""
from __future__ import annotations

import os
import threading

from fastapi import Depends, HTTPException

from common import SynthesisRequest, bearer_guard, make_app, wav_response

MODEL_ID = os.environ.get("TTS_MODEL", "Fun-CosyVoice3-0.5B-2512")
app = make_app("cosy", MODEL_ID, ["en", "ja", "ko"])
_model = None
_lock = threading.Lock()


def model():
    global _model
    if _model is None:
        from cosyvoice.cli.cosyvoice import CosyVoice3
        _model = CosyVoice3(MODEL_ID)
    return _model


@app.post("/v1/synthesize", dependencies=[Depends(bearer_guard)])
def synthesize(body: SynthesisRequest):
    if body.language not in {"en", "ja", "ko"}:
        raise HTTPException(status_code=422, detail=f"CosyVoice does not serve {body.language}")
    if body.model and body.model != MODEL_ID:
        raise HTTPException(status_code=422, detail=f"Requested model differs from loaded model {MODEL_ID}")
    reference = os.environ.get(f"COSY_REFERENCE_WAV_{body.language.upper()}", "")
    if not reference:
        raise HTTPException(status_code=503, detail=f"Missing COSY_REFERENCE_WAV_{body.language.upper()}")
    # Native CosyVoice yields chunks. Reference audio is deliberately configured
    # on the server, never supplied by the Windows caller as a mutable file path.
    # inference_instruct2 is CosyVoice 3's instruction-aware path.
    import torchaudio
    prompt, prompt_rate = torchaudio.load(reference)
    if prompt_rate != 16000:
        prompt = torchaudio.functional.resample(prompt, prompt_rate, 16000)
    with _lock:
        chunks = list(model().inference_instruct2(
            body.spokenText,
            body.ttsInstruction or "Speak naturally and conversationally.",
            prompt,
            stream=False,
        ))
    if not chunks or "tts_speech" not in chunks[0]:
        raise HTTPException(status_code=502, detail="CosyVoice returned no tts_speech")
    import torch
    audio = torch.cat([chunk["tts_speech"].squeeze().cpu() for chunk in chunks]).numpy()
    return wav_response(audio, 24000, body.sampleRate, model=MODEL_ID, seed=body.seed, version="cosy-gateway-1")
