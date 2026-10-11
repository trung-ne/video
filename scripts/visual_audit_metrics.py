"""Deterministic metric helpers shared by visual and reference audits."""

from __future__ import annotations

import hashlib
import json
import math


MEASUREMENT_SPEC_VERSION = "visual-audit-multiphase-v2"
TIMESTAMP_DECIMALS = 9
MAX_PHASE_BATCHES = 8
NEAR_DUPLICATE_PIXEL_THRESHOLD = 0.025
MINIMUM_SCALAR_FRAME_COUNT = 2
MINIMUM_TEMPORAL_PAIR_COUNT = 1


def _finite_number(value, label):
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{label} must be a number") from error
    if not math.isfinite(number):
        raise ValueError(f"{label} must be finite")
    return number


def _parse_offset_values(value, label):
    if value is None:
        return None
    if isinstance(value, str):
        tokens = value.split(",")
        if not tokens or any(not token.strip() for token in tokens):
            raise ValueError(f"{label} must be a non-empty comma-separated number list")
        values = [token.strip() for token in tokens]
    elif isinstance(value, (list, tuple, set)):
        values = list(value)
        if not values:
            raise ValueError(f"{label} must not be empty")
    else:
        values = [value]
    return values


def normalize_sample_offsets(
    sample_offset=None,
    sample_offsets=None,
    sample_seconds=5.0,
    duration_seconds=None,
    maximum_phases=MAX_PHASE_BATCHES,
):
    """Return one sorted, finite phase set for singular/plural CLI forms.

    The two forms are aliases, not additive inputs. Supplying both is accepted
    only when they describe exactly the same set, which prevents a default or
    stale singular value from silently changing a multiphase audit.
    """
    interval = _finite_number(sample_seconds, "sample interval")
    if interval <= 0:
        raise ValueError("sample interval must be positive")
    duration = None
    if duration_seconds is not None:
        duration = _finite_number(duration_seconds, "audit duration")
        if duration <= 0:
            raise ValueError("audit duration must be positive")

    def normalize(value, label):
        raw = _parse_offset_values(value, label)
        if raw is None:
            return None
        normalized = []
        for index, item in enumerate(raw):
            offset = _finite_number(item, f"{label}[{index}]")
            if offset < 0:
                raise ValueError(f"{label}[{index}] must not be negative")
            if offset >= interval:
                raise ValueError(
                    f"{label}[{index}] must be smaller than the {interval:g}s sample interval"
                )
            if duration is not None and offset >= duration:
                raise ValueError(f"{label}[{index}] must be smaller than the audit duration")
            rounded = round(offset, TIMESTAMP_DECIMALS)
            normalized.append(0.0 if rounded == 0 else rounded)
        result = sorted(set(normalized))
        if not result:
            raise ValueError(f"{label} must contain at least one offset")
        if len(result) > maximum_phases:
            raise ValueError(f"at most {maximum_phases} unique sample offsets are supported")
        return result

    singular = normalize(sample_offset, "--sample-offset")
    plural = normalize(sample_offsets, "--sample-offsets")
    if singular is not None and plural is not None and singular != plural:
        raise ValueError("--sample-offset and --sample-offsets conflict")
    return plural if plural is not None else singular if singular is not None else [0.0]


def canonical_sample_schedule(offsets, sample_seconds, duration_seconds):
    """Build the unique chronological timestamp schedule before extraction."""
    interval = _finite_number(sample_seconds, "sample interval")
    duration = _finite_number(duration_seconds, "audit duration")
    if interval <= 0 or duration <= 0:
        raise ValueError("sample interval and audit duration must be positive")
    phases = normalize_sample_offsets(
        sample_offsets=offsets,
        sample_seconds=interval,
        duration_seconds=duration,
    )
    schedule = []
    seen_timestamps = set()
    for phase_index, offset in enumerate(phases):
        # The strict timestamp < duration rule makes the expected frame count
        # independent of image2 EOF rounding.
        maximum_index = max(0, int(math.ceil((duration - offset) / interval)) + 1)
        phase_sample_index = 0
        for index in range(maximum_index):
            seconds = round(offset + index * interval, TIMESTAMP_DECIMALS)
            if seconds >= duration:
                break
            if seconds in seen_timestamps:
                raise ValueError(
                    "sample offsets collapse to a duplicate timestamp at canonical precision"
                )
            seen_timestamps.add(seconds)
            schedule.append({
                "seconds": seconds,
                "phaseOffsetSeconds": offset,
                "phaseIndex": phase_index,
                "phaseSampleIndex": phase_sample_index,
            })
            phase_sample_index += 1
    schedule.sort(key=lambda item: item["seconds"])
    if not schedule:
        raise ValueError("sampling schedule is empty")
    return schedule


