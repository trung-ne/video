"""
tts_edge.py — Generate per-scene narration audio with Microsoft Edge TTS.

No torch/GPU required. Uses edge-tts (Microsoft Edge browser TTS engine).

Usage:
    python scripts/tts_edge.py --scenes scenes.json --outdir public/audio/<proj> \
        --voice en-US-AvaNeural

Input  (scenes.json): [{"id": "scene-01", "text": "..."}, ...]
Output (in outdir):
    voice.wav        — all scenes concatenated (the track the video plays)
    durations.json   — {"fps":30,"sampleRate":24000,"totalSec":..,
                        "scenes":[{"id":..,"sec":..,"frames":..,"startFrame":..}]}

Available voices:
  English:    en-US-AvaNeural (F), en-US-AndrewNeural (M), en-US-EmmaNeural (F)
  Vietnamese: vi-VN-HoaiMyNeural (F), vi-VN-NamMinhNeural (M)

List all voices:
    python -c "import asyncio,edge_tts; asyncio.run(edge_tts.list_voices())"
"""

import argparse
import asyncio
import json
import os
import re
import subprocess
import struct
import sys
import tempfile
import time
import wave

import edge_tts

try:
    from tts_scene_cache import (
        apply_cumulative_frame_boundaries,
        build_gap_assembly_record,
        build_scene_clip_identity,
        default_cache_dir,
        installed_distribution_version,
        lookup_run_scene_clip,
        lookup_scene_clip,
        materialize_scene_clip,
        normalize_gap_seconds,
        normalize_narration,
        publish_run_assembly,
        publish_run_scene_clip_sidecar,
        publish_scene_clip,
        replace_file_atomically,
        require_known_version,
        samples_to_frame_boundary,
        scene_clip_lock,
        validate_pcm16_mono_wav,
    )
except ModuleNotFoundError as error:
    if error.name != "tts_scene_cache":
        raise
    from scripts.tts_scene_cache import (
        apply_cumulative_frame_boundaries,
        build_gap_assembly_record,
        build_scene_clip_identity,
        default_cache_dir,
        installed_distribution_version,
        lookup_run_scene_clip,
        lookup_scene_clip,
        materialize_scene_clip,
        normalize_gap_seconds,
        normalize_narration,
        publish_run_assembly,
        publish_run_scene_clip_sidecar,
        publish_scene_clip,
        replace_file_atomically,
        require_known_version,
        samples_to_frame_boundary,
        scene_clip_lock,
        validate_pcm16_mono_wav,
    )

FPS = 30
TARGET_SR = 24000
GAP_SEC = 0.08      # short boundary between per-scene narration chunks
EDGE_ENGINE = "edge-tts"
EDGE_PROVIDER = "microsoft-edge-read-aloud"
EDGE_REMOTE_REVISION = "opaque"
EDGE_CACHE_EPOCH = "edge-remote-cache-v1"
EDGE_GAP_POLICY_VERSION = "edge-gap-0.08-v1"
EDGE_DEFAULT_RATE = "+0%"
EDGE_DEFAULT_VOLUME = "+0%"
EDGE_DEFAULT_PITCH = "+0Hz"
EDGE_OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3"
SCENE_ID_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
EDGE_EXPECTED_MEDIA = {
    "container": "mp3",
    "codec": "mp3",
    "sampleRateHz": TARGET_SR,
    "channels": 1,
}


def validate_input_scene_ids(scenes: object) -> None:
    if not isinstance(scenes, list) or not scenes:
        raise ValueError("TTS scenes must be a non-empty array")
    seen = set()
    for ordinal, scene in enumerate(scenes, 1):
        if not isinstance(scene, dict):
            raise ValueError(f"TTS scene {ordinal} must be an object")
        scene_id = scene.get("id")
        if not isinstance(scene_id, str) or not SCENE_ID_PATTERN.fullmatch(scene_id):
            raise ValueError(
                f"TTS scene {ordinal} id must match lowercase-hyphen segment syntax"
            )
        if scene_id in seen:
            raise ValueError(f"Duplicate TTS scene id: {scene_id}")
        seen.add(scene_id)


def edge_engine_version() -> str:
    return installed_distribution_version("edge-tts", edge_tts)


