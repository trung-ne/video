#!/usr/bin/env python3
"""Blind A/B evaluation for Japanese Kokoro profiles; never publishes production audio."""
from __future__ import annotations

import argparse
import json
import random
import time
import uuid
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf

from kokoro_adapter import JAPANESE_VOICE_GENDERS, KokoroSynthesizer, canonical_voice_spec
from tts_fidelity import compare, passes, require_japanese_tokenizer, units
from tts_router import Transcriber

SAMPLE_RATE = 24000
FEMALE_VOICES = [name for name, gender in JAPANESE_VOICE_GENDERS.items() if gender == "female"]


def candidates(round_number: int, voice_a: str | None, voice_b: str | None) -> list[dict[str, Any]]:
    if round_number == 1:
        return [{"voice": voice, "speed": 0.96} for voice in sorted(FEMALE_VOICES)]
    if not voice_a or not voice_b or voice_a == voice_b:
        raise ValueError("Round 2 requires two distinct --voice-a/--voice-b winners from round 1")
    for voice in (voice_a, voice_b):
        if JAPANESE_VOICE_GENDERS.get(voice) != "female":
            raise ValueError(f"Round 2 production candidates require female Japanese voices, got {voice!r}")
    return [
        {"voice": f"{voice_a}:{weight:.2f},{voice_b}:{1-weight:.2f}", "speed": speed}
        for weight in (0.90, 0.80, 0.70, 0.50)
        for speed in (0.94, 0.96, 0.98)
    ]


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate fidelity-gated blind Japanese Kokoro A/B WAVs")
    parser.add_argument("--round", type=int, choices=(1, 2), required=True)
    parser.add_argument("--voice-a")
    parser.add_argument("--voice-b")
    parser.add_argument("--model", default="small", help="Faster Whisper model")
    parser.add_argument("--corpus", default="config/tts/kokoro-ja-ab-corpus.json")
    parser.add_argument("--outdir", default="output/tts-ab/kokoro-ja")
    parser.add_argument("--min-precision", type=float, default=0.98)
    parser.add_argument("--min-recall", type=float, default=0.98)
    parser.add_argument("--max-edit-rate", type=float, default=0.03)
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    corpus = json.loads((root / args.corpus).read_text(encoding="utf-8"))
    sentences = corpus.get("sentences", [])
    if corpus.get("schemaVersion") != 1 or corpus.get("language") != "ja" or not sentences:
        raise ValueError("Japanese A/B corpus must be a non-empty schemaVersion 1 document")
    require_japanese_tokenizer()
    transcriber = Transcriber(args.model)
    run_id = time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:8]
    run_dir = root / args.outdir / run_id
    staging = run_dir / "staging"; accepted = run_dir / "accepted"; rejected = run_dir / "rejected"
    for directory in (staging, accepted, rejected): directory.mkdir(parents=True, exist_ok=True)

    profiles = candidates(args.round, args.voice_a, args.voice_b)
    random.Random(run_id).shuffle(profiles)
    blind_manifest: dict[str, Any] = {
        "schemaVersion": 1, "runId": run_id, "round": args.round, "language": "ja",
        "corpus": args.corpus, "policy": {"minPrecision": args.min_precision, "minRecall": args.min_recall, "maxEditRate": args.max_edit_rate},
        "candidates": [],
    }
    answer_key: dict[str, Any] = {"schemaVersion": 1, "runId": run_id, "candidates": {}}
    gap = np.zeros(round(SAMPLE_RATE * 0.25), dtype=np.float32)

    for index, profile in enumerate(profiles, 1):
        blind_id = f"blind-{index:02d}"
        spec = canonical_voice_spec(profile["voice"], "j")
        answer_key["candidates"][blind_id] = {"voice": spec, "speed": profile["speed"]}
        synth = KokoroSynthesizer("j", spec, profile["speed"])
        candidate_dir = staging / blind_id; candidate_dir.mkdir()
        metrics_report, audio_parts, failed = [], [], False
        for sentence_index, sentence in enumerate(sentences):
            wav = candidate_dir / f"{sentence['id']}.wav"
            synth.synthesize(sentence["text"], wav)
            audio, rate = sf.read(str(wav), dtype="float32", always_2d=False)
            if rate != SAMPLE_RATE or audio.ndim != 1:
                raise RuntimeError(f"{blind_id}/{sentence['id']} is not mono {SAMPLE_RATE} Hz")
            words, detected = transcriber.transcribe(wav, "ja")
            metric = compare(units(sentence["text"], "ja"), units(" ".join(item["word"] for item in words), "ja"))
            passed = passes(metric, args.min_precision, args.min_recall, args.max_edit_rate)
            metrics_report.append({"id": sentence["id"], "passed": passed, "detectedLanguage": detected, "metrics": metric.as_dict()})
            failed = failed or not passed
            audio_parts.append(audio)
            if sentence_index < len(sentences) - 1: audio_parts.append(gap)
        report = {"blindId": blind_id, "passed": not failed, "sceneMetrics": metrics_report}
        if failed:
            candidate_dir.rename(rejected / blind_id)
            write_json(rejected / f"{blind_id}.json", report)
            print(f"  [reject] {blind_id}: fidelity gate failed")
        else:
            sf.write(str(accepted / f"{blind_id}.wav"), np.concatenate(audio_parts), SAMPLE_RATE, subtype="PCM_16")
            write_json(accepted / f"{blind_id}.json", report)
            print(f"  [accept] {blind_id}: {len(sentences)} scenes")
        blind_manifest["candidates"].append(report)

    write_json(run_dir / "blind-manifest.json", blind_manifest)
    write_json(run_dir / "answer-key.json", answer_key)
    print(f"DONE blind A/B -> {run_dir}")
    print("Listen only to accepted/blind-*.wav before opening answer-key.json.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}")
        raise SystemExit(1)
