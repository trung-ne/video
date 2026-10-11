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


def write_wav(target: Path, samples: int, rate: int = 10, value: int = 0) -> None:
    with wave.open(str(target), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(rate)
        output.writeframes(struct.pack("<h", value) * samples)


def json_sha256(value: object) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


class ChunkAudioAssemblyTest(unittest.TestCase):
    def test_concatenates_wav_at_exact_sample_boundary_and_rebases_words(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            chunks = []
            for index, samples in enumerate((100, 100), 1):
                audio = root / f"c{index}.wav"
                durations = root / f"c{index}-durations.json"
                words = root / f"c{index}-words.json"
                alignment = root / f"c{index}-alignment.json"
                scene_id = f"s{index}"
                chunk_tts_scenes = [{"id": scene_id, "text": f"w{index}"}]
                write_wav(audio, samples, value=index)
                durations.write_text(json.dumps({
                    "fps": 30, "sampleRate": 10, "totalSamples": samples,
                    "gapPolicy": {
                        "version": "edge-gap-0.08-v1",
                        "rawClipIncludesGap": False,
                        "configuredSeconds": 0.08,
                        "effectiveSamples": 0,
                        "effectiveSeconds": 0.0,
                    },
                    "ttsMetrics": {
                        "chunkCount": 1,
                        "gapCount": 0,
                        "interSceneGapCount": 0,
                        "terminalGapCount": 0,
                        "maxInterSceneGapSeconds": 0.0,
                        "totalGapSeconds": 0.0,
                        "gapShare": 0.0,
                        "wallClockSeconds": 0.1,
                    },
                    "scenes": [{
                        "id": scene_id,
                        "startSample": 0,
                        "speechSamples": samples,
                        "gapSamples": 0,
                        "gapPlacement": "none",
                        "samples": samples,
                        "startFrame": 0,
                        "frames": 300,
                    }],
                }), encoding="utf-8")
                words.write_text(json.dumps([{
                    "word": f"w{index}", "startSec": 1, "endSec": 2,
                    "scene": scene_id, "sceneWordIndex": 0, "canonicalWordIndex": 0,
                    "interpolated": False,
                }]), encoding="utf-8")
                alignment.write_text(json.dumps({
                    "schemaVersion": 1,
                    "source": "canonical-tts-scenes",
                    "canonicalWordCount": 1,
                    "matchedWordCount": 1,
                    "interpolatedWordCount": 0,
                    "coverage": 1.0,
                    "matchedCoverage": 1.0,
                    "sceneCount": 1,
                    "ttsScenesSha256": json_sha256(chunk_tts_scenes),
                    "language": "unknown",
                }), encoding="utf-8")
                chunks.append({
                    "id": f"c{index}",
                    "sceneIds": [scene_id],
                    "audio": str(audio),
                    "durations": str(durations),
                    "words": str(words),
                    "alignment": str(alignment),
                })
            inputs = root / "inputs.json"
            tts_scenes = root / "tts_scenes.json"
            inputs.write_text(json.dumps(chunks), encoding="utf-8")
            tts_scenes.write_text(json.dumps([{"id": "s1", "text": "w1"}, {"id": "s2", "text": "w2"}]), encoding="utf-8")
            out_audio = root / "voice.wav"
            out_durations = root / "durations.json"
            out_words = root / "words.json"
            out_alignment = root / "alignment.json"
            subprocess.run([
                sys.executable, str(ASSEMBLER), "--inputs", str(inputs),
                "--out-audio", str(out_audio), "--out-durations", str(out_durations),
                "--out-words", str(out_words), "--out-alignment", str(out_alignment),
                "--tts-scenes", str(tts_scenes),
            ], check=True)
            with wave.open(str(out_audio), "rb") as output:
                self.assertEqual(output.getnframes(), 200)
                assembled_pcm = struct.unpack("<200h", output.readframes(200))
            self.assertEqual(assembled_pcm[:100], (1,) * 100)
            self.assertEqual(assembled_pcm[100:], (2,) * 100)
            self.assertEqual(json.loads(out_durations.read_text(encoding="utf-8"))["scenes"], [
                {
                    "id": "s1", "startSample": 0, "speechSamples": 100,
                    "gapSamples": 0, "gapPlacement": "none", "samples": 100,
                    "startFrame": 0, "frames": 300,
                },
                {
                    "id": "s2", "startSample": 100, "speechSamples": 100,
                    "gapSamples": 0, "gapPlacement": "none", "samples": 100,
                    "startFrame": 300, "frames": 300,
                },
            ])
            self.assertTrue(validate_run_assembly(
                str(out_audio),
                str(out_durations),
                lambda path: validate_pcm16_mono_wav(path, 10),
            ))
            self.assertEqual(json.loads(out_words.read_text(encoding="utf-8"))[1]["startSec"], 11)
            self.assertEqual(json.loads(out_words.read_text(encoding="utf-8"))[1]["canonicalWordIndex"], 1)


if __name__ == "__main__":
    unittest.main()
