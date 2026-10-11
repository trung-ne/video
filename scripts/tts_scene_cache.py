"""Shared content-addressed cache for Route A per-scene TTS clips.

A cache sidecar is the commit record. Validated audio is published first under an
immutable name containing its byte hash; the sidecar is then replaced atomically.
A crash can therefore leave an unreferenced audio object, but never a reusable
partial entry.
"""

from __future__ import annotations

import errno
import hashlib
import importlib.metadata
import json
import math
import os
import re
import tempfile
import time
import unicodedata
import uuid
import wave
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any, Callable, Iterator, Mapping, Optional


CACHE_SCHEMA_VERSION = 3
RUN_SIDECAR_SCHEMA_VERSION = 1
LOCK_SCHEMA_VERSION = 1
CACHE_NAMESPACE = "route-a-scene-clips-v3"
NARRATION_NORMALIZATION = "unicode-nfc-trim-v1"
RUN_ASSEMBLY_INTEGRITY_POLICY = "hash-bound-sample-ledger-v1"
FRAME_BOUNDARY_POLICY = "cumulative-samples-js-round-v1"
GAP_PLACEMENTS = frozenset({"none", "inter-scene", "terminal"})
_SUFFIX_RE = re.compile(r"^\.[a-z0-9]+$")
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_MAX_SIDECAR_BYTES = 1024 * 1024
_REPLACE_RETRIES = 8
_REPLACE_INITIAL_DELAY_SEC = 0.02

AudioValidator = Callable[[str], Mapping[str, Any]]


@dataclass(frozen=True)
class SceneClipCacheEntry:
    audio_path: str
    metadata_path: str
    cache_key_sha256: str
    audio_sha256: str
    size_bytes: int
    media: Mapping[str, Any]


def normalize_narration(text: str) -> str:
    """Normalize exactly the text sent to a synthesis engine."""
    if not isinstance(text, str):
        raise TypeError("TTS narration must be a string")
    return unicodedata.normalize("NFC", text.strip())


def installed_distribution_version(distribution: str, module: Any = None) -> str:
    """Resolve a package version without importing heavyweight engine modules."""
    try:
        return importlib.metadata.version(distribution)
    except importlib.metadata.PackageNotFoundError:
        module_version = getattr(module, "__version__", None) if module is not None else None
        return str(module_version) if module_version else "unknown"


def require_known_version(version: str, component: str) -> str:
    value = str(version).strip()
    if not value or value == "unknown":
        raise RuntimeError(f"Cannot identify installed {component} version; refusing an unsafe TTS cache identity")
    return value


def _canonical_json_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def _json_clone(value: Any) -> Any:
    return json.loads(_canonical_json_bytes(value).decode("utf-8"))


def sha256_file(path: str) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    with open(path, "rb") as source:
        while True:
            block = source.read(1024 * 1024)
            if not block:
                break
            digest.update(block)
            size += len(block)
    return digest.hexdigest(), size


def validate_pcm16_mono_wav(path: str, expected_sample_rate_hz: Optional[int] = None) -> dict:
    """Decode and validate the PCM format used by Route A assembled audio."""
    try:
        with wave.open(path, "rb") as source:
            channels = source.getnchannels()
            sample_width = source.getsampwidth()
            sample_rate = source.getframerate()
            frame_count = source.getnframes()
            compression = source.getcomptype()
            frames = source.readframes(frame_count)
    except (OSError, EOFError, wave.Error) as error:
        raise ValueError(f"Invalid WAV audio: {path}") from error
    if compression != "NONE" or channels != 1 or sample_width != 2 or frame_count <= 0:
        raise ValueError(f"WAV must be non-empty mono PCM16: {path}")
    if len(frames) != frame_count * channels * sample_width:
        raise ValueError(f"WAV PCM payload is truncated: {path}")
    if expected_sample_rate_hz is not None and sample_rate != expected_sample_rate_hz:
        raise ValueError(f"WAV sample rate {sample_rate}, expected {expected_sample_rate_hz}")
    return {
        "container": "wav",
        "codec": "pcm_s16le",
        "sampleRateHz": sample_rate,
        "channels": channels,
        "sampleWidthBits": sample_width * 8,
        "frameCount": frame_count,
    }


