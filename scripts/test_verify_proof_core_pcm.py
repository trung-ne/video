import json
import struct
import subprocess
import sys
import tempfile
import unittest
import wave
from pathlib import Path

from scripts.verify_proof_core_pcm import PcmIdentityError, verify_proof_core_pcm


ROOT = Path(__file__).resolve().parents[1]
VERIFIER = ROOT / "scripts" / "verify_proof_core_pcm.py"


def write_wav(path: Path, samples: list[int], rate: int = 8000) -> None:
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(rate)
        output.writeframes(b"".join(struct.pack("<h", sample) for sample in samples))


def write_durations(path: Path, scenes: list[tuple[str, int]], rate: int = 8000) -> None:
    start_sample = 0
    entries = []
    for scene_id, sample_count in scenes:
        entries.append({"id": scene_id, "startSample": start_sample, "samples": sample_count})
        start_sample += sample_count
    path.write_text(json.dumps({
        "fps": 30,
        "sampleRate": rate,
        "totalSamples": start_sample,
        "scenes": entries,
    }), encoding="utf-8")


class ProofCoreFixture:
    def __init__(self, root: Path) -> None:
        self.core_audio = root / "core.wav"
        self.core_durations = root / "core-durations.json"
        self.proof_audio = root / "proof.wav"
        self.proof_durations = root / "proof-durations.json"
        self.core_pcm = [100, 101, 102, 200, 201]
        self.halo_before = [-10, -11]
        self.halo_after = [300, 301, 302]
        write_wav(self.core_audio, self.core_pcm)
        write_wav(self.proof_audio, self.halo_before + self.core_pcm + self.halo_after)
        write_durations(self.core_durations, [("scene-a", 3), ("scene-b", 2)])
        write_durations(self.proof_durations, [
            ("halo-before", 2),
            ("scene-a", 3),
            ("scene-b", 2),
            ("halo-after", 3),
        ])

    def arguments(self) -> list[str]:
        return [
            "--core-audio", str(self.core_audio),
            "--core-durations", str(self.core_durations),
            "--proof-audio", str(self.proof_audio),
            "--proof-durations", str(self.proof_durations),
        ]


class ProofCorePcmIdentityTest(unittest.TestCase):
    def test_accepts_byte_identical_core_window_between_halos(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            fixture = ProofCoreFixture(Path(temp))
            result = verify_proof_core_pcm(
                fixture.core_audio,
                fixture.core_durations,
                fixture.proof_audio,
                fixture.proof_durations,
            )
            self.assertEqual(result["coreSceneIds"], ["scene-a", "scene-b"])
            self.assertEqual(result["proofStartSample"], 2)
            self.assertEqual(result["samples"], 5)

            completed = subprocess.run(
                [sys.executable, str(VERIFIER), *fixture.arguments()],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertEqual(json.loads(completed.stdout)["samples"], 5)

    def test_rejects_pcm_byte_drift_inside_the_core_window(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            fixture = ProofCoreFixture(Path(temp))
            drifted = fixture.halo_before + fixture.core_pcm.copy() + fixture.halo_after
            drifted[len(fixture.halo_before) + 1] += 1
            write_wav(fixture.proof_audio, drifted)
            with self.assertRaisesRegex(PcmIdentityError, "PCM bytes differ"):
                verify_proof_core_pcm(
                    fixture.core_audio,
                    fixture.core_durations,
                    fixture.proof_audio,
                    fixture.proof_durations,
                )

    def test_rejects_per_scene_sample_range_drift(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            fixture = ProofCoreFixture(Path(temp))
            write_durations(fixture.core_durations, [("scene-a", 4), ("scene-b", 1)])
            with self.assertRaisesRegex(PcmIdentityError, "sample range differs"):
                verify_proof_core_pcm(
                    fixture.core_audio,
                    fixture.core_durations,
                    fixture.proof_audio,
                    fixture.proof_durations,
                )


if __name__ == "__main__":
    unittest.main()
