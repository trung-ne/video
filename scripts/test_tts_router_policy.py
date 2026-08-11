import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from tts_fidelity import evaluate, resolve_policy
from tts_router import LocalScriptBackend, SceneTooLongError, apply_pronunciation_overrides, reconcile_asr_results, scene_cache_identity, split_spoken_text, synthesize_with_rechunk


class RouterPolicyTests(unittest.TestCase):
    def test_deterministic_edge_has_one_fidelity_candidate(self):
        backend = LocalScriptBackend("edge", {}, SCRIPTS.parent)
        self.assertTrue(backend.is_deterministic("ko", "voice"))
        self.assertEqual(backend.attempt_limit(3), 1)

    def test_long_scene_splits_only_at_sentence_boundaries(self):
        text = "First authored sentence. Second authored sentence. Third authored sentence."
        chunks = split_spoken_text(text, 35)
        self.assertGreater(len(chunks), 1)
        self.assertEqual(" ".join(chunks), text)
        self.assertTrue(all(chunk.endswith(".") for chunk in chunks))

    def test_short_scene_is_not_rechunked(self):
        self.assertEqual(split_spoken_text("Short scene.", 100), ["Short scene."])

    def test_pronunciation_override_does_not_mutate_canonical_input(self):
        canonical = "Samsung grew."
        self.assertEqual(apply_pronunciation_overrides(canonical, {"Samsung": "Sam sung"}), "Sam sung grew.")
        self.assertEqual(canonical, "Samsung grew.")

    def test_two_asr_models_disagree_without_rewriting_narration(self):
        policy = resolve_policy({}, "vi")
        primary = evaluate("thị trường tăng", "thị trường giảm", "vi", "vi", [{"confidence": .9}], policy)
        secondary = evaluate("thị trường tăng", "thị trường tăng nhẹ", "vi", "vi", [{"confidence": .9}], policy)
        result = reconcile_asr_results(primary, secondary, policy)
        self.assertEqual(result["classification"], "asr_uncertain")
        self.assertEqual(result["policyResult"], "warn")

    def test_cache_invalidates_only_the_changed_scene_identity(self):
        policy = resolve_policy({}, "en")
        def key(scene):
            return scene_cache_identity(scene, scene["spokenText"], "kokoro", "af_heart", "en",
                                        "kokoro", {}, 420, policy)[1]
        first = {"id": "scene-001", "spokenText": "Market rose."}
        second = {"id": "scene-002", "spokenText": "Rates fell."}
        first_key, second_key = key(first), key(second)
        first["spokenText"] = "Market rose quickly."
        self.assertNotEqual(key(first), first_key)
        self.assertEqual(key(second), second_key)

    def test_excessive_rechunking_is_refused_before_tts_runs(self):
        class NeverSynthesize:
            def synthesize(self, *_args):
                raise AssertionError("TTS must not run for an oversized authored scene")
        text = " ".join(["Sentence."] * 8)
        with self.assertRaises(SceneTooLongError):
            synthesize_with_rechunk(NeverSynthesize(), {"id": "scene-001", "spokenText": text},
                                    "en", "voice", 1, 1, Path("ignored.wav"), 10, 2)


if __name__ == "__main__":
    unittest.main()