def build_scene_clip_identity(
    *,
    narration: str,
    engine: str,
    engine_version: str,
    provider: str,
    provider_version: str,
    voice: str,
    language: str,
    sample_rate_hz: int,
    speed: Optional[float],
    rate: Optional[str],
    volume: Optional[str],
    pitch: Optional[str],
    options: Mapping[str, Any],
    gap_policy_version: str,
) -> dict:
    """Build the content address for raw audio, which deliberately excludes gaps.

    The gap policy version remains bound because it defines the invariant that raw
    clips contain speech only. Concrete placement/duration belongs to the per-run
    assembly ledger returned by :func:`build_gap_assembly_record`.
    """
    normalized = normalize_narration(narration)
    if not normalized:
        raise ValueError("TTS narration must not be empty")
    if type(sample_rate_hz) is not int or sample_rate_hz <= 0:
        raise ValueError("sample_rate_hz must be a positive integer")
    if speed is not None and not math.isfinite(float(speed)):
        raise ValueError("speed must be finite")
    identity = {
        "schemaVersion": CACHE_SCHEMA_VERSION,
        "cacheNamespace": CACHE_NAMESPACE,
        "narration": {
            "normalization": NARRATION_NORMALIZATION,
            "sha256": hashlib.sha256(normalized.encode("utf-8")).hexdigest(),
            "utf8Bytes": len(normalized.encode("utf-8")),
        },
        "engine": {"name": str(engine), "version": str(engine_version)},
        "provider": {"name": str(provider), "version": str(provider_version)},
        "voice": str(voice),
        "language": str(language),
        "sampleRateHz": sample_rate_hz,
        "prosody": {
            "speed": None if speed is None else float(speed),
            "rate": rate,
            "volume": volume,
            "pitch": pitch,
        },
        "options": _json_clone(dict(options)),
        "gapPolicy": {
            "version": str(gap_policy_version),
            "rawClipIncludesGap": False,
        },
    }
    _canonical_json_bytes(identity)
    return identity


def normalize_gap_seconds(gap_seconds: float) -> float:
    """Validate a configured gap before applying the finite negative-to-zero policy."""
    parsed = float(gap_seconds)
    if not math.isfinite(parsed):
        raise ValueError("gap_seconds must be finite")
    return max(0.0, parsed)


def build_gap_assembly_record(
    *,
    gap_policy_version: str,
    gap_seconds: float,
    sample_rate_hz: int,
    placement: str,
) -> dict:
    """Bind concrete, effective boundary silence in the per-run assembly ledger."""
    if type(sample_rate_hz) is not int or sample_rate_hz <= 0:
        raise ValueError("sample_rate_hz must be a positive integer")
    if placement not in GAP_PLACEMENTS:
        raise ValueError(f"Unsupported gap placement: {placement}")
    configured_seconds = normalize_gap_seconds(gap_seconds)
    samples = int(sample_rate_hz * configured_seconds) if placement != "none" else 0
    return {
        "version": str(gap_policy_version),
        "rawClipIncludesGap": False,
        "placement": placement,
        "configuredSeconds": configured_seconds,
        "effectiveSamples": samples,
        "effectiveSeconds": samples / sample_rate_hz,
    }


def samples_to_frame_boundary(samples: int, sample_rate_hz: int, fps: int) -> int:
    """Round a non-negative exact sample boundary like JavaScript Math.round."""
    if type(samples) is not int or samples < 0:
        raise ValueError("samples must be a non-negative integer")
    if type(sample_rate_hz) is not int or sample_rate_hz <= 0:
        raise ValueError("sample_rate_hz must be a positive integer")
    if type(fps) is not int or fps <= 0:
        raise ValueError("fps must be a positive integer")
    numerator = samples * fps
    return (2 * numerator + sample_rate_hz) // (2 * sample_rate_hz)


def apply_cumulative_frame_boundaries(scenes: list[dict], sample_rate_hz: int, fps: int) -> int:
    """Derive all frame ranges from absolute sample boundaries without drift."""
    expected_start = 0
    for scene in scenes:
        start_sample = scene.get("startSample")
        samples = scene.get("samples")
        if type(start_sample) is not int or type(samples) is not int or samples <= 0:
            raise ValueError("Scene timing requires positive integer samples and startSample")
        if start_sample != expected_start:
            raise ValueError("Scene sample ranges must be contiguous")
        end_sample = start_sample + samples
        start_frame = samples_to_frame_boundary(start_sample, sample_rate_hz, fps)
        end_frame = samples_to_frame_boundary(end_sample, sample_rate_hz, fps)
        if end_frame <= start_frame:
            raise ValueError("A TTS scene is shorter than one output frame")
        scene["startFrame"] = start_frame
        scene["frames"] = end_frame - start_frame
        expected_start = end_sample
    return samples_to_frame_boundary(expected_start, sample_rate_hz, fps)


