#!/usr/bin/env python3
"""Route-A expressive TTS with per-scene fidelity verification.

The router never publishes a partial run.  It writes staging/rejected material
under projects/<id>/.tts-runs and atomically replaces production audio only
after every scene has passed the lexical content gate.
"""
from __future__ import annotations

import argparse, hashlib, json, os, re, shutil, subprocess, sys, time, uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib import request, error

import numpy as np
import soundfile as sf

from tts_fidelity import (
    diff_signature, evaluate, require_japanese_tokenizer, resolve_policy,
)
from align_words import attach_canonical_scene_indices
from kokoro_adapter import KokoroSynthesizer, load_versioned_profile

FPS, SAMPLE_RATE = 30, 24000
HTTP_BACKENDS = {"qwen3": "TTS_QWEN_BASE_URL", "cosy": "TTS_COSY_BASE_URL", "style_bert_vits2": "TTS_STYLE_BERT_BASE_URL"}
ALL_BACKENDS = set(HTTP_BACKENDS) | {"edge", "kokoro"}


def sha(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


def text_sha(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def load_env(root: Path) -> dict[str, str]:
    """Load non-secret defaults, then local secret overrides, then process env."""
    result: dict[str, str] = {}
    for name in (".env", ".env.local"):
        source = root / name
        if not source.exists(): continue
        for line in source.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line: continue
            key, value = line.split("=", 1)
            result[key.strip()] = value.strip().strip('"').strip("'")
    result.update({k: v for k, v in os.environ.items() if v is not None})
    return result


def require(env: dict[str, str], key: str) -> str:
    value = env.get(key, "").strip()
    if not value: raise RuntimeError(f"Missing required configuration: {key}")
    return value


def atomic_json(path: Path, value: Any) -> None:
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temp, path)


@dataclass
class SynthesisResult:
    model: str
    backend_version: str | None
    seed: int


class SceneTooLongError(RuntimeError):
    def __init__(self, chunk_count: int, max_subchunks: int):
        super().__init__(
            f"scene requires {chunk_count} sentence-boundary subchunks; production limit is {max_subchunks}"
        )
        self.chunk_count = chunk_count
        self.max_subchunks = max_subchunks


class Backend:
    def __init__(self, name: str, env: dict[str, str], root: Path):
        self.name, self.env, self.root = name, env, root

    def health(self) -> None: raise NotImplementedError
    def synthesize(self, scene: dict[str, Any], language: str, voice: str, seed: int, attempt: int, target: Path) -> SynthesisResult: raise NotImplementedError
    def generation_settings(self, language: str, voice: str) -> dict[str, Any]: return {}
    def attempt_limit(self, configured_limit: int) -> int: return configured_limit
    def is_deterministic(self, language: str, voice: str) -> bool: return False


class HttpBackend(Backend):
    def __init__(self, name: str, env: dict[str, str], root: Path):
        super().__init__(name, env, root)
        self.base_url = require(env, HTTP_BACKENDS[name]).rstrip("/")
        self.model = require(env, {"qwen3": "TTS_QWEN_MODEL", "cosy": "TTS_COSY_MODEL", "style_bert_vits2": "TTS_STYLE_BERT_MODEL"}[name])

    def _request(self, url: str, data: bytes | None = None, content_type: str | None = None):
        headers = {"Accept": "audio/wav"}
        token = self.env.get("TTS_API_TOKEN")
        if token: headers["Authorization"] = f"Bearer {token}"
        if content_type: headers["Content-Type"] = content_type
        return request.urlopen(request.Request(url, data=data, headers=headers), timeout=180)

    def health(self) -> None:
        try:
            with self._request(self.base_url + "/health") as response:
                if response.status != 200: raise RuntimeError(f"health returned HTTP {response.status}")
        except error.URLError as exc:
            raise RuntimeError(f"{self.name} server unavailable at {self.base_url}: {exc}") from exc

    def synthesize(self, scene, language, voice, seed, attempt, target) -> SynthesisResult:
        instruction = scene.get("ttsInstruction") or ""
        # Style-Bert-VITS2 treats instruction as a strict model style label, so
        # retries may vary only seed/sampling—not mutate the label into speech.
        if self.name != "style_bert_vits2" and attempt == 2:
            instruction = f"{instruction}\nKeep every lexical word exactly as written.".strip()
        elif attempt == 3:
            instruction = f"{instruction}\nRead exactly the supplied text. Do not add, omit, or paraphrase words.".strip()
        if self.name == "style_bert_vits2":
            configured_style = self.env.get(f"TTS_STYLE_BERT_STYLE_{language.upper()}", "")
            if instruction and instruction != configured_style:
                raise RuntimeError(
                    f"Style-Bert-VITS2 only accepts configured style labels; scene instruction {instruction!r} "
                    f"does not equal TTS_STYLE_BERT_STYLE_{language.upper()}={configured_style!r}"
                )
        body = json.dumps({
            "requestId": f"{scene['id']}/attempt-{attempt}", "language": language,
            "spokenText": scene["spokenText"], "ttsInstruction": instruction,
            "voice": voice, "seed": seed, "sampleRate": SAMPLE_RATE, "model": self.model,
            "styleWeight": float(self.env.get(f"TTS_STYLE_BERT_STYLE_WEIGHT_{language.upper()}", "1.0")),
        }, ensure_ascii=False).encode("utf-8")
        try:
            with self._request(self.base_url + "/v1/synthesize", body, "application/json") as response:
                content_type = response.headers.get_content_type()
                if content_type not in ("audio/wav", "audio/x-wav", "application/octet-stream"):
                    raise RuntimeError(f"{self.name} returned {content_type}, expected audio/wav")
                target.write_bytes(response.read())
                return SynthesisResult(response.headers.get("X-TTS-Model", self.model), response.headers.get("X-TTS-Version"), int(response.headers.get("X-TTS-Seed", seed)))
        except error.URLError as exc:
            raise RuntimeError(f"{self.name} synthesis failed: {exc}") from exc


class LocalScriptBackend(Backend):
    def health(self) -> None: return

    def attempt_limit(self, configured_limit: int) -> int:
        return 1

    def is_deterministic(self, language: str, voice: str) -> bool:
        return True

    def synthesize(self, scene, language, voice, seed, attempt, target) -> SynthesisResult:
        work = target.parent / f".{scene['id']}.request.json"
        work.write_text(json.dumps({"schemaVersion": 2, "language": language, "scenes": [scene]}, ensure_ascii=False), encoding="utf-8")
        outdir = target.parent / f".{scene['id']}.local"
        shutil.rmtree(outdir, ignore_errors=True); outdir.mkdir(parents=True)
        if self.name != "edge": raise RuntimeError(f"LocalScriptBackend cannot serve {self.name}")
        command = [sys.executable, str(self.root / "scripts" / "tts_edge.py"), "--scenes", str(work), "--outdir", str(outdir), "--voice", voice, "--gap", "0"]
        subprocess.run(command, cwd=self.root, check=True)
        produced = outdir / f"{scene['id']}.wav"
        if not produced.exists(): raise RuntimeError(f"{self.name} did not write {produced}")
        shutil.move(str(produced), str(target))
        shutil.rmtree(outdir, ignore_errors=True); work.unlink(missing_ok=True)
        return SynthesisResult(self.name, None, seed)


class KokoroBackend(Backend):
    """Deterministic in-process Kokoro; model and voice load once per router run."""
    def __init__(self, name: str, env: dict[str, str], root: Path):
        super().__init__(name, env, root)
        self._settings: dict[tuple[str, str], dict[str, Any]] = {}
        self._synthesizers: dict[tuple[str, str], KokoroSynthesizer] = {}

    def health(self) -> None:
        try:
            from importlib.metadata import version
            version("kokoro")
        except Exception as exc:
            raise RuntimeError("Kokoro Python package is required for local Kokoro TTS") from exc

    def generation_settings(self, language: str, voice: str) -> dict[str, Any]:
        key = (language, voice)
        if key not in self._settings:
            if language not in {"en", "ja"}:
                raise RuntimeError(f"Kokoro backend does not support production language {language!r}")
            self._settings[key] = load_versioned_profile(self.root, self.env, language, voice)
        return self._settings[key]

    def attempt_limit(self, configured_limit: int) -> int:
        # Kokoro is deterministic: changing only attempt/seed creates the same WAV.
        return min(configured_limit, 1)

    def is_deterministic(self, language: str, voice: str) -> bool:
        return True

    def synthesize(self, scene, language, voice, seed, attempt, target) -> SynthesisResult:
        settings = self.generation_settings(language, voice)
        key = (language, voice)
        if key not in self._synthesizers:
            lang_code = {"en": "a", "ja": "j"}[language]
            self._synthesizers[key] = KokoroSynthesizer(
                lang_code=lang_code,
                voice_spec=settings["voice"],
                speed=float(settings["speed"]),
                repo_id=settings["repoId"],
            )
        synthesizer = self._synthesizers[key]
        synthesizer.synthesize(scene["spokenText"], target)
        return SynthesisResult(settings["repoId"], synthesizer.package_version, seed)


def build_backend(name: str, env: dict[str, str], root: Path) -> Backend:
    if name not in ALL_BACKENDS: raise RuntimeError(f"Unsupported TTS backend {name!r}; expected {sorted(ALL_BACKENDS)}")
    if name in HTTP_BACKENDS: return HttpBackend(name, env, root)
    if name == "kokoro": return KokoroBackend(name, env, root)
    return LocalScriptBackend(name, env, root)


class Transcriber:
    def __init__(self, model_name: str):
        try:
            from faster_whisper import WhisperModel
        except ImportError as exc:
            raise RuntimeError("faster-whisper is required for production TTS router") from exc
        self.model = WhisperModel(model_name, device="cpu", compute_type="int8")

    def transcribe(self, wav: Path, language: str) -> tuple[list[dict[str, Any]], str]:
        # Let Whisper detect the language. Passing ``language=`` forces the
        # reported language and makes a wrong-language hard gate impossible.
        segments, info = self.model.transcribe(str(wav), word_timestamps=True, vad_filter=False)
        words: list[dict[str, Any]] = []
        for segment in segments:
            for item in segment.words or []:
                token = (item.word or "").strip()
                if token:
                    words.append({"word": token, "startSec": round(float(item.start), 3), "endSec": round(float(item.end), 3), "confidence": round(float(getattr(item, "probability", 0.0) or 0.0), 3)})
        return words, info.language or language


def validate_wav(path: Path) -> float:
    info = sf.info(str(path))
    if info.samplerate != SAMPLE_RATE or info.channels != 1:
        raise RuntimeError(f"{path.name}: expected mono {SAMPLE_RATE}Hz WAV, got {info.channels}ch {info.samplerate}Hz")
    seconds = info.frames / info.samplerate
    if info.frames <= 0 or seconds < 0.1:
        raise RuntimeError(f"{path.name}: audio is empty or truncated ({seconds:.3f}s)")
    return seconds


def file_sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def apply_pronunciation_overrides(text: str, overrides: Any) -> str:
    result = text
    if not isinstance(overrides, dict):
        return result
    # Longest first prevents a short term from consuming part of a longer one.
    for surface, reading in sorted(overrides.items(), key=lambda item: len(str(item[0])), reverse=True):
        surface, reading = str(surface).strip(), str(reading).strip()
        if surface and reading:
            result = re.sub(re.escape(surface), lambda _match: reading, result, flags=re.IGNORECASE)
    return result


def reconcile_asr_results(primary: dict[str, Any], secondary: dict[str, Any], policy: Any) -> dict[str, Any]:
    """Resolve the bounded two-model verification contract."""
    if secondary["policyResult"] == "pass":
        return {**secondary, "classification": "asr_uncertain"} if primary["policyResult"] != "pass" else secondary
    if diff_signature(primary) & diff_signature(secondary):
        return secondary
    critical_uncertainty = bool(primary["criticalClaimDiff"] or secondary["criticalClaimDiff"]) or secondary["classification"] == "wrong_language"
    uncertain_result = "fail" if policy.mode == "hard" or critical_uncertainty else "warn"
    return {**secondary, "classification": "asr_uncertain",
            "criticalClaimDiff": secondary["criticalClaimDiff"] or primary["criticalClaimDiff"],
            "policyResult": uncertain_result, "passed": uncertain_result != "fail"}


def scene_cache_identity(scene: dict[str, Any], synthesis_text: str, backend_name: str,
                         voice: str, language: str, model: str,
                         generation_settings: dict[str, Any], max_chunk_chars: int,
                         policy: Any) -> tuple[dict[str, Any], str]:
    settings = {"backend": backend_name, "voice": voice, "language": language,
                "model": model, "generationSettings": generation_settings,
                "spokenText": scene["spokenText"], "synthesisText": synthesis_text,
                "ttsInstruction": scene.get("ttsInstruction", ""),
                "criticalClaims": scene.get("criticalClaims", []),
                "pronunciationOverrides": scene.get("pronunciationOverrides", {}),
                "maxChunkChars": max_chunk_chars, "fidelityPolicy": policy.as_dict()}
    return settings, sha(settings)


def split_spoken_text(text: str, max_chars: int) -> list[str]:
    """Split a long scene only at authored sentence boundaries."""
    clean = text.strip()
    if len(clean) <= max_chars:
        return [clean]
    sentences = [part.strip() for part in re.split(r"(?<=[.!?。！？])\s*", clean) if part.strip()]
    if len(sentences) < 2:
        return [clean]
    chunks: list[str] = []
    current = ""
    for sentence in sentences:
        candidate = f"{current} {sentence}".strip()
        if current and len(candidate) > max_chars:
            chunks.append(current)
            current = sentence
        else:
            current = candidate
    if current:
        chunks.append(current)
    return chunks


def synthesize_with_rechunk(backend: Backend, scene: dict[str, Any], language: str,
                            voice: str, seed: int, attempt: int, target: Path,
                            max_chars: int, max_subchunks: int) -> tuple[SynthesisResult, int]:
    chunks = split_spoken_text(scene["spokenText"], max_chars)
    if len(chunks) > max_subchunks:
        raise SceneTooLongError(len(chunks), max_subchunks)
    results: list[SynthesisResult] = []
    audio: list[np.ndarray] = []
    for index, chunk in enumerate(chunks):
        part_target = target if len(chunks) == 1 else target.with_name(f"{target.stem}.part-{index + 1}.wav")
        part_scene = {**scene, "id": f"{scene['id']}-part-{index + 1}", "spokenText": chunk}
        last_error: Exception | None = None
        # A deterministic backend must not retry a WAV that merely failed
        # fidelity. It may retry once when synthesis itself failed (transport).
        for transport_try in range(2):
            try:
                part_target.unlink(missing_ok=True)
                results.append(backend.synthesize(part_scene, language, voice, seed, attempt, part_target))
                last_error = None
                break
            except Exception as exc:
                last_error = exc
                if transport_try == 0:
                    print(f"  [network-retry] {scene['id']} part={index + 1}: {exc}")
        if last_error:
            raise last_error
        validate_wav(part_target)
        samples, sr = sf.read(str(part_target), dtype="float32", always_2d=False)
        if sr != SAMPLE_RATE or samples.ndim != 1:
            raise RuntimeError(f"{part_target.name}: invalid audio format")
        audio.append(samples)
        if part_target != target:
            part_target.unlink(missing_ok=True)
    if len(chunks) > 1:
        sf.write(str(target), np.concatenate(audio), SAMPLE_RATE)
    return results[0], len(chunks)


def main() -> int:
    parser = argparse.ArgumentParser(description="Route-A expressive TTS with lexical fidelity gate")
    parser.add_argument("--project", required=True)
    parser.add_argument("--scenes", help="defaults to projects/<id>/tts_scenes.json")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    project = root / "projects" / args.project
    manifest = json.loads((project / "project.json").read_text(encoding="utf-8"))
    language = str(manifest.get("language", "")).lower()
    if language not in {"en", "ja", "ko", "vi"}: raise RuntimeError(f"Unsupported project language {language!r}; expected en/ja/ko/vi")
    if language == "ja":
        require_japanese_tokenizer()
    payload = json.loads(Path(args.scenes or project / "tts_scenes.json").read_text(encoding="utf-8-sig"))
    scenes = payload.get("scenes") if isinstance(payload, dict) else payload
    if not isinstance(scenes, list) or not scenes: raise RuntimeError("tts_scenes.json must be non-empty schema-v2 scenes array")
    if isinstance(payload, dict) and payload.get("schemaVersion") != 2: raise RuntimeError("production router requires tts_scenes schemaVersion 2")
    if isinstance(payload, dict) and payload.get("language") != language:
        raise RuntimeError("tts_scenes.json language differs from project.json; regenerate it from the storyboard")
    env = load_env(root)
    backend_name = require(env, f"TTS_BACKEND_{language.upper()}").lower()
    if backend_name == "style_bert_vits2" and language != "ja": raise RuntimeError("style_bert_vits2 is supported for Japanese only")
    voice = require(env, f"TTS_VOICE_{language.upper()}")
    backend = build_backend(backend_name, env, root); backend.health()
    policy = resolve_policy(env, language)
    max_attempts = int(env.get(f"TTS_ALIGNMENT_MAX_ATTEMPTS_{language.upper()}", env.get("TTS_ALIGNMENT_MAX_ATTEMPTS", "3")))
    # One initial candidate plus at most one stochastic re-synthesis. A
    # deterministic backend always collapses this to one candidate.
    backend_attempts = backend.attempt_limit(min(max_attempts, 2))
    generation_settings = backend.generation_settings(language, voice)
    max_chunk_chars = int(env.get(f"TTS_MAX_CHUNK_CHARS_{language.upper()}", env.get("TTS_MAX_CHUNK_CHARS", "420")))
    max_subchunks = int(env.get(f"TTS_MAX_SUBCHUNKS_{language.upper()}", env.get("TTS_MAX_SUBCHUNKS", "4")))
    gap_seconds = float(env.get("TTS_INTER_SCENE_GAP_SECONDS", "0.08"))
    run_id = time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:8]
    run_dir = project / ".tts-runs" / run_id; rejected = run_dir / "rejected"; rejected.mkdir(parents=True)
    staged_accepted = run_dir / "accepted"; staged_accepted.mkdir()
    audio_dir = root / "public" / "audio" / args.project; audio_dir.mkdir(parents=True, exist_ok=True)
    cache_dir = project / ".tts-cache"; cache_dir.mkdir(parents=True, exist_ok=True)
    transcribers: dict[str, Transcriber] = {}
    def get_transcriber(model: str) -> Transcriber:
        if model not in transcribers: transcribers[model] = Transcriber(model)
        return transcribers[model]
    transcriber = get_transcriber(policy.model)
    try:
        repair_counts = json.loads(env.get("TTS_REPAIR_COUNTS_JSON", "{}"))
    except json.JSONDecodeError as exc:
        raise RuntimeError("TTS_REPAIR_COUNTS_JSON must be a JSON object") from exc
    if not isinstance(repair_counts, dict):
        raise RuntimeError("TTS_REPAIR_COUNTS_JSON must be a JSON object")
    accepted: list[dict[str, Any]] = []

    for scene in scenes:
        if not isinstance(scene, dict) or not scene.get("id") or not scene.get("spokenText"):
            raise RuntimeError("Every schema-v2 scene requires id and spokenText")
        if scene.get("spokenTextSha256") != text_sha(scene["spokenText"]) or scene.get("instructionSha256") != text_sha(scene.get("ttsInstruction", "")):
            raise RuntimeError(f"{scene['id']}: TTS text/instruction checksum is stale; rerun storyboard-to-tts.ts")
        synthesis_text = apply_pronunciation_overrides(scene["spokenText"], scene.get("pronunciationOverrides"))
        comparison_claims = [apply_pronunciation_overrides(str(claim), scene.get("pronunciationOverrides")) for claim in scene.get("criticalClaims", [])]
        settings, cache_key = scene_cache_identity(
            scene, synthesis_text, backend_name, voice, language,
            getattr(backend, "model", backend_name), generation_settings, max_chunk_chars, policy,
        )
        wav = audio_dir / f"{scene['id']}.wav"; sidecar = audio_dir / f"{scene['id']}.tts.json"
        candidate_wav = cache_dir / f"{cache_key}.wav"
        candidate_sidecar = cache_dir / f"{cache_key}.json"
        cache_sources = ((sidecar, wav), (candidate_sidecar, candidate_wav))
        cache_hit = False
        for cached_sidecar, cached_wav in cache_sources:
            cached = json.loads(cached_sidecar.read_text(encoding="utf-8")) if cached_sidecar.exists() else None
            if (cached and cached.get("cacheKey") == cache_key and cached_wav.exists() and cached.get("passed")
                    and cached.get("wavSha256") == file_sha(cached_wav)):
                validate_wav(cached_wav)
                # The content-addressed cache may serve two authored scenes with
                # identical TTS inputs; retain the current scene identity.
                cached["id"] = scene["id"]
                cached["repairCount"] = int(repair_counts.get(scene["id"], cached.get("repairCount", 0)) or 0)
                cached["_wavPath"] = str(cached_wav)
                accepted.append(cached); print(f"  [cache] {scene['id']}")
                cache_hit = True
                break
        if cache_hit:
            continue
        scene_passed = None
        record: dict[str, Any] | None = None
        for attempt in range(1, backend_attempts + 1):
            seed = int(sha({"project": args.project, "scene": scene["id"], "cache": cache_key, "attempt": attempt})[:8], 16)
            staged = run_dir / f"{scene['id']}.attempt-{attempt}.wav"
            try:
                result, subchunk_count = synthesize_with_rechunk(
                    backend, {**scene, "spokenText": synthesis_text}, language, voice, seed, attempt, staged, max_chunk_chars, max_subchunks,
                )
                seconds = validate_wav(staged)
            except Exception as exc:
                if isinstance(exc, SceneTooLongError):
                    classification = "scene_too_long"
                else:
                    classification = "invalid_audio" if staged.exists() else "network/backend_error"
                record = {"id": scene["id"], "cacheKey": cache_key, "passed": False,
                          "policyResult": "fail", "classification": classification,
                          "tokenDiff": [], "criticalClaimDiff": [],
                          "repairCount": int(repair_counts.get(scene["id"], 0) or 0),
                          "candidateFingerprint": cache_key,
                          "error": str(exc), "attempt": attempt,
                          "subchunkCount": getattr(exc, "chunk_count", None),
                          "maxSubchunks": getattr(exc, "max_subchunks", None)}
                atomic_json(rejected / f"{scene['id']}.attempt-{attempt}.json", record)
                print(f"  [failed] {scene['id']} attempt={attempt} class={classification}: {exc}")
                break
            observed_words, detected_language = transcriber.transcribe(staged, language)
            observed_text = " ".join(item["word"] for item in observed_words)
            primary = evaluate(synthesis_text, observed_text, language, detected_language, observed_words, policy, comparison_claims)
            verification = [{"model":policy.model, **primary}]
            final_eval, final_words, final_language, asr_model = primary, observed_words, detected_language, policy.model
            if primary["needsEscalation"] and policy.escalationModel != policy.model:
                secondary_words, secondary_language = get_transcriber(policy.escalationModel).transcribe(staged, language)
                secondary_text = " ".join(item["word"] for item in secondary_words)
                secondary = evaluate(synthesis_text, secondary_text, language, secondary_language, secondary_words, policy, comparison_claims)
                verification.append({"model":policy.escalationModel, **secondary})
                final_eval = reconcile_asr_results(primary, secondary, policy)
                final_words, final_language, asr_model = secondary_words, secondary_language, policy.escalationModel
            wav_sha256 = file_sha(staged)
            record = {"id": scene["id"], "cacheKey": cache_key, "passed": final_eval["passed"], "policyResult":final_eval["policyResult"], "classification":final_eval["classification"], "tokenDiff":final_eval["tokenDiff"], "criticalClaimDiff":final_eval["criticalClaimDiff"], "asrModel":asr_model, "asrConfidence":final_eval["asrConfidence"], "repairCount":int(repair_counts.get(scene["id"], 0) or 0), "candidateFingerprint":cache_key, "wavSha256":wav_sha256, "attempt": attempt, "backend": backend_name, "model": result.model, "backendVersion": result.backend_version, "voice": voice, "generationSettings": generation_settings, "seed": result.seed, "language": language, "detectedLanguage": final_language, "spokenTextSha256": text_sha(scene["spokenText"]), "instructionSha256": text_sha(scene.get("ttsInstruction", "")), "pronunciationOverridesSha256": sha(scene.get("pronunciationOverrides", {})), "seconds": round(seconds, 3), "subchunkCount": subchunk_count, "metrics": final_eval["metrics"], "words": final_words, "verification":verification}
            if record["passed"]:
                accepted_wav = staged_accepted / f"{scene['id']}.wav"
                shutil.copy2(staged, accepted_wav)
                record["_wavPath"] = str(accepted_wav)
                accepted.append(record); scene_passed = record
                cache_temp = candidate_wav.with_suffix(".wav.tmp")
                shutil.copy2(staged, cache_temp); os.replace(cache_temp, candidate_wav)
                atomic_json(candidate_sidecar, {key: value for key, value in record.items() if key != "_wavPath"})
                marker = "warn" if record["policyResult"] == "warn" else "ok"
                print(f"  [{marker}] {scene['id']} attempt={attempt} precision={record['metrics']['precision']:.1%} recall={record['metrics']['recall']:.1%} class={record['classification']}"); break
            shutil.copy2(staged, rejected / staged.name); atomic_json(rejected / f"{scene['id']}.attempt-{attempt}.json", record)
            print(f"  [retry] {scene['id']} attempt={attempt} precision={record['metrics']['precision']:.1%} recall={record['metrics']['recall']:.1%} edit={record['metrics']['editRate']:.1%} class={record['classification']}")
        if not scene_passed:
            assert record is not None
            atomic_json(run_dir / "failed.json", {"sceneId": scene["id"], "backend": backend_name, "maxAttempts": backend_attempts, "deterministic": backend.is_deterministic(language, voice), "policy":policy.as_dict(), "classification":record["classification"], "policyResult":record["policyResult"], "tokenDiff":record["tokenDiff"], "criticalClaimDiff":record["criticalClaimDiff"], "candidateFingerprint":record["candidateFingerprint"], "error":record.get("error")})
            raise RuntimeError(f"Scene {scene['id']} failed content-fidelity gate after {backend_attempts} attempt(s); production audio unchanged")

    gap = np.zeros(round(SAMPLE_RATE * gap_seconds), dtype=np.float32)
    all_audio, all_words, durations, cursor_samples, cursor_frames = [], [], [], 0, 0
    for index, record in enumerate(accepted):
        wav = Path(record["_wavPath"]); samples, sr = sf.read(str(wav), dtype="float32", always_2d=False)
        if sr != SAMPLE_RATE: raise RuntimeError(f"Accepted cache has stale sample rate: {wav}")
        if samples.ndim != 1: raise RuntimeError(f"Accepted cache is not mono: {wav}")
        boundary = gap if index < len(accepted) - 1 else np.zeros(0, dtype=np.float32)
        clip_samples = len(samples) + len(boundary); sec = clip_samples / SAMPLE_RATE; frames = max(1, round(sec * FPS))
        durations.append({"id": record["id"], "sec": round(sec, 3), "frames": frames, "startFrame": cursor_frames})
        all_audio.extend([samples, boundary])
        for word in record["words"]:
            all_words.append({**word, "startSec": round(word["startSec"] + cursor_samples / SAMPLE_RATE, 3), "endSec": round(word["endSec"] + cursor_samples / SAMPLE_RATE, 3)})
        cursor_samples += clip_samples; cursor_frames += frames
    canonical_words, canonical = attach_canonical_scene_indices(all_words, scenes, language)
    canonical["language"] = language; canonical["ttsSchemaVersion"] = 2
    canonical["fidelityPolicy"] = policy.as_dict()
    canonical["sceneMetrics"] = [{key: record[key] for key in ("id", "backend", "model", "voice", "attempt", "seed", "language", "metrics", "policyResult", "classification", "asrModel", "asrConfidence", "candidateFingerprint")} for record in accepted]
    public_records = [{key: value for key, value in record.items() if key != "_wavPath"} for record in accepted]
    canonical["generationManifestSha256"] = sha(public_records)
    full = np.concatenate(all_audio)
    staging_audio = run_dir / "voice.wav"; sf.write(str(staging_audio), full, SAMPLE_RATE)
    durations_doc = {"fps": FPS, "sampleRate": SAMPLE_RATE, "voice": voice, "backend": backend_name, "lang": language, "totalSec": round(len(full) / SAMPLE_RATE, 3), "totalFrames": cursor_frames, "scenes": durations, "ttsMetrics": {"chunkCount": len(accepted), "subchunkCount": sum(int(record.get("subchunkCount", 1)) for record in accepted), "warningCount": sum(record.get("policyResult") == "warn" for record in accepted), "gapCount": max(0, len(accepted)-1), "maxInterSceneGapSeconds": gap_seconds, "totalGapSeconds": round(max(0, len(accepted)-1) * gap_seconds, 3), "routerRunId": run_id, "generationSettings": generation_settings, "fidelityPolicy": policy.as_dict(), "generationManifestSha256": canonical["generationManifestSha256"]}}
    generation = {"schemaVersion": 2, "runId": run_id, "projectId": args.project, "backend": backend_name, "voice": voice, "language": language, "generationSettings": generation_settings, "fidelityPolicy": policy.as_dict(), "generationManifestSha256": canonical["generationManifestSha256"], "scenes": public_records, "generatedAt": time.time()}
    # Publish only after all JSON has been constructed and every scene passed.
    # New scene cache files are promoted now, never while a later scene might
    # still fail. Existing cache WAVs were read-only input to this run.
    for record in accepted:
        source = Path(record["_wavPath"])
        destination = audio_dir / f"{record['id']}.wav"
        if source.resolve() != destination.resolve():
            temporary = destination.with_suffix(".wav.tmp")
            shutil.copy2(source, temporary)
            os.replace(temporary, destination)
        atomic_json(audio_dir / f"{record['id']}.tts.json", {key: value for key, value in record.items() if key != "_wavPath"})
    os.replace(staging_audio, audio_dir / "voice.wav")
    atomic_json(project / "durations.json", durations_doc); atomic_json(project / "words.json", canonical_words)
    atomic_json(project / "alignment.json", canonical); atomic_json(project / "tts-generation.json", generation)
    atomic_json(run_dir / "success.json", {"audio": str(audio_dir / "voice.wav"), "sceneCount": len(accepted)})
    print(f"DONE {len(accepted)} scenes -> {audio_dir / 'voice.wav'}")
    return 0


if __name__ == "__main__":
    try: raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr); raise SystemExit(1)
