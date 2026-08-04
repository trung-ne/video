#!/usr/bin/env python3
"""Route-A expressive TTS with per-scene fidelity verification.

The router never publishes a partial run.  It writes staging/rejected material
under projects/<id>/.tts-runs and atomically replaces production audio only
after every scene has passed the lexical content gate.
"""
from __future__ import annotations

import argparse, hashlib, json, os, shutil, subprocess, sys, time, uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib import request, error

import numpy as np
import soundfile as sf

from tts_fidelity import compare, passes, require_japanese_tokenizer, units
from align_words import attach_canonical_scene_indices

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


class Backend:
    def __init__(self, name: str, env: dict[str, str], root: Path):
        self.name, self.env, self.root = name, env, root

    def health(self) -> None: raise NotImplementedError
    def synthesize(self, scene: dict[str, Any], language: str, voice: str, seed: int, attempt: int, target: Path) -> SynthesisResult: raise NotImplementedError


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

    def synthesize(self, scene, language, voice, seed, attempt, target) -> SynthesisResult:
        work = target.parent / f".{scene['id']}.request.json"
        work.write_text(json.dumps({"schemaVersion": 2, "language": language, "scenes": [scene]}, ensure_ascii=False), encoding="utf-8")
        outdir = target.parent / f".{scene['id']}.local"
        shutil.rmtree(outdir, ignore_errors=True); outdir.mkdir(parents=True)
        if self.name == "edge":
            command = [sys.executable, str(self.root / "scripts" / "tts_edge.py"), "--scenes", str(work), "--outdir", str(outdir), "--voice", voice, "--gap", "0"]
        else:
            speed = self.env.get(f"TTS_KOKORO_SPEED_{language.upper()}", "1.0")
            command = ["py", "-3.11", str(self.root / "scripts" / "tts_kokoro.py"), "--scenes", str(work), "--outdir", str(outdir), "--voice", voice, "--lang", {"en": "a", "ja": "j"}.get(language, "a"), "--speed", speed, "--gap", "0"]
        subprocess.run(command, cwd=self.root, check=True)
        produced = outdir / f"{scene['id']}.wav"
        if not produced.exists(): raise RuntimeError(f"{self.name} did not write {produced}")
        shutil.move(str(produced), str(target))
        shutil.rmtree(outdir, ignore_errors=True); work.unlink(missing_ok=True)
        return SynthesisResult(self.name, None, seed)


def build_backend(name: str, env: dict[str, str], root: Path) -> Backend:
    if name not in ALL_BACKENDS: raise RuntimeError(f"Unsupported TTS backend {name!r}; expected {sorted(ALL_BACKENDS)}")
    return HttpBackend(name, env, root) if name in HTTP_BACKENDS else LocalScriptBackend(name, env, root)


