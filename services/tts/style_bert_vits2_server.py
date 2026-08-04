#!/usr/bin/env python3
"""Style-Bert-VITS2 JP-Extra gateway with explicit license/style safeguards."""
from __future__ import annotations

import os
import threading

from fastapi import Depends, HTTPException

from common import SynthesisRequest, bearer_guard, make_app, wav_response

MODEL_ID = os.environ.get("TTS_MODEL", "")
app = make_app("style_bert_vits2", MODEL_ID, ["ja"])
_holder = _model = None
_lock = threading.Lock()


def model():
    global _holder, _model
    if os.environ.get("STYLE_BERT_LICENSE_ACCEPTED") != "true":
        raise HTTPException(status_code=503, detail="Set STYLE_BERT_LICENSE_ACCEPTED=true only after reviewing the selected checkpoint license")
    if not MODEL_ID:
        raise HTTPException(status_code=503, detail="TTS_MODEL must name an installed JP-Extra model")
    if _model is None:
        from style_bert_vits2.tts_model import TTSModelHolder
        _holder = TTSModelHolder(os.environ["STYLE_BERT_MODEL_DIR"], device=os.environ.get("TTS_DEVICE", "cuda"))
        _model = _holder.get_model(MODEL_ID)
    return _model


@app.post("/v1/synthesize", dependencies=[Depends(bearer_guard)])
def synthesize(body: SynthesisRequest):
    if body.language != "ja":
        raise HTTPException(status_code=422, detail="Style-Bert-VITS2 is enabled only for Japanese")
    if body.model and body.model != MODEL_ID:
        raise HTTPException(status_code=422, detail=f"Requested model differs from loaded model {MODEL_ID}")
    allowed_style = os.environ.get("STYLE_BERT_STYLE_JA", "")
    if not allowed_style or body.ttsInstruction != allowed_style:
        raise HTTPException(status_code=422, detail="ttsInstruction must exactly equal STYLE_BERT_STYLE_JA")
    with _lock:
        audio, sample_rate = model().infer(body.spokenText, style=allowed_style, style_weight=body.styleWeight)
    return wav_response(audio, sample_rate, body.sampleRate, model=MODEL_ID, seed=body.seed, version="style-bert-vits2-gateway-1")
