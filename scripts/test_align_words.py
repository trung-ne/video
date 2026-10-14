import json
import os
import tempfile
import unittest
import sys
from types import SimpleNamespace
from unittest.mock import patch

from scripts.align_words import (
    main,
    cache_identity,
    raw_cache_path,
    read_raw_cache,
    write_raw_cache,
    validate_raw_words,
    attach_transcript_indices,
    attach_canonical_scene_indices,
    constrain_words_to_measured_scenes,
)


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

    def test_cross_scene_match_is_downgraded_and_retimed(self):
        words = [{
            "word": "next", "startSec": 0.98, "endSec": 1.08,
            "scene": "scene-002", "sceneWordIndex": 0,
            "canonicalWordIndex": 0, "confidence": 1.0,
            "whisperConfidence": 0.9, "interpolated": False,
        }, {
            "word": "word", "startSec": 1.2, "endSec": 1.3,
            "scene": "scene-002", "sceneWordIndex": 1,
            "canonicalWordIndex": 1, "confidence": 1.0,
            "whisperConfidence": 0.9, "interpolated": False,
        }]
        result = constrain_words_to_measured_scenes(words, {
            "sampleRate": 1000,
            "scenes": [{"id": "scene-002", "startSample": 1000, "samples": 1000}],
        })
        self.assertTrue(result[0]["interpolated"])
        self.assertGreaterEqual(result[0]["startSec"], 1.0)
        self.assertLessEqual(result[0]["endSec"], result[1]["startSec"])


class RawWhisperCacheTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.wav = os.path.join(self.directory.name, "voice.wav")
        with open(self.wav, "wb") as destination:
            destination.write(b"original WAV bytes")
        self.identity = cache_identity(self.wav, "base", "vi", "1.0.0")
        self.cache = raw_cache_path(self.directory.name, self.identity)
        self.words = [{"word": "xin", "startSec": 0.1, "endSec": 0.3, "confidence": 0.9}]

    def test_exact_input_round_trip_preserves_raw_words_for_canonical_remapping(self):
        write_raw_cache(self.cache, self.identity, self.words, "vi")
        loaded, language = read_raw_cache(self.cache, self.identity)
        self.assertEqual((loaded, language), (self.words, "vi"))
        mapped, _ = attach_canonical_scene_indices(loaded, [{"id": "one", "text": "xin"}])
        self.assertEqual(mapped[0]["canonicalWordIndex"], 0)
        self.assertEqual(read_raw_cache(self.cache, self.identity)[0], self.words)

    def test_rejects_changed_wav_and_every_inference_parameter(self):
        write_raw_cache(self.cache, self.identity, self.words, "vi")
        with open(self.wav, "wb") as destination:
            destination.write(b"changed WAV bytes")
        changed = cache_identity(self.wav, "base", "vi", "1.0.0")
        self.assertNotEqual(raw_cache_path(self.directory.name, changed), self.cache)
        self.assertFalse(os.path.exists(raw_cache_path(self.directory.name, changed)))
        with self.assertRaisesRegex(ValueError, "stale"):
            read_raw_cache(self.cache, changed)
        for field, value in (("model", "small"), ("fasterWhisperVersion", "2.0"),
                             ("language", "en"), ("device", "cuda"),
                             ("computeType", "float16"), ("alignerPolicy", "changed"),
                             ("options", {"word_timestamps": False, "vad_filter": False})):
            with self.subTest(field=field):
                with self.assertRaisesRegex(ValueError, "stale"):
                    read_raw_cache(self.cache, {**self.identity, field: value})

    def test_main_reuses_asr_but_remaps_changed_canonical_scenes(self):
        scenes_path = os.path.join(self.directory.name, "scenes.json")
        with open(scenes_path, "w", encoding="utf-8") as destination:
            json.dump([{"id": "first", "text": "xin"}], destination)
        segment = SimpleNamespace(words=[SimpleNamespace(word=" xin", start=0.1, end=0.3, probability=0.9)])
        calls = []

        class FakeModel:
            def __init__(self, *args, **kwargs):
                calls.append((args, kwargs))

            def transcribe(self, *args, **kwargs):
                calls.append((args, kwargs))
                return [segment], SimpleNamespace(language="vi")

        arguments = ["align_words.py", "--wav", self.wav, "--outdir", self.directory.name,
                     "--scenes", scenes_path, "--lang", "vi"]
        with patch.object(sys, "argv", arguments), patch("scripts.align_words.importlib.metadata.version", return_value="1.0.0"), \
                patch.dict(sys.modules, {"faster_whisper": SimpleNamespace(WhisperModel=FakeModel)}):
            self.assertEqual(main(), 0)
            self.assertEqual(len(calls), 2)
            with open(scenes_path, "w", encoding="utf-8") as destination:
                json.dump([{"id": "changed", "text": "xin"}], destination)
            self.assertEqual(main(), 0)
            self.assertEqual(len(calls), 2)
            with open(os.path.join(self.directory.name, "words.json"), encoding="utf-8") as source:
                self.assertEqual(json.load(source)[0]["scene"], "changed")
            with open(self.wav, "wb") as destination:
                destination.write(b"new valid WAV bytes")
            new_identity = cache_identity(self.wav, "base", "vi", "1.0.0")
            self.assertNotEqual(self.cache, raw_cache_path(self.directory.name, new_identity))
            self.assertEqual(main(), 0)
            self.assertEqual(len(calls), 4)
            self.assertTrue(os.path.isfile(raw_cache_path(self.directory.name, new_identity)))
            with open(raw_cache_path(self.directory.name, new_identity), "w", encoding="utf-8") as destination:
                destination.write("not JSON")
            self.assertEqual(main(), 1)
            self.assertEqual(len(calls), 4)

    def test_rejects_malformed_cache_and_invalid_raw_words(self):
        write_raw_cache(self.cache, self.identity, self.words, "vi")
        with open(self.cache, encoding="utf-8") as source:
            payload = json.load(source)
        for words in ([{"word": "xin", "startSec": float("nan"), "endSec": 1, "confidence": 1}],
                      [{**self.words[0], "canonicalWordIndex": 0}],
                      [{**self.words[0], "endSec": -1}], "not an array"):
            with self.subTest(words=words):
                with self.assertRaises(ValueError):
                    validate_raw_words(words)
        for invalid in ({**payload, "schemaVersion": 99},
                        {**payload, "schemaVersion": True},
                        {**payload, "words": [{**self.words[0], "scene": "one"}]},
                        {**payload, "detectedLanguage": None},
                        {**payload, "identity": None}):
            with self.subTest(invalid=invalid):
                with open(self.cache, "w", encoding="utf-8") as destination:
                    json.dump(invalid, destination)
                with self.assertRaises(ValueError):
                    read_raw_cache(self.cache, self.identity)

if __name__ == "__main__":
    unittest.main()
