"""Content-only pixel regression audit for rendered videos."""

from __future__ import annotations

import argparse
import json
import math
import re
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    from visual_audit_metrics import (
        MEASUREMENT_SPEC_VERSION,
        NEAR_DUPLICATE_PIXEL_THRESHOLD,
        aggregate_duplicate_metrics,
        canonical_sample_schedule,
        evaluate_visual_failures,
        focal_footprint,
        measurement_spec,
        measurement_spec_hash,
        normalize_sample_offsets,
        scene_at,
    )
except ImportError:  # Imported by the repository's unittest package.
    from scripts.visual_audit_metrics import (
        MEASUREMENT_SPEC_VERSION,
        NEAR_DUPLICATE_PIXEL_THRESHOLD,
        aggregate_duplicate_metrics,
        canonical_sample_schedule,
        evaluate_visual_failures,
        focal_footprint,
        measurement_spec,
        measurement_spec_hash,
        normalize_sample_offsets,
        scene_at,
    )


def percentile(np, values, q):
    return round(float(np.percentile(values, q)), 4)


def _round_optional(value, digits=4):
    return None if value is None else round(float(value), digits)


def _format_number(value, template):
    return "n/a" if value is None else format(float(value), template)


def resolve_ffprobe(explicit=None):
    if explicit:
        return str(explicit).strip()
    result = subprocess.run(
        [
            "node",
            "-e",
            "process.stdout.write(require('@ffprobe-installer/ffprobe').path)",
        ],
        capture_output=True,
        text=True,
    )
    path = result.stdout.strip()
    if result.returncode != 0 or not path:
        detail = result.stderr.strip()
        raise RuntimeError(f"cannot resolve ffprobe: {detail or 'empty installer path'}")
    return path


