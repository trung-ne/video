import unittest

from scripts.visual_audit_metrics import duplicate_metrics


class DuplicateMetricsTests(unittest.TestCase):
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
