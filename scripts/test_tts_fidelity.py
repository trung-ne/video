import unittest

from scripts.tts_fidelity import compare, passes, units


class FidelityTests(unittest.TestCase):
    def test_exact_text_passes(self):
        metrics = compare(units("The market fell quickly.", "en"), units("The market fell quickly.", "en"))
        self.assertTrue(passes(metrics, .98, .98, .03))
        self.assertEqual(metrics.insertions, 0)

    def test_extra_spoken_words_fail_precision(self):
        metrics = compare(units("alpha beta", "en"), units("alpha unexpected words beta", "en"))
        self.assertEqual(metrics.insertions, 2)
        self.assertFalse(passes(metrics, .98, .98, .03))

    def test_missing_and_substituted_words_fail(self):
        metrics = compare(units("alpha beta gamma", "en"), units("alpha wrong", "en"))
        self.assertGreater(metrics.editRate, .03)
        self.assertFalse(passes(metrics, .98, .98, .03))

    def test_japanese_uses_character_units_and_kana_normalization(self):
        self.assertEqual(units("カタカナ市場", "ja"), units("かたかな市場", "ja"))
        metrics = compare(units("日本市場", "ja"), units("日本市場", "ja"))
        self.assertTrue(passes(metrics, .98, .98, .03))

    def test_korean_preserves_whitespace_words(self):
        self.assertEqual(units("한국 시장 하락", "ko"), ["한국", "시장", "하락"])


if __name__ == "__main__":
    unittest.main()
