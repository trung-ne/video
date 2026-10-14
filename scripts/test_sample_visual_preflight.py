"""Synthetic tests for advisory sparse visual preflight (no Remotion required)."""

import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

SCRIPT = Path(__file__).with_name("sample-visual-preflight.py")
SPEC = importlib.util.spec_from_file_location("sample_visual_preflight", SCRIPT)
preflight = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(preflight)


def timeline():
    return {"fps": 30, "width": 1920, "height": 1080, "durationInFrames": 301, "scenes": [
        {"id": "before", "startFrame": 0, "durationFrames": 75},
        {"id": "core", "startFrame": 75, "durationFrames": 151},
        {"id": "after", "startFrame": 226, "durationFrames": 75},
    ]}


class SampleVisualPreflightTests(unittest.TestCase):
    def test_original_timestamps_masked_similarity_and_core_ownership(self):
        # Five samples map to frames 0, 75, 150, 225, 300 (not compact time).
        thumbnails = [np.zeros((14, 32), dtype=np.float32),
                      np.ones((14, 32), dtype=np.float32),
                      np.ones((14, 32), dtype=np.float32),
                      np.ones((14, 32), dtype=np.float32),
                      np.ones((14, 32), dtype=np.float32)]
        report = preflight.build_report("sparse.mp4", timeline(), {"core"}, thumbnails, 0.76, 0.15)
        self.assertEqual([row["originalFrame"] for row in report["samples"]], [0, 75, 150, 225, 300])
        self.assertEqual([row["seconds"] for row in report["samples"]], [0, 2.5, 5, 7.5, 10])
        self.assertEqual([row["sampleRole"] for row in report["samples"]], ["halo", "core", "core", "core", "halo"])
        self.assertEqual(report["ownedPairCount"], 3)  # prior halo -> core, never core -> next halo
        self.assertEqual(report["withinScenePairCount"], 2)
        self.assertEqual(report["withinSceneNearDuplicateRatio"], 1.0)
        self.assertEqual([(item["fromOriginalFrame"], item["toOriginalFrame"]) for item in report["withinSceneDuplicateIntervals"]], [(75, 150), (150, 225)])
        self.assertEqual(report["sampleFrameStep"], 75)
        self.assertTrue(report["nonPromotable"])
        self.assertEqual(report["status"], "inconclusive")
        self.assertNotIn("passed", report)

    def test_insufficient_pairs_are_inconclusive_not_quality_pass(self):
        source = {"fps": 30, "width": 1920, "height": 1080, "durationInFrames": 50, "scenes": [{"id": "only", "startFrame": 0, "durationFrames": 50}]}
        report = preflight.build_report("sparse.mp4", source, None, [np.zeros((14, 32))], 0.76, 0.15)
        self.assertIsNone(report["withinSceneNearDuplicateRatio"])
        self.assertEqual(report["withinScenePairCount"], 0)
        self.assertNotIn("passed", report)

    def test_exact_frame_count_and_scope_validation(self):
        with self.assertRaisesRegex(ValueError, "decoded frame count mismatch"):
            preflight.build_report("sparse.mp4", timeline(), None, [np.zeros((14, 32))], 0.76, 0.15)
        with self.assertRaisesRegex(ValueError, "exactly match"):
            preflight.core_scope({"kind": "chunk", "haloBeforeSceneIds": [], "coreSceneIds": ["core"], "haloAfterSceneIds": []}, timeline()["scenes"])
        with self.assertRaisesRegex(ValueError, "contiguous"):
            source = timeline()
            source["scenes"][1]["startFrame"] = 76
            preflight.timeline_scenes(source)

    def test_extract_decodes_every_frame_and_rejects_extras(self):
        # Fake ffmpeg writes raw decoded frames rather than invoking Remotion/H264.
        class Result:
            returncode = 0
            stderr = b""

        def fake_run(command, **_kwargs):
            self.assertNotIn("fps=", " ".join(command))
            self.assertIn("-vsync", command)
            self.assertEqual(command[command.index("-vsync") + 1], "0")
            self.assertEqual(command[command.index("-frames:v") + 1], "3")
            Path(command[-1]).write_bytes(bytes([240, 120, 30]) * (320 * 180 * 2))
            return Result()

        with patch.object(preflight.subprocess, "run", side_effect=fake_run):
            thumbs = preflight.extract_thumbnails("ffmpeg", "input.mp4", 2, 0.76)
        self.assertEqual(len(thumbs), 2)
        self.assertEqual(thumbs[0].shape, (14, 32))

        def extra_run(command, **_kwargs):
            Path(command[-1]).write_bytes(bytes(320 * 180 * 3 * 3))
            return Result()

        with patch.object(preflight.subprocess, "run", side_effect=extra_run):
            with self.assertRaisesRegex(ValueError, "expected exactly 2"):
                preflight.extract_thumbnails("ffmpeg", "input.mp4", 2, 0.76)

    def test_cli_writes_nonpromotable_json_and_returns_zero_on_advisory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            video = root / "sample.mp4"
            video.write_bytes(b"fake")
            source = root / "timeline.json"
            source.write_text(json.dumps(timeline()), encoding="utf-8")
            config = root / "reference.json"
            config.write_text(json.dumps({"visualAudit": {"subtitleBandTopRatio": 0.76, "maximumWithinSceneNearDuplicateRatio": 0.15}}), encoding="utf-8")
            out = root / "report.json"
            thumbs = [np.zeros((14, 32), dtype=np.float32)] * 5
            with patch.object(preflight, "probe_video"), patch.object(preflight, "extract_thumbnails", return_value=thumbs):
                result = preflight.main(["--video", str(video), "--timeline", str(source), "--out", str(out), "--config", str(config), "--ffmpeg", "ffmpeg", "--ffprobe", "ffprobe"])
            self.assertEqual(result, 0)
            report = json.loads(out.read_text(encoding="utf-8"))
            self.assertEqual(report["sampledFrames"], 5)
            self.assertTrue(report["nonPromotable"])
            self.assertNotIn("passed", report)
    def test_timeout_is_diagnostic_error_not_quality_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            video = root / "sample.mp4"
            video.write_bytes(b"fake")
            source = root / "timeline.json"
            source.write_text(json.dumps(timeline()), encoding="utf-8")
            config = root / "reference.json"
            config.write_text(json.dumps({"visualAudit": {}}), encoding="utf-8")
            with patch.object(preflight, "probe_video", side_effect=subprocess.TimeoutExpired("ffprobe", 1)), patch.object(preflight, "extract_thumbnails") as extract:
                result = preflight.main(["--video", str(video), "--timeline", str(source), "--config", str(config), "--ffmpeg", "ffmpeg", "--ffprobe", "ffprobe"])
            self.assertEqual(result, 2)
            extract.assert_not_called()


if __name__ == "__main__":
    unittest.main()
