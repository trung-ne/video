#!/usr/bin/env python3
"""Verify that a proof WAV embeds its attested core WAV without PCM drift."""
import argparse
import hashlib
import json
import os
import sys
import wave
from pathlib import Path


IDENTITY_POLICY = "proof-core-pcm-identity-v1"


class PcmIdentityError(RuntimeError):
    """Raised when proof audio cannot be proven identical to its core audio."""


def _fail(message: str) -> None:
    raise PcmIdentityError(message)


def _is_integer(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _read_wav(path: str | os.PathLike[str], label: str) -> dict:
    try:
        with wave.open(str(path), "rb") as source:
            params = (
                source.getnchannels(),
                source.getsampwidth(),
                source.getframerate(),
                source.getcomptype(),
            )
            sample_count = source.getnframes()
            pcm = source.readframes(sample_count)
    except (OSError, EOFError, wave.Error) as error:
        _fail(f"{label} WAV is unreadable: {error}")
    if params[3] != "NONE":
        _fail(f"{label} WAV must be uncompressed PCM")
    if sample_count <= 0:
        _fail(f"{label} WAV has no PCM sample frames")
    frame_width = params[0] * params[1]
    if len(pcm) != sample_count * frame_width:
        _fail(f"{label} WAV PCM payload is truncated")
    return {
        "params": params,
        "sampleRate": params[2],
        "sampleCount": sample_count,
        "frameWidth": frame_width,
        "pcm": pcm,
    }


def _read_manifest(
    path: str | os.PathLike[str],
    label: str,
    wav_sample_rate: int,
    wav_sample_count: int,
) -> list[dict]:
    try:
        with open(path, encoding="utf-8") as source:
            manifest = json.load(source)
    except (OSError, json.JSONDecodeError) as error:
        _fail(f"{label} durations manifest is unreadable: {error}")
    if not isinstance(manifest, dict):
        _fail(f"{label} durations manifest must be an object")
    sample_rate = manifest.get("sampleRate")
    total_samples = manifest.get("totalSamples")
    if not _is_integer(sample_rate) or sample_rate != wav_sample_rate:
        _fail(f"{label} durations sampleRate does not match its WAV")
    if not _is_integer(total_samples) or total_samples != wav_sample_count:
        _fail(f"{label} durations totalSamples does not match its WAV")

    raw_scenes = manifest.get("scenes")
    if not isinstance(raw_scenes, list) or not raw_scenes:
        _fail(f"{label} durations must contain at least one scene")
    scenes = []
    seen_ids = set()
    expected_start = 0
    for ordinal, raw_scene in enumerate(raw_scenes, 1):
        if not isinstance(raw_scene, dict):
            _fail(f"{label} duration scene {ordinal} must be an object")
        scene_id = raw_scene.get("id")
        start_sample = raw_scene.get("startSample")
        samples = raw_scene.get("samples")
        if not isinstance(scene_id, str) or not scene_id.strip():
            _fail(f"{label} duration scene {ordinal} has no id")
        if scene_id in seen_ids:
            _fail(f"{label} duration scene id is duplicated: {scene_id}")
        if not _is_integer(start_sample) or start_sample < 0:
            _fail(f"{label} scene {scene_id} has an invalid startSample")
        if not _is_integer(samples) or samples <= 0:
            _fail(f"{label} scene {scene_id} has an invalid samples value")
        if start_sample != expected_start:
            relation = "overlaps" if start_sample < expected_start else "leaves a gap before"
            _fail(f"{label} scene {scene_id} {relation} the preceding sample range")
        end_sample = start_sample + samples
        if end_sample > total_samples:
            _fail(f"{label} scene {scene_id} exceeds its WAV sample range")
        scenes.append({"id": scene_id, "startSample": start_sample, "samples": samples})
        seen_ids.add(scene_id)
        expected_start = end_sample
    if expected_start != total_samples:
        _fail(f"{label} scene sample ranges do not exactly partition its WAV")
    return scenes


def verify_proof_core_pcm(
    core_audio: str | os.PathLike[str],
    core_durations: str | os.PathLike[str],
    proof_audio: str | os.PathLike[str],
    proof_durations: str | os.PathLike[str],
) -> dict:
    """Return identity metadata or raise when the proof's core PCM has drifted.

    Scene IDs locate one contiguous core window inside the proof's optional halo.
    Both duration manifests must be exact sample partitions, corresponding core
    scene sample ranges must agree, and the extracted PCM bytes must equal the
    already-attested core WAV payload.
    """
    core_wav = _read_wav(core_audio, "core")
    proof_wav = _read_wav(proof_audio, "proof")
    if core_wav["params"] != proof_wav["params"]:
        _fail("proof WAV format does not match core WAV format")

    core_scenes = _read_manifest(
        core_durations,
        "core",
        core_wav["sampleRate"],
        core_wav["sampleCount"],
    )
    proof_scenes = _read_manifest(
        proof_durations,
        "proof",
        proof_wav["sampleRate"],
        proof_wav["sampleCount"],
    )
    core_ids = [scene["id"] for scene in core_scenes]
    proof_ids = [scene["id"] for scene in proof_scenes]
    window_matches = [
        start
        for start in range(len(proof_ids) - len(core_ids) + 1)
        if proof_ids[start:start + len(core_ids)] == core_ids
    ]
    if len(window_matches) != 1:
        _fail("proof durations must contain the exact core scene sequence once and contiguously")

    proof_scene_start = window_matches[0]
    proof_core_scenes = proof_scenes[proof_scene_start:proof_scene_start + len(core_scenes)]
    proof_start_sample = proof_core_scenes[0]["startSample"]
    for core_scene, proof_scene in zip(core_scenes, proof_core_scenes):
        proof_local_start = proof_scene["startSample"] - proof_start_sample
        if core_scene["startSample"] != proof_local_start or core_scene["samples"] != proof_scene["samples"]:
            _fail(f"proof scene {proof_scene['id']} sample range differs from attested core audio")

    proof_end_sample = proof_core_scenes[-1]["startSample"] + proof_core_scenes[-1]["samples"]
    proof_window_samples = proof_end_sample - proof_start_sample
    if proof_window_samples != core_wav["sampleCount"]:
        _fail("proof core sample window length differs from attested core audio")
    byte_start = proof_start_sample * proof_wav["frameWidth"]
    byte_end = proof_end_sample * proof_wav["frameWidth"]
    proof_core_pcm = proof_wav["pcm"][byte_start:byte_end]
    if len(proof_core_pcm) != len(core_wav["pcm"]):
        _fail("proof core PCM byte length differs from attested core audio")
    if proof_core_pcm != core_wav["pcm"]:
        _fail("proof core PCM bytes differ from attested core audio")

    return {
        "policy": IDENTITY_POLICY,
        "coreSceneIds": core_ids,
        "proofStartSample": proof_start_sample,
        "samples": proof_window_samples,
        "pcmSha256": hashlib.sha256(core_wav["pcm"]).hexdigest(),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--core-audio", required=True)
    parser.add_argument("--core-durations", required=True)
    parser.add_argument("--proof-audio", required=True)
    parser.add_argument("--proof-durations", required=True)
    parser.add_argument("--out", help="optional JSON receipt path")
    args = parser.parse_args()
    result = verify_proof_core_pcm(
        args.core_audio,
        args.core_durations,
        args.proof_audio,
        args.proof_durations,
    )
    payload = json.dumps(result, ensure_ascii=False, sort_keys=True)
    if args.out:
        output_path = Path(args.out)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = output_path.with_name(f"{output_path.name}.{os.getpid()}.tmp")
        try:
            temporary.write_text(f"{payload}\n", encoding="utf-8")
            os.replace(temporary, output_path)
        finally:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass
    print(payload)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
