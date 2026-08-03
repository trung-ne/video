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


def attach_canonical_scene_indices(aligned, scenes):
    """Map Whisper words to the exact scene narration read by TTS.

    `sourceRange` refers to the input transcript and may deliberately differ
    from `narrationOverride`. Subtitle timing must never use that source range:
    it has to follow the words the voice actually spoke.
    """
    expected = canonical_tts_tokens(scenes)
    expected_norm = [normalize_word(item["word"]) for item in expected]
    aligned_norm = [normalize_word(item["word"]) for item in aligned]
    matcher = SequenceMatcher(None, expected_norm, aligned_norm, autojunk=False)
    index_map = {}
    for block in matcher.get_matching_blocks():
        for offset in range(block.size):
            index_map[block.b + offset] = block.a + offset

    matched = 0
    for aligned_index, item in enumerate(aligned):
        canonical_index = index_map.get(aligned_index)
        item["whisperConfidence"] = item.get("confidence")
        if canonical_index is None:
            item["confidence"] = 0.0
            continue
        token = expected[canonical_index]
        item["scene"] = token["scene"]
        item["sceneWordIndex"] = token["sceneWordIndex"]
        item["canonicalWordIndex"] = canonical_index
        item["confidence"] = 1.0
        matched += 1

    return aligned, {
        "schemaVersion": 1,
        "source": "canonical-tts-scenes",
        "canonicalWordCount": len(expected),
        "matchedWordCount": matched,
        "coverage": round(matched / len(expected), 6) if expected else 0.0,
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
    args = ap.parse_args()

    if not os.path.isfile(args.wav):
        print(f"[align_words] wav not found: {args.wav}", file=sys.stderr)
        return 1

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("[align_words] faster-whisper chưa cài. Chạy: py -3.11 -m pip install faster-whisper", file=sys.stderr)
        return 2

    print(f"[align_words] loading model '{args.model}' (CPU int8)...")
    model = WhisperModel(args.model, device="cpu", compute_type="int8")

    print(f"[align_words] transcribing {args.wav} with word timestamps...")
    segments, info = model.transcribe(
        args.wav,
        word_timestamps=True,
        language=args.lang,
        vad_filter=False,
    )

    words = []
    for seg in segments:
        for w in (seg.words or []):
            token = (w.word or "").strip()
            if not token:
                continue
            words.append({
                "word": token,
                "startSec": round(float(w.start), 3),
                "endSec": round(float(w.end), 3),
                "confidence": round(float(getattr(w, "probability", 0.0) or 0.0), 3),
            })

    provenance = None
    if args.scenes:
        with open(args.scenes, "r", encoding="utf-8-sig") as f:
            scenes = json.load(f)
        if not isinstance(scenes, list) or not scenes:
            print("[align_words] --scenes must be a non-empty tts_scenes.json array", file=sys.stderr)
            return 1
        words, provenance = attach_canonical_scene_indices(words, scenes)
        provenance["language"] = info.language or args.lang
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
    print(f"[align_words] wrote {len(words)} words -> {out_path} (detected lang: {info.language}{suffix})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
