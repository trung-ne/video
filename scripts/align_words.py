#!/usr/bin/env python3
"""
align_words.py — word-level timestamps for beat-emphasis in the storyboard pipeline.

Runs after TTS. Because the TTS voice reads the narration verbatim, this is
effectively forced alignment on clean audio → reliable word timings. Output
feeds storyboardCompiler (readWords → compileStoryboard({words})) so a "beat"
(e.g. a shock number) is emphasised at the exact frame the word is spoken.

Usage:
  py -3.11 scripts/align_words.py --wav projects/<id>/voice.wav --outdir projects/<id> [--model base]

Output: <outdir>/words.json = [{"word": "...", "startSec": 0.0, "endSec": 0.0}, ...]
(absolute timestamps over the whole voice.wav)

Dependency (install once):
  py -3.11 -m pip install faster-whisper
"""
import argparse
import json
import os
import sys
import re
import unicodedata
import hashlib
from difflib import SequenceMatcher


def normalize_word(value):
    value = unicodedata.normalize("NFC", value or "").lower()
    return "".join(ch for ch in value if ch.isalnum())


def transcript_words(text):
    return re.findall(r"[\w]+(?:['’\-][\w]+)*", unicodedata.normalize("NFC", text), flags=re.UNICODE)


def attach_transcript_indices(aligned, transcript):
    expected = transcript_words(transcript)
    expected_norm = [normalize_word(word) for word in expected]
    aligned_norm = [normalize_word(item["word"]) for item in aligned]
    matcher = SequenceMatcher(None, expected_norm, aligned_norm, autojunk=False)
    index_map = {}
    for block in matcher.get_matching_blocks():
        for offset in range(block.size):
            index_map[block.b + offset] = block.a + offset
    previous = None
    for aligned_index, item in enumerate(aligned):
        match_index = index_map.get(aligned_index)
        item["whisperConfidence"] = item.get("confidence")
        item["wordIndex"] = match_index
        if match_index is None:
            item["confidence"] = 0.0
        else:
            item["confidence"] = 1.0 if previous is None or match_index == previous + 1 else 0.8
            previous = match_index
    return aligned


def alignment_key(value):
    """Fold Vietnamese diacritics for ASR-tolerant token comparison.

    Whisper often preserves the syllable timing of Vietnamese Edge TTS but misses
    one accent or consonant (for example ``nhắc`` → ``nạc``). Keeping the
    original token for subtitles while matching this folded representation lets
    the measured ASR timestamp remain an anchor rather than discarding it.
    """
    value = unicodedata.normalize("NFD", value or "").lower()
    value = "".join(ch for ch in value if unicodedata.category(ch) != "Mn")
    return value.replace("đ", "d").replace("Đ", "d")


def token_similarity(expected, observed):
    """Return a conservative 0..1 spelling similarity for one ASR token."""
    expected_key = alignment_key(expected)
    observed_key = alignment_key(observed)
    if not expected_key or not observed_key:
        return 0.0
    return SequenceMatcher(None, expected_key, observed_key, autojunk=False).ratio()


def fuzzy_monotonic_matches(expected, aligned):
    """Align ordered canonical tokens to ASR tokens without inventing times.

    This is a global sequence alignment: every returned pair uses an actual
    Whisper word timestamp, gaps are left for interpolation, and low-similarity
    pairs are rejected. It is intentionally stricter than merely pairing words
    by index, while tolerating Vietnamese ASR's common one-letter near misses.
    """
    rows, cols = len(expected), len(aligned)
    gap_penalty = -0.45
    minimum_similarity = 0.40
    scores = [[0.0] * (cols + 1) for _ in range(rows + 1)]
    steps = [[None] * (cols + 1) for _ in range(rows + 1)]
    for row in range(1, rows + 1):
        scores[row][0] = scores[row - 1][0] + gap_penalty
        steps[row][0] = "up"
    for col in range(1, cols + 1):
        scores[0][col] = scores[0][col - 1] + gap_penalty
        steps[0][col] = "left"
    similarities = {}
    for row in range(1, rows + 1):
        for col in range(1, cols + 1):
            similarity = token_similarity(expected[row - 1]["word"], aligned[col - 1]["word"])
            similarities[(row, col)] = similarity
            diagonal = scores[row - 1][col - 1] + (similarity * 2.0 - 1.0)
            up = scores[row - 1][col] + gap_penalty
            left = scores[row][col - 1] + gap_penalty
            best = max(diagonal, up, left)
            scores[row][col] = best
            steps[row][col] = "diag" if best == diagonal else ("up" if best == up else "left")
    matches = {}
    row, col = rows, cols
    while row and col:
        step = steps[row][col]
        if step == "diag":
            similarity = similarities[(row, col)]
            if similarity >= minimum_similarity:
                matches[row - 1] = (col - 1, similarity)
            row -= 1
            col -= 1
        elif step == "up":
            row -= 1
        else:
            col -= 1
    return matches


