"""Advisory temporal preflight for Remotion --every-nth-frame=75 diagnostics.

Sparse encoded timestamps are deliberately ignored: frame i represents original
frame i*75, not i frames on a compacted video clock. This is never a publish gate.
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    from visual_audit_metrics import NEAR_DUPLICATE_PIXEL_THRESHOLD, aggregate_duplicate_metrics
except ImportError:
    from scripts.visual_audit_metrics import NEAR_DUPLICATE_PIXEL_THRESHOLD, aggregate_duplicate_metrics

ORIGINAL_FPS = 30
STRIDE = 75
WIDTH = 1920
HEIGHT = 1080
SAMPLE_SECONDS = STRIDE / ORIGINAL_FPS
MAX_SAMPLES = 1000
PROBE_TIMEOUT_SECONDS = 15
DECODE_TIMEOUT_SECONDS = 180
LIMITATIONS = [
    "Sparse 2.5s samples miss changes between frames; this is not the canonical multiphase visual audit.",
    "Near-duplicate arithmetic and thumbnail dimensions match the canonical audit, but FFmpeg downscaling may differ from its Pillow downscaling; pixel measurements are approximate.",
    "No density, occupancy, audio, or encoding gates are assessed.",
    "Original frame numbers assume a full-range Remotion --every-nth-frame=75 render beginning at frame zero; decoded frames alone cannot prove that provenance.",
    "A same-scene pair can conceal visual or pose changes between samples; interpret intervals as leads, not proof of a static scene.",
]


def load_json(path, label):
    try:
        value = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    except (OSError, UnicodeError, ValueError) as error:
        raise ValueError(f"cannot read {label}: {error}") from error
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be a JSON object")
    return value


def timeline_scenes(timeline):
    if timeline.get("fps") != ORIGINAL_FPS or timeline.get("width") != WIDTH or timeline.get("height") != HEIGHT:
        raise ValueError("timeline must declare 30fps and 1920x1080")
    total = timeline.get("durationInFrames")
    if type(total) is not int or total <= 0:
        raise ValueError("timeline durationInFrames must be a positive integer")
    scenes = timeline.get("scenes")
    if not isinstance(scenes, list) or not scenes:
        raise ValueError("timeline requires nonempty scenes")
    cursor = 0
    ids = set()
    for scene in scenes:
        if not isinstance(scene, dict) or not isinstance(scene.get("id"), str) or not scene["id"] or scene["id"] in ids:
            raise ValueError("timeline scene ids must be unique nonempty strings")
        ids.add(scene["id"])
        if type(scene.get("startFrame")) is not int or scene["startFrame"] != cursor or type(scene.get("durationFrames")) is not int or scene["durationFrames"] <= 0:
            raise ValueError("timeline scenes must have positive, contiguous frame spans starting at zero")
        cursor += scene["durationFrames"]
    if cursor != total:
        raise ValueError("timeline scene spans must exactly cover durationInFrames")
    return scenes, total


def core_scope(scope, scenes):
    if scope is None:
        return None
    keys = ("haloBeforeSceneIds", "coreSceneIds", "haloAfterSceneIds")
    if scope.get("kind") != "chunk" or any(not isinstance(scope.get(key), list) or any(not isinstance(value, str) or not value for value in scope[key]) for key in keys):
        raise ValueError("quality scope must declare chunk scene-id lists")
    expected = sum((scope[key] for key in keys), [])
    if not scope["coreSceneIds"] or expected != [scene["id"] for scene in scenes] or len(expected) != len(set(expected)):
        raise ValueError("quality scope must exactly match timeline scenes and have nonempty core")
    return set(scope["coreSceneIds"])


def profile_values(config):
    profile = config.get("visualAudit")
    if not isinstance(profile, dict):
        raise ValueError("config must contain visualAudit object")
    band = profile.get("subtitleBandTopRatio", 0.76)
    limit = profile.get("maximumWithinSceneNearDuplicateRatio", 0.15)
    if isinstance(band, bool) or not isinstance(band, (int, float)) or not math.isfinite(band) or not 0 < band <= 1:
        raise ValueError("subtitleBandTopRatio must be finite in (0, 1]")
    if isinstance(limit, bool) or not isinstance(limit, (int, float)) or not math.isfinite(limit) or not 0 <= limit <= 1:
        raise ValueError("maximumWithinSceneNearDuplicateRatio must be finite in [0, 1]")
    return float(band), float(limit)


def probe_video(ffprobe, video):
    result = subprocess.run([ffprobe, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height", "-of", "json", str(video)], capture_output=True, text=True, timeout=PROBE_TIMEOUT_SECONDS)
    if result.returncode:
        raise ValueError(f"ffprobe failed: {result.stderr.strip()}")
    try:
        streams = json.loads(result.stdout)["streams"]
        stream = streams[0]
        if stream["codec_name"] != "h264" or stream["width"] != WIDTH or stream["height"] != HEIGHT:
            raise ValueError("diagnostic video must be H264 1920x1080")
    except (KeyError, IndexError, TypeError, json.JSONDecodeError) as error:
        raise ValueError("ffprobe returned malformed video metadata") from error


def extract_thumbnails(ffmpeg, video, expected, band_top):
    """Decode all frames with no fps filter; cap output at expected+1 to catch extras."""
    import numpy as np
    from PIL import Image

    with tempfile.TemporaryDirectory(prefix="sample-visual-preflight-") as tmp:
        raw = Path(tmp) / "samples.rgb"
        command = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(video), "-map", "0:v:0", "-an", "-sn", "-vf", "scale=320:180", "-vsync", "0", "-frames:v", str(expected + 1), "-f", "rawvideo", "-pix_fmt", "rgb24", str(raw)]
        result = subprocess.run(command, capture_output=True, timeout=DECODE_TIMEOUT_SECONDS)
        if result.returncode:
            raise ValueError(f"ffmpeg decode failed: {result.stderr.decode('utf-8', errors='replace').strip()}")
        frame_bytes = 320 * 180 * 3
        size = raw.stat().st_size if raw.exists() else 0
        if size != expected * frame_bytes:
            raise ValueError(f"decoded frame count mismatch: expected exactly {expected}, got {size / frame_bytes:g}")
        thumbs = []
        with raw.open("rb") as frames:
            for _ in range(expected):
                frame = Image.frombytes("RGB", (320, 180), frames.read(frame_bytes))
                content = frame.crop((0, 0, 320, max(1, round(180 * band_top))))
                image = content.resize((160, 68)).convert("L").resize((32, 14))
                thumbs.append(np.asarray(image, dtype=np.float32) / 255.0)
        return thumbs


def build_report(video, timeline, core_ids, thumbs, band_top, reference_limit):
    import numpy as np

    scenes, total = timeline_scenes(timeline)
    expected = (total + STRIDE - 1) // STRIDE
    if len(thumbs) != expected:
        raise ValueError(f"decoded frame count mismatch: expected exactly {expected}, got {len(thumbs)}")
    rows = []
    scene_index = 0
    for index in range(expected):
        frame = index * STRIDE
        while frame >= scenes[scene_index]["startFrame"] + scenes[scene_index]["durationFrames"]:
            scene_index += 1
        scene_id = scenes[scene_index]["id"]
        rows.append({"sampleIndex": index, "originalFrame": frame, "seconds": frame / ORIGINAL_FPS, "sceneId": scene_id, "sampleRole": "global" if core_ids is None else "core" if scene_id in core_ids else "halo"})
    differences = [float(np.mean(np.abs(left - right))) for left, right in zip(thumbs, thumbs[1:])]
    stats = aggregate_duplicate_metrics(rows, differences, NEAR_DUPLICATE_PIXEL_THRESHOLD, core_ids, timeline_present=True, nominal_interval_seconds=SAMPLE_SECONDS)
    intervals = [{"sceneId": pair["destinationSceneId"], "fromOriginalFrame": pair["left"]["originalFrame"], "toOriginalFrame": pair["right"]["originalFrame"], "fromSeconds": pair["left"]["seconds"], "toSeconds": pair["right"]["seconds"], "difference": round(pair["difference"], 6)} for pair in stats["duplicatePairs"] if pair["kind"] == "within-scene" and pair["duplicate"]]
    ratio = stats["withinSceneNearDuplicateRatio"]
    diagnostics = [{"sceneId": scene_id, "duplicatePairs": sum(item["sceneId"] == scene_id for item in intervals), "intervals": [{"fromSeconds": item["fromSeconds"], "toSeconds": item["toSeconds"]} for item in intervals if item["sceneId"] == scene_id][:5]} for scene_id in sorted({item["sceneId"] for item in intervals})]
    return {"schemaVersion": 1, "kind": "sample-visual-preflight", "status": "inconclusive", "nonPromotable": True, "promotable": False, "canonicalQualityAssessed": False, "sampleFrameStep": STRIDE, "sampledFrames": len(thumbs), "withinSceneDuplicateDiagnostics": diagnostics, "video": str(video), "sampling": {"originalFps": ORIGINAL_FPS, "everyNthFrame": STRIDE, "originalSecondsBetweenSamples": SAMPLE_SECONDS, "expectedFrames": expected, "decodedFrames": len(thumbs), "subtitleBandMaskedFrom": band_top, "nearDuplicatePixelThreshold": NEAR_DUPLICATE_PIXEL_THRESHOLD, "comparison": "mean absolute normalized grayscale difference on masked 32x14 thumbnails"}, "scope": {"kind": "chunk" if core_ids is not None else "global", "coreSceneIds": sorted(core_ids) if core_ids is not None else None, "temporalOwnership": "destination-core" if core_ids is not None else "all-destinations"}, "referenceMaximumWithinSceneNearDuplicateRatio": reference_limit, "withinSceneNearDuplicateRatio": ratio, "withinScenePairCount": stats["withinScenePairCount"], "withinSceneDuplicateCount": stats["withinSceneDuplicateCount"], "ownedPairCount": stats["ownedPairCount"], "seamPairCount": stats["seamPairCount"], "longestWithinSceneNearDuplicateRunSeconds": stats["longestWithinSceneNearDuplicateRunSeconds"], "advisory": "investigate sampled within-scene similarity" if ratio is not None and ratio > reference_limit else "no sampled within-scene similarity above reference; canonical quality remains unknown", "samples": rows, "withinSceneDuplicateIntervals": intervals, "limitations": LIMITATIONS}


def resolve_binary(explicit, package, label):
    if explicit:
        return explicit
    resolved = subprocess.run(["node", "-e", f"process.stdout.write(require('{package}').path)"], capture_output=True, text=True, timeout=PROBE_TIMEOUT_SECONDS)
    if resolved.returncode or not resolved.stdout.strip():
        raise ValueError(f"cannot resolve {label}; supply --{label}")
    return resolved.stdout.strip()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", required=True)
    parser.add_argument("--timeline", required=True)
    parser.add_argument("--quality-scope")
    parser.add_argument("--config", default="config/reference-quality.json")
    parser.add_argument("--ffmpeg", help="ffmpeg path (defaults to @ffmpeg-installer/ffmpeg)")
    parser.add_argument("--ffprobe", help="ffprobe path (defaults to @ffprobe-installer/ffprobe)")
    parser.add_argument("--out", "--report", dest="report", help="advisory JSON output path")
    args = parser.parse_args(argv)
    try:
        video = Path(args.video).resolve()
        if not video.is_file():
            raise ValueError(f"video not found: {video}")
        timeline = load_json(args.timeline, "timeline")
        scenes, duration = timeline_scenes(timeline)
        core_ids = core_scope(load_json(args.quality_scope, "quality scope") if args.quality_scope else None, scenes)
        band_top, limit = profile_values(load_json(args.config, "reference config"))
        expected = (duration + STRIDE - 1) // STRIDE
        if expected > MAX_SAMPLES:
            raise ValueError(f"sample count exceeds bounded limit {MAX_SAMPLES}")
        ffprobe = resolve_binary(args.ffprobe, "@ffprobe-installer/ffprobe", "ffprobe")
        ffmpeg = resolve_binary(args.ffmpeg, "@ffmpeg-installer/ffmpeg", "ffmpeg")
        probe_video(ffprobe, video)
        thumbs = extract_thumbnails(ffmpeg, video, expected, band_top)
        report = build_report(video, timeline, core_ids, thumbs, band_top, limit)
        if args.report:
            target = Path(args.report).resolve()
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    except subprocess.TimeoutExpired as error:
        print(f"Sample visual preflight timed out: {error}", file=sys.stderr)
        return 2
    except (OSError, ValueError, ImportError) as error:
        print(f"Sample visual preflight input error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