def _assembly_ledger(manifest: Mapping[str, Any]) -> dict:
    scenes = manifest.get("scenes")
    sample_rate = manifest.get("sampleRate")
    total_samples = manifest.get("totalSamples")
    fps = manifest.get("fps")
    total_frames = manifest.get("totalFrames")
    frame_policy = manifest.get("frameBoundaryPolicy")
    if not isinstance(scenes, list) or not scenes:
        raise ValueError("Assembly manifest must contain scenes")
    if type(sample_rate) is not int or sample_rate <= 0 or type(total_samples) is not int or total_samples <= 0:
        raise ValueError("Assembly manifest has invalid sample totals")
    if type(fps) is not int or fps <= 0 or type(total_frames) is not int or total_frames <= 0:
        raise ValueError("Assembly manifest has invalid frame totals")
    if frame_policy != FRAME_BOUNDARY_POLICY:
        raise ValueError("Assembly manifest has an unsupported frame-boundary policy")
    expected_start = 0
    timing_projection = []
    for scene in scenes:
        if not isinstance(scene, dict) or scene.get("startSample") != expected_start:
            raise ValueError("Assembly scene sample ranges are not contiguous")
        samples = scene.get("samples")
        speech_samples = scene.get("speechSamples")
        gap_samples = scene.get("gapSamples")
        if type(samples) is not int or type(speech_samples) is not int or type(gap_samples) is not int:
            raise ValueError("Assembly scene lacks an exact sample ledger")
        if samples <= 0 or speech_samples <= 0 or gap_samples < 0 or samples != speech_samples + gap_samples:
            raise ValueError("Assembly scene sample ledger is inconsistent")
        timing_projection.append({"startSample": expected_start, "samples": samples})
        expected_start += samples
    if expected_start != total_samples:
        raise ValueError("Assembly scene samples do not equal totalSamples")
    derived_total_frames = apply_cumulative_frame_boundaries(timing_projection, sample_rate, fps)
    if derived_total_frames != total_frames:
        raise ValueError("Assembly totalFrames does not match cumulative sample boundaries")
    for scene, timing in zip(scenes, timing_projection):
        if scene.get("startFrame") != timing["startFrame"] or scene.get("frames") != timing["frames"]:
            raise ValueError("Assembly scene frames do not match cumulative sample boundaries")
    return {
        "fps": fps,
        "sampleRate": sample_rate,
        "totalSamples": total_samples,
        "totalFrames": total_frames,
        "frameBoundaryPolicy": frame_policy,
        "scenes": _json_clone(scenes),
    }


def validate_run_assembly(audio_path: str, manifest_path: str, audio_validator: AudioValidator) -> bool:
    """Validate that canonical audio and manifest are one hash-bound generation."""
    manifest = _load_json_sidecar(manifest_path)
    if manifest is None:
        return False
    artifact = manifest.get("audioArtifact")
    assembly = manifest.get("assembly")
    if not isinstance(artifact, dict) or not isinstance(assembly, dict):
        return False
    try:
        digest, size = sha256_file(audio_path)
        media = _validate_media(audio_path, audio_validator, None)
        ledger = _assembly_ledger(manifest)
    except Exception:
        return False
    ledger_digest = hashlib.sha256(_canonical_json_bytes(ledger)).hexdigest()
    return (
        artifact.get("fileName") == os.path.basename(audio_path)
        and artifact.get("sha256") == digest
        and artifact.get("sizeBytes") == size
        and artifact.get("media") == media
        and media.get("frameCount") == manifest.get("totalSamples")
        and assembly.get("integrityPolicy") == RUN_ASSEMBLY_INTEGRITY_POLICY
        and assembly.get("ledgerSha256") == ledger_digest
    )