def canonical_tts_tokens(scenes):
    """Return the exact tokens spoken by TTS, retaining scene-local identity."""
    tokens = []
    for scene in scenes:
        scene_id = str(scene.get("id") or "").strip()
        text = str(scene.get("text") or "")
        if not scene_id:
            raise ValueError("tts_scenes.json contains a scene without id")
        for scene_word_index, word in enumerate(transcript_words(text)):
            tokens.append({
                "scene": scene_id,
                "sceneWordIndex": scene_word_index,
                "word": word,
            })
    return tokens


def constrain_words_to_measured_scenes(words, durations):
    """Reject ASR matches assigned across sample-exact TTS scene boundaries.

    Whisper timestamps are quantized and fuzzy matching can attach a repeated token
    from the preceding scene. Such timestamps are not measured evidence for the
    canonical scene, so replace them with explicitly synthetic in-scene timing.
    """
    sample_rate = durations.get("sampleRate")
    scene_rows = durations.get("scenes")
    if not isinstance(sample_rate, int) or sample_rate <= 0 or not isinstance(scene_rows, list):
        raise ValueError("durations must contain sample-exact scene ranges")
    ranges = {
        scene["id"]: (
            scene["startSample"] / sample_rate,
            (scene["startSample"] + scene["samples"]) / sample_rate,
        )
        for scene in scene_rows
    }
    for scene_id in dict.fromkeys(word["scene"] for word in words):
        if scene_id not in ranges:
            raise ValueError(f"durations has no scene range for {scene_id}")
        scene_start, scene_end = ranges[scene_id]
        indices = [index for index, word in enumerate(words) if word["scene"] == scene_id]
        invalid = [index for index in indices if words[index]["startSec"] < scene_start or words[index]["endSec"] > scene_end]
        for index in invalid:
            local = indices.index(index)
            previous = next((words[candidate] for candidate in reversed(indices[:local]) if candidate not in invalid), None)
            following = next((words[candidate] for candidate in indices[local + 1:] if candidate not in invalid), None)
            left = max(scene_start, previous["endSec"] if previous else scene_start)
            right = min(scene_end, following["startSec"] if following else scene_end)
            if right <= left:
                raise ValueError(f"cannot interpolate {scene_id} word inside its measured scene range")
            rank = invalid.index(index) + 1
            center = left + (right - left) * rank / (len(invalid) + 1)
            half_width = min(0.05, (right - left) / (2 * (len(invalid) + 1)))
            words[index].update({
                "startSec": round(center - half_width, 6),
                "endSec": round(center + half_width, 6),
                "confidence": 0.5,
                "interpolated": True,
            })
    return words


