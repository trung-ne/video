"""Focused regression tests for shared, synthesis-safe Edge TTS clips."""

import asyncio
import importlib.util
import json
import os
import shutil
import sys
import tempfile
import threading
import types
import unittest
from types import SimpleNamespace
from unittest import mock

from scripts.tts_scene_cache import cache_key_sha256, validate_run_assembly, validate_pcm16_mono_wav

sys.modules.setdefault("edge_tts", types.SimpleNamespace())
SPEC = importlib.util.spec_from_file_location("tts_edge", os.path.join(os.path.dirname(__file__), "tts_edge.py"))
tts_edge = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(tts_edge)


def fake_edge_validator(path):
    with open(path, "rb") as source:
        payload = source.read()
    if not payload.startswith(b"raw:"):
        raise ValueError("invalid fake MP3")
    return {
        **tts_edge.EDGE_EXPECTED_MEDIA,
        "decodedSampleRateHz": 24000,
        "decodedSamples": 2400,
    }


def fake_decode(_path, target_sr):
    return [0.0] * 2400, target_sr


class EdgeTtsIdentityTest(unittest.TestCase):
    def key(self, **overrides):
        values = {
            "text": "Café",
            "voice": "vi-VN-HoaiMyNeural",
            "sample_rate": 24000,
            "engine_version": "7.2.8",
            "cache_epoch": "edge-epoch-a",
            "language": "vi-VN",
            "rate": "+0%",
            "volume": "+0%",
            "pitch": "+0Hz",
            "options": {"transportOption": "a"},
        }
        values.update(overrides)
        return tts_edge.tts_cache_key(**values)

    def test_unicode_normalization_reuses_one_identity(self):
        self.assertEqual(self.key(text="Café"), self.key(text="Café"))

    def test_every_edge_synthesis_input_changes_the_address(self):
        baseline = cache_key_sha256(self.key())
        mutations = [
            {"text": "Cafés"},
            {"voice": "vi-VN-NamMinhNeural"},
            {"sample_rate": 22050},
            {"engine_version": "7.3.0"},
            {"cache_epoch": "edge-epoch-b"},
            {"language": "en-US"},
            {"rate": "+5%"},
            {"volume": "-2%"},
            {"pitch": "+3Hz"},
            {"options": {"transportOption": "b"}},
        ]
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                self.assertNotEqual(baseline, cache_key_sha256(self.key(**mutation)))

    def test_remote_revision_is_explicitly_opaque_and_epoch_is_deliberate(self):
        key = self.key()
        self.assertEqual(key["provider"]["version"], "opaque")
        self.assertEqual(key["options"]["remoteRevision"], "opaque")
        self.assertEqual(key["options"]["cacheEpoch"], "edge-epoch-a")
        self.assertFalse(key["gapPolicy"]["rawClipIncludesGap"])


