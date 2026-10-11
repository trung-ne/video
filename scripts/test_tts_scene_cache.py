"""Focused tests for the shared Route A scene-clip cache."""

import errno
import json
import multiprocessing
import os
import tempfile
import threading
import time
import unittest
import wave
from unittest import mock

from scripts import tts_scene_cache as cache


EXPECTED_TAGGED_MEDIA = {
    "container": "test",
    "codec": "test-pcm",
    "sampleRateHz": 24000,
    "channels": 1,
}


def tagged_validator(path):
    with open(path, "rb") as source:
        payload = source.read()
    if not payload.startswith(b"VALID-AUDIO:"):
        raise ValueError("malformed test audio")
    return {**EXPECTED_TAGGED_MEDIA, "payloadBytes": len(payload)}


def identity(**overrides):
    values = {
        "narration": "A normalized scene.",
        "engine": "test-engine",
        "engine_version": "1.2.3",
        "provider": "test-provider",
        "provider_version": "2026-01",
        "voice": "voice-a",
        "language": "en-US",
        "sample_rate_hz": 24000,
        "speed": 1.0,
        "rate": None,
        "volume": None,
        "pitch": None,
        "options": {"format": "raw"},
        "gap_policy_version": "gap-v1",
    }
    values.update(overrides)
    return cache.build_scene_clip_identity(**values)