def publish_run_assembly(
    staged_audio_path: str,
    audio_path: str,
    manifest: Mapping[str, Any],
    manifest_path: str,
    audio_validator: AudioValidator,
) -> dict:
    """Stage and validate both artifacts, then commit the hash-bound manifest last."""
    media = _validate_media(staged_audio_path, audio_validator, None)
    published_manifest = _json_clone(dict(manifest))
    published_manifest["frameBoundaryPolicy"] = FRAME_BOUNDARY_POLICY
    ledger = _assembly_ledger(published_manifest)
    if media.get("frameCount") != ledger["totalSamples"]:
        raise ValueError("Assembled WAV frame count does not equal the scene sample ledger")
    audio_digest, audio_size = sha256_file(staged_audio_path)
    published_manifest["audioArtifact"] = {
        "fileName": os.path.basename(audio_path),
        "sha256": audio_digest,
        "sizeBytes": audio_size,
        "media": media,
    }
    assembly = published_manifest.get("assembly")
    if assembly is None:
        assembly = {"policy": RUN_ASSEMBLY_INTEGRITY_POLICY}
    elif not isinstance(assembly, dict):
        raise ValueError("Assembly provenance must be an object")
    else:
        assembly = _json_clone(assembly)
    assembly["integrityPolicy"] = RUN_ASSEMBLY_INTEGRITY_POLICY
    assembly["ledgerSha256"] = hashlib.sha256(_canonical_json_bytes(ledger)).hexdigest()
    published_manifest["assembly"] = assembly
    payload = json.dumps(published_manifest, ensure_ascii=False, indent=2).encode("utf-8") + b"\n"

    manifest_parent = os.path.dirname(os.path.abspath(manifest_path))
    os.makedirs(manifest_parent, exist_ok=True)
    descriptor, staged_manifest = tempfile.mkstemp(
        prefix=f".{os.path.basename(manifest_path)}.", suffix=".part", dir=manifest_parent
    )
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(payload)
            output.flush()
            os.fsync(output.fileno())
        with open(staged_manifest, "r", encoding="utf-8") as source:
            if json.load(source) != published_manifest:
                raise RuntimeError("Staged assembly manifest did not round-trip")
        replace_file_atomically(staged_audio_path, audio_path)
        _fsync_directory(os.path.dirname(os.path.abspath(audio_path)))
        # The hash-bound manifest is the transaction commit record.
        replace_file_atomically(staged_manifest, manifest_path)
        _fsync_directory(manifest_parent)
    except BaseException:
        try:
            os.close(descriptor)
        except OSError:
            pass
        try:
            _remove_with_retry(staged_manifest)
        except OSError:
            pass
        raise
    if not validate_run_assembly(audio_path, manifest_path, audio_validator):
        raise RuntimeError("Published TTS assembly failed hash/ledger validation")
    return published_manifest


def cache_key_sha256(cache_key: Mapping[str, Any]) -> str:
    return hashlib.sha256(_canonical_json_bytes(dict(cache_key))).hexdigest()


def default_cache_dir() -> str:
    configured = os.environ.get("TTS_SCENE_CACHE_DIR")
    if configured:
        return os.path.abspath(os.path.expanduser(configured))
    repository_root = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
    return os.path.join(repository_root, "output", ".tts-scene-cache")


def _validate_suffix(audio_suffix: str) -> str:
    suffix = str(audio_suffix).lower()
    if not _SUFFIX_RE.fullmatch(suffix):
        raise ValueError(f"Unsafe cache audio suffix: {audio_suffix}")
    return suffix


def _cache_paths(cache_dir: str, cache_key: Mapping[str, Any]) -> tuple[str, str, str]:
    digest = cache_key_sha256(cache_key)
    shard_dir = os.path.join(os.path.abspath(cache_dir), digest[:2])
    metadata_path = os.path.join(shard_dir, f"{digest}.json")
    return digest, shard_dir, metadata_path


def _fsync_directory(path: str) -> None:
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError:
        return
    try:
        os.fsync(descriptor)
    except OSError:
        pass
    finally:
        os.close(descriptor)


def _replace_retryable(error: OSError) -> bool:
    return isinstance(error, PermissionError) or error.errno in {errno.EACCES, errno.EPERM, errno.EBUSY} or getattr(
        error, "winerror", None
    ) in {5, 32, 33}


def replace_file_atomically(source: str, destination: str) -> None:
    """Use os.replace with bounded retries for transient Windows sharing errors."""
    delay = _REPLACE_INITIAL_DELAY_SEC
    for attempt in range(_REPLACE_RETRIES):
        try:
            os.replace(source, destination)
            return
        except OSError as error:
            if attempt + 1 >= _REPLACE_RETRIES or not _replace_retryable(error):
                raise
            time.sleep(delay)
            delay *= 2


