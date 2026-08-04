import unittest

from scripts.align_words import attach_transcript_indices, attach_canonical_scene_indices


class AlignmentIndexTests(unittest.TestCase):
    def test_recovers_after_long_whisper_insertion(self):
        transcript = "alpha beta gamma delta epsilon"
        aligned = [{"word": word, "confidence": 0.9} for word in (
            ["alpha"] + [f"noise{i}" for i in range(12)] + ["beta", "gamma", "delta", "epsilon"]
        )]
        result = attach_transcript_indices(aligned, transcript)
        mapped = [(item["word"], item["wordIndex"]) for item in result if item["wordIndex"] is not None]
        self.assertEqual(mapped, [
            ("alpha", 0), ("beta", 1), ("gamma", 2), ("delta", 3), ("epsilon", 4)
        ])

    def test_preserves_repeated_word_order(self):
        result = attach_transcript_indices(
            [{"word": word, "confidence": 0.9} for word in ["one", "two", "one", "three"]],
            "one two one three",
        )
        self.assertEqual([item["wordIndex"] for item in result], [0, 1, 2, 3])

    def test_canonical_scene_indices_follow_tts_not_source_transcript(self):
        aligned = [{"word": word, "confidence": 0.9, "startSec": i * 0.2, "endSec": i * 0.2 + 0.1}
                   for i, word in enumerate(["shock", "number", "explained"])]
        result, provenance = attach_canonical_scene_indices(aligned, [
            {"id": "scene-001", "text": "shock number"},
            {"id": "scene-002", "text": "explained"},
        ])
        self.assertEqual([(item.get("scene"), item.get("sceneWordIndex")) for item in result], [
            ("scene-001", 0), ("scene-001", 1), ("scene-002", 0),
        ])
        self.assertEqual(provenance["source"], "canonical-tts-scenes")
        self.assertEqual(provenance["coverage"], 1.0)

    def test_japanese_canonical_alignment_uses_character_units(self):
        aligned = [{"word": "日本", "confidence": .9, "startSec": 0, "endSec": .2}]
        result, provenance = attach_canonical_scene_indices(aligned, [
            {"id": "scene-001", "spokenText": "日本"},
        ], "ja")
        self.assertEqual([item["word"] for item in result], ["日", "本"])
        self.assertEqual(provenance["matchedWordCount"], 2)


if __name__ == "__main__":
    unittest.main()
