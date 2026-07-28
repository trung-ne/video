import unittest

from scripts.align_words import attach_transcript_indices


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


if __name__ == "__main__":
    unittest.main()
