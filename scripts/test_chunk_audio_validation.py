import hashlib
import json
import struct
import subprocess
import sys
import tempfile
import unittest
import wave
from pathlib import Path

from scripts.tts_scene_cache import validate_pcm16_mono_wav, validate_run_assembly


ROOT = Path(__file__).resolve().parents[1]
ASSEMBLER = ROOT / "scripts" / "assemble-chunk-audio.py"
POLICY = "sample-exact-chunk-concat-v3"


def json_sha256(value: object) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


def write_wav(target: Path, samples: int, rate: int, value: int = 0) -> None:
    with wave.open(str(target), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(rate)
        output.writeframes(struct.pack("<h", value) * samples)


class AssemblyFixture:
    def __init__(
        self,
        root: Path,
        rate: int = 1000,
        fps: int = 30,
        configured_gap_samples: int = 0,
    ) -> None:
        self.root = root
        self.rate = rate
        self.fps = fps
        self.configured_gap_samples = configured_gap_samples
        self.chunks = []
        self.tts_scenes = []
        self.chunk_files = []
        self.outputs = {
            "audio": root / "out" / "voice.wav",
            "durations": root / "out" / "durations.json",
            "words": root / "out" / "words.json",
            "alignment": root / "out" / "alignment.json",
        }

    def add_chunk(self, chunk_id: str, scenes: list[tuple[str, str, int]], language: str = "vi") -> None:
        audio = self.root / f"{chunk_id}.wav"
        durations_path = self.root / f"{chunk_id}-durations.json"
        words_path = self.root / f"{chunk_id}-words.json"
        alignment_path = self.root / f"{chunk_id}-alignment.json"
        total_samples = sum(samples for _, _, samples in scenes)
        write_wav(audio, total_samples, self.rate, value=len(self.chunks) + 1)

        duration_scenes = []
        words = []
        chunk_tts_scenes = []
        start_sample = 0
        canonical_index = 0
        for scene_id, text, samples in scenes:
            tokens = text.split()
            if not tokens:
                raise ValueError("The focused fixture expects alignable scene text")
            duration_scenes.append({
                "id": scene_id,
                "startSample": start_sample,
                "speechSamples": samples,
                "gapSamples": 0,
                "gapPlacement": "none",
                "samples": samples,
                "startFrame": 0,
                "frames": 1,
            })
            token_span = samples / len(tokens)
            for scene_word_index, token in enumerate(tokens):
                words.append({
                    "word": token,
                    "startSec": (
                        start_sample + (scene_word_index + 0.25) * token_span
                    ) / self.rate,
                    "endSec": (
                        start_sample + (scene_word_index + 0.75) * token_span
                    ) / self.rate,
                    "scene": scene_id,
                    "sceneWordIndex": scene_word_index,
                    "canonicalWordIndex": canonical_index,
                    "interpolated": False,
                })
                canonical_index += 1
            chunk_tts_scenes.append({"id": scene_id, "text": text})
            start_sample += samples

        durations_path.write_text(json.dumps({
            "fps": self.fps,
            "sampleRate": self.rate,
            "totalSamples": total_samples,
            "gapPolicy": {
                "version": "edge-gap-0.08-v1",
                "rawClipIncludesGap": False,
                "configuredSeconds": self.configured_gap_samples / self.rate,
                "effectiveSamples": self.configured_gap_samples,
                "effectiveSeconds": self.configured_gap_samples / self.rate,
            },
            "ttsMetrics": {
                "chunkCount": len(scenes),
                "gapCount": 0,
                "interSceneGapCount": 0,
                "terminalGapCount": 0,
                "maxInterSceneGapSeconds": 0.0,
                "totalGapSeconds": 0.0,
                "gapShare": 0.0,
                "wallClockSeconds": 0.1,
            },
            "scenes": duration_scenes,
        }), encoding="utf-8")
        words_path.write_text(json.dumps(words), encoding="utf-8")
        alignment_path.write_text(json.dumps({
            "schemaVersion": 1,
            "source": "canonical-tts-scenes",
            "canonicalWordCount": len(words),
            "matchedWordCount": len(words),
            "interpolatedWordCount": 0,
            "coverage": 1.0,
            "matchedCoverage": 1.0,
            "sceneCount": len(scenes),
            "ttsScenesSha256": json_sha256(chunk_tts_scenes),
            "language": language,
        }), encoding="utf-8")
        self.tts_scenes.extend(chunk_tts_scenes)
        self.chunks.append({
            "id": chunk_id,
            "sceneIds": [scene_id for scene_id, _, _ in scenes],
            "audio": str(audio),
            "durations": str(durations_path),
            "words": str(words_path),
            "alignment": str(alignment_path),
        })
        self.chunk_files.append({
            "durations": durations_path,
            "words": words_path,
            "alignment": alignment_path,
        })

    @staticmethod
    def read_json(path: Path) -> object:
        return json.loads(path.read_text(encoding="utf-8"))

    @staticmethod
    def write_json(path: Path, value: object) -> None:
        path.write_text(json.dumps(value), encoding="utf-8")

    def run(self, language: str = "vi") -> subprocess.CompletedProcess[str]:
        inputs = self.root / "inputs.json"
        tts_scenes = self.root / "tts_scenes.json"
        self.write_json(inputs, self.chunks)
        self.write_json(tts_scenes, self.tts_scenes)
        return subprocess.run([
            sys.executable,
            str(ASSEMBLER),
            "--inputs", str(inputs),
            "--out-audio", str(self.outputs["audio"]),
            "--out-durations", str(self.outputs["durations"]),
            "--out-words", str(self.outputs["words"]),
            "--out-alignment", str(self.outputs["alignment"]),
            "--tts-scenes", str(tts_scenes),
            "--language", language,
            "--fps", str(self.fps),
            "--policy-version", POLICY,
        ], capture_output=True, text=True, check=False)


class ChunkAudioValidationTest(unittest.TestCase):
    def assert_rejected(self, fixture: AssemblyFixture, message: str) -> None:
        result = fixture.run()
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn(message, result.stderr)
        self.assertFalse(fixture.outputs["audio"].exists())

    def test_rejects_invalid_sample_partitions(self) -> None:
        cases = (
            ("negative start", lambda scenes: scenes[0].update(startSample=-1), "must be non-negative"),
            ("negative length", lambda scenes: scenes[0].update(samples=-1), "samples must be positive"),
            ("overlap", lambda scenes: scenes[1].update(startSample=500), "overlaps its predecessor"),
            ("non-monotonic", lambda scenes: scenes[2].update(startSample=500), "non-monotonic"),
            ("gap", lambda scenes: scenes[1].update(startSample=1001), "leaves a gap"),
            ("past audio", lambda scenes: scenes[2].update(samples=1001), "exceeds chunk audio"),
        )
        for label, mutate, expected_error in cases:
            with self.subTest(label=label), tempfile.TemporaryDirectory() as temp:
                fixture = AssemblyFixture(Path(temp))
                fixture.add_chunk("chunk-1", [
                    ("scene-a", "alpha", 1000),
                    ("scene-b", "beta", 1000),
                    ("scene-c", "gamma", 1000),
                ])
                path = fixture.chunk_files[0]["durations"]
                durations = fixture.read_json(path)
                mutate(durations["scenes"])
                fixture.write_json(path, durations)
                self.assert_rejected(fixture, expected_error)

    def test_rejects_duplicate_and_wrong_scene_ids(self) -> None:
        cases = (
            ("duplicate", lambda scenes: scenes[1].update(id="scene-a"), "duration scene id is duplicated"),
            ("wrong", lambda scenes: scenes[0].update(id="scene-wrong"), "do not match the planned chunk scene ids"),
        )
        for label, mutate, expected_error in cases:
            with self.subTest(label=label), tempfile.TemporaryDirectory() as temp:
                fixture = AssemblyFixture(Path(temp))
                fixture.add_chunk("chunk-1", [("scene-a", "alpha", 1000), ("scene-b", "beta", 1000)])
                path = fixture.chunk_files[0]["durations"]
                durations = fixture.read_json(path)
                mutate(durations["scenes"])
                fixture.write_json(path, durations)
                self.assert_rejected(fixture, expected_error)

    def test_rejects_duplicate_chunk_ids(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            fixture = AssemblyFixture(Path(temp))
            fixture.add_chunk("chunk-1", [("scene-a", "alpha", 1000)])
            fixture.add_chunk("chunk-2", [("scene-b", "beta", 1000)])
            fixture.chunks[1]["id"] = "chunk-1"
            self.assert_rejected(fixture, "chunk id is duplicated")

    def test_rejects_word_scene_index_token_and_range_mismatches(self) -> None:
        cases = (
            ("scene", lambda words: words[0].update(scene="scene-b"), "belongs to the wrong scene"),
            ("scene index", lambda words: words[0].update(sceneWordIndex=1), "wrong sceneWordIndex"),
            ("canonical index", lambda words: words[0].update(canonicalWordIndex=1), "continuous chunk-local"),
            ("token", lambda words: words[0].update(word="wrong"), "does not match canonical TTS narration"),
            ("range", lambda words: words[0].update(startSec=1.1, endSec=1.2), "falls outside scene scene-a"),
        )
        for label, mutate, expected_error in cases:
            with self.subTest(label=label), tempfile.TemporaryDirectory() as temp:
                fixture = AssemblyFixture(Path(temp))
                fixture.add_chunk("chunk-1", [("scene-a", "alpha", 1000), ("scene-b", "beta", 1000)])
                path = fixture.chunk_files[0]["words"]
                words = fixture.read_json(path)
                mutate(words)
                fixture.write_json(path, words)
                self.assert_rejected(fixture, expected_error)

    def test_rejects_inconsistent_chunk_languages(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            fixture = AssemblyFixture(Path(temp))
            fixture.add_chunk("chunk-1", [("scene-a", "alpha", 1000)], language="en")
            fixture.add_chunk("chunk-2", [("scene-b", "beta", 1000)], language="vi")
            result = fixture.run(language="unknown")
            self.assertNotEqual(result.returncode, 0, result.stdout)
            self.assertIn("chunk alignment languages are inconsistent", result.stderr)
            self.assertFalse(fixture.outputs["audio"].exists())

    def test_normalizes_only_interpolated_boundary_words_into_their_owned_scene(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            fixture = AssemblyFixture(Path(temp))
            fixture.add_chunk("chunk-1", [
                ("scene-a", "alpha", 1000),
                ("scene-b", "beta", 1000),
            ])
            words_path = fixture.chunk_files[0]["words"]
            words = fixture.read_json(words_path)
            words[0].update(startSec=1.05, endSec=1.15, interpolated=True)
            fixture.write_json(words_path, words)
            alignment_path = fixture.chunk_files[0]["alignment"]
            alignment = fixture.read_json(alignment_path)
            alignment.update(
                matchedWordCount=1,
                interpolatedWordCount=1,
                matchedCoverage=0.5,
            )
            fixture.write_json(alignment_path, alignment)

            result = fixture.run()
            self.assertEqual(result.returncode, 0, result.stderr)
            assembled_words = fixture.read_json(fixture.outputs["words"])
            self.assertEqual(assembled_words[0]["scene"], "scene-a")
            self.assertAlmostEqual(assembled_words[0]["startSec"], 0.9)
            self.assertAlmostEqual(assembled_words[0]["endSec"], 1.0)
            self.assertLessEqual(assembled_words[0]["endSec"], assembled_words[1]["startSec"])

    def test_reclassifies_nonfinal_chunk_terminal_gap_and_aggregates_metrics(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            fixture = AssemblyFixture(Path(temp), configured_gap_samples=100)
            fixture.add_chunk("chunk-1", [("scene-a", "alpha", 1000)])
            fixture.add_chunk("chunk-2", [("scene-b", "beta", 1000)])
            durations_path = fixture.chunk_files[0]["durations"]
            durations = fixture.read_json(durations_path)
            durations["scenes"][0].update(
                speechSamples=900,
                gapSamples=100,
                gapPlacement="terminal",
            )
            durations["ttsMetrics"].update(
                gapCount=1,
                interSceneGapCount=0,
                terminalGapCount=1,
                totalGapSeconds=0.1,
                gapShare=0.1,
            )
            fixture.write_json(durations_path, durations)

            result = fixture.run()
            self.assertEqual(result.returncode, 0, result.stderr)
            manifest = fixture.read_json(fixture.outputs["durations"])
            self.assertEqual(
                [scene["gapPlacement"] for scene in manifest["scenes"]],
                ["inter-scene", "none"],
            )
            self.assertEqual(manifest["gapPolicy"]["effectiveSamples"], 100)
            self.assertEqual(manifest["ttsMetrics"], {
                "chunkCount": 2,
                "assemblyChunkCount": 2,
                "gapCount": 1,
                "interSceneGapCount": 1,
                "terminalGapCount": 0,
                "maxInterSceneGapSeconds": 0.1,
                "totalGapSeconds": 0.1,
                "gapShare": 0.05,
                "wallClockSeconds": 0.2,
            })

    def test_rejects_nonchronological_words_even_when_each_is_inside_its_scene(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            fixture = AssemblyFixture(Path(temp))
            fixture.add_chunk("chunk-1", [("scene-a", "alpha beta", 1000)])
            words_path = fixture.chunk_files[0]["words"]
            words = fixture.read_json(words_path)
            words[1].update(startSec=0.05, endSec=0.1)
            fixture.write_json(words_path, words)
            self.assert_rejected(fixture, "not in chronological order")

    def test_rejects_boolean_values_in_numeric_alignment_receipt_fields(self) -> None:
        cases = (
            ("schemaVersion", True, "alignment receipt is not canonical"),
            ("canonicalWordCount", True, "alignment word count does not match"),
            ("matchedWordCount", True, "alignment match counts do not match"),
            ("interpolatedWordCount", False, "alignment match counts do not match"),
            ("coverage", True, "alignment coverage does not match"),
            ("matchedCoverage", True, "alignment coverage does not match"),
            ("sceneCount", True, "alignment coverage does not match"),
        )
        for field, value, expected_error in cases:
            with self.subTest(field=field), tempfile.TemporaryDirectory() as temp:
                fixture = AssemblyFixture(Path(temp))
                fixture.add_chunk("chunk-1", [("scene-a", "alpha", 1000)])
                path = fixture.chunk_files[0]["alignment"]
                alignment = fixture.read_json(path)
                alignment[field] = value
                fixture.write_json(path, alignment)
                self.assert_rejected(fixture, expected_error)

    def test_requires_interpolated_to_be_an_actual_boolean(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            fixture = AssemblyFixture(Path(temp))
            fixture.add_chunk("chunk-1", [("scene-a", "alpha", 1000)])
            path = fixture.chunk_files[0]["words"]
            words = fixture.read_json(path)
            words[0]["interpolated"] = 0
            fixture.write_json(path, words)
            self.assert_rejected(fixture, "interpolated must be a boolean")

    def test_fractional_frames_round_once_on_global_sample_boundaries(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            fixture = AssemblyFixture(Path(temp), rate=1000, fps=30)
            fixture.add_chunk("chunk-1", [("scene-a", "alpha", 9520)])
            fixture.add_chunk("chunk-2", [("scene-b", "beta", 9520)])
            result = fixture.run()
            self.assertEqual(result.returncode, 0, result.stderr)

            durations = fixture.read_json(fixture.outputs["durations"])
            self.assertEqual([scene["frames"] for scene in durations["scenes"]], [286, 285])
            self.assertEqual([scene["startFrame"] for scene in durations["scenes"]], [0, 286])
            self.assertEqual([scene["startSample"] for scene in durations["scenes"]], [0, 9520])
            self.assertEqual([scene["samples"] for scene in durations["scenes"]], [9520, 9520])
            self.assertEqual(sum(scene["frames"] for scene in durations["scenes"]), 571)
            self.assertEqual(durations["totalFrames"], 571)
            self.assertEqual(round(9520 * 30 / 1000) * 2, 572)
            self.assertEqual(durations["assembly"]["policy"], POLICY)
            self.assertEqual(
                durations["assembly"]["integrityPolicy"],
                "hash-bound-sample-ledger-v1",
            )
            self.assertTrue(validate_run_assembly(
                str(fixture.outputs["audio"]),
                str(fixture.outputs["durations"]),
                lambda path: validate_pcm16_mono_wav(path, 1000),
            ))
            with wave.open(str(fixture.outputs["audio"]), "rb") as output:
                self.assertEqual(output.getnframes(), 19040)

    def test_exact_half_frame_uses_the_shared_positive_boundary_rounding(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            fixture = AssemblyFixture(Path(temp), rate=1000, fps=30)
            fixture.add_chunk("chunk-1", [("scene-a", "alpha", 150)])
            fixture.add_chunk("chunk-2", [("scene-b", "beta", 150)])
            result = fixture.run()
            self.assertEqual(result.returncode, 0, result.stderr)

            durations = fixture.read_json(fixture.outputs["durations"])
            self.assertEqual([scene["startFrame"] for scene in durations["scenes"]], [0, 5])
            self.assertEqual([scene["frames"] for scene in durations["scenes"]], [5, 4])
            self.assertEqual(durations["totalFrames"], 9)
            self.assertTrue(validate_run_assembly(
                str(fixture.outputs["audio"]),
                str(fixture.outputs["durations"]),
                lambda path: validate_pcm16_mono_wav(path, 1000),
            ))


if __name__ == "__main__":
    unittest.main()
