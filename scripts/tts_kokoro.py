"""
tts_kokoro.py — Generate per-scene narration audio with Kokoro TTS.

Requires Python 3.11 (torch dependency). Run via: py -3.11 scripts/tts_kokoro.py ...

Usage:
    py -3.11 scripts/tts_kokoro.py --scenes scenes.json --outdir public/audio/<proj> \
        --voice af_heart --lang a

Input  (scenes.json): [{"id": "scene-01", "text": "..."}, ...]
Output (in outdir): voice.wav, raw scene WAVs, and durations.json.
"""

import argparse
import hashlib
import json
import math
import os
import re
import sys
import tempfile
import time
import wave

try:
    from tts_scene_cache import (
        apply_cumulative_frame_boundaries,
        build_gap_assembly_record,
        build_scene_clip_identity,
        default_cache_dir,
        installed_distribution_version,
        lookup_run_scene_clip,
        lookup_scene_clip,
        materialize_scene_clip,
        normalize_gap_seconds,
        normalize_narration,
        publish_run_assembly,
        publish_run_scene_clip_sidecar,
        publish_scene_clip,
        replace_file_atomically,
        require_known_version,
        samples_to_frame_boundary,
        scene_clip_lock,
        sha256_file,
        validate_pcm16_mono_wav,
    )
except ModuleNotFoundError as error:
    if error.name != "tts_scene_cache":
        raise
    from scripts.tts_scene_cache import (
        apply_cumulative_frame_boundaries,
        build_gap_assembly_record,
        build_scene_clip_identity,
        default_cache_dir,
        installed_distribution_version,
        lookup_run_scene_clip,
        lookup_scene_clip,
        materialize_scene_clip,
        normalize_gap_seconds,
        normalize_narration,
        publish_run_assembly,
        publish_run_scene_clip_sidecar,
        publish_scene_clip,
        replace_file_atomically,
        require_known_version,
        samples_to_frame_boundary,
        scene_clip_lock,
        sha256_file,
        validate_pcm16_mono_wav,
    )

FPS = 30
SR = 24000
GAP_SEC = 0.08
KOKORO_ENGINE = "kokoro"
KOKORO_PROVIDER = "hexgrad/Kokoro-82M"
KOKORO_DEFAULT_REVISION = "main"
KOKORO_MODEL_FILES = {
    "hexgrad/Kokoro-82M": "kokoro-v1_0.pth",
    "hexgrad/Kokoro-82M-v1.1-zh": "kokoro-v1_1-zh.pth",
}
KOKORO_GAP_POLICY_VERSION = "kokoro-gap-0.08-v1"
KOKORO_DEFAULT_SPEED = 1.0
KOKORO_SPLIT_PATTERN = r"\n+"
KOKORO_PCM_WRITER_POLICY = "route-a-pcm16-stream-v1"
SCENE_ID_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
KOKORO_DEPENDENCY_DISTRIBUTIONS = {
    "misaki": "misaki",
    "espeak": "espeakng-loader",
    "torch": "torch",
    "numpy": "numpy",
}
KOKORO_EXPECTED_MEDIA = {
    "container": "wav",
    "codec": "pcm_s16le",
    "sampleRateHz": SR,
    "channels": 1,
    "sampleWidthBits": 16,
}

VIETNAMESE_MARKS = set(
    "ăâđêôơưĂÂĐÊÔƠƯ"
    "áàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệ"
    "íìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữự"
    "ýỳỷỹỵÁÀẢÃẠẤẦẨẪẬẮẰẲẴẶÉÈẺẼẸẾỀỂỄỆ"
    "ÍÌỈĨỊÓÒỎÕỌỐỒỔỖỘỚỜỞỠỢÚÙỦŨỤỨỪỬỮỰÝỲỶỸỴ"
)


def validate_input_scene_ids(scenes: object) -> None:
    if not isinstance(scenes, list) or not scenes:
        raise ValueError("TTS scenes must be a non-empty array")
    seen = set()
    for ordinal, scene in enumerate(scenes, 1):
        if not isinstance(scene, dict):
            raise ValueError(f"TTS scene {ordinal} must be an object")
        scene_id = scene.get("id")
        if not isinstance(scene_id, str) or not SCENE_ID_PATTERN.fullmatch(scene_id):
            raise ValueError(
                f"TTS scene {ordinal} id must match lowercase-hyphen segment syntax"
            )
        if scene_id in seen:
            raise ValueError(f"Duplicate TTS scene id: {scene_id}")
        seen.add(scene_id)