def probe_video_metadata(ffprobe, video):
    result = subprocess.run(
        [
            ffprobe,
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "format=duration:stream=avg_frame_rate",
            "-of",
            "json",
            str(video),
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {result.stderr.strip() or 'unknown error'}")
    try:
        payload = json.loads(result.stdout)
        duration = float(payload["format"]["duration"])
        rate = payload.get("streams", [{}])[0].get("avg_frame_rate", "0/1")
        numerator, denominator = (float(value) for value in str(rate).split("/", 1))
        fps = numerator / denominator if denominator else 0.0
    except (KeyError, TypeError, ValueError, ZeroDivisionError, json.JSONDecodeError) as error:
        raise RuntimeError("ffprobe returned malformed duration/frame-rate metadata") from error
    if not math.isfinite(duration) or duration <= 0:
        raise RuntimeError("ffprobe returned a non-positive or non-finite duration")
    if not math.isfinite(fps) or fps <= 0:
        raise RuntimeError("ffprobe returned a non-positive or non-finite frame rate")
    return duration, fps


# AAC frame priming/padding can make the MP4 container span one 1024-sample
# audio access unit past the exact video-frame duration. Keep this allowance
# deliberately bounded; it is muxing granularity, not a timing-drift budget.
AAC_ACCESS_UNIT_SECONDS = 1024.0 / 48000.0


def expected_duration_tolerance(fps):
    return max(0.005, 1.0 / fps + AAC_ACCESS_UNIT_SECONDS + 0.005)


def validate_expected_duration(expected, actual, fps):
    if not math.isfinite(expected) or expected <= 0:
        raise ValueError("--expected-duration-seconds must be finite and positive")
    tolerance = expected_duration_tolerance(fps)
    if abs(actual - expected) > tolerance:
        raise ValueError(
            "encoded duration does not match --expected-duration-seconds "
            f"(expected {expected:.6f}s, probed {actual:.6f}s, tolerance {tolerance:.6f}s)"
        )
    return tolerance


_SHOWINFO_CONFIG = re.compile(
    r"\[showinfo@source_(?P<phase>\d+)\s+@[^\]]*\]"
    r"\s+config in time_base:\s*(?P<numerator>\d+)/(?P<denominator>\d+)"
)
_SHOWINFO_FRAME = re.compile(
    r"\[showinfo@(?P<kind>source|sample)_(?P<phase>\d+)\s+@[^\]]*\]"
    r".*?\bn:\s*(?P<index>\d+)\s+pts:\s*(?P<pts>-?\d+)"
    r".*?\bpts_time:(?P<seconds>[^\s]+)\s+pos:\s*(?P<position>-?\d+)"
)


def _decoded_sample_timestamps(stderr, phase_counts):
    """Correlate fps outputs with the decoded frames they actually copied."""
    source_timestamps = [dict() for _ in phase_counts]
    sampled_positions = [dict() for _ in phase_counts]
    text = stderr.decode("utf-8", errors="replace")
    source_time_bases = {}
    for match in _SHOWINFO_CONFIG.finditer(text):
        phase_index = int(match.group("phase"))
        numerator = int(match.group("numerator"))
        denominator = int(match.group("denominator"))
        if 0 <= phase_index < len(phase_counts) and numerator > 0 and denominator > 0:
            source_time_bases[phase_index] = numerator / denominator
    for match in _SHOWINFO_FRAME.finditer(text):
        phase_index = int(match.group("phase"))
        if phase_index < 0 or phase_index >= len(phase_counts):
            continue
        frame_index = int(match.group("index"))
        position = int(match.group("position"))
        if match.group("kind") == "source":
            time_base = source_time_bases.get(phase_index)
            if time_base is None:
                raise RuntimeError(
                    f"phase {phase_index} lacks a decoded source time base"
                )
            seconds = int(match.group("pts")) * time_base
            if not math.isfinite(seconds) or seconds < 0:
                raise RuntimeError("ffmpeg reported an invalid decoded frame timestamp")
            previous = source_timestamps[phase_index].get(position)
            if previous is not None and not math.isclose(previous, seconds, abs_tol=1e-9):
                raise RuntimeError(
                    f"phase {phase_index} has ambiguous decoded packet positions"
                )
            source_timestamps[phase_index][position] = seconds
        else:
            if frame_index in sampled_positions[phase_index]:
                raise RuntimeError(f"phase {phase_index} repeated an extracted frame index")
            sampled_positions[phase_index][frame_index] = position

    decoded = {}
    for phase_index, count in enumerate(phase_counts):
        indices = sorted(sampled_positions[phase_index])
        if indices != list(range(count)):
            raise RuntimeError(
                f"phase {phase_index} did not report exactly {count} sampled frame timestamps"
            )
        phase_timestamps = []
        for frame_index in indices:
            position = sampled_positions[phase_index][frame_index]
            if position < 0 or position not in source_timestamps[phase_index]:
                raise RuntimeError(
                    f"phase {phase_index} sampled frame {frame_index} lacks a decoded source timestamp"
                )
            phase_timestamps.append(round(source_timestamps[phase_index][position], 9))
        decoded[phase_index] = phase_timestamps
    return decoded


def extract_samples(
    ffmpeg,
    video,
    tmp,
    schedule,
    offsets,
    step,
    duration,
    scale_width=320,
):
    """Extract a precomputed multiphase schedule in one bounded ffmpeg process.

    Each phase is a branch of one decoded stream. File sequence numbers prove
    phase order; the canonical schedule controls the final chronological merge.
    Named showinfo filters correlate each fps output's retained packet position
    with the source frame PTS before fps rewrites it. Any absent, extra, empty,
    misnumbered, or unattributable output fails closed.
    """
    phase_counts = [0 for _ in offsets]
    for item in schedule:
        phase_index = item["phaseIndex"]
        if phase_index < 0 or phase_index >= len(offsets):
            raise RuntimeError("sampling schedule contains an invalid phase index")
        if item["phaseOffsetSeconds"] != offsets[phase_index]:
            raise RuntimeError("sampling schedule phase metadata is inconsistent")
        if item["phaseSampleIndex"] != phase_counts[phase_index]:
            raise RuntimeError("sampling schedule phase order is inconsistent")
        phase_counts[phase_index] += 1
    if not schedule or any(count <= 0 for count in phase_counts):
        raise RuntimeError("sampling schedule has an empty phase")

    if len(offsets) == 1:
        inputs = ["[0:v]"]
        filters = []
    else:
        inputs = [f"[phase_in_{index}]" for index in range(len(offsets))]
        filters = [
            f"[0:v]split={len(offsets)}" + "".join(inputs)
        ]
    fps_expression = f"1/{step:.9f}"
    output_labels = []
    for index, (input_label, offset) in enumerate(zip(inputs, offsets)):
        output_label = f"[phase_out_{index}]"
        output_labels.append(output_label)
        filters.append(
            f"{input_label}trim=start={offset:.9f}:end={duration:.9f},"
            f"showinfo@source_{index},"
            "setpts=PTS-STARTPTS,"
            f"fps=fps={fps_expression}:round=near:eof_action=pass,"
            f"showinfo@sample_{index},"
            f"scale={int(scale_width)}:-2{output_label}"
        )

    command = [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "info",
        "-nostats",
        "-y",
        "-i",
        str(video),
        "-filter_complex",
        ";".join(filters),
    ]
    expected_paths = {}
    for phase_index, (label, count) in enumerate(zip(output_labels, phase_counts)):
        pattern = Path(tmp) / f"phase_{phase_index:02d}_%06d.jpg"
        command.extend([
            "-map",
            label,
            "-frames:v",
            str(count),
            "-vsync",
            "0",
            "-q:v",
            "4",
            "-start_number",
            "0",
            str(pattern),
        ])
        expected_paths[phase_index] = [
            Path(tmp) / f"phase_{phase_index:02d}_{index:06d}.jpg"
            for index in range(count)
        ]

    result = subprocess.run(command, capture_output=True)
    if result.returncode != 0:
        detail = result.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"bounded frame extraction failed: {detail or 'unknown ffmpeg error'}")

    for phase_index, expected in expected_paths.items():
        actual = sorted(Path(tmp).glob(f"phase_{phase_index:02d}_*.jpg"))
        if actual != expected:
            raise RuntimeError(
                f"phase {phase_index} produced {len(actual)} frames in an unexpected order; "
                f"expected exactly {len(expected)}"
            )
        for frame_path in actual:
            if not frame_path.is_file() or frame_path.stat().st_size == 0:
                raise RuntimeError(f"extracted frame is missing or empty: {frame_path.name}")

    decoded_timestamps = _decoded_sample_timestamps(result.stderr, phase_counts)
    samples = []
    for item in schedule:
        phase_index = item["phaseIndex"]
        phase_sample_index = item["phaseSampleIndex"]
        frame_path = expected_paths[phase_index][phase_sample_index]
        decoded_seconds = decoded_timestamps[phase_index][phase_sample_index]
        samples.append((decoded_seconds, item["seconds"], frame_path))
    if len(samples) != len(schedule):
        raise RuntimeError("chronological extraction merge is incomplete")
    return samples


def _selected_contact_indices(total, maximum=30):
    if total <= 0:
        return set()
    count = min(maximum, total)
    if count == 1:
        return {0}
    return {
        round(index * (total - 1) / (count - 1))
        for index in range(count)
    }


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True)
    parser.add_argument("--ffmpeg", required=True)
    parser.add_argument("--ffprobe")
    parser.add_argument("--timeline")
    parser.add_argument(
        "--quality-scope",
        help="chunk scope; report all samples but gate only core-owned frames/pairs",
    )
    parser.add_argument("--report", help="optional report path; defaults beside the video")
    parser.add_argument("--sample-seconds", type=float, default=5.0)
    parser.add_argument("--sample-offset", type=float)
    parser.add_argument("--sample-offsets", help="comma-separated phase offsets")
    parser.add_argument(
        "--expected-duration-seconds",
        type=float,
        help="requested render span; standalone audits probe it when omitted",
    )
    parser.add_argument("--timeline-offset-seconds", type=float, default=0.0)
    parser.add_argument("--subtitle-band-top", type=float)
    parser.add_argument("--config", default="config/reference-quality.json")
    parser.add_argument("--contact-sheet")
    parser.add_argument(
        "--record-video-path",
        help="published path to record while auditing a staged video",
    )
    parser.add_argument(
        "--record-contact-sheet",
        help="published contact-sheet path to record",
    )
    args = parser.parse_args()

    try:
        import numpy as np
        from PIL import Image, ImageFilter
    except ImportError as error:
        print(f"Visual audit cannot run: missing required dependency: {error}")
        return 2

    video = Path(args.video).resolve()
    if not video.is_file():
        print(f"Visual audit: video not found: {video}")
        return 2

    profile = {}
    if args.config and Path(args.config).is_file():
        try:
            profile = json.loads(Path(args.config).read_text(encoding="utf-8-sig")).get(
                "visualAudit", {}
            )
        except (OSError, json.JSONDecodeError) as error:
            print(f"Visual audit: malformed config: {error}")
            return 2

    try:
        ffprobe = resolve_ffprobe(args.ffprobe)
        probed_duration, probed_fps = probe_video_metadata(ffprobe, video)
        requested_duration = (
            probed_duration
            if args.expected_duration_seconds is None
            else float(args.expected_duration_seconds)
        )
        duration_tolerance = validate_expected_duration(
            requested_duration, probed_duration, probed_fps
        )
        default_offsets = profile.get("sampleOffsetsSeconds", [0.0])
        plural_offsets = (
            args.sample_offsets
            if args.sample_offsets is not None
            else default_offsets if args.sample_offset is None else None
        )
        offsets = normalize_sample_offsets(
            sample_offset=args.sample_offset,
            sample_offsets=plural_offsets,
            sample_seconds=args.sample_seconds,
            duration_seconds=requested_duration,
        )
        subtitle_band_top = float(
            args.subtitle_band_top
            if args.subtitle_band_top is not None
            else profile.get("subtitleBandTopRatio", 0.76)
        )
        if not math.isfinite(subtitle_band_top) or not 0 < subtitle_band_top <= 1:
            raise ValueError("--subtitle-band-top must be finite and fall in (0, 1]")
        if not math.isfinite(args.timeline_offset_seconds) or args.timeline_offset_seconds < 0:
            raise ValueError("--timeline-offset-seconds must be finite and non-negative")
        schedule = canonical_sample_schedule(
            offsets, args.sample_seconds, requested_duration
        )
        spec = measurement_spec(args.sample_seconds, offsets, subtitle_band_top)
        spec_hash = measurement_spec_hash(spec)
    except (RuntimeError, ValueError) as error:
        print(f"Visual audit: {error}")
        return 2

    timeline = None
    if args.timeline:
        timeline_path = Path(args.timeline)
        if not timeline_path.is_file():
            print(f"Visual audit: timeline not found: {timeline_path}")
            return 2
        try:
            timeline = json.loads(timeline_path.read_text(encoding="utf-8-sig"))
        except (OSError, json.JSONDecodeError) as error:
            print(f"Visual audit: malformed timeline: {error}")
            return 2

    core_scene_ids = None
    halo_before_ids = set()
    halo_after_ids = set()
    scope_kind = "global"
    scope_payload = None
    if args.quality_scope:
        scope_path = Path(args.quality_scope)
        if not scope_path.is_file() or timeline is None:
            print("Visual audit: --quality-scope requires readable scope and timeline files.")
            return 2
        try:
            scope_payload = json.loads(scope_path.read_text(encoding="utf-8-sig"))
        except (OSError, json.JSONDecodeError) as error:
            print(f"Visual audit: malformed quality scope: {error}")
            return 2
        list_keys = ("haloBeforeSceneIds", "coreSceneIds", "haloAfterSceneIds")
        if (
            scope_payload.get("kind") != "chunk"
            or any(
                not isinstance(scope_payload.get(key), list)
                or any(not isinstance(value, str) or not value for value in scope_payload[key])
                for key in list_keys
            )
        ):
            print("Visual audit: --quality-scope must declare valid chunk scene-id lists.")
            return 2
        expected_ids = sum((scope_payload[key] for key in list_keys), [])
        actual_ids = [scene.get("id") for scene in timeline.get("scenes", [])]
        if actual_ids != expected_ids or len(expected_ids) != len(set(expected_ids)):
            print("Visual audit: timeline does not exactly match the declared chunk scope.")
            return 2
        core_scene_ids = set(scope_payload["coreSceneIds"])
        halo_before_ids = set(scope_payload["haloBeforeSceneIds"])
        halo_after_ids = set(scope_payload["haloAfterSceneIds"])
        if not core_scene_ids:
            print("Visual audit: chunk scope has no core scenes.")
            return 2
        scope_kind = "chunk"

    scene_lookup = {
        scene.get("id"): scene for scene in (timeline or {}).get("scenes", [])
    }
    timeline_scene_ids = [
        scene.get("id") for scene in (timeline or {}).get("scenes", []) if scene.get("id")
    ]
    seam_expected = (
        bool(halo_before_ids) or len(core_scene_ids or ()) > 1
        if scope_kind == "chunk"
        else timeline is not None and len(timeline_scene_ids) > 1
    )

    thresholds = {
        "minimumSaturation": float(profile.get("minimumSaturation", 0.15)),
        "maximumSaturation": float(profile.get("maximumSaturation", 1.0)),
        "minimumNearWhiteMean": float(profile.get("minimumNearWhiteMean", 0.0)),
        "minimumWhiteDominantRatio": float(
            profile.get("minimumWhiteDominantRatio", 0.0)
        ),
        "minimumEdgeDensity": float(profile.get("minimumEdgeDensity", 0.16)),
        "maximumNearDuplicateRatio": float(
            profile.get("maximumNearDuplicateRatio", 0.22)
        ),
        "maximumWithinSceneNearDuplicateRatio": float(
            profile.get("maximumWithinSceneNearDuplicateRatio", 1.0)
        ),
        "maximumStaticRunSeconds": float(
            profile.get("maximumStaticRunSeconds", float("inf"))
        ),
        "maximumFlatFrameRatio": float(
            profile.get("maximumFlatFrameRatio", 0.50)
        ),
        "maximumBelowFocalTargetRatio": float(
            profile.get("maximumBelowFocalTargetRatio", 0.25)
        ),
    }

    with tempfile.TemporaryDirectory(prefix="cat-video-audit-") as tmp:
        try:
            samples = extract_samples(
                args.ffmpeg,
                video,
                tmp,
                schedule,
                offsets,
                args.sample_seconds,
                requested_duration,
            )
        except RuntimeError as error:
            print(f"Visual audit failed: {error}")
            return 2

        rows = []
        thumbs = []
        contact_indices = _selected_contact_indices(len(samples)) if args.contact_sheet else set()
        contact_frames = {}
        for sample_index, (seconds, scheduled_seconds, frame_path) in enumerate(samples):
            with Image.open(frame_path) as source:
                full = source.convert("RGB").resize((320, 180))
            if sample_index in contact_indices:
                contact_frames[sample_index] = full.copy()
            content_height = max(1, round(full.height * subtitle_band_top))
            image = full.crop((0, 0, full.width, content_height)).resize((160, 68))
            pixels = np.asarray(image).astype(np.float32)
            channel_max = pixels.max(axis=2)
            channel_min = pixels.min(axis=2)
            white = float(np.mean(np.all(pixels > 235, axis=2)))
            saturation = float(
                np.mean((channel_max - channel_min) / (channel_max + 1e-6))
            )
            edges = np.asarray(
                image.convert("L").filter(ImageFilter.FIND_EDGES)
            ).astype(np.float32)
            edge_density = float(np.mean(edges > 35))
            quantized = (pixels // 24).astype(np.uint8).reshape(-1, 3)
            _, color_counts = np.unique(quantized, axis=0, return_counts=True)
            dominant_color = float(color_counts.max() / len(quantized))
            flat = dominant_color > 0.55 or (
                edge_density < 0.10 and saturation < 0.12
            )
            scene_id = scene_at(timeline, seconds, args.timeline_offset_seconds)
            scene = scene_lookup.get(scene_id, {})
            target = scene.get("focalOccupancyTarget")
            occupancy = float(focal_footprint(np, pixels))
            if core_scene_ids is None:
                sample_role = "global"
            elif scene_id in core_scene_ids:
                sample_role = "core"
            elif scene_id in halo_before_ids:
                sample_role = "halo-before"
            elif scene_id in halo_after_ids:
                sample_role = "halo-after"
            else:
                sample_role = "unowned"
            row = {
                "seconds": seconds,
                "scheduledSeconds": scheduled_seconds,
                "sceneId": scene_id,
                "sampleRole": sample_role,
                "white": white,
                "saturation": saturation,
                "edges": edge_density,
                "dominantColor": dominant_color,
                "flat": flat,
                "focalOccupancy": round(occupancy, 4),
                "focalOccupancyTarget": target,
                "focalOccupancyDelta": (
                    round(occupancy - float(target), 4) if target is not None else None
                ),
            }
            rows.append(row)
            thumbs.append(
                np.asarray(image.convert("L").resize((32, 14))).astype(np.float32)
                / 255.0
            )

        differences = [
            float(np.mean(np.abs(left - right)))
            for left, right in zip(thumbs, thumbs[1:])
        ]
        try:
            duplicate_stats = aggregate_duplicate_metrics(
                rows,
                differences,
                NEAR_DUPLICATE_PIXEL_THRESHOLD,
                core_scene_ids,
                timeline_present=timeline is not None,
                nominal_interval_seconds=args.sample_seconds,
            )
        except ValueError as error:
            print(f"Visual audit failed: malformed temporal evidence: {error}")
            return 2

        gating_rows = [
            row
            for row in rows
            if core_scene_ids is None or row["sceneId"] in core_scene_ids
        ]
        # Empty evidence remains reportable and fails through the explicit policy;
        # use neutral placeholders only to keep report serialization total.
        saturation_values = [row["saturation"] for row in gating_rows]
        edge_values = [row["edges"] for row in gating_rows]

        def summary(values):
            if not values:
                return {"mean": None, "p10": None, "p50": None}
            return {
                "mean": round(float(np.mean(values)), 4),
                "p10": percentile(np, values, 10),
                "p50": percentile(np, values, 50),
            }

        structural_differences = [
            pair["difference"] for pair in duplicate_stats["duplicatePairs"]
        ]
        metrics = {
            "schemaVersion": 2,
            "measurementSpecVersion": MEASUREMENT_SPEC_VERSION,
            "measurementSpecHash": spec_hash,
            "measurementSpec": spec,
            "video": (
                str(Path(args.record_video_path).resolve())
                if args.record_video_path
                else str(video)
            ),
            "auditScope": {
                "kind": scope_kind,
                "chunkId": scope_payload.get("chunkId") if scope_payload else None,
                "coreSceneIds": sorted(core_scene_ids) if core_scene_ids is not None else None,
                "scalarOwnership": "core-only" if scope_kind == "chunk" else "all-samples",
                "temporalOwnership": "destination-core" if scope_kind == "chunk" else "all-destinations",
                "seamExpected": seam_expected,
            },
            "sampleSeconds": args.sample_seconds,
            "sampleOffsets": offsets,
            "sampleOffsetSeconds": offsets[0] if len(offsets) == 1 else None,
            "expectedDurationSeconds": requested_duration,
            "probedDurationSeconds": probed_duration,
            "durationSource": (
                "probed"
                if args.expected_duration_seconds is None
                else "caller-expected-and-probe-verified"
            ),
            "durationToleranceSeconds": duration_tolerance,
            "expectedSampleCount": len(schedule),
            "timelineOffsetSeconds": args.timeline_offset_seconds,
            "subtitleBandMaskedFrom": subtitle_band_top,
            "sampledFrames": len(rows),
            "gatingSampledFrames": len(gating_rows),
            "gatingCoreSceneIds": sorted(core_scene_ids) if core_scene_ids is not None else None,
            "nearWhiteMean": (
                round(float(np.mean([row["white"] for row in gating_rows])), 4)
                if gating_rows
                else None
            ),
            "whiteDominantRatio": (
                round(float(np.mean([row["white"] > 0.60 for row in gating_rows])), 4)
                if gating_rows
                else None
            ),
            "flatFrameRatio": (
                round(float(np.mean([row["flat"] for row in gating_rows])), 4)
                if gating_rows
                else None
            ),
            "saturation": summary(saturation_values),
            "edgeDensity": summary(edge_values),
            "nearDuplicateRatio": _round_optional(
                duplicate_stats["nearDuplicateRatio"]
            ),
            "edgeNearDuplicateRatio": _round_optional(
                duplicate_stats["edgeNearDuplicateRatio"]
            ),
            "withinSceneNearDuplicateRatio": _round_optional(
                duplicate_stats["withinSceneNearDuplicateRatio"]
            ),
            "withinSceneEdgeNearDuplicateRatio": _round_optional(
                duplicate_stats["withinSceneEdgeNearDuplicateRatio"]
            ),
            "seamNearDuplicateRatio": _round_optional(
                duplicate_stats["seamNearDuplicateRatio"]
            ),
            "seamEdgeNearDuplicateRatio": _round_optional(
                duplicate_stats["seamEdgeNearDuplicateRatio"]
            ),
            "crossSceneNearDuplicateRatio": _round_optional(
                duplicate_stats["crossSceneNearDuplicateRatio"]
            ),
            "ownedPairCount": duplicate_stats["ownedPairCount"],
            "withinScenePairCount": duplicate_stats["withinScenePairCount"],
            "withinSceneDuplicateCount": duplicate_stats[
                "withinSceneDuplicateCount"
            ],
            "withinScenePairCountsByScene": duplicate_stats[
                "withinScenePairCountsByScene"
            ],
            "seamPairCount": duplicate_stats["seamPairCount"],
            "seamDuplicateCount": duplicate_stats["seamDuplicateCount"],
            "crossScenePairCount": duplicate_stats["crossScenePairCount"],
            "crossSceneDuplicateCount": duplicate_stats["crossSceneDuplicateCount"],
            "longestNearDuplicateRunSeconds": round(
                duplicate_stats["longestNearDuplicateRunSeconds"], 4
            ),
            "longestWithinSceneNearDuplicateRunSeconds": round(
                duplicate_stats["longestWithinSceneNearDuplicateRunSeconds"], 4
            ),
            "structuralChangeMean": (
                round(float(np.mean(structural_differences)), 4)
                if structural_differences
                else None
            ),
            "samples": rows,
        }
        occupancy_rows = [
            row for row in gating_rows if row["focalOccupancyTarget"] is not None
        ]
        metrics["focalOccupancy"] = {
            "mean": (
                round(float(np.mean([row["focalOccupancy"] for row in gating_rows])), 4)
                if gating_rows
                else None
            ),
            "p10": (
                percentile(np, [row["focalOccupancy"] for row in gating_rows], 10)
                if gating_rows
                else None
            ),
            "declaredTargetSamples": len(occupancy_rows),
            "belowDeclaredTargetRatio": (
                round(
                    float(
                        np.mean(
                            [row["focalOccupancyDelta"] < 0 for row in occupancy_rows]
                        )
                    ),
                    4,
                )
                if occupancy_rows
                else None
            ),
        }

        by_scene = {}
        for row in gating_rows:
            key = row["sceneId"] or "unknown"
            bucket = by_scene.setdefault(
                key, {"samples": 0, "flat": 0, "edges": [], "saturation": []}
            )
            bucket["samples"] += 1
            bucket["flat"] += int(row["flat"])
            bucket["edges"].append(row["edges"])
            bucket["saturation"].append(row["saturation"])
        scene_metrics = [
            {
                "sceneId": scene_id,
                "samples": values["samples"],
                "flatRatio": round(values["flat"] / values["samples"], 4),
                "edgeDensityMean": round(float(np.mean(values["edges"])), 4),
                "saturationMean": round(float(np.mean(values["saturation"])), 4),
            }
            for scene_id, values in by_scene.items()
        ]
        metrics["worstFlatScenes"] = sorted(
            scene_metrics,
            key=lambda item: (-item["flatRatio"], item["edgeDensityMean"]),
        )[:20]
        metrics["lowDensityScenes"] = sorted(
            scene_metrics, key=lambda item: item["edgeDensityMean"]
        )[:20]

        register_buckets = {}
        for row in gating_rows:
            register = scene_lookup.get(row["sceneId"], {}).get(
                "visualRegister", "unknown"
            )
            register_buckets.setdefault(register, []).append(row)
        metrics["registerMetrics"] = {
            register: {
                "sceneCount": len(set(item["sceneId"] for item in items)),
                "sampleCount": len(items),
                "flatRatioMean": round(float(np.mean([item["flat"] for item in items])), 4),
                "edgeDensityMean": round(
                    float(np.mean([item["edges"] for item in items])), 4
                ),
                "saturationMean": round(
                    float(np.mean([item["saturation"] for item in items])), 4
                ),
            }
            for register, items in register_buckets.items()
        }
        grammar_buckets = {}
        for row in gating_rows:
            grammar = scene_lookup.get(row["sceneId"], {}).get(
                "visualGrammar", "unknown"
            )
            grammar_buckets.setdefault(grammar, []).append(row)
        metrics["grammarMetrics"] = {
            grammar: {
                "sceneCount": len(set(item["sceneId"] for item in items)),
                "sampleCount": len(items),
                "flatRatioMean": round(float(np.mean([item["flat"] for item in items])), 4),
                "edgeDensityMean": round(
                    float(np.mean([item["edges"] for item in items])), 4
                ),
                "saturationMean": round(
                    float(np.mean([item["saturation"] for item in items])), 4
                ),
            }
            for grammar, items in grammar_buckets.items()
        }
        metrics["temporalPairs"] = [
            {
                "fromSceneId": pair["left"]["sceneId"],
                "toSceneId": pair["right"]["sceneId"],
                "fromSeconds": pair["left"]["seconds"],
                "toSeconds": pair["right"]["seconds"],
                "deltaSeconds": round(pair["deltaSeconds"], 9),
                "pairKind": pair["kind"],
                "difference": round(pair["difference"], 6),
                "nearDuplicate": pair["duplicate"],
            }
            for pair in duplicate_stats["duplicatePairs"]
        ]
        metrics["duplicateScenePairs"] = [
            {
                "fromSceneId": pair["left"]["sceneId"],
                "toSceneId": pair["right"]["sceneId"],
                "fromSeconds": pair["left"]["seconds"],
                "toSeconds": pair["right"]["seconds"],
                "deltaSeconds": round(pair["deltaSeconds"], 9),
                "pairKind": pair["kind"],
                "difference": round(pair["difference"], 4),
            }
            for pair in duplicate_stats["duplicatePairs"]
            if pair["duplicate"]
        ][:50]

        if args.contact_sheet and contact_frames:
            from PIL import ImageDraw

            sheet = Image.new("RGB", (5 * 324 + 4, 6 * 204 + 4), "white")
            draw = ImageDraw.Draw(sheet)
            for slot, frame_index in enumerate(sorted(contact_frames)):
                x = 4 + (slot % 5) * 324
                y = 4 + (slot // 5) * 204
                sheet.paste(contact_frames[frame_index], (x, y))
                label = (
                    f"{rows[frame_index]['seconds']:.1f}s "
                    f"{rows[frame_index]['sceneId'] or ''}"
                )
                draw.text((x + 4, y + 183), label, fill="black")
            contact_path = Path(args.contact_sheet).resolve()
            contact_path.parent.mkdir(parents=True, exist_ok=True)
            sheet.save(contact_path, quality=88)
            metrics["contactSheet"] = (
                str(Path(args.record_contact_sheet).resolve())
                if args.record_contact_sheet
                else str(contact_path)
            )

    failures, applicability = evaluate_visual_failures(
        metrics,
        thresholds,
        scope_kind=scope_kind,
        timeline_present=timeline is not None,
        seam_expected=seam_expected,
    )
    metrics["gateApplicability"] = applicability
    metrics["minimumEvidence"] = spec["minimumEvidence"] | {
        "observedScalarFrames": metrics["gatingSampledFrames"],
        "observedOwnedTemporalPairs": metrics["ownedPairCount"],
        "observedWithinScenePairs": metrics["withinScenePairCount"],
        "observedSeamPairs": metrics["seamPairCount"],
        "sufficient": not any(failure.startswith("MISSING_") for failure in failures),
    }
    metrics["failures"] = failures
    metrics["passed"] = not failures
    report_path = (
        Path(args.report).resolve()
        if args.report
        else video.with_suffix(".visual-audit.json")
    )
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(
        json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print("\nVISUAL AUDIT (subtitle band excluded)")
    print(
        f"   Samples:             {metrics['gatingSampledFrames']} core / "
        f"{metrics['sampledFrames']} extracted"
    )
    print(
        "   Flat frames:         "
        + _format_number(
            None if metrics["flatFrameRatio"] is None else metrics["flatFrameRatio"] * 100,
            ".1f",
        )
        + ("" if metrics["flatFrameRatio"] is None else "%")
    )
    print(
        "   Mean saturation:     "
        + _format_number(metrics["saturation"]["mean"], ".3f")
    )
    print(
        "   Mean edge density:   "
        + _format_number(metrics["edgeDensity"]["mean"], ".3f")
    )
    duplicate_ratio = metrics["nearDuplicateRatio"]
    within_ratio = metrics["withinSceneNearDuplicateRatio"]
    seam_ratio = metrics["seamNearDuplicateRatio"]
    print(
        "   Near-duplicate:      "
        + ("n/a" if duplicate_ratio is None else f"{duplicate_ratio * 100:.1f}%")
    )
    print(
        "   Within-scene dup:    "
        + ("n/a" if within_ratio is None else f"{within_ratio * 100:.1f}%")
    )
    print(
        "   Seam duplicate:      "
        + ("n/a" if seam_ratio is None else f"{seam_ratio * 100:.1f}%")
    )
    static_run = (
        metrics["longestWithinSceneNearDuplicateRunSeconds"]
        if timeline
        else metrics["longestNearDuplicateRunSeconds"]
    )
    print(f"   Longest static run:  {static_run:.1f}s")
    print(f"   Measurement spec:    {metrics['measurementSpecHash']}")
    print(f"   Report:              {report_path}")
    for failure in failures:
        print(f"   FAIL {failure}")
    return 3 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
