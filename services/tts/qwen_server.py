#!/usr/bin/env python3
"""Qwen3-TTS CustomVoice gateway implementing the repository TTS contract."""
from __future__ import annotations

import os
import threading

from fastapi import Depends, HTTPException

from common import SynthesisRequest, bearer_guard, make_app, wav_response

MODEL_ID = os.environ.get("TTS_MODEL", "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice")
LANGUAGES = {"en": "English", "ja": "Japanese", "ko": "Korean"}
app = make_app("qwen3", MODEL_ID, list(LANGUAGES))
_model = None
_lock = threading.Lock()


def model():
    global _model
    if _model is None:
        import torch
        from qwen_tts import Qwen3TTSModel
        _model = Qwen3TTSModel.from_pretrained(
            MODEL_ID,
            device_map=os.environ.get("TTS_DEVICE", "cuda:0"),
            dtype=torch.bfloat16,
            attn_implementation=os.environ.get("TTS_ATTENTION", "flash_attention_2"),
        )
    return _model


@app.post("/v1/synthesize", dependencies=[Depends(bearer_guard)])
def synthesize(body: SynthesisRequest):
    if body.language not in LANGUAGES:
        raise HTTPException(status_code=422, detail=f"Qwen CustomVoice does not serve {body.language}")
    if body.model and body.model not in {MODEL_ID, MODEL_ID.removeprefix("Qwen/")}:
        raise HTTPException(status_code=422, detail=f"Requested model differs from loaded model {MODEL_ID}")
    import torch
    # Generator state is global in the model stack, so serialize inference rather
    # than mixing request seeds across simultaneous scenes.
    with _lock:
        torch.manual_seed(body.seed)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(body.seed)
        wavs, sample_rate = model().generate_custom_voice(
            text=body.spokenText,
            language=LANGUAGES[body.language],
            speaker=body.voice,
            instruct=body.ttsInstruction or None,
        )
    return wav_response(wavs[0], sample_rate, body.sampleRate, model=MODEL_ID, seed=body.seed, version="qwen3-gateway-1")