def looks_vietnamese(text: str) -> bool:
    letters = sum(ch.isalpha() for ch in text)
    marked = sum(ch in VIETNAMESE_MARKS for ch in text)
    return marked >= 12 and marked / max(1, letters) >= 0.01


def kokoro_engine_version() -> str:
    return installed_distribution_version("kokoro")


def kokoro_dependency_versions() -> dict[str, str]:
    """Resolve phonemizer/runtime versions without importing heavyweight modules."""
    return {
        component: require_known_version(
            installed_distribution_version(distribution), component
        )
        for component, distribution in KOKORO_DEPENDENCY_DISTRIBUTIONS.items()
    }


def _snapshot_revision(path: str) -> str | None:
    parts = os.path.realpath(path).replace("\\", "/").split("/")
    try:
        index = parts.index("snapshots")
    except ValueError:
        return None
    return parts[index + 1] if index + 1 < len(parts) else None


def _artifact_record(role: str, logical_path: str, path: str) -> dict:
    if not os.path.isfile(path):
        raise RuntimeError(f"Missing Kokoro {role} artifact: {path}")
    digest, size = sha256_file(path)
    if size <= 0:
        raise RuntimeError(f"Empty Kokoro {role} artifact: {path}")
    return {
        "role": role,
        "logicalPath": logical_path,
        "sha256": digest,
        "sizeBytes": size,
    }


