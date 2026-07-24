"""Pixel-level regression audit for rendered videos.

Timeline checks cannot see a visually empty frame. This script samples the
encoded MP4 every five seconds and measures the failure mode found in the
reference audit: excessive near-white area, low colour, low visual detail, and
long runs of nearly identical frames.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path


def main() -> int:
    # Windows PowerShell may expose a legacy cp1252 stdout. Keep the audit
    # usable in CI/redirected logs without crashing on status symbols.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True)
    parser.add_argument("--ffmpeg", required=True)
    parser.add_argument("--sample-seconds", type=float, default=5.0)
    args = parser.parse_args()

    try:
        import numpy as np
        from PIL import Image, ImageFilter
    except ImportError:
        print("⚠️  Visual audit skipped: install Pillow + numpy for pixel checks.")
        return 0

    video = Path(args.video).resolve()
    if not video.exists():
        print(f"❌ Visual audit: video not found: {video}")
        return 2

    with tempfile.TemporaryDirectory(prefix="cat-video-audit-") as tmp:
        pattern = str(Path(tmp) / "frame_%05d.jpg")
        subprocess.run(
            [
                args.ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
                "-i", str(video),
                "-vf", f"fps=1/{args.sample_seconds},scale=320:-1",
                "-q:v", "5", pattern,
            ],
            check=True,
        )

        paths = sorted(Path(tmp).glob("*.jpg"))
        if len(paths) < 4:
            print("⚠️  Visual audit skipped: fewer than four sampled frames.")
            return 0

        rows: list[dict[str, float]] = []
        hashes: list["np.ndarray"] = []
        for path in paths:
            image = Image.open(path).convert("RGB").resize((160, 90))
            pixels = np.asarray(image).astype(np.float32)
            channel_max = pixels.max(axis=2)
            channel_min = pixels.min(axis=2)
            white = float(np.mean(np.all(pixels > 235, axis=2)))
            saturation = float(np.mean((channel_max - channel_min) / (channel_max + 1e-6)))
            edges = np.asarray(image.convert("L").filter(ImageFilter.FIND_EDGES)).astype(np.float32)
            edge_density = float(np.mean(edges > 35))
            rows.append({"white": white, "saturation": saturation, "edges": edge_density})

            thumb = np.asarray(image.convert("L").resize((32, 18))).astype(np.float32) / 255.0
            hashes.append(thumb)

        duplicate_pairs = 0
        for previous, current in zip(hashes, hashes[1:]):
            if float(np.mean(np.abs(previous - current))) < 0.025:
                duplicate_pairs += 1

        metrics = {
            "video": str(video),
            "sampleSeconds": args.sample_seconds,
            "sampledFrames": len(rows),
            "nearWhiteMean": round(float(np.mean([r["white"] for r in rows])), 4),
            "whiteDominantRatio": round(float(np.mean([r["white"] > 0.60 for r in rows])), 4),
            "saturationMean": round(float(np.mean([r["saturation"] for r in rows])), 4),
            "edgeDensityMean": round(float(np.mean([r["edges"] for r in rows])), 4),
            "nearDuplicateRatio": round(duplicate_pairs / max(1, len(rows) - 1), 4),
        }

    failures: list[str] = []
    if metrics["whiteDominantRatio"] > 0.78:
        failures.append("WHITE_DOMINANCE: >78% sampled frames are mostly white")
    if metrics["saturationMean"] < 0.10:
        failures.append("LOW_COLOUR_REGISTER: mean saturation <0.10")
    if metrics["edgeDensityMean"] < 0.12:
        failures.append("LOW_VISUAL_DENSITY: mean edge density <0.12")
    if metrics["nearDuplicateRatio"] > 0.55:
        failures.append("FRAME_SIMILARITY: >55% adjacent samples are near-identical")

    metrics["failures"] = failures
    report_path = video.with_suffix(".visual-audit.json")
    report_path.write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")

    print("\n🎞️  VISUAL AUDIT")
    print(f"   Samples:             {metrics['sampledFrames']}")
    print(f"   White-dominant:      {metrics['whiteDominantRatio'] * 100:.1f}%")
    print(f"   Mean saturation:     {metrics['saturationMean']:.3f}")
    print(f"   Mean edge density:   {metrics['edgeDensityMean']:.3f}")
    print(f"   Near-duplicate:      {metrics['nearDuplicateRatio'] * 100:.1f}%")
    print(f"   Report:              {report_path}")

    # Require two independent pixel symptoms before failing. This avoids
    # rejecting a deliberate low-colour or minimalist sequence on one metric.
    if len(failures) >= 2:
        for failure in failures:
            print(f"   ❌ {failure}")
        print("❌ Visual audit failed: output is materially flatter than the reference target.")
        return 3

    for failure in failures:
        print(f"   ⚠️  {failure}")
    print("✅ Visual audit passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