class EdgeTtsSharedCacheRunTest(unittest.TestCase):
    def make_args(self, scenes, outdir, cache_dir, terminal_gap=False, force=False, start_index=None):
        scenes_path = os.path.join(outdir, "tts_scenes.json")
        os.makedirs(outdir, exist_ok=True)
        with open(scenes_path, "w", encoding="utf-8") as output:
            json.dump(scenes, output, ensure_ascii=False)
        return SimpleNamespace(
            scenes=scenes_path,
            outdir=outdir,
            manifest=None,
            voice="vi-VN-HoaiMyNeural",
            rate="+0%",
            volume="+0%",
            pitch="+0Hz",
            gap=0.08,
            terminal_gap=terminal_gap,
            cache_dir=cache_dir,
            cache_epoch="edge-test-v1",
            force=force,
            start_index=start_index,
        )

    def patches(self, synthesized):
        async def fake_speak(text, voice, out_path, **options):
            synthesized.append((text, voice, options))
            with open(out_path, "wb") as output:
                output.write(("raw:" + text).encode("utf-8"))
        return (
            mock.patch.object(tts_edge, "edge_engine_version", return_value="7.2.8"),
            mock.patch.object(tts_edge, "speak_scene", side_effect=fake_speak),
            mock.patch.object(tts_edge, "validate_edge_mp3", side_effect=fake_edge_validator),
            mock.patch.object(tts_edge, "mp3_to_wav_samples", side_effect=fake_decode),
        )

    def test_rejects_unsafe_missing_and_duplicate_scene_ids_before_engine_setup(self):
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
                args = self.make_args(scenes, os.path.join(temp, "run"), os.path.join(temp, "cache"))
                with mock.patch.object(tts_edge, "edge_engine_version") as engine_setup, \
                        self.assertRaisesRegex(ValueError, expected_error):
                    asyncio.run(tts_edge.main_async(args))
                engine_setup.assert_not_called()
                self.assertFalse(any(name.endswith((".mp3", ".wav", ".tts-cache.json"))
                                     for name in os.listdir(args.outdir)))

    def test_separate_core_and_proof_dirs_reuse_identical_raw_clips(self):
        with tempfile.TemporaryDirectory() as temp:
            cache_dir = os.path.join(temp, "cache")
            scenes = [
                {"id": "scene-a", "text": "First line."},
                {"id": "scene-b", "text": "Second line."},
            ]
            core = self.make_args(scenes, os.path.join(temp, "core"), cache_dir, terminal_gap=True)
            proof = self.make_args(scenes, os.path.join(temp, "proof"), cache_dir, terminal_gap=False)
            synthesized = []
            patches = self.patches(synthesized)
            with patches[0], patches[1], patches[2], patches[3]:
                asyncio.run(tts_edge.main_async(core))
                asyncio.run(tts_edge.main_async(proof))

            self.assertEqual(len(synthesized), 2, "proof run should be fully cache-backed")
            for scene_id in ("scene-a", "scene-b"):
                with open(os.path.join(core.outdir, f"{scene_id}.mp3"), "rb") as left, \
                        open(os.path.join(proof.outdir, f"{scene_id}.mp3"), "rb") as right:
                    self.assertEqual(left.read(), right.read())

    def test_one_scene_terminal_and_no_gap_share_raw_but_have_distinct_ledgers(self):
        with tempfile.TemporaryDirectory() as temp:
            cache_dir = os.path.join(temp, "cache")
            scenes = [{"id": "scene-a", "text": "One line."}]
            terminal = self.make_args(scenes, os.path.join(temp, "terminal"), cache_dir, terminal_gap=True)
            no_gap = self.make_args(scenes, os.path.join(temp, "no-gap"), cache_dir, terminal_gap=False)
            synthesized = []
            patches = self.patches(synthesized)
            with patches[0], patches[1], patches[2], patches[3]:
                asyncio.run(tts_edge.main_async(terminal))
                asyncio.run(tts_edge.main_async(no_gap))

            self.assertEqual(len(synthesized), 1)
            with open(os.path.join(terminal.outdir, "durations.json"), encoding="utf-8") as source:
                terminal_manifest = json.load(source)
            with open(os.path.join(no_gap.outdir, "durations.json"), encoding="utf-8") as source:
                no_gap_manifest = json.load(source)
            self.assertEqual(terminal_manifest["ttsMetrics"]["interSceneGapCount"], 0)
            self.assertEqual(terminal_manifest["ttsMetrics"]["terminalGapCount"], 1)
            self.assertEqual(terminal_manifest["ttsMetrics"]["maxInterSceneGapSeconds"], 0)
            self.assertEqual(no_gap_manifest["ttsMetrics"]["terminalGapCount"], 0)
            self.assertEqual(terminal_manifest["scenes"][0]["gapSamples"], 1920)
            self.assertEqual(no_gap_manifest["scenes"][0]["gapSamples"], 0)
            self.assertEqual(
                terminal_manifest["scenes"][0]["rawClipSha256"],
                no_gap_manifest["scenes"][0]["rawClipSha256"],
            )

    def test_start_index_imports_compatible_local_clip_when_shared_cache_is_gone(self):
        with tempfile.TemporaryDirectory() as temp:
            outdir = os.path.join(temp, "run")
            first_cache = os.path.join(temp, "cache-a")
            scenes = [
                {"id": "scene-a", "text": "First line."},
                {"id": "scene-b", "text": "Second line."},
            ]
            synthesized = []
            patches = self.patches(synthesized)
            with patches[0], patches[1], patches[2], patches[3]:
                asyncio.run(tts_edge.main_async(self.make_args(scenes, outdir, first_cache)))
                shutil.rmtree(first_cache)
                resumed = self.make_args(
                    scenes, outdir, os.path.join(temp, "cache-b"), force=True, start_index=1
                )
                asyncio.run(tts_edge.main_async(resumed))
            self.assertEqual([item[0] for item in synthesized], ["First line.", "Second line.", "Second line."])

    def test_start_index_prefers_committed_run_clip_over_repointed_shared_address(self):
        with tempfile.TemporaryDirectory() as temp:
            outdir = os.path.join(temp, "run")
            cache_dir = os.path.join(temp, "cache")
            scenes = [
                {"id": "scene-a", "text": "First line."},
                {"id": "scene-b", "text": "Second line."},
            ]
            synthesized = []
            patches = self.patches(synthesized)
            with patches[0], patches[1], patches[2], patches[3]:
                initial = self.make_args(scenes, outdir, cache_dir)
                asyncio.run(tts_edge.main_async(initial))
                scene_a = os.path.join(outdir, "scene-a.mp3")
                with open(scene_a, "rb") as source:
                    committed_bytes = source.read()

                replacement = os.path.join(temp, "replacement.mp3")
                with open(replacement, "wb") as output:
                    output.write(b"raw:replacement-valid-provider-output")
                key = tts_edge.tts_cache_key(
                    "First line.",
                    initial.voice,
                    24000,
                    engine_version="7.2.8",
                    cache_epoch=initial.cache_epoch,
                    rate=initial.rate,
                    volume=initial.volume,
                    pitch=initial.pitch,
                )
                tts_edge.publish_scene_clip(
                    cache_dir,
                    key,
                    replacement,
                    ".mp3",
                    fake_edge_validator,
                    tts_edge.EDGE_EXPECTED_MEDIA,
                )

                resumed = self.make_args(
                    scenes, outdir, cache_dir, force=True, start_index=1
                )
                asyncio.run(tts_edge.main_async(resumed))
                with open(scene_a, "rb") as source:
                    self.assertEqual(source.read(), committed_bytes)
            self.assertEqual(
                [item[0] for item in synthesized],
                ["First line.", "Second line.", "Second line."],
            )

    def test_engine_recheck_under_lock_prevents_duplicate_synthesis(self):
        with tempfile.TemporaryDirectory() as temp:
            cache_dir = os.path.join(temp, "cache")
            scenes = [{"id": "scene-a", "text": "Race line."}]
            args_a = self.make_args(scenes, os.path.join(temp, "a"), cache_dir)
            args_b = self.make_args(scenes, os.path.join(temp, "b"), cache_dir)
            synthesized = []
            failures = []
            barrier = threading.Barrier(2)

            async def fake_speak(text, _voice, out_path, **_options):
                synthesized.append(text)
                await asyncio.sleep(0.05)
                with open(out_path, "wb") as output:
                    output.write(("raw:" + text).encode("utf-8"))

            def worker(args):
                try:
                    barrier.wait()
                    asyncio.run(tts_edge.main_async(args))
                except BaseException as error:
                    failures.append(error)

            with mock.patch.object(tts_edge, "edge_engine_version", return_value="7.2.8"), \
                    mock.patch.object(tts_edge, "speak_scene", side_effect=fake_speak), \
                    mock.patch.object(tts_edge, "validate_edge_mp3", side_effect=fake_edge_validator), \
                    mock.patch.object(tts_edge, "mp3_to_wav_samples", side_effect=fake_decode):
                threads = [threading.Thread(target=worker, args=(args,)) for args in (args_a, args_b)]
                for thread in threads:
                    thread.start()
                for thread in threads:
                    thread.join(10)
            self.assertFalse(failures)
            self.assertEqual(synthesized, ["Race line."])
            for args in (args_a, args_b):
                self.assertTrue(validate_run_assembly(
                    os.path.join(args.outdir, "voice.wav"),
                    os.path.join(args.outdir, "durations.json"),
                    lambda path: validate_pcm16_mono_wav(path, 24000),
                ))


if __name__ == "__main__":
    unittest.main()