def edge_language_for_voice(voice: str) -> str:
    parts = voice.split("-", 2)
    return "-".join(parts[:2]) if len(parts) >= 2 else "und"


def tts_cache_key(
    text: str,
    voice: str,
    sample_rate: int,
    *,
    engine_version: str | None = None,
    cache_epoch: str = EDGE_CACHE_EPOCH,
    language: str | None = None,
    rate: str = EDGE_DEFAULT_RATE,
    volume: str = EDGE_DEFAULT_VOLUME,
    pitch: str = EDGE_DEFAULT_PITCH,
    options: dict | None = None,
) -> dict:
    """Return every synthesis input for one raw Edge clip.

    Edge does not expose a model revision. ``cache_epoch`` is therefore an
    explicit operator-controlled invalidation boundary, not a claimed remote
    provider version.
    """
    synthesis_options = {
        "outputFormat": EDGE_OUTPUT_FORMAT,
        "remoteRevision": EDGE_REMOTE_REVISION,
        "cacheEpoch": cache_epoch,
    }
    if options:
        synthesis_options.update(options)
    return build_scene_clip_identity(
        narration=text,
        engine=EDGE_ENGINE,
        engine_version=engine_version or edge_engine_version(),
        provider=EDGE_PROVIDER,
        provider_version=EDGE_REMOTE_REVISION,
        voice=voice,
        language=language or edge_language_for_voice(voice),
        sample_rate_hz=sample_rate,
        speed=None,
        rate=rate,
        volume=volume,
        pitch=pitch,
        options=synthesis_options,
        gap_policy_version=EDGE_GAP_POLICY_VERSION,
    )


def wav_to_samples(path: str):
    """Read a WAV file → (samples_list, sample_rate)."""
    with wave.open(path, "rb") as wf:
        sr = wf.getframerate()
        nch = wf.getnchannels()
        sw = wf.getsampwidth()
        raw = wf.readframes(wf.getnframes())

    # Convert to float32 mono
    if sw == 2:
        fmt = f"<{len(raw)//2}h"
        samples = list(struct.unpack(fmt, raw))
        samples = [s / 32768.0 for s in samples]
    elif sw == 3:
        # 24-bit — rare from edge-tts but handle it
        n = len(raw) // 3
        samples = []
        for i in range(n):
            b = raw[i*3:i*3+3]
            v = struct.unpack("<i", b + (b"\xff" if b[2] & 0x80 else b"\x00"))[0] >> 8
            samples.append(v / 8388608.0)
    else:
        raise ValueError(f"Unsupported sample width {sw}")

    # Mix down to mono if stereo
    if nch == 2:
        samples = [(samples[i] + samples[i+1]) / 2 for i in range(0, len(samples), 2)]

    return samples, sr


def write_wav(path: str, samples: list, sr: int):
    """Write float32 mono samples to a 16-bit PCM WAV."""
    os.makedirs(os.path.dirname(path) if os.path.dirname(path) else ".", exist_ok=True)
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        # Clamp to [-1,1] and convert to int16
        packed = struct.pack(f"<{len(samples)}h",
                             *[max(-32768, min(32767, int(s * 32767))) for s in samples])
        wf.writeframes(packed)


async def speak_scene(
    text: str,
    voice: str,
    out_path: str,
    rate: str = EDGE_DEFAULT_RATE,
    volume: str = EDGE_DEFAULT_VOLUME,
    pitch: str = EDGE_DEFAULT_PITCH,
    retries: int = 7,
):
    """Generate TTS for one scene and save to out_path (.mp3).

    edge-tts occasionally drops the websocket mid-batch (NoAudioReceived) under
    sustained sequential load; this is transient, not content-related, so retry
    with backoff before giving up.
    """
    last_err = None
    for attempt in range(retries):
        temp_path = f"{out_path}.part"
        try:
            communicate = edge_tts.Communicate(
                text,
                voice,
                rate=rate,
                volume=volume,
                pitch=pitch,
            )
            if os.path.exists(temp_path):
                os.remove(temp_path)
            # save() keeps the websocket operation inside a single cancellable
            # awaitable.  Streaming directly could leave a half-written target
            # file when Edge stalled during the final chunk.
            await asyncio.wait_for(communicate.save(temp_path), timeout=45)
            if not os.path.exists(temp_path) or os.path.getsize(temp_path) == 0:
                raise RuntimeError("Edge TTS returned an empty audio stream")
            replace_file_atomically(temp_path, out_path)
            return
        except Exception as e:
            last_err = e
            if os.path.exists(temp_path):
                os.remove(temp_path)
            print(f" [retry {attempt+1}/{retries}: {e}]", end="", flush=True)
            # Repeated NoAudioReceived errors appear during provider-side throttling.
            # Use a bounded exponential cooldown so a temporary outage can recover
            # without accepting an incomplete scene or forcing a manual restart.
            await asyncio.sleep(min(30.0, 2.5 * (2 ** attempt)))
    raise last_err