def write_wav(path, samples, sample_rate=24000, value=0):
    with wave.open(path, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(int(value).to_bytes(2, "little", signed=True) * samples)


def manifest_for_samples(samples):
    scenes = [{
        "id": "scene-a",
        "speechSamples": samples,
        "gapSamples": 0,
        "gapPlacement": "none",
        "samples": samples,
        "startSample": 0,
        "rawClipCacheKeySha256": "a" * 64,
        "rawClipSha256": "b" * 64,
    }]
    total_frames = cache.apply_cumulative_frame_boundaries(scenes, 24000, 30)
    return {
        "fps": 30,
        "sampleRate": 24000,
        "totalSamples": samples,
        "totalFrames": total_frames,
        "scenes": scenes,
    }


def lock_process_worker(cache_dir, source_path, marker_path, result_queue):
    key = identity()
    try:
        hit = cache.lookup_scene_clip(
            cache_dir, key, ".mp3", tagged_validator, EXPECTED_TAGGED_MEDIA
        )
        if hit is None:
            with cache.scene_clip_lock(cache_dir, key, timeout_sec=10):
                hit = cache.lookup_scene_clip(
                    cache_dir, key, ".mp3", tagged_validator, EXPECTED_TAGGED_MEDIA
                )
                if hit is None:
                    with open(marker_path, "a", encoding="utf-8") as marker:
                        marker.write(f"{os.getpid()}\n")
                    time.sleep(0.1)
                    hit = cache.publish_scene_clip(
                        cache_dir, key, source_path, ".mp3", tagged_validator, EXPECTED_TAGGED_MEDIA
                    )
        result_queue.put(hit is not None)
    except BaseException as error:
        result_queue.put(repr(error))


class SceneClipIdentityTest(unittest.TestCase):
    def test_normalized_narration_has_one_content_address(self):
        composed = identity(narration="  Café  ")
        decomposed = identity(narration="Café")
        self.assertEqual(composed, decomposed)
        self.assertEqual(cache.cache_key_sha256(composed), cache.cache_key_sha256(decomposed))

    def test_raw_identity_excludes_concrete_gap_but_binds_policy_version(self):
        key = identity()
        self.assertEqual(key["gapPolicy"], {"version": "gap-v1", "rawClipIncludesGap": False})
        terminal = cache.build_gap_assembly_record(
            gap_policy_version="gap-v1", gap_seconds=0.08, sample_rate_hz=24000, placement="terminal"
        )
        no_gap = cache.build_gap_assembly_record(
            gap_policy_version="gap-v1", gap_seconds=0.08, sample_rate_hz=24000, placement="none"
        )
        self.assertEqual(terminal["effectiveSamples"], 1920)
        self.assertEqual(no_gap["effectiveSamples"], 0)
        self.assertNotEqual(terminal, no_gap)

    def test_nonfinite_gap_is_rejected_before_negative_gap_clamping(self):
        for value in (float("nan"), float("inf"), -float("inf"), "nan"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                cache.normalize_gap_seconds(value)
            with self.subTest(builder_value=value), self.assertRaises(ValueError):
                cache.build_gap_assembly_record(
                    gap_policy_version="gap-v1",
                    gap_seconds=value,
                    sample_rate_hz=24000,
                    placement="inter-scene",
                )
        self.assertEqual(cache.normalize_gap_seconds(-1), 0.0)

    def test_half_frame_boundary_uses_one_explicit_js_rounding_policy(self):
        self.assertEqual(cache.samples_to_frame_boundary(400, 24000, 30), 1)
        scenes = [{"id": "half-frame", "startSample": 0, "samples": 400}]
        self.assertEqual(cache.apply_cumulative_frame_boundaries(scenes, 24000, 30), 1)
        self.assertEqual(scenes[0]["frames"], 1)

    def test_one_hundred_scenes_use_cumulative_sample_frame_boundaries(self):
        scenes = []
        start = 0
        for index in range(100):
            scenes.append({"id": str(index), "startSample": start, "samples": 1000})
            start += 1000
        total_frames = cache.apply_cumulative_frame_boundaries(scenes, 24000, 30)
        self.assertEqual(total_frames, 125)
        self.assertEqual(sum(scene["frames"] for scene in scenes), 125)
        self.assertEqual(scenes[-1]["startFrame"] + scenes[-1]["frames"], 125)


class SceneClipPublicationTest(unittest.TestCase):
    def test_publish_lookup_and_materialize_validate_exact_audio_and_media(self):
        with tempfile.TemporaryDirectory() as temp:
            source = os.path.join(temp, "source.mp3")
            destination = os.path.join(temp, "run", "scene.mp3")
            cache_dir = os.path.join(temp, "cache")
            payload = b"VALID-AUDIO:raw-scene"
            with open(source, "wb") as output:
                output.write(payload)

            entry = cache.publish_scene_clip(
                cache_dir, identity(), source, ".mp3", tagged_validator, EXPECTED_TAGGED_MEDIA
            )
            hit = cache.lookup_scene_clip(
                cache_dir, identity(), ".mp3", tagged_validator, EXPECTED_TAGGED_MEDIA
            )
            self.assertEqual(hit, entry)
            cache.materialize_scene_clip(hit, destination)
            with open(destination, "rb") as materialized:
                self.assertEqual(materialized.read(), payload)
            with open(entry.metadata_path, encoding="utf-8") as sidecar:
                metadata = json.load(sidecar)
            self.assertEqual(metadata["audio"]["media"], tagged_validator(source))

    def test_sidecar_parser_failures_are_cache_misses(self):
        with tempfile.TemporaryDirectory() as temp:
            sidecar = os.path.join(temp, "entry.json")
            with open(sidecar, "w", encoding="utf-8") as output:
                output.write("{}")
            for failure in (ValueError("parser failure"), RecursionError("too deep")):
                with self.subTest(failure=type(failure).__name__), \
                        mock.patch.object(cache.json, "load", side_effect=failure):
                    self.assertIsNone(cache._load_json_sidecar(sidecar))

    def test_malformed_audio_is_rejected_before_cache_commit(self):
        with tempfile.TemporaryDirectory() as temp:
            source = os.path.join(temp, "poison.mp3")
            cache_dir = os.path.join(temp, "cache")
            with open(source, "wb") as output:
                output.write(b"not decodable")
            with self.assertRaises(ValueError):
                cache.publish_scene_clip(
                    cache_dir, identity(), source, ".mp3", tagged_validator, EXPECTED_TAGGED_MEDIA
                )
            with self.assertRaises(ValueError):
                cache.publish_scene_clip(
                    cache_dir,
                    identity(),
                    source,
                    ".mp3",
                    tagged_validator,
                    EXPECTED_TAGGED_MEDIA,
                    validated_media=EXPECTED_TAGGED_MEDIA,
                )
            self.assertIsNone(cache.lookup_scene_clip(
                cache_dir, identity(), ".mp3", tagged_validator, EXPECTED_TAGGED_MEDIA
            ))

    def test_tampered_audio_or_codec_sidecar_is_never_reused(self):
        with tempfile.TemporaryDirectory() as temp:
            source = os.path.join(temp, "source.wav")
            with open(source, "wb") as output:
                output.write(b"VALID-AUDIO:original")
            key = identity(options={"format": "wav"})
            entry = cache.publish_scene_clip(
                os.path.join(temp, "cache"), key, source, ".wav", tagged_validator, EXPECTED_TAGGED_MEDIA
            )
            with open(entry.audio_path, "wb") as output:
                output.write(b"poison")
            self.assertIsNone(cache.lookup_scene_clip(
                os.path.join(temp, "cache"), key, ".wav", tagged_validator, EXPECTED_TAGGED_MEDIA
            ))

            entry = cache.publish_scene_clip(
                os.path.join(temp, "cache"), key, source, ".wav", tagged_validator, EXPECTED_TAGGED_MEDIA
            )
            with open(entry.metadata_path, "r+", encoding="utf-8") as sidecar:
                metadata = json.load(sidecar)
                metadata["audio"]["media"]["codec"] = "poison-codec"
                sidecar.seek(0)
                json.dump(metadata, sidecar)
                sidecar.truncate()
            self.assertIsNone(cache.lookup_scene_clip(
                os.path.join(temp, "cache"), key, ".wav", tagged_validator, EXPECTED_TAGGED_MEDIA
            ))

    def test_failed_sidecar_commit_keeps_previous_entry_safe(self):
        with tempfile.TemporaryDirectory() as temp:
            cache_dir = os.path.join(temp, "cache")
            old_source = os.path.join(temp, "old.mp3")
            new_source = os.path.join(temp, "new.mp3")
            with open(old_source, "wb") as output:
                output.write(b"VALID-AUDIO:old")
            with open(new_source, "wb") as output:
                output.write(b"VALID-AUDIO:new")
            key = identity()
            old_entry = cache.publish_scene_clip(
                cache_dir, key, old_source, ".mp3", tagged_validator, EXPECTED_TAGGED_MEDIA
            )
            with mock.patch.object(cache, "_atomic_write_bytes", side_effect=OSError("simulated crash")):
                with self.assertRaises(OSError):
                    cache.publish_scene_clip(
                        cache_dir, key, new_source, ".mp3", tagged_validator, EXPECTED_TAGGED_MEDIA
                    )
            hit = cache.lookup_scene_clip(
                cache_dir, key, ".mp3", tagged_validator, EXPECTED_TAGGED_MEDIA
            )
            self.assertEqual(hit.audio_sha256, old_entry.audio_sha256)

    def test_windows_sharing_error_is_retried(self):
        with tempfile.TemporaryDirectory() as temp:
            source = os.path.join(temp, "source")
            destination = os.path.join(temp, "destination")
            with open(source, "wb") as output:
                output.write(b"bytes")
            original_replace = os.replace
            calls = []

            def flaky_replace(left, right):
                calls.append((left, right))
                if len(calls) == 1:
                    raise PermissionError(errno.EACCES, "sharing violation")
                return original_replace(left, right)

            with mock.patch.object(cache.os, "replace", side_effect=flaky_replace), \
                    mock.patch.object(cache.time, "sleep"):
                cache.replace_file_atomically(source, destination)
            self.assertEqual(len(calls), 2)
            self.assertTrue(os.path.isfile(destination))

    def test_key_lock_recheck_prevents_duplicate_synthesis(self):
        with tempfile.TemporaryDirectory() as temp:
            cache_dir = os.path.join(temp, "cache")
            key = identity()
            barrier = threading.Barrier(2)
            syntheses = []
            failures = []

            def worker(number):
                try:
                    barrier.wait()
                    hit = cache.lookup_scene_clip(
                        cache_dir, key, ".mp3", tagged_validator, EXPECTED_TAGGED_MEDIA
                    )
                    if hit is None:
                        with cache.scene_clip_lock(cache_dir, key, timeout_sec=5):
                            hit = cache.lookup_scene_clip(
                                cache_dir, key, ".mp3", tagged_validator, EXPECTED_TAGGED_MEDIA
                            )
                            if hit is None:
                                syntheses.append(number)
                                source = os.path.join(temp, f"source-{number}.mp3")
                                with open(source, "wb") as output:
                                    output.write(b"VALID-AUDIO:race")
                                time.sleep(0.05)
                                hit = cache.publish_scene_clip(
                                    cache_dir, key, source, ".mp3", tagged_validator, EXPECTED_TAGGED_MEDIA
                                )
                    self.assertIsNotNone(hit)
                except BaseException as error:
                    failures.append(error)

            threads = [threading.Thread(target=worker, args=(number,)) for number in range(2)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(10)
            self.assertFalse(failures)
            self.assertEqual(len(syntheses), 1)

    def test_key_lock_serializes_independent_processes(self):
        with tempfile.TemporaryDirectory() as temp:
            cache_dir = os.path.join(temp, "cache")
            source = os.path.join(temp, "source.mp3")
            marker = os.path.join(temp, "syntheses.txt")
            with open(source, "wb") as output:
                output.write(b"VALID-AUDIO:process-race")
            context = multiprocessing.get_context("spawn")
            results = context.Queue()
            processes = [
                context.Process(
                    target=lock_process_worker,
                    args=(cache_dir, source, marker, results),
                )
                for _ in range(2)
            ]
            for process in processes:
                process.start()
            for process in processes:
                process.join(15)
            self.assertTrue(all(process.exitcode == 0 for process in processes))
            self.assertEqual([results.get(timeout=2) for _ in processes], [True, True])
            with open(marker, encoding="utf-8") as synthesized:
                self.assertEqual(len(synthesized.readlines()), 1)
    def test_competing_stale_reclaimers_cannot_unlink_a_fresh_owner(self):
        with tempfile.TemporaryDirectory() as temp:
            key_digest, shard_dir, _metadata = cache._cache_paths(temp, identity())
            os.makedirs(shard_dir, exist_ok=True)
            lock_path = os.path.join(shard_dir, f"{key_digest}.lock")
            with open(lock_path, "w", encoding="utf-8") as output:
                json.dump({
                    "schemaVersion": cache.LOCK_SCHEMA_VERSION,
                    "pid": 2147483647,
                    "token": "dead-owner",
                    "createdUnixNs": 1,
                }, output)

            barrier = threading.Barrier(2)
            outcomes = []

            def reclaimer():
                barrier.wait()
                outcomes.append(cache._try_reclaim_stale_lock(lock_path, 0))

            threads = [threading.Thread(target=reclaimer) for _ in range(2)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(5)
            self.assertEqual(sorted(outcomes), [False, True])
            self.assertFalse(os.path.exists(lock_path))

            with open(lock_path, "w", encoding="utf-8") as output:
                json.dump({
                    "schemaVersion": cache.LOCK_SCHEMA_VERSION,
                    "pid": os.getpid(),
                    "token": "fresh-owner",
                    "createdUnixNs": time.time_ns(),
                }, output)
            self.assertFalse(cache._try_reclaim_stale_lock(lock_path, 0))
            with open(lock_path, encoding="utf-8") as source:
                self.assertEqual(json.load(source)["token"], "fresh-owner")

    def test_reclaimer_revalidates_the_exact_observed_generation_before_unlink(self):
        with tempfile.TemporaryDirectory() as temp:
            lock_path = os.path.join(temp, "address.lock")
            with open(lock_path, "w", encoding="utf-8") as output:
                output.write("fresh")
            stale = {"identity": (1,), "payloadSha256": "a" * 64, "reclaimable": True}
            replacement = {"identity": (2,), "payloadSha256": "b" * 64, "reclaimable": False}
            with mock.patch.object(cache, "_lock_observation", side_effect=[stale, replacement]):
                self.assertFalse(cache._try_reclaim_stale_lock(lock_path, 0))
            self.assertTrue(os.path.isfile(lock_path))


class AssemblyPublicationTest(unittest.TestCase):
    def test_publication_rejects_frames_not_derived_from_sample_boundaries(self):
        with tempfile.TemporaryDirectory() as temp:
            staged = os.path.join(temp, "staged.wav")
            write_wav(staged, 2400)
            manifest = manifest_for_samples(2400)
            manifest["scenes"][0]["frames"] += 1
            with self.assertRaisesRegex(ValueError, "cumulative sample boundaries"):
                cache.publish_run_assembly(
                    staged,
                    os.path.join(temp, "voice.wav"),
                    manifest,
                    os.path.join(temp, "durations.json"),
                    lambda path: cache.validate_pcm16_mono_wav(path, 24000),
                )

    def test_interrupted_manifest_commit_cannot_validate_new_audio_with_stale_manifest(self):
        with tempfile.TemporaryDirectory() as temp:
            audio = os.path.join(temp, "voice.wav")
            manifest_path = os.path.join(temp, "durations.json")
            old_staged = os.path.join(temp, "old.wav")
            write_wav(old_staged, 2400, value=1)
            cache.publish_run_assembly(
                old_staged, audio, manifest_for_samples(2400), manifest_path,
                lambda path: cache.validate_pcm16_mono_wav(path, 24000),
            )
            self.assertTrue(cache.validate_run_assembly(
                audio, manifest_path, lambda path: cache.validate_pcm16_mono_wav(path, 24000)
            ))

            new_staged = os.path.join(temp, "new.wav")
            write_wav(new_staged, 2400, value=2)
            original_replace = cache.replace_file_atomically
            calls = 0

            def fail_manifest_replace(source, destination):
                nonlocal calls
                calls += 1
                if calls == 2:
                    raise OSError("simulated manifest publication interruption")
                return original_replace(source, destination)

            with mock.patch.object(cache, "replace_file_atomically", side_effect=fail_manifest_replace):
                with self.assertRaises(OSError):
                    cache.publish_run_assembly(
                        new_staged, audio, manifest_for_samples(2400), manifest_path,
                        lambda path: cache.validate_pcm16_mono_wav(path, 24000),
                    )
            self.assertFalse(cache.validate_run_assembly(
                audio, manifest_path, lambda path: cache.validate_pcm16_mono_wav(path, 24000)
            ))


if __name__ == "__main__":
    unittest.main()