def resolve_kokoro_artifacts(
    voice: str,
    repo_id: str,
    revision: str,
    model_dir: str | None = None,
) -> dict:
    """Resolve and hash the exact config, checkpoint, and voice packs to load."""
    model_filename = KOKORO_MODEL_FILES.get(repo_id)
    if not model_filename:
        raise RuntimeError(f"Unknown Kokoro model checkpoint for repo {repo_id}")

    def resolve_repo_file(logical_path: str) -> str:
        if model_dir:
            return os.path.abspath(os.path.join(model_dir, *logical_path.split("/")))
        from huggingface_hub import hf_hub_download
        return hf_hub_download(repo_id=repo_id, filename=logical_path, revision=revision)

    config_path = resolve_repo_file("config.json")
    model_path = resolve_repo_file(model_filename)
    voice_paths = []
    voice_records = []
    for ordinal, voice_name in enumerate(part.strip() for part in voice.split(",")):
        if not voice_name:
            raise ValueError("Kokoro voice list contains an empty name")
        if voice_name.endswith(".pt") and os.path.isfile(voice_name):
            voice_path = os.path.abspath(voice_name)
            logical_path = os.path.basename(voice_path)
        else:
            logical_path = f"voices/{voice_name}.pt"
            voice_path = resolve_repo_file(logical_path)
        voice_paths.append(voice_path)
        voice_records.append(_artifact_record(f"voice-{ordinal}", logical_path, voice_path))

    records = [
        _artifact_record("config", "config.json", config_path),
        _artifact_record("model", model_filename, model_path),
        *voice_records,
    ]
    revisions = {_snapshot_revision(path) for path in [config_path, model_path, *voice_paths]}
    revisions.discard(None)
    resolved_revision = next(iter(revisions)) if len(revisions) == 1 else ("local" if not revisions else "mixed")
    identity_without_digest = {
        "repoId": repo_id,
        "requestedRevision": revision,
        "resolvedRevision": resolved_revision,
        "artifacts": records,
    }
    content_digest = hashlib.sha256(json.dumps(
        identity_without_digest, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")).hexdigest()
    return {
        "repoId": repo_id,
        "configPath": config_path,
        "modelPath": model_path,
        "voiceArgument": ",".join(voice_paths),
        "identity": {**identity_without_digest, "contentSha256": content_digest},
    }


def tts_cache_key(
    text: str,
    voice: str,
    language: str,
    sample_rate: int,
    *,
    model_identity: dict,
    dependency_versions: dict[str, str],
    engine_version: str | None = None,
    speed: float = KOKORO_DEFAULT_SPEED,
    device: str = "cpu",
    options: dict | None = None,
) -> dict:
    """Return every synthesis input, including model and runtime identities."""
    speed = float(speed)
    if not math.isfinite(speed) or speed <= 0:
        raise ValueError("Kokoro speed must be finite and greater than zero")
    if not isinstance(model_identity, dict) or not model_identity.get("contentSha256"):
        raise ValueError("Kokoro cache identity requires resolved model artifact hashes")
    expected_dependencies = set(KOKORO_DEPENDENCY_DISTRIBUTIONS)
    if not isinstance(dependency_versions, dict) or set(dependency_versions) != expected_dependencies:
        raise ValueError("Kokoro cache identity requires exact misaki/espeak/torch/numpy versions")
    runtime_dependencies = {
        name: require_known_version(dependency_versions[name], name)
        for name in KOKORO_DEPENDENCY_DISTRIBUTIONS
    }
    synthesis_options = {
        "modelIdentity": model_identity,
        "runtimeDependencies": runtime_dependencies,
        "splitPattern": KOKORO_SPLIT_PATTERN,
        "device": device,
        "audioEncoding": {
            "container": "wav",
            "codec": "pcm_s16le",
            "writerPolicy": KOKORO_PCM_WRITER_POLICY,
        },
        "engineOptions": dict(options or {}),
    }
    return build_scene_clip_identity(
        narration=text,
        engine=KOKORO_ENGINE,
        engine_version=engine_version or kokoro_engine_version(),
        provider=model_identity.get("repoId", KOKORO_PROVIDER),
        provider_version=model_identity["contentSha256"],
        voice=voice,
        language=language,
        sample_rate_hz=sample_rate,
        speed=speed,
        rate=None,
        volume=None,
        pitch=None,
        options=synthesis_options,
        gap_policy_version=KOKORO_GAP_POLICY_VERSION,
    )


def validate_kokoro_wav(path: str) -> dict:
    properties = validate_pcm16_mono_wav(path, SR)
    for name, expected in KOKORO_EXPECTED_MEDIA.items():
        if properties.get(name) != expected:
            raise ValueError(f"Kokoro clip {name}={properties.get(name)!r}, expected {expected!r}")
    return properties


def initialize_kokoro_pipeline(artifacts: dict, language: str, device: str):
    """Import and construct Kokoro only after a locked cache miss."""
    import numpy as np
    import torch
    from kokoro import KModel, KPipeline

    if device == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("Kokoro CUDA device requested but CUDA is unavailable")
    model = KModel(
        repo_id=artifacts["repoId"],
        config=artifacts["configPath"],
        model=artifacts["modelPath"],
    ).to(device).eval()
    pipeline = KPipeline(
        lang_code=language,
        repo_id=artifacts["repoId"],
        model=model,
        device=device,
    )
    return pipeline, np


def synthesize_kokoro_scene(
    pipeline,
    np,
    text: str,
    voice_argument: str,
    speed: float,
    output_path: str,
) -> None:
    """Stream generated chunks directly into one PCM WAV without retaining them."""
    parent = os.path.dirname(os.path.abspath(output_path))
    os.makedirs(parent, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{os.path.basename(output_path)}.", suffix=".wav", dir=parent)
    os.close(descriptor)
    written_samples = 0
    try:
        with wave.open(temporary, "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(SR)
            for _graphemes, _phonemes, audio in pipeline(
                text,
                voice=voice_argument,
                speed=speed,
                split_pattern=KOKORO_SPLIT_PATTERN,
            ):
                samples = np.asarray(audio, dtype=np.float32).reshape(-1)
                if samples.size == 0:
                    continue
                clipped = np.clip(samples, -1.0, 1.0)
                scaled = np.where(clipped < 0, clipped * 32768.0, clipped * 32767.0)
                pcm = scaled.astype("<i2").tobytes()
                output.writeframesraw(pcm)
                written_samples += samples.size
        if written_samples <= 0:
            raise RuntimeError("Kokoro produced no audio")
        with open(temporary, "rb+") as handle:
            os.fsync(handle.fileno())
        validate_kokoro_wav(temporary)
        replace_file_atomically(temporary, output_path)
    finally:
        try:
            os.remove(temporary)
        except OSError:
            pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenes", required=True, help="JSON file: [{id,text},...]")
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--manifest", default=None, help="durations.json path (default: <outdir>/durations.json)")
    ap.add_argument("--voice", default="af_heart")
    ap.add_argument("--lang", default="a", help="Kokoro lang_code (a=US English)")
    ap.add_argument("--speed", type=float, default=KOKORO_DEFAULT_SPEED)
    ap.add_argument("--repo-id", default=KOKORO_PROVIDER)
    ap.add_argument("--model-revision", default=KOKORO_DEFAULT_REVISION)
    ap.add_argument("--model-dir", default=None, help="optional local HF snapshot root")
    ap.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    ap.add_argument("--gap", type=float, default=GAP_SEC, help="silence between per-scene TTS chunks")
    ap.add_argument("--terminal-gap", action="store_true",
                    help="append one policy gap after the final scene for chunk assembly")
    ap.add_argument("--cache-dir", default=default_cache_dir(),
                    help="shared content-addressed raw scene-clip cache")
    ap.add_argument("--force", action="store_true",
                    help="Regenerate and republish every scene clip")
    ap.add_argument("--start-index", type=int,
                    help="Zero-based scene index to resume forced TTS from; compatible local clips are imported")
    args = ap.parse_args()

    if not math.isfinite(args.speed) or args.speed <= 0:
        ap.error("--speed must be finite and greater than zero")
    gap_seconds = normalize_gap_seconds(args.gap)
    with open(args.scenes, "r", encoding="utf-8-sig") as f:
        scenes = json.load(f)
    validate_input_scene_ids(scenes)
    combined_text = " ".join(str(scene.get("text") or "") for scene in scenes)
    if args.lang in {"a", "b"} and looks_vietnamese(combined_text):
        print(
            "ERROR: Kokoro language a/b cannot produce Vietnamese narration. "
            "Use scripts/tts_edge.py --voice vi-VN-NamMinhNeural.",
            file=sys.stderr,
        )
        sys.exit(3)

    # Environment is established before huggingface_hub or kokoro is imported.
    os.environ.setdefault("HF_HUB_DISABLE_IMPLICIT_TOKEN", "1")
    artifacts = resolve_kokoro_artifacts(
        args.voice, args.repo_id, args.model_revision, args.model_dir
    )
    engine_version = require_known_version(kokoro_engine_version(), KOKORO_ENGINE)
    dependency_versions = kokoro_dependency_versions()
    os.makedirs(args.outdir, exist_ok=True)
    cache_dir = os.path.abspath(args.cache_dir)
    configured_gap_samples = int(SR * gap_seconds)
    gap_pcm = b"\0\0" * configured_gap_samples
    prepared_scenes = []
    for idx, scene in enumerate(scenes):
        sid = scene["id"]
        text = normalize_narration(scene.get("text") or "")
        if not text:
            print(f"  [skip] {sid}: empty text", file=sys.stderr)
            continue
        prepared_scenes.append((idx, sid, text))
    if not prepared_scenes:
        print("ERROR: no audio generated for any scene", file=sys.stderr)
        sys.exit(1)

    started_at = time.perf_counter()
    manifest = {
        "fps": FPS,
        "sampleRate": SR,
        "voice": args.voice,
        "lang": args.lang,
        "gapPolicy": {
            "version": KOKORO_GAP_POLICY_VERSION,
            "rawClipIncludesGap": False,
            "configuredSeconds": gap_seconds,
            "effectiveSamples": configured_gap_samples,
            "effectiveSeconds": configured_gap_samples / SR,
        },
        "scenes": [],
    }
    pipeline = None
    np = None
    start_sample = 0
    descriptor, staged_voice = tempfile.mkstemp(prefix=".voice.", suffix=".wav", dir=args.outdir)
    os.close(descriptor)
    try:
        with wave.open(staged_voice, "wb") as assembled:
            assembled.setnchannels(1)
            assembled.setsampwidth(2)
            assembled.setframerate(SR)
            for position, (idx, sid, normalized_text) in enumerate(prepared_scenes):
                has_next = position < len(prepared_scenes) - 1
                terminal_gap = args.terminal_gap and not has_next
                gap_kind = "inter-scene" if has_next else ("terminal" if terminal_gap else "none")
                gap_record = build_gap_assembly_record(
                    gap_policy_version=KOKORO_GAP_POLICY_VERSION,
                    gap_seconds=gap_seconds,
                    sample_rate_hz=SR,
                    placement=gap_kind,
                )
                cache_key = tts_cache_key(
                    normalized_text,
                    args.voice,
                    args.lang,
                    SR,
                    model_identity=artifacts["identity"],
                    dependency_versions=dependency_versions,
                    engine_version=engine_version,
                    speed=args.speed,
                    device=args.device,
                )
                wav_path = os.path.join(args.outdir, f"{sid}.wav")
                run_sidecar_path = os.path.join(args.outdir, f"{sid}.tts-cache.json")
                resume_before = args.start_index is not None and idx < args.start_index
                force_current = args.force and not resume_before
                preserve_run_local = False
                if resume_before:
                    # Resume boundaries freeze this run's committed clip even if a
                    # peer later repointed the same non-deterministic cache address.
                    cache_entry = lookup_run_scene_clip(
                        run_sidecar_path,
                        wav_path,
                        cache_key,
                        ".wav",
                        validate_kokoro_wav,
                        KOKORO_EXPECTED_MEDIA,
                    )
                    if cache_entry is None:
                        raise RuntimeError(
                            f"Cannot resume at scene index {args.start_index}: missing or stale prior clip {sid}"
                        )
                    preserve_run_local = True
                    with scene_clip_lock(cache_dir, cache_key):
                        shared_entry = lookup_scene_clip(
                            cache_dir, cache_key, ".wav", validate_kokoro_wav, KOKORO_EXPECTED_MEDIA
                        )
                        if shared_entry is None:
                            publish_scene_clip(
                                cache_dir,
                                cache_key,
                                cache_entry.audio_path,
                                ".wav",
                                validate_kokoro_wav,
                                KOKORO_EXPECTED_MEDIA,
                                validated_media=cache_entry.media,
                            )
                    print(f"  [reuse] {sid}", end="", flush=True)
                else:
                    cache_entry = None if force_current else lookup_scene_clip(
                        cache_dir, cache_key, ".wav", validate_kokoro_wav, KOKORO_EXPECTED_MEDIA
                    )
                    if cache_entry is None:
                        with scene_clip_lock(cache_dir, cache_key):
                            if not force_current:
                                cache_entry = lookup_scene_clip(
                                    cache_dir, cache_key, ".wav", validate_kokoro_wav, KOKORO_EXPECTED_MEDIA
                                )
                            if cache_entry is None and not force_current:
                                local_entry = lookup_run_scene_clip(
                                    run_sidecar_path,
                                    wav_path,
                                    cache_key,
                                    ".wav",
                                    validate_kokoro_wav,
                                    KOKORO_EXPECTED_MEDIA,
                                )
                                if local_entry is not None:
                                    cache_entry = publish_scene_clip(
                                        cache_dir,
                                        cache_key,
                                        local_entry.audio_path,
                                        ".wav",
                                        validate_kokoro_wav,
                                        KOKORO_EXPECTED_MEDIA,
                                        validated_media=local_entry.media,
                                    )
                            if cache_entry is None:
                                print(f"  [tts] {sid}…", end="", flush=True)
                                if pipeline is None:
                                    pipeline, np = initialize_kokoro_pipeline(
                                        artifacts, args.lang, args.device
                                    )
                                synthesize_kokoro_scene(
                                    pipeline,
                                    np,
                                    normalized_text,
                                    artifacts["voiceArgument"],
                                    args.speed,
                                    wav_path,
                                )
                                # Fully decode before the cache publication call.
                                validated_media = validate_kokoro_wav(wav_path)
                                cache_entry = publish_scene_clip(
                                    cache_dir,
                                    cache_key,
                                    wav_path,
                                    ".wav",
                                    validate_kokoro_wav,
                                    KOKORO_EXPECTED_MEDIA,
                                    validated_media=validated_media,
                                )
                            else:
                                print(f"  [reuse] {sid}", end="", flush=True)
                    else:
                        print(f"  [reuse] {sid}", end="", flush=True)

                if not preserve_run_local:
                    materialize_scene_clip(cache_entry, wav_path)
                publish_run_scene_clip_sidecar(
                    run_sidecar_path,
                    wav_path,
                    cache_key,
                    ".wav",
                    validate_kokoro_wav,
                    KOKORO_EXPECTED_MEDIA,
                    validated_media=cache_entry.media,
                )
                media = cache_entry.media
                with wave.open(wav_path, "rb") as raw_scene:
                    pcm = raw_scene.readframes(raw_scene.getnframes())
                speech_samples = media["frameCount"]
                assembled.writeframesraw(pcm)
                if gap_record["effectiveSamples"]:
                    assembled.writeframesraw(gap_pcm)
                scene_samples = speech_samples + gap_record["effectiveSamples"]
                sec = scene_samples / SR
                start_frame = samples_to_frame_boundary(start_sample, SR, FPS)
                end_frame = samples_to_frame_boundary(start_sample + scene_samples, SR, FPS)
                if end_frame <= start_frame:
                    raise RuntimeError(f"TTS clip {sid} is shorter than one output frame")
                manifest["scenes"].append({
                    "id": sid,
                    "sec": round(sec, 3),
                    "speechSamples": speech_samples,
                    "gapSamples": gap_record["effectiveSamples"],
                    "gapPlacement": gap_record["placement"],
                    "samples": scene_samples,
                    "startSample": start_sample,
                    "frames": end_frame - start_frame,
                    "startFrame": start_frame,
                    "rawClipCacheKeySha256": cache_entry.cache_key_sha256,
                    "rawClipSha256": cache_entry.audio_sha256,
                })
                start_sample += scene_samples
                print(f" {sec:.2f}s ({end_frame - start_frame}f)")

        with open(staged_voice, "rb+") as handle:
            os.fsync(handle.fileno())
        manifest["totalSec"] = round(start_sample / SR, 3)
        manifest["totalSamples"] = start_sample
        manifest["totalFrames"] = apply_cumulative_frame_boundaries(manifest["scenes"], SR, FPS)
        inter_scene_gap_count = sum(
            scene["gapPlacement"] == "inter-scene" for scene in manifest["scenes"]
        )
        terminal_gap_count = sum(
            scene["gapPlacement"] == "terminal" for scene in manifest["scenes"]
        )
        effective_gap_seconds = configured_gap_samples / SR
        total_gap_seconds = (inter_scene_gap_count + terminal_gap_count) * effective_gap_seconds
        manifest["ttsMetrics"] = {
            "chunkCount": len(manifest["scenes"]),
            "gapCount": inter_scene_gap_count + terminal_gap_count,
            "interSceneGapCount": inter_scene_gap_count,
            "terminalGapCount": terminal_gap_count,
            "maxInterSceneGapSeconds": round(effective_gap_seconds if inter_scene_gap_count else 0.0, 3),
            "totalGapSeconds": round(total_gap_seconds, 3),
            "gapShare": round(total_gap_seconds / manifest["totalSec"], 6) if manifest["totalSec"] else 0,
            "wallClockSeconds": round(time.perf_counter() - started_at, 3),
        }
        voice_wav = os.path.join(args.outdir, "voice.wav")
        manifest_path = args.manifest or os.path.join(args.outdir, "durations.json")
        manifest = publish_run_assembly(
            staged_voice,
            voice_wav,
            manifest,
            manifest_path,
            validate_kokoro_wav,
        )
    finally:
        try:
            os.remove(staged_voice)
        except OSError:
            pass

    print(f"\nDONE  total={manifest['totalSec']}s  ({manifest['totalFrames']} frames)  "
          f"scenes={len(manifest['scenes'])}")
    print(f"  voice.wav -> {args.outdir}")
    print(f"  durations.json -> {manifest_path}")


if __name__ == "__main__":
    main()