def attach_canonical_scene_indices(aligned, scenes):
    """Map Whisper words to the exact scene narration read by TTS.

    `sourceRange` refers to the input transcript and may deliberately differ
    from `narrationOverride`. Subtitle timing must never use that source range:
    it has to follow the words the voice actually spoke.
    """
    expected = canonical_tts_tokens(scenes)
    canonical_matches = {
        canonical_index: (aligned[aligned_index], similarity)
        for canonical_index, (aligned_index, similarity) in fuzzy_monotonic_matches(expected, aligned).items()
    }
    matched = len(canonical_matches)

    # Whisper is an ASR model, not a Vietnamese forced aligner. It can omit a
    # small word while still timestamping the surrounding TTS phrase correctly.
    # Emit one canonical token per spoken TTS token and interpolate only the
    # missing intervals. The report preserves the measured fraction separately
    # so downstream code never mistakes assisted timestamps for ASR matches.
    result = []
    anchor_indices = sorted(canonical_matches)
    for canonical_index, token in enumerate(expected):
        observed_match = canonical_matches.get(canonical_index)
        if observed_match is not None:
            observed, similarity = observed_match
            result.append({
                "word": token["word"],
                "startSec": observed["startSec"], "endSec": observed["endSec"],
                "confidence": round(similarity, 3), "whisperConfidence": observed.get("confidence"),
                "scene": token["scene"], "sceneWordIndex": token["sceneWordIndex"],
                "canonicalWordIndex": canonical_index, "interpolated": False,
            })
            continue
        previous = max((idx for idx in anchor_indices if idx < canonical_index), default=None)
        following = min((idx for idx in anchor_indices if idx > canonical_index), default=None)
        if previous is not None and following is not None:
            left, _ = canonical_matches[previous]
            right, _ = canonical_matches[following]
            fraction = (canonical_index - previous) / (following - previous)
            center = float(left["endSec"]) + (float(right["startSec"]) - float(left["endSec"])) * fraction
        elif previous is not None:
            left, _ = canonical_matches[previous]
            center = float(left["endSec"]) + 0.16 * (canonical_index - previous)
        elif following is not None:
            right, _ = canonical_matches[following]
            center = max(0.0, float(right["startSec"]) - 0.16 * (following - canonical_index))
        else:
            center = canonical_index * 0.16
        result.append({
            "word": token["word"],
            "startSec": round(max(0.0, center - 0.05), 3),
            "endSec": round(max(0.0, center + 0.05), 3),
            "confidence": 0.5, "whisperConfidence": None,
            "scene": token["scene"], "sceneWordIndex": token["sceneWordIndex"],
            "canonicalWordIndex": canonical_index, "interpolated": True,
        })

    return result, {
        "schemaVersion": 1,
        "source": "canonical-tts-scenes",
        "canonicalWordCount": len(expected),
        "matchedWordCount": matched,
        "interpolatedWordCount": len(expected) - matched,
        "coverage": 1.0 if expected else 0.0,
        "matchedCoverage": round(matched / len(expected), 6) if expected else 0.0,
        "sceneCount": len(scenes),
        "ttsScenesSha256": hashlib.sha256(
            json.dumps(scenes, ensure_ascii=False, sort_keys=True).encode("utf-8")
        ).hexdigest(),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--wav", required=True, help="path to voice.wav")
    ap.add_argument("--outdir", required=True, help="folder to write words.json")
    ap.add_argument("--model", default="base", help="whisper model size (tiny/base/small/medium)")
    ap.add_argument("--lang", default=None, help="language code hint, e.g. en / vi (auto if omitted)")
    ap.add_argument("--transcript", default=None, help="verbatim transcript for stable wordIndex mapping")
    ap.add_argument("--scenes", default=None, help="canonical tts_scenes.json; required for production subtitle timing")
    ap.add_argument("--durations", default=None, help="sample-exact durations.json used to bind words to TTS scenes")
    ap.add_argument("--input-words", default=None, help="reuse raw Whisper words after canonical mapping was interrupted")
    args = ap.parse_args()

    if not os.path.isfile(args.wav):
        print(f"[align_words] wav not found: {args.wav}", file=sys.stderr)
        return 1

    if args.input_words:
        with open(args.input_words, "r", encoding="utf-8-sig") as f:
            words = json.load(f)
        if not isinstance(words, list):
            print("[align_words] --input-words must contain a JSON array", file=sys.stderr)
            return 1
        detected_language = args.lang or "unknown"
    else:
        try:
            from faster_whisper import WhisperModel
        except ImportError:
            print("[align_words] faster-whisper chưa cài. Chạy: py -3.11 -m pip install faster-whisper", file=sys.stderr)
            return 2

        print(f"[align_words] loading model '{args.model}' (CPU int8)...")
        model = WhisperModel(args.model, device="cpu", compute_type="int8")
        print(f"[align_words] transcribing {args.wav} with word timestamps...")
        segments, info = model.transcribe(
            args.wav, word_timestamps=True, language=args.lang, vad_filter=False,
        )
        words = []
        for seg in segments:
            for w in (seg.words or []):
                token = (w.word or "").strip()
                if token:
                    words.append({
                        "word": token, "startSec": round(float(w.start), 3),
                        "endSec": round(float(w.end), 3),
                        "confidence": round(float(getattr(w, "probability", 0.0) or 0.0), 3),
                    })
        detected_language = info.language or args.lang

    provenance = None
    if args.scenes:
        with open(args.scenes, "r", encoding="utf-8-sig") as f:
            scenes = json.load(f)
        if not isinstance(scenes, list) or not scenes:
            print("[align_words] --scenes must be a non-empty tts_scenes.json array", file=sys.stderr)
            return 1
        words, provenance = attach_canonical_scene_indices(words, scenes)
        if args.durations:
            with open(args.durations, "r", encoding="utf-8-sig") as f:
                durations = json.load(f)
            words = constrain_words_to_measured_scenes(words, durations)
            matched = sum(1 for word in words if not word["interpolated"])
            provenance["matchedWordCount"] = matched
            provenance["interpolatedWordCount"] = len(words) - matched
            provenance["matchedCoverage"] = round(matched / len(words), 6) if words else 0.0
        provenance["language"] = detected_language
    elif args.transcript:
        with open(args.transcript, "r", encoding="utf-8-sig") as f:
            words = attach_transcript_indices(words, f.read())
        provenance = {"schemaVersion": 1, "source": "legacy-transcript"}

    out_path = os.path.join(args.outdir, "words.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(words, f, ensure_ascii=False, indent=2)

    if provenance:
        provenance_path = os.path.join(args.outdir, "alignment.json")
        with open(provenance_path, "w", encoding="utf-8") as f:
            json.dump(provenance, f, ensure_ascii=False, indent=2)

    suffix = f", coverage={provenance.get('coverage', 0):.1%}" if provenance and "coverage" in provenance else ""
    print(f"[align_words] wrote {len(words)} words -> {out_path} (detected lang: {detected_language}{suffix})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
