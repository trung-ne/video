#!/usr/bin/env python3
"""Pin and measure a visual reference with legacy and phase-robust sampling."""

import argparse
import hashlib
import json
import statistics
import subprocess
import sys
import tempfile
from pathlib import Path


METRICS = {
    "flatFrameRatio": lambda report: report["flatFrameRatio"],
    "edgeDensity": lambda report: report["edgeDensity"]["mean"],
    "nearDuplicateRatio": lambda report: report["nearDuplicateRatio"],
    "longestNearDuplicateRunSeconds": lambda report: report["longestNearDuplicateRunSeconds"],
    "saturation": lambda report: report["saturation"]["mean"],
    "nearWhiteMean": lambda report: report["nearWhiteMean"],
    "whiteDominantRatio": lambda report: report["whiteDominantRatio"],
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def summarize(values):
    return {
        "mean": round(statistics.fmean(values), 4),
        "variance": round(statistics.pvariance(values), 6),
        "min": round(min(values), 4),
        "max": round(max(values), 4),
    }


def compact_metrics(report):
    return {name: round(reader(report), 4) for name, reader in METRICS.items()}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference", default="refer/meo.mp4")
    parser.add_argument("--timeline")
    parser.add_argument("--config", default="config/reference-quality.json")
    parser.add_argument("--out", default="config/reference-visual-baseline.json")
    parser.add_argument("--offsets", default="0,1.7,3.3")
    parser.add_argument("--sample-seconds", type=float, default=5.0)
    parser.add_argument("--ffmpeg")
    args = parser.parse_args()

    reference = Path(args.reference).resolve()
    if not reference.is_file():
        raise SystemExit(f"Reference not found: {reference}")
    offsets = [float(value.strip()) for value in args.offsets.split(",") if value.strip()]
    if 0.0 not in offsets:
        raise SystemExit("Offsets must include 0 for the legacy baseline.")
    ffmpeg = args.ffmpeg
    if not ffmpeg:
        probe = subprocess.run(
            ["node", "-e", "process.stdout.write(require('@ffmpeg-installer/ffmpeg').path)"],
            capture_output=True, text=True, check=True,
        )
        ffmpeg = probe.stdout

    reports = []
    with tempfile.TemporaryDirectory(prefix="cat-reference-audit-") as temp_dir:
        for index, offset in enumerate(offsets):
            report_path = Path(temp_dir) / f"offset-{index}.json"
            command = [
                sys.executable, str(Path(__file__).with_name("visual-audit.py")),
                "--video", str(reference),
                "--ffmpeg", ffmpeg,
                "--config", str(Path(args.config).resolve()),
                "--report", str(report_path),
                "--sample-seconds", str(args.sample_seconds),
                "--sample-offset", str(offset),
            ]
            if args.timeline:
                command.extend(["--timeline", str(Path(args.timeline).resolve())])
            result = subprocess.run(command)
            if not report_path.is_file():
                raise SystemExit(f"Visual audit produced no report for offset {offset} (exit {result.returncode})")
            reports.append(json.loads(report_path.read_text(encoding="utf-8")))

    per_offset = [
        {"offsetSeconds": offset, **compact_metrics(report)}
        for offset, report in zip(offsets, reports)
    ]
    robust = {
        name: summarize([reader(report) for report in reports])
        for name, reader in METRICS.items()
    }
    zero_index = offsets.index(0.0)
    try:
        recorded_reference = reference.relative_to(Path.cwd()).as_posix()
    except ValueError:
        recorded_reference = str(reference)
    output = {
        "schemaVersion": 1,
        "reference": recorded_reference,
        "referenceSha256": sha256_file(reference),
        "sampleSeconds": args.sample_seconds,
        "offsetsSeconds": offsets,
        "legacyBaseline": {
            "definition": "single offset at 0 seconds",
            **compact_metrics(reports[zero_index]),
        },
        "robustBaseline": {
            "definition": "mean/variance/min/max across phase offsets",
            "perOffset": per_offset,
            "metrics": robust,
        },
    }
    out_path = Path(args.out).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    print(f"Reference baseline: {out_path}")
    print(f"SHA-256: {output['referenceSha256']}")
    print(json.dumps(output["legacyBaseline"], indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
