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
try:
    from tts_fidelity import units as fidelity_units
except ModuleNotFoundError:  # imported as scripts.align_words in unit tests
    from scripts.tts_fidelity import units as fidelity_units


def normalize_word(value):
    value = unicodedata.normalize("NFC", value or "").lower()
    return "".join(ch for ch in value if ch.isalnum())


def is_japanese_language(language):
    return str(language or "").lower().startswith("ja")


def is_korean_language(language):
    return str(language or "").lower().startswith("ko")


def transcript_words(text, language=None):
    value = unicodedata.normalize("NFC", text)
    if is_japanese_language(language):
        # Whisper's Japanese "word" segmentation is not stable. Character
        # units give canonical subtitles deterministic coverage/timestamps.
        return [char for char in value if ("\u3040" <= char <= "\u30ff") or ("\u3400" <= char <= "\u9fff") or char.isdigit()]
    return re.findall(r"[\w]+(?:['’\-][\w]+)*", value, flags=re.UNICODE)


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


def canonical_tts_tokens(scenes, language=None):
    """Return the exact tokens spoken by TTS, retaining scene-local identity."""
    tokens = []
    for scene in scenes:
        scene_id = str(scene.get("id") or "").strip()
        # schema-v2 separates direction from the exact words expected in the
        # waveform. Legacy text remains readable for diagnostic artifacts.
        text = str(scene.get("spokenText") or scene.get("text") or "")
        if not scene_id:
            raise ValueError("tts_scenes.json contains a scene without id")
        scene_language = scene.get("language") or language
        for scene_word_index, word in enumerate(transcript_words(text, scene_language)):
            tokens.append({
                "scene": scene_id,
                "sceneWordIndex": scene_word_index,
                "word": word,
            })
    return tokens