def measurement_spec(sample_seconds, offsets, subtitle_band_top):
    """Versioned definition of the canonical pixel measurement."""
    interval = _finite_number(sample_seconds, "sample interval")
    band_top = _finite_number(subtitle_band_top, "subtitle band top")
    phases = normalize_sample_offsets(sample_offsets=offsets, sample_seconds=interval)
    if not 0 < band_top <= 1:
        raise ValueError("subtitle band top must fall in (0, 1]")
    return {
        "schemaVersion": 1,
        "metricVersion": MEASUREMENT_SPEC_VERSION,
        "sampling": {
            "intervalSeconds": interval,
            "phaseOffsetsSeconds": phases,
            "timestampRule": "offset + n*interval, with 0 <= timestamp < audited duration",
            "timestampPrecisionDecimals": TIMESTAMP_DECIMALS,
            "maximumPhaseBatches": MAX_PHASE_BATCHES,
            "frameSelection": "phase trim, zero-based PTS, fixed-rate nearest-frame sampling",
            "pairing": "chronological adjacent samples across all phases",
        },
        "contentMask": {
            "includedTopRatio": band_top,
            "excludedRegion": "subtitle band from includedTopRatio through frame bottom",
        },
        "frameMetrics": {
            "analysisSize": [160, 68],
            "contactSize": [320, 180],
            "scalarOwnership": "core frames only for chunk scope; all frames for global scope",
        },
        "temporalMetrics": {
            "thumbnailSize": [32, 14],
            "difference": "mean absolute normalized grayscale pixel difference",
            "nearDuplicatePixelThreshold": NEAR_DUPLICATE_PIXEL_THRESHOLD,
            "ratioNormalization": "mean duplicate incidence weighted by actual pair delta / nominal interval",
            "pairDelta": "actual destination timestamp minus source timestamp",
            "pairOwnership": "destination core scene for chunk scope",
            "seamClassification": "source and destination scene ids differ",
            "staticRunDuration": "sum actual edge deltas plus the initial sample span",
        },
        "scopeRules": {
            "global": {
                "distributionGates": True,
                "localDetailAndTemporalGates": True,
            },
            "chunk": {
                "distributionGates": False,
                "localDetailAndTemporalGates": True,
                "seamPairsReportedAndGatedSeparately": True,
                "lastCoreToNextHaloOwnedByNextChunk": True,
            },
        },
        "minimumEvidence": {
            "scalarCoreFrames": MINIMUM_SCALAR_FRAME_COUNT,
            "ownedTemporalPairs": MINIMUM_TEMPORAL_PAIR_COUNT,
            "sameScenePairsWhenTimelinePresent": MINIMUM_TEMPORAL_PAIR_COUNT,
            "seamPairsWhenExpected": MINIMUM_TEMPORAL_PAIR_COUNT,
        },
    }