def mp3_duration_sec(path: str) -> float:
    """Estimate MP3 duration by parsing frame headers (no ffprobe needed)."""
    with open(path, "rb") as f:
        data = f.read()

    # Skip ID3 tag if present
    offset = 0
    if data[:3] == b"ID3":
        size = ((data[6] & 0x7f) << 21 | (data[7] & 0x7f) << 14 |
                (data[8] & 0x7f) << 7 | (data[9] & 0x7f))
        offset = 10 + size

    total_frames = 0
    sample_rate = 44100
    samples_per_frame = 1152

    i = offset
    while i < len(data) - 4:
        if data[i] == 0xff and (data[i+1] & 0xe0) == 0xe0:
            b1 = data[i+1]
            b2 = data[i+2]
            layer = (b1 >> 1) & 0x3
            bitrate_idx = (b2 >> 4) & 0xf
            sr_idx = (b2 >> 2) & 0x3

            sr_table = [44100, 48000, 32000, 0]
            sr = sr_table[sr_idx]
            if sr == 0 or layer != 1 or bitrate_idx == 0 or bitrate_idx == 15:
                i += 1
                continue

            bitrates = [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320,0]
            br = bitrates[bitrate_idx] * 1000
            if br == 0:
                i += 1
                continue

            frame_size = 144 * br // sr + ((b2 >> 1) & 1)
            sample_rate = sr
            total_frames += 1
            i += frame_size
        else:
            i += 1

    return (total_frames * samples_per_frame) / sample_rate if total_frames > 0 else 0.0


def mp3_to_wav_samples(mp3_path: str, target_sr: int = 24000):
    """Convert MP3 to mono PCM with a bounded ffmpeg child process.

    Certain short Edge MP3 chunks can make miniaudio block indefinitely while
    parsing their trailing metadata. ffmpeg is already a production dependency
    in this repository and lets the caller fail fast instead.
    """
    result = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", mp3_path, "-f", "s16le", "-ac", "1", "-ar", str(target_sr), "pipe:1"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=30,
        check=False,
    )
    if result.returncode != 0 or not result.stdout:
        raise RuntimeError(f"ffmpeg could not decode {mp3_path}: {result.stderr.decode('utf-8', 'replace').strip()}")
    raw = result.stdout
    n = len(raw) // 2
    samples = [struct.unpack_from("<h", raw, i*2)[0] / 32768.0 for i in range(n)]
    return samples, target_sr


