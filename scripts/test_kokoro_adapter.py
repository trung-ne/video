import json
import tempfile
import unittest
from pathlib import Path

from scripts.kokoro_adapter import (
    KokoroSynthesizer,
    canonical_voice_spec,
    load_versioned_profile,
    parse_weighted_voice,
    validate_voice_for_language,
)


class FakePipeline:
    constructions = 0

    def __init__(self, **_):
        FakePipeline.constructions += 1
        self.voices = {}

    def load_single_voice(self, name):
        return {"jf_alpha": 1.0, "jf_nezumi": 3.0}[name]


class KokoroAdapterTests(unittest.TestCase):
    def test_single_voice_normalizes_to_one(self):
        self.assertEqual(parse_weighted_voice("jf_alpha"), [("jf_alpha", 1.0)])

    def test_weighted_blend_is_normalized(self):
        parsed = parse_weighted_voice("jf_alpha:2,jf_nezumi:1")
        self.assertAlmostEqual(parsed[0][1], 2 / 3)
        self.assertAlmostEqual(parsed[1][1], 1 / 3)
        self.assertEqual(canonical_voice_spec("jf_alpha:8,jf_nezumi:2", "j"), "jf_alpha:0.800000,jf_nezumi:0.200000")

    def test_invalid_specs_fail_closed(self):
        for spec in ("", "jf_alpha:nope", "jf_alpha:0", "jf_alpha,jf_nezumi,jf_tebukuro", "jf_alpha,jf_alpha"):
            with self.subTest(spec=spec):
                with self.assertRaises(ValueError): parse_weighted_voice(spec)

    def test_japanese_rejects_wrong_language_and_mixed_gender(self):
        with self.assertRaises(ValueError): validate_voice_for_language("af_heart", "j")
        with self.assertRaisesRegex(ValueError, "male and female"):
            validate_voice_for_language("jf_alpha:0.8,jm_kumo:0.2", "j")

    def test_pipeline_and_voice_embedding_load_once(self):
        FakePipeline.constructions = 0
        synth = KokoroSynthesizer("j", "jf_alpha:0.8,jf_nezumi:0.2", .96, pipeline_factory=FakePipeline)
        synth._load(); synth._load()
        self.assertEqual(FakePipeline.constructions, 1)
        self.assertEqual(synth.load_count, 1)
        self.assertAlmostEqual(synth._pipeline.voices[synth._voice_key], 1.4)

    def test_versioned_profile_detects_env_drift(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); registry = root / "config" / "tts"; registry.mkdir(parents=True)
            (registry / "kokoro-ja-profiles.json").write_text(json.dumps({
                "schemaVersion": 1,
                "profiles": {"profile-v1": {"language": "ja", "voice": "jf_alpha:0.8,jf_nezumi:0.2", "speed": .96}},
            }), encoding="utf-8")
            valid = {"TTS_KOKORO_PROFILE_JA": "profile-v1", "TTS_KOKORO_SPEED_JA": ".96"}
            profile = load_versioned_profile(root, valid, "ja", "jf_alpha:8,jf_nezumi:2")
            self.assertEqual(profile["profileId"], "profile-v1")
            with self.assertRaisesRegex(ValueError, "drift"):
                load_versioned_profile(root, {**valid, "TTS_KOKORO_SPEED_JA": ".98"}, "ja", "jf_alpha:8,jf_nezumi:2")

    def test_generation_settings_change_with_speed_or_voice(self):
        root = Path.cwd()
        base = load_versioned_profile(root, {"TTS_KOKORO_SPEED_JA": ".96"}, "ja", "jf_alpha")
        faster = load_versioned_profile(root, {"TTS_KOKORO_SPEED_JA": ".98"}, "ja", "jf_alpha")
        blend = load_versioned_profile(root, {"TTS_KOKORO_SPEED_JA": ".96"}, "ja", "jf_alpha:0.8,jf_nezumi:0.2")
        self.assertNotEqual(base, faster)
        self.assertNotEqual(base, blend)


if __name__ == "__main__":
    unittest.main()
