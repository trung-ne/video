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
    parser.add_argument("--sample-offset", type=float, default=0.0)
    parser.add_argument("--subtitle-band-top", type=float, default=0.76)
    parser.add_argument("--config", default="config/reference-quality.json")
    parser.add_argument("--contact-sheet")
    parser.add_argument("--record-video-path", help="published path to record while auditing a staged video")
    parser.add_argument("--record-contact-sheet", help="published contact-sheet path to record")
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
    profile = {}
    if args.config and Path(args.config).is_file():
        profile = json.loads(Path(args.config).read_text(encoding="utf-8-sig")).get("visualAudit", {})
    minimum_saturation = float(profile.get("minimumSaturation", 0.15))
    minimum_edges = float(profile.get("minimumEdgeDensity", 0.16))
    maximum_duplicates = float(profile.get("maximumNearDuplicateRatio", 0.22))
    maximum_flat = float(profile.get("maximumFlatFrameRatio", 0.50))

    with tempfile.TemporaryDirectory(prefix="cat-video-audit-") as tmp:
        pattern = str(Path(tmp) / "frame_%05d.jpg")
        subprocess.run([
            args.ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
            "-ss", str(max(0.0, args.sample_offset)),
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
        contact_frames = []
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
            seconds = args.sample_offset + index * args.sample_seconds
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
            contact_frames.append(full.resize((320, 180)))

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
            "video": str(Path(args.record_video_path).resolve()) if args.record_video_path else str(video),
            "sampleSeconds": args.sample_seconds,
            "sampleOffsetSeconds": args.sample_offset,
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

        by_scene = {}
        for row in rows:
            key = row["sceneId"] or "unknown"
            bucket = by_scene.setdefault(key, {"samples": 0, "flat": 0, "edges": [], "saturation": []})
            bucket["samples"] += 1
            bucket["flat"] += int(row["flat"])
            bucket["edges"].append(row["edges"])
            bucket["saturation"].append(row["saturation"])
        scene_metrics = [{
            "sceneId": scene_id,
            "samples": values["samples"],
            "flatRatio": round(values["flat"] / values["samples"], 4),
            "edgeDensityMean": round(float(np.mean(values["edges"])), 4),
            "saturationMean": round(float(np.mean(values["saturation"])), 4),
        } for scene_id, values in by_scene.items()]
        metrics["worstFlatScenes"] = sorted(
            scene_metrics, key=lambda item: (-item["flatRatio"], item["edgeDensityMean"])
        )[:20]
        metrics["lowDensityScenes"] = sorted(
            scene_metrics, key=lambda item: item["edgeDensityMean"]
        )[:20]
        scene_lookup = {
            scene.get("id"): scene for scene in (timeline or {}).get("scenes", [])
        }
        register_buckets = {}
        for row in rows:
            register = scene_lookup.get(row["sceneId"], {}).get("visualRegister", "unknown")
            register_buckets.setdefault(register, []).append(row)
        metrics["registerMetrics"] = {
            register: {
                "sceneCount": len(set(item["sceneId"] for item in items)),
                "sampleCount": len(items),
                "flatRatioMean": round(float(np.mean([item["flat"] for item in items])), 4),
                "edgeDensityMean": round(float(np.mean([item["edges"] for item in items])), 4),
                "saturationMean": round(float(np.mean([item["saturation"] for item in items])), 4),
            }
            for register, items in register_buckets.items()
        }
        grammar_buckets = {}
        for row in rows:
            grammar = scene_lookup.get(row["sceneId"], {}).get("visualGrammar", "unknown")
            grammar_buckets.setdefault(grammar, []).append(row)
        metrics["grammarMetrics"] = {
            grammar: {
                "sceneCount": len(set(item["sceneId"] for item in items)),
                "sampleCount": len(items),
                "flatRatioMean": round(float(np.mean([item["flat"] for item in items])), 4),
                "edgeDensityMean": round(float(np.mean([item["edges"] for item in items])), 4),
                "saturationMean": round(float(np.mean([item["saturation"] for item in items])), 4),
            }
            for grammar, items in grammar_buckets.items()
        }
        metrics["duplicateScenePairs"] = [{
            "fromSceneId": rows[index]["sceneId"],
            "toSceneId": rows[index + 1]["sceneId"],
            "fromSeconds": rows[index]["seconds"],
            "toSeconds": rows[index + 1]["seconds"],
            "difference": round(differences[index], 4),
        } for index, duplicate in enumerate(duplicate_flags) if duplicate][:50]

        if args.contact_sheet and contact_frames:
            from PIL import ImageDraw
            count = min(30, len(contact_frames))
            selected = np.linspace(0, len(contact_frames) - 1, count, dtype=int)
            sheet = Image.new("RGB", (5 * 324 + 4, 6 * 204 + 4), "white")
            draw = ImageDraw.Draw(sheet)
            for slot, frame_index in enumerate(selected):
                x = 4 + (slot % 5) * 324
                y = 4 + (slot // 5) * 204
                sheet.paste(contact_frames[frame_index], (x, y))
                label = f"{rows[frame_index]['seconds']:.0f}s {rows[frame_index]['sceneId'] or ''}"
                draw.text((x + 4, y + 183), label, fill="black")
            contact_path = Path(args.contact_sheet).resolve()
            contact_path.parent.mkdir(parents=True, exist_ok=True)
            sheet.save(contact_path, quality=88)
            metrics["contactSheet"] = (
                str(Path(args.record_contact_sheet).resolve())
                if args.record_contact_sheet else str(contact_path)
            )

    failures = []
    if metrics["saturation"]["mean"] < minimum_saturation:
        failures.append(f"LOW_COLOUR_REGISTER: content saturation mean <{minimum_saturation}")
    if metrics["edgeDensity"]["mean"] < minimum_edges:
        failures.append(f"LOW_VISUAL_DENSITY: content edge density mean <{minimum_edges}")
    if metrics["nearDuplicateRatio"] > maximum_duplicates:
        failures.append(f"FRAME_SIMILARITY: adjacent near-duplicate ratio >{maximum_duplicates:.0%}")
    if metrics["flatFrameRatio"] > maximum_flat:
        failures.append(f"FLAT_REGISTER: sampled content flat ratio >{maximum_flat:.0%}")

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
