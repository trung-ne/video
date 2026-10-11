import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts.visual_audit_metrics import (
    aggregate_duplicate_metrics,
    canonical_sample_schedule,
    duplicate_metrics,
    evaluate_visual_failures,
    focal_footprint,
    measurement_spec,
    measurement_spec_hash,
    normalize_sample_offsets,
    scene_at,
)


ROOT = Path(__file__).resolve().parents[1]


def load_hyphenated_script(filename, module_name):
    spec = importlib.util.spec_from_file_location(module_name, ROOT / "scripts" / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def thresholds():
    return {
        "minimumSaturation": 0.15,
        "maximumSaturation": 0.205,
        "minimumNearWhiteMean": 0.28,
        "minimumWhiteDominantRatio": 0.28,
        "minimumEdgeDensity": 0.16,
        "maximumNearDuplicateRatio": 0.22,
        "maximumWithinSceneNearDuplicateRatio": 0.15,
        "maximumStaticRunSeconds": 10.0,
        "maximumFlatFrameRatio": 0.50,
        "maximumBelowFocalTargetRatio": 0.25,
    }


def report_metrics(duplicate_stats, gating_frames=2, **overrides):
    metrics = {
        "gatingSampledFrames": gating_frames,
        "nearWhiteMean": 0.4,
        "whiteDominantRatio": 0.4,
        "flatFrameRatio": 0.4,
        "saturation": {"mean": 0.18},
        "edgeDensity": {"mean": 0.2},
        "focalOccupancy": {"belowDeclaredTargetRatio": 0.0},
        **duplicate_stats,
    }
    metrics.update(overrides)
    return metrics


def showinfo_log(phase_timestamps):
    lines = []
    for phase_index, timestamps in enumerate(phase_timestamps):
        lines.append(
            f"[showinfo@source_{phase_index} @ fixture] config in time_base: 1/10, frame_rate: 10/1"
        )
        for frame_index, seconds in enumerate(timestamps):
            position = 1000 + phase_index * 100 + frame_index
            source_pts = round(seconds * 10)
            lines.append(
                f"[showinfo@source_{phase_index} @ fixture] n: {frame_index} pts: {source_pts} "
                f"pts_time:{seconds} pos: {position} checksum:00000000"
            )
            lines.append(
                f"[showinfo@sample_{phase_index} @ fixture] n: {frame_index} pts: {frame_index} "
                f"pts_time:{frame_index * 5} pos: {position} checksum:00000000"
            )
    return "\n".join(lines).encode("utf-8")


class SamplingTests(unittest.TestCase):
    def test_offsets_are_one_authoritative_finite_set(self):
        self.assertEqual(
            normalize_sample_offsets(
                sample_offsets="2.5,0,2.500000000", sample_seconds=5, duration_seconds=20
            ),
            [0.0, 2.5],
        )
        self.assertEqual(
            normalize_sample_offsets(
                sample_offset=2.5,
                sample_offsets="2.5",
                sample_seconds=5,
                duration_seconds=20,
            ),
            [2.5],
        )
        for malformed in ("nan", "inf", "-1", "0,,2.5", "5"):
            with self.subTest(malformed=malformed):
                with self.assertRaises(ValueError):
                    normalize_sample_offsets(
                        sample_offsets=malformed,
                        sample_seconds=5,
                        duration_seconds=20,
                    )
        with self.assertRaisesRegex(ValueError, "conflict"):
            normalize_sample_offsets(
                sample_offset=0,
                sample_offsets="0,2.5",
                sample_seconds=5,
                duration_seconds=20,
            )

    def test_schedule_is_unique_and_chronological(self):
        schedule = canonical_sample_schedule([0, 2.5], 5, 11)
        self.assertEqual(
            [item["seconds"] for item in schedule],
            [0.0, 2.5, 5.0, 7.5, 10.0],
        )
        self.assertEqual(len(schedule), len(set(item["seconds"] for item in schedule)))

    def test_measurement_spec_hash_is_deterministic_and_mask_bound(self):
        first = measurement_spec(5, [0, 2.5], 0.76)
        second = measurement_spec(5.0, [2.5, 0], 0.76)
        self.assertEqual(measurement_spec_hash(first), measurement_spec_hash(second))
        self.assertNotEqual(
            measurement_spec_hash(first),
            measurement_spec_hash(measurement_spec(5, [0, 2.5], 0.75)),
        )

    def test_duration_tolerance_includes_one_bounded_aac_access_unit(self):
        audit = load_hyphenated_script("visual-audit.py", "visual_audit_duration_tolerance")
        expected = 161.83333333333334
        self.assertAlmostEqual(
            audit.expected_duration_tolerance(30),
            1 / 30 + 1024 / 48000 + 0.005,
        )
        self.assertAlmostEqual(
            audit.validate_expected_duration(expected, 161.877, 30),
            audit.expected_duration_tolerance(30),
        )
        with self.assertRaisesRegex(ValueError, "encoded duration"):
            audit.validate_expected_duration(expected, 161.90, 30)

        audit = load_hyphenated_script("visual-audit.py", "visual_audit_for_extract_test")
        schedule = canonical_sample_schedule([0, 2.5], 5, 10)
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            for phase in range(2):
                for index in range(2):
                    (root / f"phase_{phase:02d}_{index:06d}.jpg").write_bytes(b"jpeg")
            with mock.patch.object(
                audit.subprocess,
                "run",
                return_value=subprocess.CompletedProcess(
                    [],
                    0,
                    stdout=b"",
                    stderr=showinfo_log([[0.1, 5.1], [2.6, 7.6]]),
                ),
            ) as run:
                samples = audit.extract_samples(
                    "ffmpeg", "video.mp4", root, schedule, [0.0, 2.5], 5, 10
                )
            self.assertEqual(run.call_count, 1)
            self.assertEqual(
                [(actual, planned) for actual, planned, _ in samples],
                [(0.1, 0.0), (2.6, 2.5), (5.1, 5.0), (7.6, 7.5)],
            )
            command = run.call_args.args[0]
            filters = command[command.index("-filter_complex") + 1]
            self.assertIn("split=2", filters)
            self.assertIn("showinfo@source_0", filters)
            self.assertIn("showinfo@sample_1", filters)

    def test_extraction_fails_closed_on_missing_phase_frame(self):
        audit = load_hyphenated_script("visual-audit.py", "visual_audit_for_missing_test")
        schedule = canonical_sample_schedule([0, 2.5], 5, 10)
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            for name in (
                "phase_00_000000.jpg",
                "phase_00_000001.jpg",
                "phase_01_000000.jpg",
            ):
                (root / name).write_bytes(b"jpeg")
            with mock.patch.object(
                audit.subprocess,
                "run",
                return_value=subprocess.CompletedProcess([], 0, stdout=b"", stderr=b""),
            ):
                with self.assertRaisesRegex(RuntimeError, "unexpected order"):
                    audit.extract_samples(
                        "ffmpeg", "video.mp4", root, schedule, [0.0, 2.5], 5, 10
                    )
    def test_hard_cut_ownership_uses_decoded_pts_not_phase_schedule(self):
        audit = load_hyphenated_script("visual-audit.py", "visual_audit_pts_regression")
        resolved = subprocess.run(
            [
                "node",
                "-e",
                "process.stdout.write(require('@ffmpeg-installer/ffmpeg').path)",
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        if resolved.returncode != 0 or not resolved.stdout.strip():
            self.skipTest("bundled ffmpeg is unavailable")
        ffmpeg = resolved.stdout.strip()

        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            video = root / "hard-cut.mp4"
            generated = subprocess.run(
                [
                    ffmpeg,
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=blue:s=64x64:r=10:d=0.5",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=red:s=64x64:r=10:d=0.5",
                    "-filter_complex",
                    "[0:v][1:v]concat=n=2:v=1:a=0[out]",
                    "-map",
                    "[out]",
                    "-c:v",
                    "libx264",
                    "-g",
                    "1",
                    "-pix_fmt",
                    "yuv420p",
                    str(video),
                ],
                capture_output=True,
            )
            self.assertEqual(generated.returncode, 0, generated.stderr.decode(errors="replace"))

            schedule = canonical_sample_schedule([0.2], 1, 1)
            samples = audit.extract_samples(
                ffmpeg, video, root, schedule, [0.2], 1, 1, scale_width=64
            )
            self.assertEqual(len(samples), 1)
            decoded_seconds, scheduled_seconds, _ = samples[0]
            self.assertEqual(scheduled_seconds, 0.2)
            self.assertGreaterEqual(decoded_seconds, 0.5)
            timeline = {
                "fps": 10,
                "scenes": [
                    {"id": "blue", "startFrame": 0, "durationFrames": 5},
                    {"id": "red", "startFrame": 5, "durationFrames": 5},
                ],
            }
            self.assertEqual(scene_at(timeline, scheduled_seconds), "blue")
            self.assertEqual(scene_at(timeline, decoded_seconds), "red")


class DuplicateMetricsTests(unittest.TestCase):
    def test_partial_render_offset_maps_to_source_timeline_scene(self):
        timeline = {
            "fps": 30,
            "scenes": [
                {"id": "early", "startFrame": 0, "durationFrames": 300},
                {"id": "slice", "startFrame": 900, "durationFrames": 300},
            ],
        }
        self.assertEqual(scene_at(timeline, 0, 30), "slice")
        self.assertEqual(scene_at(timeline, 5, 30), "slice")
        self.assertEqual(scene_at(timeline, 0), "early")

    def test_focal_footprint_measures_extent_not_ink_count(self):
        import numpy as np

        uniform = np.full((68, 160, 3), 255, dtype=np.float32)
        self.assertEqual(focal_footprint(np, uniform), 0)

        box = uniform.copy()
        box[14:54, 40:120] = (40, 80, 120)
        self.assertAlmostEqual(focal_footprint(np, box), 40 / 68)

    def test_multiphase_chronology_detects_alternating_ab_changes(self):
        rows = [
            {"seconds": 0.0, "sceneId": "scene"},
            {"seconds": 2.5, "sceneId": "scene"},
            {"seconds": 5.0, "sceneId": "scene"},
            {"seconds": 7.5, "sceneId": "scene"},
        ]
        # A, B, A, B: same-phase 5s comparisons would be duplicates, but the
        # canonical chronological edges correctly observe every 2.5s change.
        metrics = aggregate_duplicate_metrics(rows, [0.2, 0.2, 0.2], timeline_present=True)
        self.assertEqual(metrics["nearDuplicateRatio"], 0)
        self.assertEqual(metrics["withinSceneNearDuplicateRatio"], 0)
        self.assertEqual(
            [pair["deltaSeconds"] for pair in metrics["duplicatePairs"]],
            [2.5, 2.5, 2.5],
        )

    def test_static_run_includes_initial_sample_span(self):
        rows = [
            {"seconds": 0.0, "sceneId": "a"},
            {"seconds": 5.0, "sceneId": "a"},
            {"seconds": 10.0, "sceneId": "a"},
        ]
        metrics = aggregate_duplicate_metrics(rows, [0.01, 0.01], timeline_present=True)
        self.assertEqual(metrics["longestNearDuplicateRunSeconds"], 15)
        self.assertEqual(metrics["longestWithinSceneNearDuplicateRunSeconds"], 15)

    def test_actual_timestamp_delta_is_carried_not_nominal_interval(self):
        rows = [
            {"seconds": 0.0, "sceneId": None},
            {"seconds": 1.7, "sceneId": None},
            {"seconds": 3.3, "sceneId": None},
        ]
        metrics = aggregate_duplicate_metrics(rows, [0.2, 0.2], timeline_present=False)
        self.assertEqual(
            [pair["deltaSeconds"] for pair in metrics["duplicatePairs"]],
            [1.7, 1.6],
        )
        self.assertNotIn(5, [pair["deltaSeconds"] for pair in metrics["duplicatePairs"]])

        duplicate = aggregate_duplicate_metrics(
            rows[:2],
            [0.01],
            timeline_present=False,
            nominal_interval_seconds=5,
        )
        self.assertEqual(duplicate["duplicatePairs"][0]["deltaSeconds"], 1.7)
        self.assertAlmostEqual(duplicate["nearDuplicateRatio"], 1.7 / 5)

    def test_cross_scene_edge_never_inflates_within_scene_metric(self):
        rows = [
            {"seconds": 0.0, "sceneId": "a"},
            {"seconds": 2.5, "sceneId": "a"},
            {"seconds": 5.0, "sceneId": "b"},
            {"seconds": 7.5, "sceneId": "b"},
        ]
        metrics = aggregate_duplicate_metrics(
            rows, [0.2, 0.01, 0.2], timeline_present=True
        )
        self.assertEqual(metrics["withinScenePairCount"], 2)
        self.assertEqual(metrics["withinSceneDuplicateCount"], 0)
        self.assertEqual(metrics["seamPairCount"], 1)
        self.assertEqual(metrics["seamDuplicateCount"], 1)
        self.assertEqual(metrics["withinSceneNearDuplicateRatio"], 0)
        self.assertEqual(metrics["seamNearDuplicateRatio"], 1)

    def test_seam_gate_is_independent_from_within_scene_gate(self):
        rows = [
            {"seconds": 0.0, "sceneId": "prior"},
            {"seconds": 2.5, "sceneId": "core"},
            {"seconds": 5.0, "sceneId": "core"},
        ]
        stats = aggregate_duplicate_metrics(
            rows,
            [0.01, 0.2],
            owner_scene_ids={"core"},
            timeline_present=True,
            nominal_interval_seconds=5,
        )
        failures, applicability = evaluate_visual_failures(
            report_metrics(stats, gating_frames=2),
            thresholds(),
            scope_kind="chunk",
            timeline_present=True,
            seam_expected=True,
        )
        self.assertTrue(applicability["seamNearDuplicateRatio"]["applies"])
        self.assertTrue(any(item.startswith("SEAM_FRAME_SIMILARITY") for item in failures))
        self.assertFalse(any(item.startswith("WITHIN_SCENE_SIMILARITY") for item in failures))

    def test_empty_evidence_is_null_and_fails_policy(self):
        stats = aggregate_duplicate_metrics([], [], timeline_present=False)
        self.assertIsNone(stats["nearDuplicateRatio"])
        self.assertEqual(stats["ownedPairCount"], 0)
        failures, _ = evaluate_visual_failures(
            report_metrics(stats, gating_frames=0), thresholds(), timeline_present=False
        )
        self.assertTrue(any(item.startswith("MISSING_SCALAR_EVIDENCE") for item in failures))
        self.assertTrue(any(item.startswith("MISSING_TEMPORAL_EVIDENCE") for item in failures))

    def test_short_first_core_cannot_pass_on_previous_halo_seam_only(self):
        rows = [
            {"seconds": 0.0, "sceneId": "prior"},
            {"seconds": 2.5, "sceneId": "core"},
        ]
        stats = aggregate_duplicate_metrics(
            rows, [0.2], owner_scene_ids={"core"}, timeline_present=True
        )
        self.assertEqual(stats["seamPairCount"], 1)
        self.assertEqual(stats["withinScenePairCount"], 0)
        self.assertIsNone(stats["withinSceneNearDuplicateRatio"])
        failures, _ = evaluate_visual_failures(
            report_metrics(stats, gating_frames=1),
            thresholds(),
            scope_kind="chunk",
            timeline_present=True,
            seam_expected=True,
        )
        self.assertTrue(
            any(item.startswith("MISSING_WITHIN_SCENE_TEMPORAL_EVIDENCE") for item in failures)
        )

    def test_five_second_core_has_real_within_core_evidence(self):
        rows = [
            {"seconds": 0.0, "sceneId": "prior"},
            {"seconds": 2.5, "sceneId": "core"},
            {"seconds": 5.0, "sceneId": "core"},
        ]
        stats = aggregate_duplicate_metrics(
            rows, [0.2, 0.2], owner_scene_ids={"core"}, timeline_present=True
        )
        self.assertEqual(stats["seamPairCount"], 1)
        self.assertEqual(stats["withinScenePairCount"], 1)
        failures, _ = evaluate_visual_failures(
            report_metrics(stats, gating_frames=2),
            thresholds(),
            scope_kind="chunk",
            timeline_present=True,
            seam_expected=True,
        )
        self.assertFalse(any(item.startswith("MISSING_") for item in failures))

    def test_last_core_to_next_halo_is_not_owned_by_current_chunk(self):
        rows = [
            {"seconds": 0.0, "sceneId": "core"},
            {"seconds": 2.5, "sceneId": "core"},
            {"seconds": 5.0, "sceneId": "next"},
        ]
        stats = aggregate_duplicate_metrics(
            rows, [0.2, 0.01], owner_scene_ids={"core"}, timeline_present=True
        )
        self.assertEqual(stats["ownedPairCount"], 1)
        self.assertEqual(stats["seamPairCount"], 0)
        self.assertEqual(stats["duplicatePairs"][0]["right"]["sceneId"], "core")

    def test_photo_chunk_reports_but_does_not_gate_global_distribution_quotas(self):
        rows = [
            {"seconds": 0.0, "sceneId": "core"},
            {"seconds": 2.5, "sceneId": "core"},
        ]
        stats = aggregate_duplicate_metrics(
            rows, [0.2], owner_scene_ids={"core"}, timeline_present=True
        )
        metrics = report_metrics(
            stats,
            nearWhiteMean=0.0,
            whiteDominantRatio=0.0,
            flatFrameRatio=1.0,
            saturation={"mean": 0.05},
        )
        failures, applicability = evaluate_visual_failures(
            metrics,
            thresholds(),
            scope_kind="chunk",
            timeline_present=True,
            seam_expected=False,
        )
        self.assertEqual(failures, [])
        for key in (
            "nearWhiteMean",
            "whiteDominantRatio",
            "flatFrameRatio",
            "saturation",
            "nearDuplicateRatio",
        ):
            self.assertFalse(applicability[key]["applies"])
        self.assertTrue(applicability["edgeDensity"]["applies"])
        self.assertTrue(applicability["withinSceneNearDuplicateRatio"]["applies"])

    def test_legacy_entrypoint_uses_same_aggregator(self):
        rows = [{"sceneId": None}, {"sceneId": None}, {"sceneId": None}]
        metrics = duplicate_metrics(rows, [0.01, 0.01], 0.025, 5)
        self.assertEqual(metrics["ownedPairCount"], 2)
        self.assertEqual(metrics["longestNearDuplicateRunSeconds"], 15)
        self.assertIsNone(metrics["withinSceneNearDuplicateRatio"])


class ReferenceAuditTests(unittest.TestCase):
    def test_reference_invokes_one_pooled_audit_and_probes_duration(self):
        reference_audit = load_hyphenated_script(
            "reference-audit.py", "reference_audit_invocation_test"
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            reference = root / "reference.mp4"
            reference.write_bytes(b"reference")
            config = root / "quality.json"
            config.write_text(
                json.dumps({"visualAudit": {"sampleOffsetsSeconds": [0, 2.5]}}),
                encoding="utf-8",
            )
            output = root / "baseline.json"
            calls = []

            def fake_run(command, *args, **kwargs):
                calls.append(command)
                report_path = Path(command[command.index("--report") + 1])
                report_path.write_text(
                    json.dumps(
                        {
                            "passed": True,
                            "sampleOffsets": [0.0, 2.5],
                            "measurementSpecVersion": "visual-audit-multiphase-v2",
                            "measurementSpecHash": "a" * 64,
                            "measurementSpec": {"schemaVersion": 1},
                            "flatFrameRatio": 0.45,
                            "edgeDensity": {"mean": 0.19},
                            "nearDuplicateRatio": 0.2,
                            "longestNearDuplicateRunSeconds": 10,
                            "saturation": {"mean": 0.18},
                            "nearWhiteMean": 0.4,
                            "whiteDominantRatio": 0.4,
                        }
                    ),
                    encoding="utf-8",
                )
                return subprocess.CompletedProcess(command, 0)

            argv = [
                "reference-audit.py",
                "--reference",
                str(reference),
                "--config",
                str(config),
                "--out",
                str(output),
            ]
            with (
                mock.patch.object(sys, "argv", argv),
                mock.patch.object(
                    reference_audit,
                    "resolve_installer_binary",
                    side_effect=["ffmpeg", "ffprobe"],
                ),
                mock.patch.object(
                    reference_audit, "probe_duration_seconds", return_value=10.0
                ) as probe,
                mock.patch.object(reference_audit.subprocess, "run", side_effect=fake_run),
            ):
                self.assertEqual(reference_audit.main(), 0)
            probe.assert_called_once()
            self.assertEqual(len(calls), 1)
            command = calls[0]
            self.assertEqual(command.count("--sample-offsets"), 1)
            self.assertNotIn("--sample-offset", command)
            self.assertEqual(command[command.index("--sample-offsets") + 1], "0,2.5")
            self.assertEqual(
                command[command.index("--expected-duration-seconds") + 1], "10.0"
            )
            baseline = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(baseline["schemaVersion"], 2)
            self.assertEqual(baseline["measurementSpecHash"], "a" * 64)
            self.assertNotIn("perOffset", baseline["robustBaseline"])

    def test_reference_command_always_passes_explicit_duration_and_plural_offsets(self):
        reference_audit = load_hyphenated_script(
            "reference-audit.py", "reference_audit_command_test"
        )
        command = reference_audit.build_visual_audit_command(
            "reference.mp4",
            "ffmpeg",
            "ffprobe",
            "quality.json",
            "report.json",
            5,
            [0.0, 2.5],
            12.5,
        )
        self.assertIn("--expected-duration-seconds", command)
        self.assertEqual(command.count("--sample-offsets"), 1)
        self.assertNotIn("--sample-offset", command)


if __name__ == "__main__":
    unittest.main()
