"""
tts_kokoro.py — Generate per-scene narration audio with Kokoro TTS.

Requires Python 3.11 (torch dependency). Run via: py -3.11 scripts/tts_kokoro.py ...

Usage:
    py -3.11 scripts/tts_kokoro.py --scenes scenes.json --outdir public/audio/<proj> \
        --voice af_heart --lang a

Input  (scenes.json): [{"id": "scene-01", "text": "..."}, ...]
Output (in outdir):
    voice.wav        — all scenes concatenated (the track the video plays)
    durations.json   — {"fps":30,"sampleRate":24000,"totalSec":..,
                        "scenes":[{"id":..,"sec":..,"frames":..,"startFrame":..}]}

lang codes: a=American English, b=British English, j=Japanese, z=Mandarin
voices: af_heart af_bella af_nicole am_adam am_michael bf_emma bm_george
"""

import argparse
import json
import os
import sys
import time

FPS = 30
SR = 24000          # Kokoro output sample rate
GAP_SEC = 0.08      # short boundary between per-scene narration chunks

VIETNAMESE_MARKS = set(
    "ăâđêôơưĂÂĐÊÔƠƯ"
    "áàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệ"
    "íìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữự"
    "ýỳỷỹỵÁÀẢÃẠẤẦẨẪẬẮẰẲẴẶÉÈẺẼẸẾỀỂỄỆ"
    "ÍÌỈĨỊÓÒỎÕỌỐỒỔỖỘỚỜỞỠỢÚÙỦŨỤỨỪỬỮỰÝỲỶỸỴ"
)


def looks_vietnamese(text: str) -> bool:
    letters = sum(ch.isalpha() for ch in text)
    marked = sum(ch in VIETNAMESE_MARKS for ch in text)
    return marked >= 12 and marked / max(1, letters) >= 0.01


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenes", required=True, help="JSON file: [{id,text},...]")
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--manifest", default=None, help="durations.json path (default: <outdir>/durations.json)")
    ap.add_argument("--voice", default="af_heart")
    ap.add_argument("--lang", default="a", help="Kokoro lang_code (a=US English)")
    ap.add_argument("--gap", type=float, default=GAP_SEC, help="silence between per-scene TTS chunks")
    args = ap.parse_args()

    with open(args.scenes, "r", encoding="utf-8-sig") as f:
        scenes = json.load(f)

    combined_text = " ".join(str(scene.get("text") or "") for scene in scenes)
    if args.lang in {"a", "b"} and looks_vietnamese(combined_text):
        print(
            "ERROR: Kokoro language a/b cannot produce Vietnamese narration. "
            "Use scripts/tts_edge.py --voice vi-VN-NamMinhNeural.",
            file=sys.stderr,
        )
        sys.exit(3)

    import numpy as np
    import soundfile as sf
    from kokoro import KPipeline

    os.makedirs(args.outdir, exist_ok=True)

    # Suppress HF hub warning
    os.environ.setdefault("HF_HUB_DISABLE_IMPLICIT_TOKEN", "1")

    started_at = time.perf_counter()
    pipeline = KPipeline(lang_code=args.lang)

    gap = np.zeros(int(SR * max(0.0, args.gap)), dtype=np.float32)
    all_audio = []
    manifest = {"fps": FPS, "sampleRate": SR, "voice": args.voice,
                "lang": args.lang, "scenes": []}
    start_frame = 0

    for idx, scene in enumerate(scenes):
        sid = scene.get("id", f"scene-{idx+1:02d}")
        text = (scene.get("text") or "").strip()
        if not text:
            print(f"  [skip] {sid}: empty text", file=sys.stderr)
            continue

        chunks = []
        for _gs, _ps, audio in pipeline(text, voice=args.voice):
            chunks.append(audio)
        if not chunks:
            print(f"  [skip] {sid}: no audio produced", file=sys.stderr)
            continue

        clip = np.concatenate(chunks)
        # per-scene wav (handy for debugging / re-renders)
        sf.write(os.path.join(args.outdir, f"{sid}.wav"), clip, SR)

        all_audio.append(clip)
        if idx < len(scenes) - 1:
            all_audio.append(gap)

        boundary_gap = len(gap) if idx < len(scenes) - 1 else 0
        sec = (len(clip) + boundary_gap) / SR
        frames = max(1, round(sec * FPS))
        manifest["scenes"].append({
            "id": sid, "sec": round(sec, 3),
            "frames": frames, "startFrame": start_frame,
        })
        start_frame += frames
        print(f"  [ok] {sid}: {sec:.2f}s ({frames}f)")

    if not all_audio:
        print("ERROR: no audio generated for any scene", file=sys.stderr)
        sys.exit(1)

    full = np.concatenate(all_audio)
    sf.write(os.path.join(args.outdir, "voice.wav"), full, SR)

    manifest["totalSec"] = round(len(full) / SR, 3)
    manifest["totalFrames"] = start_frame
    gap_count = max(0, len(manifest["scenes"]) - 1)
    total_gap_seconds = gap_count * max(0.0, args.gap)
    manifest["ttsMetrics"] = {
        "chunkCount": len(manifest["scenes"]),
        "gapCount": gap_count,
        "maxInterSceneGapSeconds": round(max(0.0, args.gap), 3),
        "totalGapSeconds": round(total_gap_seconds, 3),
        "gapShare": round(total_gap_seconds / manifest["totalSec"], 6) if manifest["totalSec"] else 0,
        "wallClockSeconds": round(time.perf_counter() - started_at, 3),
    }
    manifest_path = args.manifest or os.path.join(args.outdir, "durations.json")
    os.makedirs(os.path.dirname(os.path.abspath(manifest_path)), exist_ok=True)
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    print(f"\nDONE  total={manifest['totalSec']}s  ({start_frame} frames)  "
          f"scenes={len(manifest['scenes'])}")
    print(f"  voice.wav -> {args.outdir}")
    print(f"  durations.json -> {manifest_path}")


if __name__ == "__main__":
    main()
