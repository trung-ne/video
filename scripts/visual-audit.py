"""Content-only pixel regression audit for rendered videos."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path


def scene_at(timeline, seconds):
    if not timeline:
        return None
    frame = seconds * timeline.get("fps", 30)
    for scene in timeline.get("scenes", []):
        start = scene.get("startFrame", 0)
        if start <= frame < start + scene.get("durationFrames", 0):
            return scene.get("id")
    return None


def percentile(np, values, q):
    return round(float(np.percentile(values, q)), 4)


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True)
    parser.add_argument("--ffmpeg", required=True)
    parser.add_argument("--timeline")
    parser.add_argument("--report", help="optional report path; defaults beside the video")
    parser.add_argument("--sample-seconds", type=float, default=5.0)
    parser.add_argument("--subtitle-band-top", type=float, default=0.76)
    args = parser.parse_args()

    try:
        import numpy as np
        from PIL import Image, ImageFilter
    except ImportError:
        print("Visual audit skipped: install Pillow + numpy.")
        return 0

    video = Path(args.video).resolve()
    if not video.exists():
        print(f"Visual audit: video not found: {video}")
        return 2
    timeline = None
    if args.timeline and Path(args.timeline).is_file():
        timeline = json.loads(Path(args.timeline).read_text(encoding="utf-8-sig"))

    with tempfile.TemporaryDirectory(prefix="cat-video-audit-") as tmp:
        pattern = str(Path(tmp) / "frame_%05d.jpg")
        subprocess.run([
            args.ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(video),
            "-vf", f"fps=1/{args.sample_seconds},scale=320:-1",
            "-q:v", "4", pattern,
        ], check=True)
        paths = sorted(Path(tmp).glob("*.jpg"))
        if len(paths) < 4:
            print("Visual audit skipped: fewer than four sampled frames.")
            return 0

        rows = []
        thumbs = []
        for index, frame_path in enumerate(paths):
            full = Image.open(frame_path).convert("RGB").resize((320, 180))
            content_height = max(1, round(full.height * args.subtitle_band_top))
            image = full.crop((0, 0, full.width, content_height)).resize((160, 68))
            pixels = np.asarray(image).astype(np.float32)
            channel_max = pixels.max(axis=2)
            channel_min = pixels.min(axis=2)
            white = float(np.mean(np.all(pixels > 235, axis=2)))
            saturation = float(np.mean((channel_max - channel_min) / (channel_max + 1e-6)))
            edges = np.asarray(image.convert("L").filter(ImageFilter.FIND_EDGES)).astype(np.float32)
            edge_density = float(np.mean(edges > 35))
            quantized = (pixels // 24).astype(np.uint8).reshape(-1, 3)
            _, color_counts = np.unique(quantized, axis=0, return_counts=True)
            dominant_color = float(color_counts.max() / len(quantized))
            flat = dominant_color > 0.55 or (edge_density < 0.10 and saturation < 0.12)
            seconds = index * args.sample_seconds
            rows.append({
                "seconds": round(seconds, 3),
                "sceneId": scene_at(timeline, seconds),
                "white": white,
                "saturation": saturation,
                "edges": edge_density,
                "dominantColor": dominant_color,
                "flat": flat,
            })
            thumbs.append(np.asarray(image.convert("L").resize((32, 14))).astype(np.float32) / 255.0)

        differences = [float(np.mean(np.abs(a - b))) for a, b in zip(thumbs, thumbs[1:])]
        duplicate_flags = [difference < 0.025 for difference in differences]
        longest_duplicate_run = 0
        current_run = 0
        for duplicate in duplicate_flags:
            current_run = current_run + 1 if duplicate else 0
            longest_duplicate_run = max(longest_duplicate_run, current_run)

        saturation_values = [row["saturation"] for row in rows]
        edge_values = [row["edges"] for row in rows]
        metrics = {
            "video": str(video),
            "sampleSeconds": args.sample_seconds,
            "subtitleBandMaskedFrom": args.subtitle_band_top,
            "sampledFrames": len(rows),
            "nearWhiteMean": round(float(np.mean([row["white"] for row in rows])), 4),
            "whiteDominantRatio": round(float(np.mean([row["white"] > 0.60 for row in rows])), 4),
            "flatFrameRatio": round(float(np.mean([row["flat"] for row in rows])), 4),
            "saturation": {
                "mean": round(float(np.mean(saturation_values)), 4),
                "p10": percentile(np, saturation_values, 10),
                "p50": percentile(np, saturation_values, 50),
            },
            "edgeDensity": {
                "mean": round(float(np.mean(edge_values)), 4),
                "p10": percentile(np, edge_values, 10),
                "p50": percentile(np, edge_values, 50),
            },
            "nearDuplicateRatio": round(float(np.mean(duplicate_flags)), 4),
            "longestNearDuplicateRunSeconds": round(longest_duplicate_run * args.sample_seconds, 2),
            "structuralChangeMean": round(float(np.mean(differences)), 4),
            "samples": rows,
        }

    failures = []
    if metrics["saturation"]["mean"] < 0.15:
        failures.append("LOW_COLOUR_REGISTER: content saturation mean <0.15")
    if metrics["edgeDensity"]["mean"] < 0.16:
        failures.append("LOW_VISUAL_DENSITY: content edge density mean <0.16")
    if metrics["nearDuplicateRatio"] > 0.22:
        failures.append("FRAME_SIMILARITY: adjacent near-duplicate ratio >22%")
    if metrics["flatFrameRatio"] > 0.50:
        failures.append("FLAT_REGISTER: >50% sampled content frames are flat")

    metrics["failures"] = failures
    metrics["passed"] = not failures
    report_path = Path(args.report).resolve() if args.report else video.with_suffix(".visual-audit.json")
    report_path.write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")

    print("\nVISUAL AUDIT (subtitle band excluded)")
    print(f"   Samples:             {metrics['sampledFrames']}")
    print(f"   Flat frames:         {metrics['flatFrameRatio'] * 100:.1f}%")
    print(f"   Mean saturation:     {metrics['saturation']['mean']:.3f}")
    print(f"   Mean edge density:   {metrics['edgeDensity']['mean']:.3f}")
    print(f"   Near-duplicate:      {metrics['nearDuplicateRatio'] * 100:.1f}%")
    print(f"   Longest static run:  {metrics['longestNearDuplicateRunSeconds']:.1f}s")
    print(f"   Report:              {report_path}")
    for failure in failures:
        print(f"   FAIL {failure}")
    return 3 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