class Transcriber:
    def __init__(self, model_name: str):
        try:
            from faster_whisper import WhisperModel
        except ImportError as exc:
            raise RuntimeError("faster-whisper is required for production TTS router") from exc
        self.model = WhisperModel(model_name, device="cpu", compute_type="int8")

    def transcribe(self, wav: Path, language: str) -> tuple[list[dict[str, Any]], str]:
        segments, info = self.model.transcribe(str(wav), word_timestamps=True, language=language, vad_filter=False)
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
    return info.frames / info.samplerate


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
    max_attempts = int(env.get("TTS_ALIGNMENT_MAX_ATTEMPTS", "3"))
    min_precision, min_recall, max_edit = (float(env.get("TTS_ALIGNMENT_MIN_PRECISION", "0.98")), float(env.get("TTS_ALIGNMENT_MIN_RECALL", "0.98")), float(env.get("TTS_ALIGNMENT_MAX_EDIT_RATE", "0.03")))
    gap_seconds = float(env.get("TTS_INTER_SCENE_GAP_SECONDS", "0.08"))
    run_id = time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:8]
    run_dir = project / ".tts-runs" / run_id; rejected = run_dir / "rejected"; rejected.mkdir(parents=True)
    staged_accepted = run_dir / "accepted"; staged_accepted.mkdir()
    audio_dir = root / "public" / "audio" / args.project; audio_dir.mkdir(parents=True, exist_ok=True)
    transcriber = Transcriber(env.get("TTS_ALIGNMENT_MODEL", "small"))
    accepted: list[dict[str, Any]] = []

    for scene in scenes:
        if not isinstance(scene, dict) or not scene.get("id") or not scene.get("spokenText"):
            raise RuntimeError("Every schema-v2 scene requires id and spokenText")
        if scene.get("spokenTextSha256") != text_sha(scene["spokenText"]) or scene.get("instructionSha256") != text_sha(scene.get("ttsInstruction", "")):
            raise RuntimeError(f"{scene['id']}: TTS text/instruction checksum is stale; rerun storyboard-to-tts.ts")
        settings = {"backend": backend_name, "voice": voice, "language": language, "model": getattr(backend, "model", backend_name), "spokenText": scene["spokenText"], "ttsInstruction": scene.get("ttsInstruction", "")}
        cache_key = sha(settings)
        wav = audio_dir / f"{scene['id']}.wav"; sidecar = audio_dir / f"{scene['id']}.tts.json"
        cached = json.loads(sidecar.read_text(encoding="utf-8")) if sidecar.exists() else None
        if cached and cached.get("cacheKey") == cache_key and wav.exists() and cached.get("passed"):
            validate_wav(wav)
            cached["_wavPath"] = str(wav)
            accepted.append(cached); print(f"  [cache] {scene['id']}"); continue
        scene_passed = None
        for attempt in range(1, max_attempts + 1):
            seed = int(sha({"project": args.project, "scene": scene["id"], "cache": cache_key, "attempt": attempt})[:8], 16)
            staged = run_dir / f"{scene['id']}.attempt-{attempt}.wav"
            result = backend.synthesize(scene, language, voice, seed, attempt, staged)
            seconds = validate_wav(staged)
            observed_words, detected_language = transcriber.transcribe(staged, language)
            metrics = compare(units(scene["spokenText"], language), units(" ".join(item["word"] for item in observed_words), language))
            record = {"id": scene["id"], "cacheKey": cache_key, "passed": passes(metrics, min_precision, min_recall, max_edit), "attempt": attempt, "backend": backend_name, "model": result.model, "backendVersion": result.backend_version, "voice": voice, "seed": result.seed, "language": language, "detectedLanguage": detected_language, "spokenTextSha256": text_sha(scene["spokenText"]), "instructionSha256": text_sha(scene.get("ttsInstruction", "")), "seconds": round(seconds, 3), "metrics": metrics.as_dict(), "words": observed_words}
            if record["passed"]:
                accepted_wav = staged_accepted / f"{scene['id']}.wav"
                shutil.copy2(staged, accepted_wav)
                record["_wavPath"] = str(accepted_wav)
                accepted.append(record); scene_passed = record
                print(f"  [ok] {scene['id']} attempt={attempt} precision={metrics.precision:.1%} recall={metrics.recall:.1%}"); break
            shutil.copy2(staged, rejected / staged.name); atomic_json(rejected / f"{scene['id']}.attempt-{attempt}.json", record)
            print(f"  [retry] {scene['id']} attempt={attempt} precision={metrics.precision:.1%} recall={metrics.recall:.1%} edit={metrics.editRate:.1%}")
        if not scene_passed:
            atomic_json(run_dir / "failed.json", {"sceneId": scene["id"], "backend": backend_name, "maxAttempts": max_attempts})
            raise RuntimeError(f"Scene {scene['id']} failed content-fidelity gate after {max_attempts} attempts; production audio unchanged")

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
    canonical["fidelityPolicy"] = {"minPrecision": min_precision, "minRecall": min_recall, "maxEditRate": max_edit, "maxContiguousInsertion": 0}
    canonical["sceneMetrics"] = [{key: record[key] for key in ("id", "backend", "model", "voice", "attempt", "seed", "language", "metrics")} for record in accepted]
    public_records = [{key: value for key, value in record.items() if key != "_wavPath"} for record in accepted]
    canonical["generationManifestSha256"] = sha(public_records)
    full = np.concatenate(all_audio)
    staging_audio = run_dir / "voice.wav"; sf.write(str(staging_audio), full, SAMPLE_RATE)
    durations_doc = {"fps": FPS, "sampleRate": SAMPLE_RATE, "voice": voice, "backend": backend_name, "lang": language, "totalSec": round(len(full) / SAMPLE_RATE, 3), "totalFrames": cursor_frames, "scenes": durations, "ttsMetrics": {"chunkCount": len(accepted), "gapCount": max(0, len(accepted)-1), "maxInterSceneGapSeconds": gap_seconds, "totalGapSeconds": round(max(0, len(accepted)-1) * gap_seconds, 3), "routerRunId": run_id}}
    generation = {"schemaVersion": 1, "runId": run_id, "projectId": args.project, "backend": backend_name, "voice": voice, "language": language, "scenes": public_records, "generatedAt": time.time()}
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
