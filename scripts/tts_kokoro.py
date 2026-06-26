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

FPS = 30
SR = 24000          # Kokoro output sample rate
GAP_SEC = 0.30      # silence inserted between scenes for natural pacing


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenes", required=True, help="JSON file: [{id,text},...]")
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--voice", default="af_heart")
    ap.add_argument("--lang", default="a", help="Kokoro lang_code (a=US English)")
    args = ap.parse_args()

    import numpy as np
    import soundfile as sf
    from kokoro import KPipeline

    with open(args.scenes, "r", encoding="utf-8-sig") as f:
        scenes = json.load(f)

    os.makedirs(args.outdir, exist_ok=True)

    # Suppress HF hub warning
    os.environ.setdefault("HF_HUB_DISABLE_IMPLICIT_TOKEN", "1")

    pipeline = KPipeline(lang_code=args.lang)

    gap = np.zeros(int(SR * GAP_SEC), dtype=np.float32)
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
        all_audio.append(gap)

        sec = (len(clip) + len(gap)) / SR
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
    with open(os.path.join(args.outdir, "durations.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    print(f"\nDONE  total={manifest['totalSec']}s  ({start_frame} frames)  "
          f"scenes={len(manifest['scenes'])}")
    print(f"  voice.wav + durations.json -> {args.outdir}")


if __name__ == "__main__":
    main()