def japanese_canonical_tokens(scenes, language=None):
    """Build kana comparison units while retaining original subtitle chars.

    Sudachi's reading form can contain more kana than the original Kanji span.
    We distribute those reading units across visible source characters, then
    later group their ASR timestamps back to one canonical subtitle character.
    """
    reading_tokens, surface_tokens = [], []
    for scene in scenes:
        scene_id = str(scene.get("id") or "").strip()
        text = str(scene.get("spokenText") or scene.get("text") or "")
        surface = transcript_words(text, "ja")
        if not scene_id:
            raise ValueError("tts_scenes.json contains a scene without id")
        if not surface:
            continue
        base = len(surface_tokens)
        surface_tokens.extend({"scene": scene_id, "sceneWordIndex": index, "word": word} for index, word in enumerate(surface))
        readings = fidelity_units(text, "ja")
        for index, reading in enumerate(readings):
            surface_index = min(len(surface) - 1, index * len(surface) // max(1, len(readings)))
            reading_tokens.append({
                "scene": scene_id, "sceneWordIndex": surface_index,
                "surfaceCanonicalIndex": base + surface_index, "word": surface[surface_index],
                "matchWord": reading,
            })
    return reading_tokens, surface_tokens


def korean_canonical_tokens(scenes, language=None):
    """Use spacing-independent Hangul units while retaining subtitle words."""
    reading_tokens, surface_tokens = [], []
    for scene in scenes:
        scene_id = str(scene.get("id") or "").strip()
        text = str(scene.get("spokenText") or scene.get("text") or "")
        surface = transcript_words(text, "ko")
        if not scene_id:
            raise ValueError("tts_scenes.json contains a scene without id")
        if not surface:
            continue
        base = len(surface_tokens)
        surface_tokens.extend({"scene": scene_id, "sceneWordIndex": index, "word": word}
                              for index, word in enumerate(surface))
        readings = fidelity_units(text, "ko")
        for index, reading in enumerate(readings):
            surface_index = min(len(surface) - 1, index * len(surface) // max(1, len(readings)))
            reading_tokens.append({
                "scene": scene_id, "sceneWordIndex": surface_index,
                "surfaceCanonicalIndex": base + surface_index, "word": surface[surface_index],
                "matchWord": reading,
            })
    return reading_tokens, surface_tokens


def _expand_reading_aligned(aligned, language):
    result = []
    for item in aligned:
        # Compare ASR surface (Kanji/kana) using the same Sudachi reading units
        # as canonical narration.  Keeping surface characters here made "日本"
        # compare against "にほん" and falsely report zero matches.
        readings = fidelity_units(item.get("word", ""), language)
        if not readings:
            continue
        start, end = float(item.get("startSec", 0)), float(item.get("endSec", 0))
        for index, reading in enumerate(readings):
            left = start + (end - start) * index / len(readings)
            right = start + (end - start) * (index + 1) / len(readings)
            result.append({**item, "word": reading, "startSec": round(left, 3), "endSec": round(right, 3)})
    return result


def attach_canonical_scene_indices(aligned, scenes, language=None):
    """Map Whisper words to the exact scene narration read by TTS.

    `sourceRange` refers to the input transcript and may deliberately differ
    from `narrationOverride`. Subtitle timing must never use that source range:
    it has to follow the words the voice actually spoke.
    """
    japanese = is_japanese_language(language)
    korean = is_korean_language(language)
    reading_based = japanese or korean
    if japanese:
        expected, surface_expected = japanese_canonical_tokens(scenes, language)
    elif korean:
        expected, surface_expected = korean_canonical_tokens(scenes, language)
    else:
        expected, surface_expected = canonical_tts_tokens(scenes, language), None
    if reading_based:
        aligned = _expand_reading_aligned(aligned, "ja" if japanese else "ko")
    expected_norm = [normalize_word(item.get("matchWord", item["word"])) for item in expected]
    aligned_norm = [normalize_word(item["word"]) for item in aligned]
    matcher = SequenceMatcher(None, expected_norm, aligned_norm, autojunk=False)
    index_map = {}
    for block in matcher.get_matching_blocks():
        for offset in range(block.size):
            index_map[block.b + offset] = block.a + offset

    canonical_matches = {canonical_index: aligned[aligned_index]
                         for aligned_index, canonical_index in index_map.items()}
    if reading_based:
        grouped = {}
        for reading_index, observed in canonical_matches.items():
            grouped.setdefault(expected[reading_index]["surfaceCanonicalIndex"], []).append(observed)
        canonical_matches = {
            surface_index: {
                "startSec": min(float(item["startSec"]) for item in observations),
                "endSec": max(float(item["endSec"]) for item in observations),
                "confidence": min(float(item.get("confidence", 0)) for item in observations),
            }
            for surface_index, observations in grouped.items()
        }
        expected = surface_expected
    matched = len(canonical_matches)

    # Whisper is an ASR model, not a Vietnamese forced aligner. It can omit a
    # small word while still timestamping the surrounding TTS phrase correctly.
    # Emit one canonical token per spoken TTS token and interpolate only the
    # missing intervals. The report preserves the measured fraction separately
    # so downstream code never mistakes assisted timestamps for ASR matches.
    result = []
    anchor_indices = sorted(canonical_matches)
    for canonical_index, token in enumerate(expected):
        observed = canonical_matches.get(canonical_index)
        if observed is not None:
            result.append({
                "word": token["word"],
                "startSec": observed["startSec"], "endSec": observed["endSec"],
                "confidence": 1.0, "whisperConfidence": observed.get("confidence"),
                "scene": token["scene"], "sceneWordIndex": token["sceneWordIndex"],
                "canonicalWordIndex": canonical_index, "interpolated": False,
            })
            continue
        previous = max((idx for idx in anchor_indices if idx < canonical_index), default=None)
        following = min((idx for idx in anchor_indices if idx > canonical_index), default=None)
        if previous is not None and following is not None:
            left = canonical_matches[previous]
            right = canonical_matches[following]
            fraction = (canonical_index - previous) / (following - previous)
            center = float(left["endSec"]) + (float(right["startSec"]) - float(left["endSec"])) * fraction
        elif previous is not None:
            left = canonical_matches[previous]
            center = float(left["endSec"]) + 0.16 * (canonical_index - previous)
        elif following is not None:
            right = canonical_matches[following]
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
            payload = json.load(f)
        scenes = payload.get("scenes", []) if isinstance(payload, dict) else payload
        if not isinstance(scenes, list) or not scenes:
            print("[align_words] --scenes must be a non-empty tts_scenes.json array", file=sys.stderr)
            return 1
        words, provenance = attach_canonical_scene_indices(words, scenes, args.lang or detected_language)
        provenance["language"] = detected_language
        provenance["ttsSchemaVersion"] = payload.get("schemaVersion", 1) if isinstance(payload, dict) else 1
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
