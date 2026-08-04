"""Shared pieces for the private expressive-TTS HTTP gateways.

These services intentionally expose a small, model-neutral contract.  They are
deployed on the Linux GPU host; the Windows video workstation only invokes the
contract through ``scripts/tts_router.py``.
"""
from __future__ import annotations

import io
import os
from typing import Annotated

import numpy as np
import soundfile as sf
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from scipy.signal import resample_poly


class SynthesisRequest(BaseModel):
    requestId: str = Field(min_length=1)
    language: str = Field(pattern="^(en|ja|ko|vi)$")
    spokenText: str = Field(min_length=1)
    ttsInstruction: str = ""
    voice: str = Field(min_length=1)
    seed: int
    sampleRate: int = Field(default=24000, ge=8000, le=48000)
    model: str = ""
    styleWeight: float = Field(default=1.0, ge=0.0, le=2.0)


def bearer_guard(authorization: Annotated[str | None, Header()] = None) -> None:
    """Require a bearer token only when TTS_SERVICE_TOKEN is configured."""
    expected = os.environ.get("TTS_SERVICE_TOKEN", "")
    if not expected:
        return
    if authorization != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail="Invalid bearer token")


def make_app(name: str, model: str, languages: list[str]) -> FastAPI:
    app = FastAPI(title=f"{name} private TTS gateway", version="1.0")

    @app.get("/health")
    def health():
        return {"ok": True, "backend": name, "model": model}

    @app.get("/v1/capabilities")
    def capabilities(_: None = Depends(bearer_guard)):
        return {
            "backend": name,
            "model": model,
            "languages": languages,
            "sampleRates": [24000],
            "contractVersion": 1,
        }

    return app


def wav_response(audio: object, source_rate: int, requested_rate: int, *, model: str, seed: int, version: str) -> Response:
    """Normalise backend output to a mono WAV at precisely requested_rate."""
    data = np.asarray(audio, dtype=np.float32)
    if data.ndim > 1:
        data = np.mean(data, axis=-1)
    if source_rate != requested_rate:
        # rational resampling avoids silently lying about WAV sample rate.
        from math import gcd
        divisor = gcd(source_rate, requested_rate)
        data = resample_poly(data, requested_rate // divisor, source_rate // divisor).astype(np.float32)
    buffer = io.BytesIO()
    sf.write(buffer, data, requested_rate, format="WAV", subtype="PCM_16")
    return Response(
        content=buffer.getvalue(),
        media_type="audio/wav",
        headers={
            "X-TTS-Model": model,
            "X-TTS-Seed": str(seed),
            "X-TTS-Sample-Rate": str(requested_rate),
            "X-TTS-Version": version,
        },
    )
