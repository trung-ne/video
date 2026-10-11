#!/usr/bin/env python3
"""Sample-exact assembly of already-attested chunk WAVs and alignment data."""
import argparse
import hashlib
import json
import math
import os
import re
import sys
import tempfile
import unicodedata
import wave

try:
    from tts_scene_cache import (
        apply_cumulative_frame_boundaries,
        publish_run_assembly,
        sha256_file,
        validate_pcm16_mono_wav,
    )
except ModuleNotFoundError as error:
    if error.name != "tts_scene_cache":
        raise
    from scripts.tts_scene_cache import (
        apply_cumulative_frame_boundaries,
        publish_run_assembly,
        sha256_file,
        validate_pcm16_mono_wav,
    )


ASSEMBLY_POLICY = "sample-exact-chunk-concat-v3"


def fail(message: str) -> None:
    raise RuntimeError(message)


def is_integer(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def is_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def nonempty_string(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())


def transcript_words(text: str) -> list[str]:
    return re.findall(r"[\w]+(?:['’\-][\w]+)*", unicodedata.normalize("NFC", text), flags=re.UNICODE)


def normalize_word(value: str) -> str:
    normalized = unicodedata.normalize("NFC", value or "").lower()
    return "".join(character for character in normalized if character.isalnum())


def normalize_interpolated_time_range(
    start_sec: float,
    end_sec: float,
    scene_start: float,
    scene_end: float,
) -> tuple[float, float]:
    """Clamp only synthetic alignment timing into its canonical scene."""
    scene_span = scene_end - scene_start
    if scene_span <= 0:
        fail("cannot normalize a word into an empty scene time range")
    duration = min(end_sec - start_sec, scene_span)
    center = (start_sec + end_sec) / 2
    normalized_start = min(
        max(center - duration / 2, scene_start),
        scene_end - duration,
    )
    normalized_end = normalized_start + duration
    if normalized_end <= normalized_start:
        fail("cannot normalize an interpolated word to a positive time range")
    return normalized_start, normalized_end


def validate_chronological_word_times(
    words: list[dict],
    context: str,
) -> None:
    previous_start = -math.inf
    previous_end = -math.inf
    for ordinal, word in enumerate(words, 1):
        start_sec = word["startSec"]
        end_sec = word["endSec"]
        if start_sec < previous_start or end_sec < previous_end:
            fail(f"{context}: word {ordinal} is not in chronological order")
        previous_start = start_sec
        previous_end = end_sec


def validate_gap_policy(ordinal: int, policy: object, sample_rate: int) -> dict:
    if not isinstance(policy, dict):
        fail(f"chunk {ordinal}: durations has no canonical gapPolicy")
    version = policy.get("version")
    configured_seconds = policy.get("configuredSeconds")
    effective_samples = policy.get("effectiveSamples")
    effective_seconds = policy.get("effectiveSeconds")
    if not nonempty_string(version):
        fail(f"chunk {ordinal}: gapPolicy version is missing")
    if policy.get("rawClipIncludesGap") is not False:
        fail(f"chunk {ordinal}: raw TTS clips must not include assembly gaps")
    if not is_number(configured_seconds) or configured_seconds < 0:
        fail(f"chunk {ordinal}: gapPolicy configuredSeconds is invalid")
    if not is_integer(effective_samples) or effective_samples < 0:
        fail(f"chunk {ordinal}: gapPolicy effectiveSamples is invalid")
    if not is_number(effective_seconds) or effective_seconds < 0:
        fail(f"chunk {ordinal}: gapPolicy effectiveSeconds is invalid")
    if not math.isclose(effective_seconds, effective_samples / sample_rate, abs_tol=1e-12):
        fail(f"chunk {ordinal}: gapPolicy effective duration disagrees with its sample count")
    return dict(policy)


def validate_tts_metrics(ordinal: int, metrics: object) -> dict:
    if not isinstance(metrics, dict):
        fail(f"chunk {ordinal}: durations has no ttsMetrics")
    integer_fields = (
        "chunkCount",
        "gapCount",
        "interSceneGapCount",
        "terminalGapCount",
    )
    number_fields = (
        "maxInterSceneGapSeconds",
        "totalGapSeconds",
        "gapShare",
        "wallClockSeconds",
    )
    for field in integer_fields:
        if not is_integer(metrics.get(field)) or metrics[field] < 0:
            fail(f"chunk {ordinal}: ttsMetrics {field} must be a non-negative integer")
    for field in number_fields:
        if not is_number(metrics.get(field)) or metrics[field] < 0:
            fail(f"chunk {ordinal}: ttsMetrics {field} must be a non-negative finite number")
    return dict(metrics)


def json_sha256(value: object) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def load_canonical_tts_scenes(path: str) -> tuple[list[dict], dict[str, dict]]:
    with open(path, encoding="utf-8") as source:
        scenes = json.load(source)
    if not isinstance(scenes, list) or not scenes:
        fail("canonical tts-scenes must be a non-empty array")

    by_id = {}
    for ordinal, scene in enumerate(scenes, 1):
        if not isinstance(scene, dict):
            fail(f"canonical TTS scene {ordinal} must be an object")
        scene_id = scene.get("id")
        text = scene.get("text")
        if not nonempty_string(scene_id):
            fail(f"canonical TTS scene {ordinal} has no id")
        if scene_id in by_id:
            fail(f"canonical TTS scene id is duplicated: {scene_id}")
        if not nonempty_string(text):
            fail(f"canonical TTS scene {scene_id} has no narration text")
        if not transcript_words(text):
            fail(f"canonical TTS scene {scene_id} has no alignable words")
        by_id[scene_id] = scene
    return scenes, by_id


def validate_scene_ranges(
    ordinal: int,
    scenes: object,
    expected_scene_ids: list[str],
    total_samples: int,
) -> list[dict]:
    if not isinstance(scenes, list) or not scenes:
        fail(f"chunk {ordinal}: durations has no scenes")

    duration_ids = []
    previous_start = -1
    expected_start = 0
    validated = []
    for scene_ordinal, scene in enumerate(scenes, 1):
        if not isinstance(scene, dict):
            fail(f"chunk {ordinal}: duration scene {scene_ordinal} must be an object")
        scene_id = scene.get("id")
        if not nonempty_string(scene_id):
            fail(f"chunk {ordinal}: duration scene {scene_ordinal} has no id")
        if scene_id in duration_ids:
            fail(f"chunk {ordinal}: duration scene id is duplicated: {scene_id}")
        duration_ids.append(scene_id)

        start_sample = scene.get("startSample")
        samples = scene.get("samples")
        if not is_integer(start_sample) or not is_integer(samples):
            fail(f"chunk {ordinal}: duration lacks sample-exact fields; regenerate TTS")
        if start_sample < 0:
            fail(f"chunk {ordinal}: scene {scene_id} startSample must be non-negative")
        if samples <= 0:
            fail(f"chunk {ordinal}: scene {scene_id} samples must be positive")
        if start_sample < previous_start:
            fail(f"chunk {ordinal}: scene {scene_id} sample ranges are non-monotonic")
        if start_sample < expected_start:
            fail(f"chunk {ordinal}: scene {scene_id} sample range overlaps its predecessor")
        if start_sample > expected_start:
            fail(f"chunk {ordinal}: scene {scene_id} sample range leaves a gap")
        end_sample = start_sample + samples
        if end_sample > total_samples:
            fail(f"chunk {ordinal}: scene {scene_id} sample range exceeds chunk audio")

        speech_samples = scene.get("speechSamples")
        gap_samples = scene.get("gapSamples")
        gap_placement = scene.get("gapPlacement")
        if not is_integer(speech_samples) or not is_integer(gap_samples):
            fail(f"chunk {ordinal}: scene {scene_id} lacks the canonical speech/gap sample ledger")
        if speech_samples <= 0 or gap_samples < 0 or speech_samples + gap_samples != samples:
            fail(f"chunk {ordinal}: scene {scene_id} speech/gap sample ledger is inconsistent")
        if gap_samples == 0 and gap_placement != "none":
            fail(f"chunk {ordinal}: scene {scene_id} has a gap placement without gap samples")
        if gap_samples > 0 and gap_placement not in {"inter-scene", "terminal"}:
            fail(f"chunk {ordinal}: scene {scene_id} has an invalid gap placement")

        copied = dict(scene)
        copied.update({"id": scene_id, "startSample": start_sample, "samples": samples})
        validated.append(copied)
        previous_start = start_sample
        expected_start = end_sample

    if duration_ids != expected_scene_ids:
        fail(f"chunk {ordinal}: duration scene ids do not match the planned chunk scene ids")
    if expected_start != total_samples:
        fail(f"chunk {ordinal}: scene sample ranges do not exactly partition chunk audio")
    return validated


def expected_tokens_for_scenes(scene_ids: list[str], canonical_by_id: dict[str, dict]) -> list[dict]:
    tokens = []
    for scene_id in scene_ids:
        text = canonical_by_id[scene_id]["text"]
        for scene_word_index, word in enumerate(transcript_words(text)):
            tokens.append({
                "scene": scene_id,
                "sceneWordIndex": scene_word_index,
                "word": word,
            })
    return tokens


def validate_words(
    ordinal: int,
    words: object,
    expected_tokens: list[dict],
    scene_ranges: list[dict],
    sample_rate: int,
) -> list[dict]:
    if not isinstance(words, list):
        fail(f"chunk {ordinal}: words is not an array")
    if len(words) != len(expected_tokens):
        fail(f"chunk {ordinal}: word count does not match canonical TTS narration")

    ranges = {
        scene["id"]: (
            scene["startSample"] / sample_rate,
            (scene["startSample"] + scene["samples"]) / sample_rate,
        )
        for scene in scene_ranges
    }
    validated = []
    for word_ordinal, (word, expected) in enumerate(zip(words, expected_tokens), 1):
        if not isinstance(word, dict):
            fail(f"chunk {ordinal}: word {word_ordinal} must be an object")
        if word.get("scene") != expected["scene"]:
            fail(f"chunk {ordinal}: word {word_ordinal} belongs to the wrong scene")
        if word.get("sceneWordIndex") != expected["sceneWordIndex"] or not is_integer(word.get("sceneWordIndex")):
            fail(f"chunk {ordinal}: word {word_ordinal} has the wrong sceneWordIndex")
        if word.get("canonicalWordIndex") != word_ordinal - 1 or not is_integer(word.get("canonicalWordIndex")):
            fail(f"chunk {ordinal}: words do not have continuous chunk-local canonicalWordIndex values")
        actual_word = word.get("word")
        if not nonempty_string(actual_word) or normalize_word(actual_word) != normalize_word(expected["word"]):
            fail(f"chunk {ordinal}: word {word_ordinal} does not match canonical TTS narration")

        interpolated = word.get("interpolated")
        if type(interpolated) is not bool:
            fail(f"chunk {ordinal}: word {word_ordinal} interpolated must be a boolean")
        confidence = word.get("confidence")
        whisper_confidence = word.get("whisperConfidence")
        if confidence is not None and not is_number(confidence):
            fail(f"chunk {ordinal}: word {word_ordinal} confidence must be finite")
        if whisper_confidence is not None and not is_number(whisper_confidence):
            fail(f"chunk {ordinal}: word {word_ordinal} whisperConfidence must be finite or null")

        start_sec = word.get("startSec")
        end_sec = word.get("endSec")
        if not is_number(start_sec) or not is_number(end_sec):
            fail(f"chunk {ordinal}: word {word_ordinal} has a non-finite time range")
        if start_sec < 0 or end_sec <= start_sec:
            fail(f"chunk {ordinal}: word {word_ordinal} has an invalid time range")
        scene_start, scene_end = ranges[expected["scene"]]
        outside_scene = start_sec < scene_start or end_sec > scene_end
        if outside_scene and not interpolated:
            fail(f"chunk {ordinal}: word {word_ordinal} time range falls outside scene {expected['scene']}")
        copied = dict(word)
        if outside_scene:
            start_sec, end_sec = normalize_interpolated_time_range(
                start_sec,
                end_sec,
                scene_start,
                scene_end,
            )
            copied["startSec"] = start_sec
            copied["endSec"] = end_sec
        validated.append(copied)
    validate_chronological_word_times(validated, f"chunk {ordinal}: words")
    return validated


def validate_alignment(
    ordinal: int,
    alignment: object,
    language: str,
    words: list[dict],
    tts_scenes: list[dict],
) -> str:
    if not isinstance(alignment, dict):
        fail(f"chunk {ordinal}: alignment receipt must be an object")
    schema_version = alignment.get("schemaVersion")
    if not is_integer(schema_version) or schema_version != 1 \
            or alignment.get("source") != "canonical-tts-scenes":
        fail(f"chunk {ordinal}: alignment receipt is not canonical")
    canonical_word_count = alignment.get("canonicalWordCount")
    if not is_integer(canonical_word_count) or canonical_word_count != len(words):
        fail(f"chunk {ordinal}: alignment word count does not match words.json")
    matched = sum(1 for word in words if not word["interpolated"])
    interpolated = len(words) - matched
    matched_count = alignment.get("matchedWordCount")
    interpolated_count = alignment.get("interpolatedWordCount")
    if not is_integer(matched_count) or not is_integer(interpolated_count) \
            or matched_count != matched or interpolated_count != interpolated:
        fail(f"chunk {ordinal}: alignment match counts do not match words.json")
    coverage = alignment.get("coverage")
    matched_coverage = alignment.get("matchedCoverage")
    scene_count = alignment.get("sceneCount")
    expected_matched_coverage = round(matched / len(words), 6) if words else 0.0
    if not is_number(coverage) or coverage != 1.0 \
            or not is_number(matched_coverage) \
            or matched_coverage != expected_matched_coverage \
            or not is_integer(scene_count) or scene_count != len(tts_scenes):
        fail(f"chunk {ordinal}: alignment coverage does not match canonical scenes")
    if alignment.get("ttsScenesSha256") != json_sha256(tts_scenes):
        fail(f"chunk {ordinal}: alignment receipt belongs to different TTS scenes")

    detected_language = alignment.get("language")
    if not nonempty_string(detected_language):
        fail(f"chunk {ordinal}: alignment receipt has no detected language")
    detected_language = detected_language.strip().lower()
    if language != "unknown" and detected_language != language:
        fail(f"chunk {ordinal}: alignment language {detected_language} differs from requested language {language}")
    return detected_language


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--inputs", required=True, help="Ordered chunk input manifest")
    parser.add_argument("--out-audio", required=True)
    parser.add_argument("--out-durations", required=True)
    parser.add_argument("--out-words", required=True)
    parser.add_argument("--out-alignment", required=True)
    parser.add_argument("--tts-scenes", required=True, help="Complete canonical tts_scenes.json")
    parser.add_argument("--language", default="unknown")
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--policy-version", default=ASSEMBLY_POLICY)
    args = parser.parse_args()

    if args.fps <= 0:
        fail("fps must be positive")
    if args.policy_version != ASSEMBLY_POLICY:
        fail(f"unsupported assembly policy: {args.policy_version}")
    language = args.language.strip().lower()
    if not language:
        fail("language must be a non-empty language code or 'unknown'")

    tts_scenes, canonical_by_id = load_canonical_tts_scenes(args.tts_scenes)
    canonical_scene_ids = [scene["id"] for scene in tts_scenes]

    with open(args.inputs, encoding="utf-8") as source:
        chunks = json.load(source)
    if not isinstance(chunks, list) or not chunks:
        fail("inputs must be a non-empty ordered chunk list")

    stream_params = None
    validated_audio_sources = []
    assembled_scenes = []
    assembled_words = []
    sample_offset = 0
    canonical_offset = 0
    chunk_ids = set()
    planned_scene_ids = []
    detected_languages = set()
    gap_policy = None
    chunk_tts_metrics = []

    for ordinal, chunk in enumerate(chunks, 1):
        if not isinstance(chunk, dict):
            fail(f"chunk {ordinal}: input entry must be an object")
        chunk_id = chunk.get("id")
        if not nonempty_string(chunk_id):
            fail(f"chunk {ordinal}: input entry has no id")
        if chunk_id in chunk_ids:
            fail(f"chunk id is duplicated: {chunk_id}")
        chunk_ids.add(chunk_id)

        scene_ids = chunk.get("sceneIds")
        if not isinstance(scene_ids, list) or not scene_ids or any(not nonempty_string(item) for item in scene_ids):
            fail(f"chunk {ordinal}: sceneIds must be a non-empty string array")
        if len(set(scene_ids)) != len(scene_ids):
            fail(f"chunk {ordinal}: planned scene id is duplicated")
        unknown_scene_ids = [scene_id for scene_id in scene_ids if scene_id not in canonical_by_id]
        if unknown_scene_ids:
            fail(f"chunk {ordinal}: planned scene id is not canonical: {unknown_scene_ids[0]}")
        planned_scene_ids.extend(scene_ids)
        chunk_tts_scenes = [canonical_by_id[scene_id] for scene_id in scene_ids]

        artifact_keys = ("audio", "durations", "words", "alignment")
        artifact_paths = [chunk.get(key) for key in artifact_keys]
        if not all(isinstance(item, str) and os.path.isfile(item) for item in artifact_paths):
            fail(f"chunk {ordinal}: missing audio, durations, words, or alignment artifact")
        audio_path, durations_path, words_path, alignment_path = artifact_paths

        with wave.open(audio_path, "rb") as wav:
            params = (wav.getnchannels(), wav.getsampwidth(), wav.getframerate(), wav.getcomptype())
            if params[3] != "NONE":
                fail(f"chunk {ordinal}: WAV must be PCM, got compression {params[3]}")
            if stream_params is None:
                stream_params = params
            elif params != stream_params:
                fail(f"chunk {ordinal}: WAV format differs from preceding chunk")
            actual_samples = wav.getnframes()
        media = validate_pcm16_mono_wav(audio_path, params[2])
        if actual_samples <= 0 or media.get("frameCount") != actual_samples:
            fail(f"chunk {ordinal}: WAV payload is empty or truncated")
        audio_sha256, audio_size = sha256_file(audio_path)
        validated_audio_sources.append({
            "path": audio_path,
            "samples": actual_samples,
            "sha256": audio_sha256,
            "sizeBytes": audio_size,
        })

        with open(durations_path, encoding="utf-8") as source:
            durations = json.load(source)
        if not isinstance(durations, dict):
            fail(f"chunk {ordinal}: durations manifest must be an object")
        sample_rate = durations.get("sampleRate")
        if not is_integer(sample_rate) or sample_rate != stream_params[2]:
            fail(f"chunk {ordinal}: duration sample rate differs from WAV")
        if durations.get("fps") != args.fps or not is_integer(durations.get("fps")):
            fail(f"chunk {ordinal}: duration fps differs from assembly fps")
        declared_samples = durations.get("totalSamples")
        if not is_integer(declared_samples) or declared_samples <= 0 or declared_samples != actual_samples:
            fail(f"chunk {ordinal}: durations totalSamples does not equal WAV samples")
        scenes = validate_scene_ranges(ordinal, durations.get("scenes"), scene_ids, declared_samples)
        current_gap_policy = validate_gap_policy(ordinal, durations.get("gapPolicy"), sample_rate)
        if gap_policy is None:
            gap_policy = current_gap_policy
        elif current_gap_policy != gap_policy:
            fail(f"chunk {ordinal}: gapPolicy differs from preceding chunk")
        chunk_tts_metrics.append(validate_tts_metrics(ordinal, durations.get("ttsMetrics")))

        with open(words_path, encoding="utf-8") as source:
            words = json.load(source)
        if isinstance(words, dict):
            words = words.get("words")
        expected_tokens = expected_tokens_for_scenes(scene_ids, canonical_by_id)
        words = validate_words(ordinal, words, expected_tokens, scenes, sample_rate)

        with open(alignment_path, encoding="utf-8") as source:
            alignment = json.load(source)
        detected_languages.add(validate_alignment(ordinal, alignment, language, words, chunk_tts_scenes))

        for scene in scenes:
            copied = dict(scene)
            copied["startSample"] = sample_offset + scene["startSample"]
            assembled_scenes.append(copied)
        for word in words:
            copied = dict(word)
            copied["startSec"] = word["startSec"] + sample_offset / sample_rate
            copied["endSec"] = word["endSec"] + sample_offset / sample_rate
            copied["canonicalWordIndex"] = word["canonicalWordIndex"] + canonical_offset
            assembled_words.append(copied)
        canonical_offset += len(expected_tokens)
        sample_offset += actual_samples

    if planned_scene_ids != canonical_scene_ids:
        fail("chunk scene order does not reconstruct the canonical TTS scene order")
    if len(detected_languages) != 1:
        fail(f"chunk alignment languages are inconsistent: {', '.join(sorted(detected_languages))}")
    output_language = language if language != "unknown" else next(iter(detected_languages))

    # A terminal gap at the end of a non-final proof chunk becomes the ordinary
    # inter-scene gap between its last core scene and the next global scene.
    for scene_index, scene in enumerate(assembled_scenes):
        gap_samples = scene["gapSamples"]
        if gap_samples > 0 and gap_samples != gap_policy["effectiveSamples"]:
            fail(f"assembled scene {scene['id']} gapSamples differs from gapPolicy")
        if gap_samples == 0:
            scene["gapPlacement"] = "none"
        elif scene_index + 1 < len(assembled_scenes):
            scene["gapPlacement"] = "inter-scene"
        else:
            scene["gapPlacement"] = "terminal"

    inter_scene_gaps = [
        scene["gapSamples"]
        for scene in assembled_scenes
        if scene["gapPlacement"] == "inter-scene"
    ]
    terminal_gaps = [
        scene["gapSamples"]
        for scene in assembled_scenes
        if scene["gapPlacement"] == "terminal"
    ]
    total_gap_samples = sum(inter_scene_gaps) + sum(terminal_gaps)
    tts_metrics = {
        "chunkCount": sum(metrics["chunkCount"] for metrics in chunk_tts_metrics),
        "assemblyChunkCount": len(chunks),
        "gapCount": len(inter_scene_gaps) + len(terminal_gaps),
        "interSceneGapCount": len(inter_scene_gaps),
        "terminalGapCount": len(terminal_gaps),
        "maxInterSceneGapSeconds": round(
            max(inter_scene_gaps, default=0) / stream_params[2], 3
        ),
        "totalGapSeconds": round(total_gap_samples / stream_params[2], 3),
        "gapShare": round(total_gap_samples / sample_offset, 6),
        "wallClockSeconds": round(
            sum(metrics["wallClockSeconds"] for metrics in chunk_tts_metrics), 3
        ),
    }

    # One shared helper owns the exact positive-boundary rounding contract used
    # by Edge, Kokoro, run publication, and chunk reassembly.
    total_frames = apply_cumulative_frame_boundaries(
        assembled_scenes, stream_params[2], args.fps
    )

    canonical_indices = [word.get("canonicalWordIndex") for word in assembled_words]
    if canonical_indices != list(range(len(assembled_words))):
        fail("assembled words do not have continuous canonical word indices")
    validate_chronological_word_times(assembled_words, "assembled words")

    audio_parent = os.path.dirname(os.path.abspath(args.out_audio))
    os.makedirs(audio_parent, exist_ok=True)
    descriptor, staged_audio = tempfile.mkstemp(
        prefix=f".{os.path.basename(args.out_audio)}.", suffix=".wav", dir=audio_parent
    )
    os.close(descriptor)
    try:
        with wave.open(staged_audio, "wb") as output:
            output.setnchannels(stream_params[0])
            output.setsampwidth(stream_params[1])
            output.setframerate(stream_params[2])
            bytes_per_frame = stream_params[0] * stream_params[1]
            for source_audio in validated_audio_sources:
                before_digest, before_size = sha256_file(source_audio["path"])
                if before_digest != source_audio["sha256"] or before_size != source_audio["sizeBytes"]:
                    fail(f"chunk audio changed before assembly: {source_audio['path']}")
                with wave.open(source_audio["path"], "rb") as source:
                    current_params = (
                        source.getnchannels(),
                        source.getsampwidth(),
                        source.getframerate(),
                        source.getcomptype(),
                    )
                    if current_params != stream_params or source.getnframes() != source_audio["samples"]:
                        fail(f"chunk audio format changed before assembly: {source_audio['path']}")
                    remaining = source_audio["samples"]
                    while remaining:
                        payload = source.readframes(min(65536, remaining))
                        if not payload or len(payload) % bytes_per_frame:
                            fail(f"chunk WAV payload is truncated: {source_audio['path']}")
                        payload_frames = len(payload) // bytes_per_frame
                        if payload_frames > remaining:
                            fail(f"chunk WAV payload exceeds its declared sample count: {source_audio['path']}")
                        output.writeframesraw(payload)
                        remaining -= payload_frames
                after_digest, after_size = sha256_file(source_audio["path"])
                if after_digest != before_digest or after_size != before_size:
                    fail(f"chunk audio changed during assembly: {source_audio['path']}")
        with open(staged_audio, "rb+") as output:
            os.fsync(output.fileno())
        manifest = {
            "fps": args.fps,
            "sampleRate": stream_params[2],
            "totalSamples": sample_offset,
            "totalSec": round(sample_offset / stream_params[2], 6),
            "totalFrames": total_frames,
            "gapPolicy": gap_policy,
            "ttsMetrics": tts_metrics,
            "scenes": assembled_scenes,
            "assembly": {"policy": ASSEMBLY_POLICY, "chunkCount": len(chunks)},
        }
        manifest = publish_run_assembly(
            staged_audio,
            args.out_audio,
            manifest,
            args.out_durations,
            lambda path: validate_pcm16_mono_wav(path, stream_params[2]),
        )
    finally:
        try:
            os.remove(staged_audio)
        except OSError:
            pass

    os.makedirs(os.path.dirname(os.path.abspath(args.out_words)), exist_ok=True)
    with open(args.out_words, "w", encoding="utf-8") as output:
        json.dump(assembled_words, output, ensure_ascii=False, indent=2)
        output.write("\n")
    alignment = {
        "schemaVersion": 1,
        "source": "canonical-tts-scenes",
        "canonicalWordCount": len(assembled_words),
        "matchedWordCount": sum(1 for word in assembled_words if not word["interpolated"]),
        "interpolatedWordCount": sum(1 for word in assembled_words if word["interpolated"]),
        "coverage": 1.0,
        "matchedCoverage": round(sum(1 for word in assembled_words if not word["interpolated"]) / len(assembled_words), 6) if assembled_words else 0.0,
        "sceneCount": len(tts_scenes),
        "ttsScenesSha256": json_sha256(tts_scenes),
        "language": output_language,
        "assembly": ASSEMBLY_POLICY,
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.out_alignment)), exist_ok=True)
    with open(args.out_alignment, "w", encoding="utf-8") as output:
        json.dump(alignment, output, ensure_ascii=False, indent=2)
        output.write("\n")
    print(f"assembled {len(chunks)} chunks, {len(assembled_scenes)} scenes, {sample_offset} samples")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
