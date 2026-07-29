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
import edge_tts
import json
import os
import struct
import sys
import time
import wave

FPS = 30
GAP_SEC = 0.08      # short boundary between per-scene narration chunks


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


async def speak_scene(text: str, voice: str, out_path: str, retries: int = 4):
    """Generate TTS for one scene and save to out_path (.mp3).

    edge-tts occasionally drops the websocket mid-batch (NoAudioReceived) under
    sustained sequential load; this is transient, not content-related, so retry
    with backoff before giving up.
    """
    last_err = None
    for attempt in range(retries):
        try:
            communicate = edge_tts.Communicate(text, voice)
            with open(out_path, "wb") as f:
                async for chunk in communicate.stream():
                    if chunk["type"] == "audio":
                        f.write(chunk["data"])
            return
        except Exception as e:
            last_err = e
            print(f" [retry {attempt+1}/{retries}: {e}]", end="", flush=True)
            await asyncio.sleep(1.5 * (attempt + 1))
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
    """Convert MP3 to float32 mono samples. Uses miniaudio (pure Python, no ffmpeg)."""
    import miniaudio

    # Decode MP3 to PCM via miniaudio (handles MP3/WAV/FLAC natively)
    decoded = miniaudio.decode_file(mp3_path, output_format=miniaudio.SampleFormat.SIGNED16,
                                    nchannels=1, sample_rate=target_sr)
    raw = bytes(decoded.samples)
    n = len(raw) // 2
    samples = [struct.unpack_from("<h", raw, i*2)[0] / 32768.0 for i in range(n)]
    return samples, target_sr


async def main_async(args):
    started_at = time.perf_counter()
    with open(args.scenes, "r", encoding="utf-8-sig") as f:
        scenes = json.load(f)

    os.makedirs(args.outdir, exist_ok=True)

    TARGET_SR = 24000
    gap = [0.0] * int(TARGET_SR * max(0.0, args.gap))

    all_samples = []
    manifest = {"fps": FPS, "sampleRate": TARGET_SR, "voice": args.voice, "scenes": []}
    start_frame = 0

    for idx, scene in enumerate(scenes):
        sid = scene.get("id", f"scene-{idx+1:02d}")
        text = (scene.get("text") or "").strip()
        if not text:
            print(f"  [skip] {sid}: empty text", file=sys.stderr)
            continue

        mp3_path = os.path.join(args.outdir, f"{sid}.mp3")
        wav_path = os.path.join(args.outdir, f"{sid}.wav")

        print(f"  [tts] {sid}…", end="", flush=True)
        await speak_scene(text, args.voice, mp3_path)

        clip_samples, clip_sr = mp3_to_wav_samples(mp3_path, TARGET_SR)

        # Resample if needed (shouldn't happen since we request target_sr in ffmpeg)
        if clip_sr != TARGET_SR:
            # Basic linear resample
            ratio = TARGET_SR / clip_sr
            new_len = int(len(clip_samples) * ratio)
            clip_samples = [clip_samples[int(i / ratio)] for i in range(new_len)]

        write_wav(wav_path, clip_samples, TARGET_SR)
        all_samples.extend(clip_samples)
        if idx < len(scenes) - 1:
            all_samples.extend(gap)

        clip_frames = len(clip_samples) + (len(gap) if idx < len(scenes) - 1 else 0)
        sec = clip_frames / TARGET_SR
        frames = max(1, round(sec * FPS))

        manifest["scenes"].append({
            "id": sid,
            "sec": round(sec, 3),
            "frames": frames,
            "startFrame": start_frame,
        })
        start_frame += frames
        print(f" {sec:.2f}s ({frames}f)")

    if not all_samples:
        print("ERROR: no audio generated for any scene", file=sys.stderr)
        sys.exit(1)

    voice_wav = os.path.join(args.outdir, "voice.wav")
    write_wav(voice_wav, all_samples, TARGET_SR)

    manifest["totalSec"] = round(len(all_samples) / TARGET_SR, 3)
    manifest["totalFrames"] = start_frame
    gap_count = max(0, len(manifest["scenes"]) - 1)
    total_gap_seconds = gap_count * max(0.0, args.gap)
    manifest["ttsMetrics"] = {
        "chunkCount": len(manifest["scenes"]),
        "gapCount": gap_count,
        "maxInterSceneGapSeconds": round(max(0.0, args.gap), 3),
        "totalGapSeconds": round(total_gap_seconds, 3),
        "gapShare": round(total_gap_seconds / manifest["totalSec"], 6) if manifest["totalSec"] else 0,
        "wallClockSeconds": round(time.perf_counter() - started_at, 3),
    }
    durations_path = args.manifest or os.path.join(args.outdir, "durations.json")
    os.makedirs(os.path.dirname(os.path.abspath(durations_path)), exist_ok=True)
    with open(durations_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    print(f"\nDONE  total={manifest['totalSec']}s  ({start_frame} frames)  "
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
    ap.add_argument("--gap", type=float, default=GAP_SEC,
                    help="silence between per-scene TTS chunks")
    args = ap.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