def _remove_with_retry(path: str) -> None:
    delay = _REPLACE_INITIAL_DELAY_SEC
    for attempt in range(_REPLACE_RETRIES):
        try:
            os.remove(path)
            return
        except FileNotFoundError:
            return
        except OSError as error:
            if attempt + 1 >= _REPLACE_RETRIES or not _replace_retryable(error):
                raise
            time.sleep(delay)
            delay *= 2


def _atomic_write_bytes(destination: str, payload: bytes) -> None:
    parent = os.path.dirname(os.path.abspath(destination))
    os.makedirs(parent, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{os.path.basename(destination)}.", suffix=".part", dir=parent)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(payload)
            output.flush()
            os.fsync(output.fileno())
        replace_file_atomically(temporary, destination)
        _fsync_directory(parent)
    except BaseException:
        try:
            os.close(descriptor)
        except OSError:
            pass
        try:
            _remove_with_retry(temporary)
        except OSError:
            pass
        raise


def _stage_audio(source_path: str, shard_dir: str) -> tuple[str, str, int]:
    os.makedirs(shard_dir, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".clip.", suffix=".part", dir=shard_dir)
    digest = hashlib.sha256()
    size = 0
    try:
        with open(source_path, "rb") as source, os.fdopen(descriptor, "wb") as output:
            while True:
                block = source.read(1024 * 1024)
                if not block:
                    break
                output.write(block)
                digest.update(block)
                size += len(block)
            output.flush()
            os.fsync(output.fileno())
        if size <= 0:
            raise ValueError(f"Cannot cache empty scene clip: {source_path}")
        return temporary, digest.hexdigest(), size
    except BaseException:
        try:
            os.close(descriptor)
        except OSError:
            pass
        try:
            _remove_with_retry(temporary)
        except OSError:
            pass
        raise


def _validate_media_properties(
    properties: Mapping[str, Any], expected_media: Optional[Mapping[str, Any]]
) -> dict:
    media = _json_clone(dict(properties))
    required = {"container", "codec", "sampleRateHz", "channels"}
    if not required.issubset(media):
        raise ValueError("Audio validator did not report container/codec/sampleRateHz/channels")
    if not isinstance(media["container"], str) or not media["container"]:
        raise ValueError("Audio container must be a non-empty string")
    if not isinstance(media["codec"], str) or not media["codec"]:
        raise ValueError("Audio codec must be a non-empty string")
    if type(media["sampleRateHz"]) is not int or media["sampleRateHz"] <= 0:
        raise ValueError("Audio sample rate must be a positive integer")
    if type(media["channels"]) is not int or media["channels"] <= 0:
        raise ValueError("Audio channel count must be a positive integer")
    if expected_media:
        for key, expected in expected_media.items():
            if media.get(key) != expected:
                raise ValueError(f"Audio property {key}={media.get(key)!r}, expected {expected!r}")
    return media


def _validate_media(path: str, validator: AudioValidator, expected_media: Optional[Mapping[str, Any]]) -> dict:
    return _validate_media_properties(validator(path), expected_media)


def _load_json_sidecar(path: str) -> Optional[dict]:
    try:
        if not os.path.isfile(path) or os.path.getsize(path) > _MAX_SIDECAR_BYTES:
            return None
        with open(path, "r", encoding="utf-8") as source:
            value = json.load(source)
        return value if isinstance(value, dict) else None
    except (OSError, UnicodeError, ValueError, RecursionError):
        return None


def lookup_scene_clip(
    cache_dir: str,
    cache_key: Mapping[str, Any],
    audio_suffix: str,
    media_validator: AudioValidator,
    expected_media: Optional[Mapping[str, Any]] = None,
) -> Optional[SceneClipCacheEntry]:
    """Return a hit only after sidecar, hash, and decoded media validation."""
    suffix = _validate_suffix(audio_suffix)
    key_digest, shard_dir, metadata_path = _cache_paths(cache_dir, cache_key)
    metadata = _load_json_sidecar(metadata_path)
    if metadata is None or set(metadata) != {
        "schemaVersion", "cacheNamespace", "entryKind", "cacheKeySha256", "cacheKey", "audio"
    }:
        return None
    if metadata.get("schemaVersion") != CACHE_SCHEMA_VERSION or metadata.get("cacheNamespace") != CACHE_NAMESPACE:
        return None
    if metadata.get("entryKind") != "content-addressed-cache":
        return None
    if metadata.get("cacheKeySha256") != key_digest or metadata.get("cacheKey") != dict(cache_key):
        return None
    try:
        if cache_key_sha256(metadata["cacheKey"]) != key_digest:
            return None
    except (TypeError, ValueError):
        return None

    audio = metadata.get("audio")
    if not isinstance(audio, dict) or set(audio) != {"fileName", "sha256", "sizeBytes", "suffix", "media"}:
        return None
    audio_digest = audio.get("sha256")
    size_bytes = audio.get("sizeBytes")
    if not isinstance(audio_digest, str) or not _SHA256_RE.fullmatch(audio_digest):
        return None
    if type(size_bytes) is not int or size_bytes <= 0 or audio.get("suffix") != suffix:
        return None
    expected_name = f"{key_digest}.{audio_digest}{suffix}"
    if audio.get("fileName") != expected_name:
        return None
    audio_path = os.path.join(shard_dir, expected_name)
    if not os.path.isfile(audio_path):
        return None
    try:
        actual_digest, actual_size = sha256_file(audio_path)
        actual_media = _validate_media(audio_path, media_validator, expected_media)
    except Exception:
        return None
    if actual_digest != audio_digest or actual_size != size_bytes or actual_media != audio.get("media"):
        return None
    return SceneClipCacheEntry(
        audio_path=audio_path,
        metadata_path=metadata_path,
        cache_key_sha256=key_digest,
        audio_sha256=audio_digest,
        size_bytes=size_bytes,
        media=actual_media,
    )


def publish_scene_clip(
    cache_dir: str,
    cache_key: Mapping[str, Any],
    source_path: str,
    audio_suffix: str,
    media_validator: AudioValidator,
    expected_media: Optional[Mapping[str, Any]] = None,
    validated_media: Optional[Mapping[str, Any]] = None,
) -> SceneClipCacheEntry:
    """Validate audio, durably publish it, then atomically commit its sidecar."""
    suffix = _validate_suffix(audio_suffix)
    key_digest, shard_dir, metadata_path = _cache_paths(cache_dir, cache_key)
    temporary, audio_digest, size_bytes = _stage_audio(source_path, shard_dir)
    try:
        media = _validate_media(temporary, media_validator, expected_media)
        if validated_media is not None:
            prior_media = _validate_media_properties(validated_media, expected_media)
            if prior_media != media:
                raise ValueError("Audio media changed after caller validation")
        audio_name = f"{key_digest}.{audio_digest}{suffix}"
        audio_path = os.path.join(shard_dir, audio_name)
        existing_valid = False
        if os.path.isfile(audio_path):
            try:
                existing_digest, existing_size = sha256_file(audio_path)
                existing_valid = existing_digest == audio_digest and existing_size == size_bytes
            except Exception:
                existing_valid = False
        if existing_valid:
            _remove_with_retry(temporary)
        else:
            replace_file_atomically(temporary, audio_path)
            _fsync_directory(shard_dir)
    finally:
        try:
            _remove_with_retry(temporary)
        except OSError:
            pass

    metadata = {
        "schemaVersion": CACHE_SCHEMA_VERSION,
        "cacheNamespace": CACHE_NAMESPACE,
        "entryKind": "content-addressed-cache",
        "cacheKeySha256": key_digest,
        "cacheKey": _json_clone(dict(cache_key)),
        "audio": {
            "fileName": audio_name,
            "sha256": audio_digest,
            "sizeBytes": size_bytes,
            "suffix": suffix,
            "media": media,
        },
    }
    _atomic_write_bytes(metadata_path, _canonical_json_bytes(metadata) + b"\n")
    return SceneClipCacheEntry(
        audio_path=audio_path,
        metadata_path=metadata_path,
        cache_key_sha256=key_digest,
        audio_sha256=audio_digest,
        size_bytes=size_bytes,
        media=media,
    )


def lookup_run_scene_clip(
    sidecar_path: str,
    audio_path: str,
    cache_key: Mapping[str, Any],
    audio_suffix: str,
    media_validator: AudioValidator,
    expected_media: Optional[Mapping[str, Any]] = None,
) -> Optional[SceneClipCacheEntry]:
    """Validate a prior run-local clip so --start-index can safely import it."""
    suffix = _validate_suffix(audio_suffix)
    key_digest = cache_key_sha256(cache_key)
    metadata = _load_json_sidecar(sidecar_path)
    if metadata is None or set(metadata) != {
        "schemaVersion", "cacheNamespace", "entryKind", "cacheKeySha256", "cacheKey", "audio"
    }:
        return None
    if metadata.get("schemaVersion") != RUN_SIDECAR_SCHEMA_VERSION or metadata.get("cacheNamespace") != CACHE_NAMESPACE:
        return None
    if metadata.get("entryKind") != "run-materialization":
        return None
    if metadata.get("cacheKeySha256") != key_digest or metadata.get("cacheKey") != dict(cache_key):
        return None
    audio = metadata.get("audio")
    if not isinstance(audio, dict) or set(audio) != {"fileName", "sha256", "sizeBytes", "suffix", "media"}:
        return None
    if audio.get("fileName") != os.path.basename(audio_path) or audio.get("suffix") != suffix:
        return None
    try:
        actual_digest, actual_size = sha256_file(audio_path)
        actual_media = _validate_media(audio_path, media_validator, expected_media)
    except Exception:
        return None
    if (
        actual_digest != audio.get("sha256")
        or actual_size != audio.get("sizeBytes")
        or actual_media != audio.get("media")
    ):
        return None
    return SceneClipCacheEntry(
        audio_path=audio_path,
        metadata_path=sidecar_path,
        cache_key_sha256=key_digest,
        audio_sha256=actual_digest,
        size_bytes=actual_size,
        media=actual_media,
    )


def publish_run_scene_clip_sidecar(
    sidecar_path: str,
    audio_path: str,
    cache_key: Mapping[str, Any],
    audio_suffix: str,
    media_validator: AudioValidator,
    expected_media: Optional[Mapping[str, Any]] = None,
    validated_media: Optional[Mapping[str, Any]] = None,
) -> SceneClipCacheEntry:
    suffix = _validate_suffix(audio_suffix)
    media = _validate_media(audio_path, media_validator, expected_media)
    if validated_media is not None:
        prior_media = _validate_media_properties(validated_media, expected_media)
        if prior_media != media:
            raise ValueError("Run-local audio media changed after caller validation")
    audio_digest, size_bytes = sha256_file(audio_path)
    if size_bytes <= 0:
        raise ValueError("Cannot publish a sidecar for an empty scene clip")
    key_digest = cache_key_sha256(cache_key)
    metadata = {
        "schemaVersion": RUN_SIDECAR_SCHEMA_VERSION,
        "cacheNamespace": CACHE_NAMESPACE,
        "entryKind": "run-materialization",
        "cacheKeySha256": key_digest,
        "cacheKey": _json_clone(dict(cache_key)),
        "audio": {
            "fileName": os.path.basename(audio_path),
            "sha256": audio_digest,
            "sizeBytes": size_bytes,
            "suffix": suffix,
            "media": media,
        },
    }
    _atomic_write_bytes(sidecar_path, _canonical_json_bytes(metadata) + b"\n")
    return SceneClipCacheEntry(
        audio_path=audio_path,
        metadata_path=sidecar_path,
        cache_key_sha256=key_digest,
        audio_sha256=audio_digest,
        size_bytes=size_bytes,
        media=media,
    )


def materialize_scene_clip(entry: SceneClipCacheEntry, destination: str) -> None:
    """Atomically copy the exact validated cache bytes into a run directory."""
    parent = os.path.dirname(os.path.abspath(destination))
    os.makedirs(parent, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{os.path.basename(destination)}.", suffix=".part", dir=parent)
    digest = hashlib.sha256()
    size = 0
    try:
        with open(entry.audio_path, "rb") as source, os.fdopen(descriptor, "wb") as output:
            while True:
                block = source.read(1024 * 1024)
                if not block:
                    break
                output.write(block)
                digest.update(block)
                size += len(block)
            output.flush()
            os.fsync(output.fileno())
        if digest.hexdigest() != entry.audio_sha256 or size != entry.size_bytes:
            raise RuntimeError("TTS cache audio changed while it was being materialized")
        replace_file_atomically(temporary, destination)
        _fsync_directory(parent)
    except BaseException:
        try:
            os.close(descriptor)
        except OSError:
            pass
        try:
            _remove_with_retry(temporary)
        except OSError:
            pass
        raise


def _process_is_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if pid == os.getpid():
        return True
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False


def _lock_observation(lock_path: str, stale_after_sec: float) -> Optional[dict]:
    """Read one stable lock generation and decide whether that generation is stale."""
    try:
        with open(lock_path, "rb") as source:
            before = os.fstat(source.fileno())
            payload = source.read(_MAX_SIDECAR_BYTES + 1)
            after = os.fstat(source.fileno())
    except OSError:
        return None

    def identity(stat_result) -> tuple:
        return (
            stat_result.st_dev,
            stat_result.st_ino,
            stat_result.st_size,
            stat_result.st_mtime_ns,
            stat_result.st_ctime_ns,
        )

    file_identity = identity(before)
    if file_identity != identity(after):
        return None
    try:
        metadata = json.loads(payload.decode("utf-8"))
    except (UnicodeError, ValueError, RecursionError):
        metadata = None
    age = max(0.0, time.time() - after.st_mtime)
    if isinstance(metadata, dict) and metadata.get("schemaVersion") == LOCK_SCHEMA_VERSION:
        pid = metadata.get("pid")
        reclaimable = type(pid) is int and not _process_is_alive(pid)
    else:
        reclaimable = age >= stale_after_sec
    return {
        "identity": file_identity,
        "payloadSha256": hashlib.sha256(payload).hexdigest(),
        "reclaimable": reclaimable,
    }


def _acquire_reclamation_guard(handle) -> bool:
    """Acquire a crash-released OS lock that serializes stale-lock reclaimers."""
    if os.fstat(handle.fileno()).st_size == 0:
        handle.write(b"\0")
        handle.flush()
        os.fsync(handle.fileno())
    handle.seek(0)
    try:
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except OSError:
        return False


def _release_reclamation_guard(handle) -> None:
    handle.seek(0)
    if os.name == "nt":
        import msvcrt
        msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
    else:
        import fcntl
        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def _try_reclaim_stale_lock(lock_path: str, stale_after_sec: float) -> bool:
    """Remove only the exact stale generation observed under a reclaimer mutex."""
    guard_path = f"{lock_path}.reclaim"
    try:
        guard = open(guard_path, "a+b")
    except OSError:
        return False
    acquired = False
    try:
        acquired = _acquire_reclamation_guard(guard)
        if not acquired:
            return False
        observed = _lock_observation(lock_path, stale_after_sec)
        if not observed or not observed["reclaimable"]:
            return False
        # Re-read immediately before unlink. The OS guard prevents another
        # compliant waiter from passing this comparison concurrently.
        current = _lock_observation(lock_path, stale_after_sec)
        if (
            not current
            or current["identity"] != observed["identity"]
            or current["payloadSha256"] != observed["payloadSha256"]
            or not current["reclaimable"]
        ):
            return False
        _remove_with_retry(lock_path)
        _fsync_directory(os.path.dirname(os.path.abspath(lock_path)))
        return True
    except OSError:
        # A transient Windows sharing violation means this waiter did not win
        # reclamation; the outer acquisition loop will retry without unlinking.
        return False
    finally:
        if acquired:
            try:
                _release_reclamation_guard(guard)
            except OSError:
                # Closing the handle below releases the OS lock crash-safely.
                pass
        guard.close()


@contextmanager
def scene_clip_lock(
    cache_dir: str,
    cache_key: Mapping[str, Any],
    *,
    timeout_sec: float = 300.0,
    stale_after_sec: float = 600.0,
) -> Iterator[None]:
    """Serialize synthesis for one content address across threads/processes."""
    key_digest, shard_dir, _metadata_path = _cache_paths(cache_dir, cache_key)
    os.makedirs(shard_dir, exist_ok=True)
    lock_path = os.path.join(shard_dir, f"{key_digest}.lock")
    token = uuid.uuid4().hex
    deadline = time.monotonic() + timeout_sec
    payload = _canonical_json_bytes({
        "schemaVersion": LOCK_SCHEMA_VERSION,
        "pid": os.getpid(),
        "token": token,
        "createdUnixNs": time.time_ns(),
    }) + b"\n"

    while True:
        try:
            descriptor = os.open(lock_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            if _try_reclaim_stale_lock(lock_path, stale_after_sec):
                continue
            if time.monotonic() >= deadline:
                raise TimeoutError(f"Timed out waiting for TTS cache lock {key_digest}")
            time.sleep(0.05)
            continue
        with os.fdopen(descriptor, "wb") as output:
            output.write(payload)
            output.flush()
            os.fsync(output.fileno())
        _fsync_directory(shard_dir)
        break

    try:
        yield
    finally:
        metadata = _load_json_sidecar(lock_path)
        if metadata and metadata.get("token") == token and metadata.get("pid") == os.getpid():
            _remove_with_retry(lock_path)
            _fsync_directory(shard_dir)
