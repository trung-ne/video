import unittest

from scripts.tts_fidelity import (
    critical_claim_diff, evaluate, resolve_policy, compare, passes,
    token_diff, units,
)


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

    def test_korean_uses_spacing_independent_syllable_units(self):
        self.assertEqual(units("한국 시장 하락", "ko"), ["한", "국", "시", "장", "하", "락"])

    def test_language_specific_policy_and_global_fallback(self):
        self.assertEqual(resolve_policy({}, "en").model, "medium")
        self.assertEqual(resolve_policy({}, "vi").mode, "soft")
        policy = resolve_policy({"TTS_ALIGNMENT_MIN_PRECISION": ".91", "TTS_ALIGNMENT_MIN_PRECISION_KO": ".97"}, "ko")
        self.assertEqual(policy.minPrecision, .97)

    def test_number_word_normalization_for_english(self):
        self.assertEqual(units("profit was ten percent", "en"), ["profit", "was", "10", "percent"])

    def test_compound_number_currency_and_contraction_normalization(self):
        self.assertEqual(units("It can't exceed twenty one dollars", "en"),
                         units("It cannot exceed $21", "en"))

    def test_korean_spacing_does_not_change_comparison_units(self):
        self.assertEqual(units("한국 시장", "ko"), units("한국시장", "ko"))

    def test_korean_sino_number_matches_digits(self):
        self.assertEqual(units("이십 퍼센트", "ko"), units("20%", "ko"))

    def test_vietnamese_spoken_number_matches_digits(self):
        self.assertEqual(units("hai mươi phần trăm", "vi"), units("20%", "vi"))

    def test_vietnamese_spoken_year_matches_digits(self):
        self.assertEqual(units("hai nghìn không trăm hai mươi lăm", "vi"), units("2025", "vi"))

    def test_vietnamese_grouped_debt_number_matches_spoken_form(self):
        self.assertEqual(units("hai nghìn tỷ", "vi"), units("2 .000 tỉ", "vi"))

    def test_token_diff_reports_substitution(self):
        self.assertEqual(token_diff(["market", "rose"], ["market", "fell"])[0]["type"], "substitution")

    def test_critical_number_mismatch_is_hard_failure_even_in_soft_policy(self):
        policy = resolve_policy({}, "vi")
        result = evaluate("Lợi nhuận tăng 20%", "Lợi nhuận tăng 10%", "vi", "vi", [{"confidence": .99}], policy)
        self.assertEqual(result["classification"], "critical_claim_mismatch")
        self.assertEqual(result["policyResult"], "fail")

    def test_vietnamese_minor_asr_substitution_is_warning(self):
        policy = resolve_policy({}, "vi")
        words = [{"word": word, "confidence": .95} for word in "thị trường hàn quốc giảm rất mạnh".split()]
        result = evaluate("thị trường Hàn Quốc giảm rất nhanh", "thị trường hàn quốc giảm rất mạnh", "vi", "vi", words, policy)
        self.assertTrue(result["passed"])
        self.assertEqual(result["policyResult"], "warn")

    def test_english_below_threshold_remains_hard_failure(self):
        policy = resolve_policy({}, "en")
        words = [{"word": word, "confidence": .99} for word in "the market fell".split()]
        result = evaluate("the market rose", "the market fell", "en", "en", words, policy)
        self.assertFalse(result["passed"])
        self.assertEqual(result["policyResult"], "fail")

    def test_contiguous_omission_hard_fails_soft_policy(self):
        policy = resolve_policy({}, "vi")
        result = evaluate("thị trường đang giảm rất nhanh", "thị trường nhanh", "vi", "vi", [{"confidence": .99}], policy)
        self.assertFalse(result["passed"])
        self.assertGreater(result["metrics"]["maxContiguousDeletion"], policy.maxContiguousDeletion)

    def test_explicit_critical_term_is_checked(self):
        diff = critical_claim_diff("Samsung tăng trưởng", "doanh nghiệp tăng trưởng", "vi", ["Samsung"])
        self.assertEqual(diff, [{"type": "missing", "claim": "samsung"}])

    def test_unexpected_number_is_a_critical_claim_mismatch(self):
        diff = critical_claim_diff("profit rose 20%", "profit rose 20% and 30%", "en")
        self.assertEqual(diff, [{"type": "unexpected", "claim": "30 percent"}])

    def test_percent_symbol_and_spoken_form_are_the_same_claim(self):
        self.assertEqual(critical_claim_diff("profit rose 20%", "profit rose twenty percent", "en"), [])

    def test_wrong_language_is_hard_failure(self):
        policy = resolve_policy({}, "ko")
        result = evaluate("한국 시장", "한국 시장", "ko", "en", [{"confidence": .99}], policy)
        self.assertEqual(result["classification"], "wrong_language")
        self.assertEqual(result["policyResult"], "fail")

    def test_low_confidence_exact_result_escalates(self):
        policy = resolve_policy({}, "en")
        result = evaluate("market rose", "market rose", "en", "en", [{"confidence": .2}], policy)
        self.assertTrue(result["needsEscalation"])


if __name__ == "__main__":
    unittest.main()
