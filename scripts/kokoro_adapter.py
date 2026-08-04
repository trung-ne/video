"""Reusable in-process Kokoro adapter and production voice-profile validation."""
from __future__ import annotations

import json
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any, Callable

KOKORO_SAMPLE_RATE = 24000
KOKORO_REPO_DEFAULT = "hexgrad/Kokoro-82M"
JAPANESE_VOICE_GENDERS = {
    "jf_alpha": "female",
    "jf_gongitsune": "female",
    "jf_nezumi": "female",
    "jf_tebukuro": "female",
    "jm_kumo": "male",
}


def parse_weighted_voice(spec: str) -> list[tuple[str, float]]:
    """Parse and normalize ``voice:weight`` pairs without loading Kokoro."""
    import re

    parts = [part.strip() for part in spec.split(",") if part.strip()]
    if not parts:
        raise ValueError("Kokoro voice must not be empty")
    weighted: list[tuple[str, float]] = []
    seen: set[str] = set()
    for part in parts:
        match = re.fullmatch(r"([A-Za-z0-9_-]+)(?::([0-9]+(?:\.[0-9]+)?))?", part)
        if not match:
            raise ValueError(f"Invalid Kokoro voice blend element {part!r}; use voice:weight")
        name, raw_weight = match.groups()
        if name in seen:
            raise ValueError(f"Kokoro voice {name!r} appears more than once")
        seen.add(name)
        weighted.append((name, float(raw_weight) if raw_weight is not None else 1.0))
    if len(weighted) > 2:
        raise ValueError("Kokoro supports at most two voices in a production blend")
    if any(weight <= 0 for _, weight in weighted):
        raise ValueError("Kokoro blend weights must be positive")
    total = sum(weight for _, weight in weighted)
    return [(name, weight / total) for name, weight in weighted]


def validate_voice_for_language(spec: str, lang_code: str, *, allow_mixed_gender: bool = False) -> list[tuple[str, float]]:
    weighted = parse_weighted_voice(spec)
    if lang_code == "j":
        unknown = [name for name, _ in weighted if name not in JAPANESE_VOICE_GENDERS]
        if unknown:
            raise ValueError(
                f"Japanese Kokoro requires Japanese voices {sorted(JAPANESE_VOICE_GENDERS)}, got {unknown}"
            )
        genders = {JAPANESE_VOICE_GENDERS[name] for name, _ in weighted}
        if len(genders) > 1 and not allow_mixed_gender:
            raise ValueError("Production Japanese Kokoro profiles may not blend male and female voices")
    return weighted


def canonical_voice_spec(spec: str, lang_code: str) -> str:
    return ",".join(f"{name}:{weight:.6f}" for name, weight in validate_voice_for_language(spec, lang_code))


def load_versioned_profile(root: Path, env: dict[str, str], language: str, voice: str) -> dict[str, Any]:
    """Resolve a profile and fail when .env silently drifts from its versioned definition."""
    lang_code = {"en": "a", "ja": "j"}.get(language, "a")
    speed = float(env.get(f"TTS_KOKORO_SPEED_{language.upper()}", "1.0"))
    if not 0.75 <= speed <= 1.20:
        raise ValueError("Kokoro speed must stay between 0.75 and 1.20")
    profile_id = env.get(f"TTS_KOKORO_PROFILE_{language.upper()}", "").strip()
    base = {
        "profileId": profile_id or "env-direct",
        "profileSchemaVersion": 1,
        "voice": canonical_voice_spec(voice, lang_code),
        "speed": speed,
        "repoId": env.get("TTS_KOKORO_REPO", KOKORO_REPO_DEFAULT),
        "deterministic": True,
    }
    if not profile_id:
        return base
    registry_path = root / "config" / "tts" / "kokoro-ja-profiles.json"
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    if registry.get("schemaVersion") != 1:
        raise ValueError(f"Unsupported Kokoro profile schema in {registry_path}")
    profile = registry.get("profiles", {}).get(profile_id)
    if not isinstance(profile, dict):
        raise ValueError(f"Unknown TTS_KOKORO_PROFILE_{language.upper()}={profile_id!r}")
    if profile.get("language") != language:
        raise ValueError(f"Kokoro profile {profile_id!r} is for {profile.get('language')}, not {language}")
    expected_voice = canonical_voice_spec(str(profile.get("voice", "")), lang_code)
    expected_speed = float(profile.get("speed", 1.0))
    if base["voice"] != expected_voice or abs(speed - expected_speed) > 1e-9:
        raise ValueError(
            f".env voice/speed drift from versioned Kokoro profile {profile_id!r}; "
            f"expected {profile['voice']} at {expected_speed}"
        )
    return {**base, **profile, "voice": expected_voice, "speed": expected_speed}


class KokoroSynthesizer:
    """Load one KPipeline/voice embedding and reuse it for every scene in a run."""

    def __init__(
        self,
        lang_code: str,
        voice_spec: str,
        speed: float,
        repo_id: str = KOKORO_REPO_DEFAULT,
        pipeline_factory: Callable[..., Any] | None = None,
    ):
        self.lang_code = lang_code
        self.voice_spec = voice_spec
        self.speed = speed
        self.repo_id = repo_id
        self._pipeline_factory = pipeline_factory
        self._pipeline = None
        self._voice_key: str | None = None
        self.load_count = 0

    @property
    def package_version(self) -> str:
        try:
            return version("kokoro")
        except PackageNotFoundError:
            return "not-installed"

    def _load(self):
        if self._pipeline is not None:
            return
        if self._pipeline_factory is None:
            from kokoro import KPipeline
            self._pipeline_factory = KPipeline
        self._pipeline = self._pipeline_factory(lang_code=self.lang_code, repo_id=self.repo_id)
        weighted = validate_voice_for_language(self.voice_spec, self.lang_code)
        if len(weighted) == 1:
            self._voice_key = weighted[0][0]
        else:
            key = "weighted:" + ",".join(f"{name}:{weight:.6f}" for name, weight in weighted)
            packs = [self._pipeline.load_single_voice(name) for name, _ in weighted]
            self._pipeline.voices[key] = sum(pack * weight for pack, (_, weight) in zip(packs, weighted))
            self._voice_key = key
        self.load_count += 1

    def synthesize(self, text: str, target: Path) -> None:
        import numpy as np
        import soundfile as sf

        self._load()
        chunks = [result.audio for result in self._pipeline(text, voice=self._voice_key, speed=self.speed)]
        if not chunks:
            raise RuntimeError("Kokoro produced no audio")
        audio = np.concatenate(chunks).astype(np.float32)
        sf.write(str(target), audio, KOKORO_SAMPLE_RATE, subtype="PCM_16")

