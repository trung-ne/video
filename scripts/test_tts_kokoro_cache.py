"""Focused tests for Kokoro's checkpoint-bound shared cache contract."""

import json
import os
import sys
import tempfile
import unittest
import wave
from unittest import mock

from scripts import tts_kokoro
from scripts.tts_scene_cache import cache_key_sha256


FAKE_KOKORO_DEPENDENCY_VERSIONS = {
    "misaki": "0.9.4",
    "espeak": "1.0.3",
    "torch": "2.8.0",
    "numpy": "2.4.6",
}


def write_wav(path, samples=2400, sample_rate=24000, value=0):
    with wave.open(path, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(int(value).to_bytes(2, "little", signed=True) * samples)


def make_model_dir(root, model_bytes=b"model-a"):
    model_dir = os.path.join(root, "model")
    os.makedirs(os.path.join(model_dir, "voices"), exist_ok=True)
    with open(os.path.join(model_dir, "config.json"), "wb") as output:
        output.write(b'{"config":"test"}')
    with open(os.path.join(model_dir, "kokoro-v1_0.pth"), "wb") as output:
        output.write(model_bytes)
    with open(os.path.join(model_dir, "voices", "af_heart.pt"), "wb") as output:
        output.write(b"voice-a")
    return model_dir


class KokoroTtsIdentityTest(unittest.TestCase):
    def model_identity(self, digest="a" * 64):
        return {
            "repoId": tts_kokoro.KOKORO_PROVIDER,
            "requestedRevision": "main",
            "resolvedRevision": "local",
            "artifacts": [{"role": "model", "sha256": digest, "sizeBytes": 1}],
            "contentSha256": digest,
        }

    def dependency_versions(self, **overrides):
        versions = dict(FAKE_KOKORO_DEPENDENCY_VERSIONS)
        versions.update(overrides)
        return versions

    def key(self, **overrides):
        values = {
            "text": "A café example.",
            "voice": "af_heart",
            "language": "a",
            "sample_rate": 24000,
            "model_identity": self.model_identity(),
            "dependency_versions": self.dependency_versions(),
            "engine_version": "0.9.4",
            "speed": 1.0,
            "device": "cpu",
            "options": {"pipelineOption": "a"},
        }
        values.update(overrides)
        return tts_kokoro.tts_cache_key(**values)

    def test_unicode_normalization_reuses_one_identity(self):
        self.assertEqual(self.key(text="Café"), self.key(text="Café"))

    def test_every_kokoro_synthesis_input_changes_the_address(self):
        baseline = cache_key_sha256(self.key())
        mutations = [
            {"text": "Another example."},
            {"voice": "am_adam"},
            {"language": "b"},
            {"sample_rate": 22050},
            {"engine_version": "0.9.5"},
            {"model_identity": self.model_identity("b" * 64)},
            {"dependency_versions": self.dependency_versions(misaki="0.9.5")},
            {"dependency_versions": self.dependency_versions(espeak="1.0.4")},
            {"dependency_versions": self.dependency_versions(torch="2.9.0")},
            {"dependency_versions": self.dependency_versions(numpy="2.4.7")},
            {"speed": 1.1},
            {"device": "cuda"},
            {"options": {"pipelineOption": "b"}},
        ]
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                self.assertNotEqual(baseline, cache_key_sha256(self.key(**mutation)))

    def test_missing_or_unknown_runtime_dependency_version_is_rejected(self):
        missing = self.dependency_versions()
        del missing["misaki"]
        with self.assertRaises(ValueError):
            self.key(dependency_versions=missing)
        with self.assertRaises(RuntimeError):
            self.key(dependency_versions=self.dependency_versions(espeak="unknown"))

    def test_invalid_speed_is_rejected_before_cache_or_pipeline(self):
        for speed in (0, -1, float("nan"), float("inf"), -float("inf")):
            with self.subTest(speed=speed), self.assertRaises(ValueError):
                self.key(speed=speed)

    def test_actual_checkpoint_bytes_change_model_and_clip_identity(self):
        with tempfile.TemporaryDirectory() as temp:
            model_dir = make_model_dir(temp, b"checkpoint-one")
            first = tts_kokoro.resolve_kokoro_artifacts(
                "af_heart", tts_kokoro.KOKORO_PROVIDER, "main", model_dir
            )
            with open(os.path.join(model_dir, "kokoro-v1_0.pth"), "wb") as output:
                output.write(b"checkpoint-two")
            second = tts_kokoro.resolve_kokoro_artifacts(
                "af_heart", tts_kokoro.KOKORO_PROVIDER, "main", model_dir
            )
            self.assertNotEqual(
                first["identity"]["contentSha256"], second["identity"]["contentSha256"]
            )
            self.assertNotEqual(
                cache_key_sha256(self.key(model_identity=first["identity"])),
                cache_key_sha256(self.key(model_identity=second["identity"])),
            )

    def test_malformed_wav_cannot_be_published(self):
        with tempfile.TemporaryDirectory() as temp:
            malformed = os.path.join(temp, "bad.wav")
            with open(malformed, "wb") as output:
                output.write(b"not a wav")
            with self.assertRaises(ValueError):
                tts_kokoro.publish_scene_clip(
                    os.path.join(temp, "cache"),
                    self.key(),
                    malformed,
                    ".wav",
                    tts_kokoro.validate_kokoro_wav,
                    tts_kokoro.KOKORO_EXPECTED_MEDIA,
                )


class KokoroSharedCacheRunTest(unittest.TestCase):
    def run_main(
        self,
        scenes_path,
        outdir,
        cache_dir,
        model_dir,
        *,
        terminal_gap=False,
        force=False,
        start_index=None,
    ):
        argv = [
            "tts_kokoro.py",
            "--scenes", scenes_path,
            "--outdir", outdir,
            "--cache-dir", cache_dir,
            "--model-dir", model_dir,
        ]
        if terminal_gap:
            argv.append("--terminal-gap")
        if force:
            argv.append("--force")
        if start_index is not None:
            argv.extend(["--start-index", str(start_index)])
        with mock.patch.object(sys, "argv", argv):
            tts_kokoro.main()

    def test_rejects_unsafe_missing_and_duplicate_scene_ids_before_model_setup(self):
        cases = (
            ([{"text": "Missing."}], "lowercase-hyphen"),
            ([{"id": "../escape", "text": "Unsafe."}], "lowercase-hyphen"),
            ([{"id": "..\\escape", "text": "Unsafe Windows path."}], "lowercase-hyphen"),
            ([{"id": "Scene-a", "text": "Uppercase."}], "lowercase-hyphen"),
            ([
                {"id": "scene-a", "text": "First."},
                {"id": "scene-a", "text": "Second."},
            ], "Duplicate TTS scene id"),
        )
        for scenes, expected_error in cases:
            with self.subTest(scenes=scenes), tempfile.TemporaryDirectory() as temp:
                scenes_path = os.path.join(temp, "tts_scenes.json")
                with open(scenes_path, "w", encoding="utf-8") as output:
                    json.dump(scenes, output)
                outdir = os.path.join(temp, "run")
                with mock.patch.object(tts_kokoro, "resolve_kokoro_artifacts") as model_setup, \
                        self.assertRaisesRegex(ValueError, expected_error):
                    self.run_main(
                        scenes_path,
                        outdir,
                        os.path.join(temp, "cache"),
                        os.path.join(temp, "model"),
                    )
                model_setup.assert_not_called()
                self.assertFalse(os.path.exists(outdir))

    def test_cache_hits_do_not_import_or_initialize_kokoro_and_reuse_raw_wavs(self):
        with tempfile.TemporaryDirectory() as temp:
            model_dir = make_model_dir(temp)
            scenes_path = os.path.join(temp, "tts_scenes.json")
            scenes = [
                {"id": "scene-a", "text": "First line."},
                {"id": "scene-b", "text": "Second line."},
            ]
            with open(scenes_path, "w", encoding="utf-8") as output:
                json.dump(scenes, output)
            core_dir = os.path.join(temp, "core")
            proof_dir = os.path.join(temp, "proof")
            cache_dir = os.path.join(temp, "cache")
            initializations = []
            syntheses = []

            def fake_initialize(artifacts, language, device):
                self.assertEqual(os.environ.get("HF_HUB_DISABLE_IMPLICIT_TOKEN"), "1")
                initializations.append((artifacts, language, device))
                return object(), object()

            def fake_synthesize(_pipeline, _np, text, voice, speed, output_path):
                syntheses.append((text, voice, speed))
                write_wav(output_path)

            with mock.patch.object(tts_kokoro, "kokoro_engine_version", return_value="0.9.4"), \
                    mock.patch.object(tts_kokoro, "kokoro_dependency_versions", return_value=dict(FAKE_KOKORO_DEPENDENCY_VERSIONS)), \
                    mock.patch.object(tts_kokoro, "initialize_kokoro_pipeline", side_effect=fake_initialize), \
                    mock.patch.object(tts_kokoro, "synthesize_kokoro_scene", side_effect=fake_synthesize):
                self.run_main(scenes_path, core_dir, cache_dir, model_dir, terminal_gap=True)
                self.run_main(scenes_path, proof_dir, cache_dir, model_dir, terminal_gap=False)

            self.assertEqual(len(initializations), 1)
            self.assertEqual(len(syntheses), 2)
            for scene_id in ("scene-a", "scene-b"):
                with open(os.path.join(core_dir, f"{scene_id}.wav"), "rb") as left, \
                        open(os.path.join(proof_dir, f"{scene_id}.wav"), "rb") as right:
                    self.assertEqual(left.read(), right.read())

    def test_start_index_prefers_committed_run_wav_over_repointed_shared_address(self):
        with tempfile.TemporaryDirectory() as temp:
            model_dir = make_model_dir(temp)
            scenes_path = os.path.join(temp, "tts_scenes.json")
            scenes = [
                {"id": "scene-a", "text": "First line."},
                {"id": "scene-b", "text": "Second line."},
            ]
            with open(scenes_path, "w", encoding="utf-8") as output:
                json.dump(scenes, output)
            outdir = os.path.join(temp, "run")
            cache_dir = os.path.join(temp, "cache")
            syntheses = []

            def fake_synthesize(_pipeline, _np, text, _voice, _speed, output_path):
                syntheses.append(text)
                write_wav(output_path, value=len(syntheses))

            with mock.patch.object(tts_kokoro, "kokoro_engine_version", return_value="0.9.4"), \
                    mock.patch.object(tts_kokoro, "kokoro_dependency_versions", return_value=dict(FAKE_KOKORO_DEPENDENCY_VERSIONS)), \
                    mock.patch.object(tts_kokoro, "initialize_kokoro_pipeline", return_value=(object(), object())), \
                    mock.patch.object(tts_kokoro, "synthesize_kokoro_scene", side_effect=fake_synthesize):
                self.run_main(scenes_path, outdir, cache_dir, model_dir)
                scene_a = os.path.join(outdir, "scene-a.wav")
                with open(scene_a, "rb") as source:
                    committed_bytes = source.read()

                artifacts = tts_kokoro.resolve_kokoro_artifacts(
                    "af_heart", tts_kokoro.KOKORO_PROVIDER, "main", model_dir
                )
                key = tts_kokoro.tts_cache_key(
                    "First line.",
                    "af_heart",
                    "a",
                    24000,
                    model_identity=artifacts["identity"],
                    dependency_versions=dict(FAKE_KOKORO_DEPENDENCY_VERSIONS),
                    engine_version="0.9.4",
                    speed=1.0,
                    device="cpu",
                )
                replacement = os.path.join(temp, "replacement.wav")
                write_wav(replacement, value=99)
                tts_kokoro.publish_scene_clip(
                    cache_dir,
                    key,
                    replacement,
                    ".wav",
                    tts_kokoro.validate_kokoro_wav,
                    tts_kokoro.KOKORO_EXPECTED_MEDIA,
                )

                self.run_main(
                    scenes_path,
                    outdir,
                    cache_dir,
                    model_dir,
                    force=True,
                    start_index=1,
                )
                with open(scene_a, "rb") as source:
                    self.assertEqual(source.read(), committed_bytes)
            self.assertEqual(syntheses, ["First line.", "Second line.", "Second line."])

    def test_streaming_writer_produces_valid_pcm_without_collecting_chunk_list(self):
        try:
            import numpy as np
        except ImportError:
            self.skipTest("numpy is not available")
        with tempfile.TemporaryDirectory() as temp:
            output_path = os.path.join(temp, "scene.wav")

            def pipeline(_text, **_options):
                yield "a", "a", np.array([0.0, 0.25], dtype=np.float32)
                yield "b", "b", np.array([-0.25, 0.5], dtype=np.float32)

            tts_kokoro.synthesize_kokoro_scene(
                pipeline, np, "text", "voice.pt", 1.0, output_path
            )
            media = tts_kokoro.validate_kokoro_wav(output_path)
            self.assertEqual(media["frameCount"], 4)


if __name__ == "__main__":
    unittest.main()
