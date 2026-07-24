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


def normalize_word(value):
    value = unicodedata.normalize("NFC", value or "").lower()
    return "".join(ch for ch in value if ch.isalnum())


def transcript_words(text):
    return re.findall(r"[\w]+(?:['’\-][\w]+)*", unicodedata.normalize("NFC", text), flags=re.UNICODE)


def attach_transcript_indices(aligned, transcript):
    expected = transcript_words(transcript)
    cursor = 0
    for item in aligned:
        token = normalize_word(item["word"])
        match_index = None
        for index in range(cursor, min(len(expected), cursor + 8)):
            if normalize_word(expected[index]) == token:
                match_index = index
                break
        if match_index is None:
            item["wordIndex"] = None
            item["confidence"] = 0.0
        else:
            item["wordIndex"] = match_index
            item["confidence"] = 1.0 if match_index == cursor else 0.8
            cursor = match_index + 1
    return aligned


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--wav", required=True, help="path to voice.wav")
    ap.add_argument("--outdir", required=True, help="folder to write words.json")
    ap.add_argument("--model", default="base", help="whisper model size (tiny/base/small/medium)")
    ap.add_argument("--lang", default=None, help="language code hint, e.g. en / vi (auto if omitted)")
    ap.add_argument("--transcript", default=None, help="verbatim transcript for stable wordIndex mapping")
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

    if args.transcript:
        with open(args.transcript, "r", encoding="utf-8-sig") as f:
            words = attach_transcript_indices(words, f.read())

    out_path = os.path.join(args.outdir, "words.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(words, f, ensure_ascii=False, indent=2)

    print(f"[align_words] wrote {len(words)} words -> {out_path} (detected lang: {info.language})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