def validate_edge_mp3(path: str) -> dict:
    """Probe and fully decode an Edge clip before it can enter the cache."""
    result = subprocess.run(
        [
            "ffprobe", "-v", "error", "-select_streams", "a:0",
            "-show_entries", "stream=codec_name,sample_rate,channels",
            "-of", "json", path,
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=30,
        check=False,
    )
    if result.returncode != 0:
        raise ValueError(
            f"ffprobe rejected Edge clip {path}: "
            f"{result.stderr.decode('utf-8', 'replace').strip()}"
        )
    try:
        payload = json.loads(result.stdout.decode("utf-8"))
        streams = payload["streams"]
        stream = streams[0] if len(streams) == 1 else None
        properties = {
            "container": "mp3",
            "codec": stream["codec_name"],
            "sampleRateHz": int(stream["sample_rate"]),
            "channels": int(stream["channels"]),
        }
    except (KeyError, TypeError, ValueError, IndexError, json.JSONDecodeError) as error:
        raise ValueError(f"ffprobe returned incomplete Edge clip metadata for {path}") from error
    for name, expected in EDGE_EXPECTED_MEDIA.items():
        if properties.get(name) != expected:
            raise ValueError(f"Edge clip {name}={properties.get(name)!r}, expected {expected!r}")
    decoded, decoded_rate = mp3_to_wav_samples(path, TARGET_SR)
    if decoded_rate != TARGET_SR or not decoded:
        raise ValueError(f"Edge clip did not decode to non-empty {TARGET_SR} Hz PCM")
    properties["decodedSampleRateHz"] = decoded_rate
    properties["decodedSamples"] = len(decoded)
    return properties


async def main_async(args):
    started_at = time.perf_counter()
    gap_seconds = normalize_gap_seconds(args.gap)
    with open(args.scenes, "r", encoding="utf-8-sig") as f:
        scenes = json.load(f)
    validate_input_scene_ids(scenes)

    os.makedirs(args.outdir, exist_ok=True)
    cache_dir = os.path.abspath(getattr(args, "cache_dir", None) or default_cache_dir())
    rate = getattr(args, "rate", EDGE_DEFAULT_RATE)
    volume = getattr(args, "volume", EDGE_DEFAULT_VOLUME)
    pitch = getattr(args, "pitch", EDGE_DEFAULT_PITCH)
    cache_epoch = getattr(args, "cache_epoch", EDGE_CACHE_EPOCH)
    engine_version = require_known_version(edge_engine_version(), EDGE_ENGINE)
    configured_gap_samples = int(TARGET_SR * gap_seconds)
    gap = [0.0] * configured_gap_samples

    prepared_scenes = []
    for idx, scene in enumerate(scenes):
        sid = scene["id"]
        text = normalize_narration(scene.get("text") or "")
        if not text:
            print(f"  [skip] {sid}: empty text", file=sys.stderr)
            continue
        prepared_scenes.append((idx, sid, text))

    all_samples = []
    manifest = {
        "fps": FPS,
        "sampleRate": TARGET_SR,
        "voice": args.voice,
        "gapPolicy": {
            "version": EDGE_GAP_POLICY_VERSION,
            "rawClipIncludesGap": False,
            "configuredSeconds": gap_seconds,
            "effectiveSamples": configured_gap_samples,
            "effectiveSeconds": configured_gap_samples / TARGET_SR,
        },
        "scenes": [],
    }
    start_sample = 0

    for position, (idx, sid, normalized_text) in enumerate(prepared_scenes):
        has_next = position < len(prepared_scenes) - 1
        terminal_gap = bool(getattr(args, "terminal_gap", False)) and not has_next
        gap_kind = "inter-scene" if has_next else ("terminal" if terminal_gap else "none")
        gap_record = build_gap_assembly_record(
            gap_policy_version=EDGE_GAP_POLICY_VERSION,
            gap_seconds=gap_seconds,
            sample_rate_hz=TARGET_SR,
            placement=gap_kind,
        )
        cache_key = tts_cache_key(
            normalized_text,
            args.voice,
            TARGET_SR,
            engine_version=engine_version,
            cache_epoch=cache_epoch,
            rate=rate,
            volume=volume,
            pitch=pitch,
        )
        mp3_path = os.path.join(args.outdir, f"{sid}.mp3")
        wav_path = os.path.join(args.outdir, f"{sid}.wav")
        run_sidecar_path = os.path.join(args.outdir, f"{sid}.tts-cache.json")
        resume_before = args.start_index is not None and idx < args.start_index
        force_current = bool(args.force) and not resume_before
        preserve_run_local = False

        if resume_before:
            # A resume boundary freezes already-committed run-local bytes. The
            # mutable shared address may now reference a different valid output
            # from a non-deterministic provider, so it must never win here.
            cache_entry = lookup_run_scene_clip(
                run_sidecar_path,
                mp3_path,
                cache_key,
                ".mp3",
                validate_edge_mp3,
                EDGE_EXPECTED_MEDIA,
            )
            if cache_entry is None:
                raise RuntimeError(
                    f"Cannot resume at scene index {args.start_index}: missing or stale prior clip {sid}"
                )
            preserve_run_local = True
            # Restore an absent shared address for future runs, without replacing
            # this run-local choice if a peer already published another valid clip.
            with scene_clip_lock(cache_dir, cache_key):
                shared_entry = lookup_scene_clip(
                    cache_dir, cache_key, ".mp3", validate_edge_mp3, EDGE_EXPECTED_MEDIA
                )
                if shared_entry is None:
                    publish_scene_clip(
                        cache_dir,
                        cache_key,
                        cache_entry.audio_path,
                        ".mp3",
                        validate_edge_mp3,
                        EDGE_EXPECTED_MEDIA,
                        validated_media=cache_entry.media,
                    )
            print(f"  [reuse] {sid}", end="", flush=True)
        else:
            cache_entry = None if force_current else lookup_scene_clip(
                cache_dir, cache_key, ".mp3", validate_edge_mp3, EDGE_EXPECTED_MEDIA
            )
            if cache_entry is None:
                with scene_clip_lock(cache_dir, cache_key):
                    # A core/proof peer may have filled this address while we waited.
                    if not force_current:
                        cache_entry = lookup_scene_clip(
                            cache_dir, cache_key, ".mp3", validate_edge_mp3, EDGE_EXPECTED_MEDIA
                        )
                    if cache_entry is None and not force_current:
                        local_entry = lookup_run_scene_clip(
                            run_sidecar_path,
                            mp3_path,
                            cache_key,
                            ".mp3",
                            validate_edge_mp3,
                            EDGE_EXPECTED_MEDIA,
                        )
                        if local_entry is not None:
                            cache_entry = publish_scene_clip(
                                cache_dir,
                                cache_key,
                                local_entry.audio_path,
                                ".mp3",
                                validate_edge_mp3,
                                EDGE_EXPECTED_MEDIA,
                                validated_media=local_entry.media,
                            )
                    if cache_entry is None:
                        print(f"  [tts] {sid}…", end="", flush=True)
                        await speak_scene(
                            normalized_text,
                            args.voice,
                            mp3_path,
                            rate=rate,
                            volume=volume,
                            pitch=pitch,
                        )
                        # Validation is intentionally complete before publication.
                        validated_media = validate_edge_mp3(mp3_path)
                        cache_entry = publish_scene_clip(
                            cache_dir,
                            cache_key,
                            mp3_path,
                            ".mp3",
                            validate_edge_mp3,
                            EDGE_EXPECTED_MEDIA,
                            validated_media=validated_media,
                        )
                    else:
                        print(f"  [reuse] {sid}", end="", flush=True)
            else:
                print(f"  [reuse] {sid}", end="", flush=True)

        if not preserve_run_local:
            materialize_scene_clip(cache_entry, mp3_path)
        publish_run_scene_clip_sidecar(
            run_sidecar_path,
            mp3_path,
            cache_key,
            ".mp3",
            validate_edge_mp3,
            EDGE_EXPECTED_MEDIA,
            validated_media=cache_entry.media,
        )
        clip_samples, clip_sr = mp3_to_wav_samples(mp3_path, TARGET_SR)
        if clip_sr != TARGET_SR:
            ratio = TARGET_SR / clip_sr
            new_len = int(len(clip_samples) * ratio)
            clip_samples = [clip_samples[int(i / ratio)] for i in range(new_len)]

        write_wav(wav_path, clip_samples, TARGET_SR)
        all_samples.extend(clip_samples)
        if gap_record["effectiveSamples"]:
            all_samples.extend(gap)

        speech_samples = len(clip_samples)
        clip_samples_with_gap = speech_samples + gap_record["effectiveSamples"]
        sec = clip_samples_with_gap / TARGET_SR
        start_frame = samples_to_frame_boundary(start_sample, TARGET_SR, FPS)
        end_frame = samples_to_frame_boundary(
            start_sample + clip_samples_with_gap, TARGET_SR, FPS
        )
        if end_frame <= start_frame:
            raise RuntimeError(f"TTS clip {sid} is shorter than one output frame")
        manifest["scenes"].append({
            "id": sid,
            "sec": round(sec, 3),
            "speechSamples": speech_samples,
            "gapSamples": gap_record["effectiveSamples"],
            "gapPlacement": gap_record["placement"],
            "samples": clip_samples_with_gap,
            "startSample": start_sample,
            "frames": end_frame - start_frame,
            "startFrame": start_frame,
            "rawClipCacheKeySha256": cache_entry.cache_key_sha256,
            "rawClipSha256": cache_entry.audio_sha256,
        })
        start_sample += clip_samples_with_gap
        print(f" {sec:.2f}s ({end_frame - start_frame}f)")

    if not all_samples:
        print("ERROR: no audio generated for any scene", file=sys.stderr)
        sys.exit(1)

    manifest["totalSec"] = round(len(all_samples) / TARGET_SR, 3)
    manifest["totalSamples"] = len(all_samples)
    manifest["totalFrames"] = apply_cumulative_frame_boundaries(
        manifest["scenes"], TARGET_SR, FPS
    )
    inter_scene_gap_count = sum(
        scene["gapPlacement"] == "inter-scene" for scene in manifest["scenes"]
    )
    terminal_gap_count = sum(
        scene["gapPlacement"] == "terminal" for scene in manifest["scenes"]
    )
    effective_gap_seconds = configured_gap_samples / TARGET_SR
    total_gap_seconds = (inter_scene_gap_count + terminal_gap_count) * effective_gap_seconds
    manifest["ttsMetrics"] = {
        "chunkCount": len(manifest["scenes"]),
        "gapCount": inter_scene_gap_count + terminal_gap_count,
        "interSceneGapCount": inter_scene_gap_count,
        "terminalGapCount": terminal_gap_count,
        "maxInterSceneGapSeconds": round(effective_gap_seconds if inter_scene_gap_count else 0.0, 3),
        "totalGapSeconds": round(total_gap_seconds, 3),
        "gapShare": round(total_gap_seconds / manifest["totalSec"], 6) if manifest["totalSec"] else 0,
        "wallClockSeconds": round(time.perf_counter() - started_at, 3),
    }
    voice_wav = os.path.join(args.outdir, "voice.wav")
    durations_path = args.manifest or os.path.join(args.outdir, "durations.json")
    os.makedirs(os.path.dirname(os.path.abspath(durations_path)), exist_ok=True)
    descriptor, staged_voice = tempfile.mkstemp(prefix=".voice.", suffix=".wav", dir=args.outdir)
    os.close(descriptor)
    try:
        write_wav(staged_voice, all_samples, TARGET_SR)
        manifest = publish_run_assembly(
            staged_voice,
            voice_wav,
            manifest,
            durations_path,
            lambda path: validate_pcm16_mono_wav(path, TARGET_SR),
        )
    finally:
        try:
            os.remove(staged_voice)
        except OSError:
            pass

    print(f"\nDONE  total={manifest['totalSec']}s  ({manifest['totalFrames']} frames)  "
          f"scenes={len(manifest['scenes'])}")
    print(f"  {voice_wav}")
    print(f"  {durations_path}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenes", required=True, help="JSON file: [{id,text},...]")
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--manifest", default=None,
                    help="durations.json path (default: <outdir>/durations.json)")
    ap.add_argument("--voice", default="en-US-AvaNeural",
                    help="Edge TTS voice name (default: en-US-AvaNeural)")
    ap.add_argument("--rate", default=EDGE_DEFAULT_RATE,
                    help="Edge relative speaking rate (default: +0%%)")
    ap.add_argument("--volume", default=EDGE_DEFAULT_VOLUME,
                    help="Edge relative volume (default: +0%%)")
    ap.add_argument("--pitch", default=EDGE_DEFAULT_PITCH,
                    help="Edge relative pitch (default: +0Hz)")
    ap.add_argument("--gap", type=float, default=GAP_SEC,
                    help="silence between per-scene TTS chunks")
    ap.add_argument("--terminal-gap", action="store_true",
                    help="append one policy gap after the final scene for chunk assembly")
    ap.add_argument("--cache-dir", default=default_cache_dir(),
                    help="shared content-addressed raw scene-clip cache")
    ap.add_argument("--cache-epoch", default=EDGE_CACHE_EPOCH,
                    help="explicit Edge remote-output invalidation epoch; bump deliberately when needed")
    ap.add_argument("--force", action="store_true",
                    help="Regenerate and republish every scene clip")
    ap.add_argument("--start-index", type=int,
                    help="Zero-based scene index to resume forced TTS from; prior valid clips are retained")
    args = ap.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