def measurement_spec_hash(spec):
    canonical = json.dumps(spec, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def scene_at(timeline, video_seconds, timeline_offset_seconds=0.0):
    """Map a local video timestamp to its source timeline scene.

    Partial `--frames` renders start at a non-zero timeline frame but their
    encoded timestamps restart at zero. Keeping the offset explicit prevents
    slice audits from borrowing register and occupancy targets from scene 1.
    """
    if not timeline:
        return None
    timeline_seconds = video_seconds + timeline_offset_seconds
    frame = timeline_seconds * timeline.get("fps", 30)
    for scene in timeline.get("scenes", []):
        start = scene.get("startFrame", 0)
        if start <= frame < start + scene.get("durationFrames", 0):
            return scene.get("id")
    return None


def focal_footprint(np, pixels):
    """Longest-side footprint of the largest painted component."""
    quantized = (pixels // 24).astype(np.uint8).reshape(-1, 3)
    colors, counts = np.unique(quantized, axis=0, return_counts=True)
    background = colors[counts.argmax()].astype(np.float32) * 24 + 12
    color_distance = np.linalg.norm(pixels - background, axis=2)
    mask = color_distance > 42
    height, width = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    best_size = 0
    best_footprint = 0.0
    minimum_component = max(4, round(width * height * 0.0015))
    for y in range(height):
        for x in range(width):
            if not mask[y, x] or seen[y, x]:
                continue
            stack = [(y, x)]
            seen[y, x] = True
            size = 0
            min_y = max_y = y
            min_x = max_x = x
            while stack:
                cy, cx = stack.pop()
                size += 1
                min_y, max_y = min(min_y, cy), max(max_y, cy)
                min_x, max_x = min(min_x, cx), max(max_x, cx)
                for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
                    if 0 <= ny < height and 0 <= nx < width and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
            if size >= minimum_component and size > best_size:
                best_size = size
                best_footprint = max(
                    (max_x - min_x + 1) / width,
                    (max_y - min_y + 1) / height,
                )
    return best_footprint


def _ratio(flags):
    return sum(flags) / len(flags) if flags else None


def _longest_duplicate_run(pairs, pair_kind=None):
    longest = 0.0
    current = 0.0
    previous = None
    for pair in pairs:
        eligible = pair["duplicate"] and (pair_kind is None or pair["kind"] == pair_kind)
        same_sequence = (
            previous is not None
            and pair["sourcePairIndex"] == previous["sourcePairIndex"] + 1
            and math.isclose(
                pair["left"]["seconds"], previous["right"]["seconds"], abs_tol=1e-9
            )
        )
        same_within_scene = (
            pair_kind != "within-scene"
            or previous is None
            or pair["destinationSceneId"] == previous["destinationSceneId"]
        )
        if eligible:
            if same_sequence and same_within_scene:
                current += pair["deltaSeconds"]
            else:
                # An edge covers its destination span and the initial sample's
                # equally-sized span. Without this, three unchanged 5s samples
                # are incorrectly described as only a 10s static sequence.
                current = pair["deltaSeconds"] * 2
            longest = max(longest, current)
            previous = pair
        else:
            current = 0.0
            previous = None
    return longest


def aggregate_duplicate_metrics(
    rows,
    differences,
    threshold=NEAR_DUPLICATE_PIXEL_THRESHOLD,
    owner_scene_ids=None,
    timeline_present=None,
    nominal_interval_seconds=None,
):
    """Aggregate one chronological temporal pair stream.

    Every owned pair is attributed to its destination scene. In chunk scope this
    includes previous-halo→core seams and excludes last-core→next-halo edges.
    """
    if len(differences) != max(0, len(rows) - 1):
        raise ValueError("temporal difference count does not match the sample sequence")
    threshold_value = _finite_number(threshold, "near-duplicate threshold")
    if threshold_value < 0:
        raise ValueError("near-duplicate threshold must not be negative")
    owner_ids = None if owner_scene_ids is None else set(owner_scene_ids)
    has_timeline = (
        any(row.get("sceneId") is not None for row in rows)
        if timeline_present is None
        else bool(timeline_present)
    )

    timestamps = []
    for index, row in enumerate(rows):
        seconds = _finite_number(row.get("seconds"), f"sample[{index}].seconds")
        if seconds < 0:
            raise ValueError(f"sample[{index}].seconds must not be negative")
        if timestamps and seconds <= timestamps[-1]:
            raise ValueError("sample timestamps must be finite, unique, and strictly increasing")
        timestamps.append(seconds)

    pairs = []
    for index, (left, right, raw_difference) in enumerate(zip(rows, rows[1:], differences)):
        difference = _finite_number(raw_difference, f"difference[{index}]")
        if difference < 0:
            raise ValueError(f"difference[{index}] must not be negative")
        destination_scene_id = right.get("sceneId")
        if owner_ids is not None and destination_scene_id not in owner_ids:
            continue
        delta = round(timestamps[index + 1] - timestamps[index], TIMESTAMP_DECIMALS)
        if not math.isfinite(delta) or delta <= 0:
            raise ValueError("temporal pair delta must be finite and positive")
        if not has_timeline:
            kind = "unscoped"
        elif left.get("sceneId") is not None and left.get("sceneId") == destination_scene_id:
            kind = "within-scene"
        else:
            kind = "seam"
        pairs.append({
            "left": left,
            "right": right,
            "sourcePairIndex": index,
            "destinationSceneId": destination_scene_id,
            "deltaSeconds": delta,
            "difference": difference,
            "duplicate": difference < threshold_value,
            "kind": kind,
            "within": kind == "within-scene",
        })

    duplicate_flags = [pair["duplicate"] for pair in pairs]
    within_pairs = [pair for pair in pairs if pair["kind"] == "within-scene"]
    seam_pairs = [pair for pair in pairs if pair["kind"] == "seam"]
    unscoped_pairs = [pair for pair in pairs if pair["kind"] == "unscoped"]
    within_duplicates = [pair["duplicate"] for pair in within_pairs]
    seam_duplicates = [pair["duplicate"] for pair in seam_pairs]
    if nominal_interval_seconds is None:
        nominal_interval = max((pair["deltaSeconds"] for pair in pairs), default=1.0)
    else:
        nominal_interval = _finite_number(
            nominal_interval_seconds, "nominal sample interval"
        )
        if nominal_interval <= 0:
            raise ValueError("nominal sample interval must be positive")

    def normalized_duplicate_ratio(items):
        if not items:
            return None
        return sum(
            min(pair["deltaSeconds"] / nominal_interval, 1.0)
            for pair in items
            if pair["duplicate"]
        ) / len(items)

    per_scene_counts = {}
    for pair in within_pairs:
        key = pair["destinationSceneId"]
        per_scene_counts[key] = per_scene_counts.get(key, 0) + 1

    return {
        "duplicateFlags": duplicate_flags,
        "duplicatePairs": pairs,
        "nearDuplicateRatio": normalized_duplicate_ratio(pairs),
        "withinSceneNearDuplicateRatio": normalized_duplicate_ratio(within_pairs),
        "seamNearDuplicateRatio": normalized_duplicate_ratio(seam_pairs),
        "edgeNearDuplicateRatio": _ratio(duplicate_flags),
        "withinSceneEdgeNearDuplicateRatio": _ratio(within_duplicates),
        "seamEdgeNearDuplicateRatio": _ratio(seam_duplicates),
        # Compatibility aliases retain old report readers without maintaining a
        # second implementation of the arithmetic.
        "crossSceneNearDuplicateRatio": normalized_duplicate_ratio(seam_pairs),
        "ownedPairCount": len(pairs),
        "withinScenePairCount": len(within_pairs),
        "withinSceneDuplicateCount": sum(within_duplicates),
        "seamPairCount": len(seam_pairs),
        "seamDuplicateCount": sum(seam_duplicates),
        "crossScenePairCount": len(seam_pairs),
        "crossSceneDuplicateCount": sum(seam_duplicates),
        "unscopedPairCount": len(unscoped_pairs),
        "withinScenePairCountsByScene": per_scene_counts,
        "longestNearDuplicateRunSeconds": _longest_duplicate_run(pairs),
        "longestWithinSceneNearDuplicateRunSeconds": _longest_duplicate_run(
            pairs, "within-scene"
        ),
    }


def duplicate_metrics(rows, differences, threshold, sample_seconds):
    """Compatibility wrapper over the authoritative chronological aggregator."""
    interval = _finite_number(sample_seconds, "sample interval")
    normalized_rows = []
    for index, row in enumerate(rows):
        normalized = dict(row)
        normalized.setdefault("seconds", index * interval)
        normalized_rows.append(normalized)
    return aggregate_duplicate_metrics(
        normalized_rows,
        differences,
        threshold,
        timeline_present=any(row.get("sceneId") is not None for row in normalized_rows),
        nominal_interval_seconds=interval,
    )


def gate_applicability(scope_kind, timeline_present, seam_expected, seam_pair_count=0):
    """Declare which unchanged thresholds apply to global and chunk evidence."""
    is_chunk = scope_kind == "chunk"

    def entry(applies, category, reason=None):
        result = {"applies": bool(applies), "category": category}
        if reason:
            result["reason"] = reason
        return result

    distribution_reason = "global distribution quota; reported but not gated per chunk"
    return {
        "saturation": entry(not is_chunk, "distribution", distribution_reason if is_chunk else None),
        "nearWhiteMean": entry(not is_chunk, "distribution", distribution_reason if is_chunk else None),
        "whiteDominantRatio": entry(not is_chunk, "distribution", distribution_reason if is_chunk else None),
        "flatFrameRatio": entry(not is_chunk, "distribution", distribution_reason if is_chunk else None),
        "nearDuplicateRatio": entry(not is_chunk, "distribution", distribution_reason if is_chunk else None),
        "edgeDensity": entry(True, "local-frame-detail"),
        "focalOccupancy": entry(True, "local-frame-detail"),
        "withinSceneNearDuplicateRatio": entry(
            bool(timeline_present),
            "within-scene-temporal",
            None if timeline_present else "no timeline scene attribution",
        ),
        "longestStaticRun": entry(
            bool(timeline_present),
            "within-scene-temporal",
            None if timeline_present else "requires timeline scene attribution",
        ),
        "seamNearDuplicateRatio": entry(
            bool(timeline_present and (seam_expected or seam_pair_count > 0)),
            "seam-temporal",
            None if timeline_present and (seam_expected or seam_pair_count > 0)
            else "no destination-owned seam is expected",
        ),
        "minimumEvidence": entry(True, "evidence-integrity"),
    }


def evaluate_visual_failures(
    metrics,
    thresholds,
    scope_kind="global",
    timeline_present=False,
    seam_expected=False,
):
    """Apply unchanged thresholds according to explicit runtime scope."""
    failures = []

    def evidence_count(name):
        value = metrics.get(name, 0)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            failures.append(f"MALFORMED_TEMPORAL_EVIDENCE: {name} is not numeric")
            return 0
        if not math.isfinite(float(value)) or value < 0 or int(value) != value:
            failures.append(f"MALFORMED_TEMPORAL_EVIDENCE: {name} is not a non-negative integer")
            return 0
        return int(value)

    sampled = evidence_count("gatingSampledFrames")
    owned_pairs = evidence_count("ownedPairCount")
    within_pairs = evidence_count("withinScenePairCount")
    seam_pairs = evidence_count("seamPairCount")
    applicability = gate_applicability(
        scope_kind,
        timeline_present,
        seam_expected,
        seam_pairs,
    )
    if sampled < MINIMUM_SCALAR_FRAME_COUNT:
        failures.append(
            "MISSING_SCALAR_EVIDENCE: gating scope has fewer than "
            f"{MINIMUM_SCALAR_FRAME_COUNT} sampled frames"
        )
    if owned_pairs < MINIMUM_TEMPORAL_PAIR_COUNT:
        failures.append("MISSING_TEMPORAL_EVIDENCE: gating scope has no destination-owned pair")
    if timeline_present and within_pairs < MINIMUM_TEMPORAL_PAIR_COUNT:
        failures.append(
            "MISSING_WITHIN_SCENE_TEMPORAL_EVIDENCE: gating scope has no genuine same-scene pair"
        )
    if seam_expected and seam_pairs < MINIMUM_TEMPORAL_PAIR_COUNT:
        failures.append(
            "MISSING_SEAM_TEMPORAL_EVIDENCE: expected destination-owned seam pair is absent"
        )

    def applies(name):
        return applicability[name]["applies"]

    def metric_number(value, label, required=True):
        if not required:
            return None
        if isinstance(value, bool):
            failures.append(f"MALFORMED_METRIC_EVIDENCE: {label} is not finite")
            return None
        try:
            number = float(value)
        except (TypeError, ValueError):
            failures.append(f"MALFORMED_METRIC_EVIDENCE: {label} is not finite")
            return None
        if not math.isfinite(number):
            failures.append(f"MALFORMED_METRIC_EVIDENCE: {label} is not finite")
            return None
        return number

    saturation = metric_number(
        metrics.get("saturation", {}).get("mean"),
        "saturation.mean",
        applies("saturation") and sampled > 0,
    )
    if saturation is not None:
        if saturation < thresholds["minimumSaturation"]:
            failures.append(
                f"LOW_COLOUR_REGISTER: content saturation mean <{thresholds['minimumSaturation']}"
            )
        if saturation > thresholds["maximumSaturation"]:
            failures.append(
                f"OVER_SATURATED: content saturation mean >{thresholds['maximumSaturation']}"
            )
    near_white = metric_number(
        metrics.get("nearWhiteMean"),
        "nearWhiteMean",
        applies("nearWhiteMean") and sampled > 0,
    )
    if near_white is not None and near_white < thresholds["minimumNearWhiteMean"]:
        failures.append(
            f"WHITE_REGISTER_SHORTAGE: near-white content mean <{thresholds['minimumNearWhiteMean']}"
        )
    white_dominant = metric_number(
        metrics.get("whiteDominantRatio"),
        "whiteDominantRatio",
        applies("whiteDominantRatio") and sampled > 0,
    )
    if (
        white_dominant is not None
        and white_dominant < thresholds["minimumWhiteDominantRatio"]
    ):
        failures.append(
            "WHITE_DOMINANT_SHORTAGE: white-dominant frame ratio "
            f"<{thresholds['minimumWhiteDominantRatio']}"
        )
    edge_density = metric_number(
        metrics.get("edgeDensity", {}).get("mean"),
        "edgeDensity.mean",
        applies("edgeDensity") and sampled > 0,
    )
    if edge_density is not None and edge_density < thresholds["minimumEdgeDensity"]:
        failures.append(
            f"LOW_VISUAL_DENSITY: content edge density mean <{thresholds['minimumEdgeDensity']}"
        )
    overall_duplicate = metric_number(
        metrics.get("nearDuplicateRatio"),
        "nearDuplicateRatio",
        applies("nearDuplicateRatio") and owned_pairs > 0,
    )
    if (
        overall_duplicate is not None
        and overall_duplicate > thresholds["maximumNearDuplicateRatio"]
    ):
        failures.append(
            "FRAME_SIMILARITY: adjacent near-duplicate ratio "
            f">{thresholds['maximumNearDuplicateRatio']:.0%}"
        )
    within_duplicate = metric_number(
        metrics.get("withinSceneNearDuplicateRatio"),
        "withinSceneNearDuplicateRatio",
        applies("withinSceneNearDuplicateRatio") and within_pairs > 0,
    )
    if (
        within_duplicate is not None
        and within_duplicate > thresholds["maximumWithinSceneNearDuplicateRatio"]
    ):
        failures.append(
            "WITHIN_SCENE_SIMILARITY: same-scene near-duplicate ratio "
            f">{thresholds['maximumWithinSceneNearDuplicateRatio']:.0%}"
        )
    seam_duplicate = metric_number(
        metrics.get("seamNearDuplicateRatio"),
        "seamNearDuplicateRatio",
        applies("seamNearDuplicateRatio") and seam_pairs > 0,
    )
    if (
        seam_duplicate is not None
        and seam_duplicate > thresholds["maximumNearDuplicateRatio"]
    ):
        failures.append(
            "SEAM_FRAME_SIMILARITY: destination-owned seam near-duplicate ratio "
            f">{thresholds['maximumNearDuplicateRatio']:.0%}"
        )
    static_run_key = (
        "longestWithinSceneNearDuplicateRunSeconds"
        if timeline_present
        else "longestNearDuplicateRunSeconds"
    )
    static_run = metric_number(
        metrics.get(static_run_key),
        static_run_key,
        applies("longestStaticRun") and owned_pairs > 0,
    )
    if static_run is not None and static_run > thresholds["maximumStaticRunSeconds"]:
        failures.append(
            "STATIC_SCENE_RUN: longest applicable near-duplicate run "
            f">{thresholds['maximumStaticRunSeconds']:.1f}s"
        )
    flat_ratio = metric_number(
        metrics.get("flatFrameRatio"),
        "flatFrameRatio",
        applies("flatFrameRatio") and sampled > 0,
    )
    if flat_ratio is not None and flat_ratio > thresholds["maximumFlatFrameRatio"]:
        failures.append(
            f"FLAT_REGISTER: sampled content flat ratio >{thresholds['maximumFlatFrameRatio']:.0%}"
        )
    below_focal = metrics.get("focalOccupancy", {}).get("belowDeclaredTargetRatio")
    focal_ratio = metric_number(
        below_focal,
        "focalOccupancy.belowDeclaredTargetRatio",
        applies("focalOccupancy") and below_focal is not None,
    )
    if (
        focal_ratio is not None
        and focal_ratio > thresholds["maximumBelowFocalTargetRatio"]
    ):
        failures.append(
            "FOCAL_OCCUPANCY: samples below declared focal target "
            f">{thresholds['maximumBelowFocalTargetRatio']:.0%}"
        )
    return failures, applicability
