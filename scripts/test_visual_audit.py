import unittest

from scripts.visual_audit_metrics import duplicate_metrics, focal_footprint, scene_at


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

    def test_separates_static_scene_from_similar_cut(self):
        rows = [
            {"sceneId": "a"},
            {"sceneId": "a"},
            {"sceneId": "a"},
            {"sceneId": "b"},
            {"sceneId": "b"},
        ]
        # a→a duplicate twice; a→b also looks similar but is a cut; b changes.
        metrics = duplicate_metrics(rows, [0.01, 0.01, 0.01, 0.2], 0.025, 5)
        self.assertEqual(metrics["withinScenePairCount"], 3)
        self.assertEqual(metrics["withinSceneDuplicateCount"], 2)
        self.assertEqual(metrics["crossScenePairCount"], 1)
        self.assertEqual(metrics["crossSceneDuplicateCount"], 1)
        self.assertAlmostEqual(metrics["withinSceneNearDuplicateRatio"], 2 / 3)
        self.assertEqual(metrics["longestWithinSceneNearDuplicateRunSeconds"], 10)
        self.assertEqual(metrics["longestNearDuplicateRunSeconds"], 15)

    def test_reference_without_timeline_keeps_global_metric(self):
        rows = [{"sceneId": None}, {"sceneId": None}, {"sceneId": None}]
        metrics = duplicate_metrics(rows, [0.01, 0.01], 0.025, 5)
        self.assertEqual(metrics["withinScenePairCount"], 0)
        self.assertEqual(metrics["withinSceneNearDuplicateRatio"], 0)
        self.assertEqual(metrics["longestNearDuplicateRunSeconds"], 10)


if __name__ == "__main__":
    unittest.main()
