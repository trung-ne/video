#!/usr/bin/env python3
"""Pin and measure a visual reference with the canonical pooled audit."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    from visual_audit_metrics import normalize_sample_offsets
except ImportError:  # Imported by the repository's unittest package.
    from scripts.visual_audit_metrics import normalize_sample_offsets


METRICS = {
    "flatFrameRatio": lambda report: report["flatFrameRatio"],
    "edgeDensity": lambda report: report["edgeDensity"]["mean"],
    "nearDuplicateRatio": lambda report: report["nearDuplicateRatio"],
    "longestNearDuplicateRunSeconds": lambda report: report[
        "longestNearDuplicateRunSeconds"
    ],
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


def compact_metrics(report):
    values = {}
    for name, reader in METRICS.items():
        value = float(reader(report))
        if not math.isfinite(value):
            raise ValueError(f"reference report metric {name} is not finite")
        values[name] = round(value, 4)
    return values


def single_measurement_summary(value):
    value = round(float(value), 4)
    return {"mean": value, "variance": 0.0, "min": value, "max": value}


def resolve_installer_binary(package_name):
    result = subprocess.run(
        [
            "node",
            "-e",
            f"process.stdout.write(require('{package_name}').path)",
        ],
        capture_output=True,
        text=True,
    )
    path = result.stdout.strip()
    if result.returncode != 0 or not path:
        raise RuntimeError(
            f"cannot resolve {package_name}: {result.stderr.strip() or 'empty installer path'}"
        )
    return path


def probe_duration_seconds(ffprobe, reference):
    result = subprocess.run(
        [
            ffprobe,
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(reference),
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"ffprobe failed: {result.stderr.strip() or 'unknown error'}"
        )
    try:
        duration = float(result.stdout.strip())
    except ValueError as error:
        raise RuntimeError("ffprobe returned a malformed duration") from error
    if not math.isfinite(duration) or duration <= 0:
        raise RuntimeError("ffprobe returned a non-positive or non-finite duration")
    return duration


def build_visual_audit_command(
    reference,
    ffmpeg,
    ffprobe,
    config,
    report_path,
    sample_seconds,
    offsets,
    expected_duration,
    timeline=None,
):
    command = [
        sys.executable,
        str(Path(__file__).with_name("visual-audit.py")),
        "--video",
        str(reference),
        "--ffmpeg",
        str(ffmpeg),
        "--ffprobe",
        str(ffprobe),
        "--config",
        str(config),
        "--report",
        str(report_path),
        "--sample-seconds",
        str(sample_seconds),
        "--sample-offsets",
        ",".join(f"{offset:.9g}" for offset in offsets),
        "--expected-duration-seconds",
        str(expected_duration),
    ]
    if timeline:
        command.extend(["--timeline", str(timeline)])
    return command


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference", default="refer/meo.mp4")
    parser.add_argument("--timeline")
    parser.add_argument("--config", default="config/reference-quality.json")
    parser.add_argument("--out", default="config/reference-visual-baseline.json")
    parser.add_argument("--offset", type=float)
    parser.add_argument("--offsets", help="comma-separated phase offsets")
    parser.add_argument("--sample-seconds", type=float, default=5.0)
    parser.add_argument("--expected-duration-seconds", type=float)
    parser.add_argument("--ffmpeg")
    parser.add_argument("--ffprobe")
    args = parser.parse_args()

    reference = Path(args.reference).resolve()
    if not reference.is_file():
        raise SystemExit(f"Reference not found: {reference}")
    config_path = Path(args.config).resolve()
    try:
        profile = (
            json.loads(config_path.read_text(encoding="utf-8-sig")).get(
                "visualAudit", {}
            )
            if config_path.is_file()
            else {}
        )
    except (OSError, json.JSONDecodeError) as error:
        raise SystemExit(f"Malformed reference quality config: {error}") from error

    try:
        ffmpeg = args.ffmpeg or resolve_installer_binary("@ffmpeg-installer/ffmpeg")
        ffprobe = args.ffprobe or resolve_installer_binary("@ffprobe-installer/ffprobe")
        if args.expected_duration_seconds is None:
            expected_duration = probe_duration_seconds(ffprobe, reference)
            duration_source = "probed-by-reference-audit"
        else:
            expected_duration = float(args.expected_duration_seconds)
            if not math.isfinite(expected_duration) or expected_duration <= 0:
                raise ValueError(
                    "--expected-duration-seconds must be finite and positive"
                )
            duration_source = "explicit"
        default_offsets = profile.get("sampleOffsetsSeconds", [0.0])
        plural_offsets = (
            args.offsets
            if args.offsets is not None
            else default_offsets if args.offset is None else None
        )
        offsets = normalize_sample_offsets(
            sample_offset=args.offset,
            sample_offsets=plural_offsets,
            sample_seconds=args.sample_seconds,
            duration_seconds=expected_duration,
        )
    except (RuntimeError, ValueError) as error:
        raise SystemExit(f"Reference audit: {error}") from error

    with tempfile.TemporaryDirectory(prefix="cat-reference-audit-") as temp_dir:
        report_path = Path(temp_dir) / "pooled-multiphase.json"
        command = build_visual_audit_command(
            reference=reference,
            ffmpeg=ffmpeg,
            ffprobe=ffprobe,
            config=config_path,
            report_path=report_path,
            sample_seconds=args.sample_seconds,
            offsets=offsets,
            expected_duration=expected_duration,
            timeline=Path(args.timeline).resolve() if args.timeline else None,
        )
        result = subprocess.run(command)
        if result.returncode != 0 or not report_path.is_file():
            raise SystemExit(
                "Canonical visual audit failed "
                f"(exit {result.returncode}, report={report_path.is_file()})"
            )
        report = json.loads(report_path.read_text(encoding="utf-8"))

    if report.get("passed") is not True:
        raise SystemExit("Canonical visual audit report did not pass unchanged thresholds")
    if report.get("sampleOffsets") != offsets:
        raise SystemExit("Canonical visual audit report recorded a different phase set")
    spec_hash = report.get("measurementSpecHash")
    spec = report.get("measurementSpec")
    if not isinstance(spec_hash, str) or len(spec_hash) != 64 or not isinstance(spec, dict):
        raise SystemExit("Canonical visual audit report omitted its measurement specification")

    pooled = compact_metrics(report)
    try:
        recorded_reference = reference.relative_to(Path.cwd()).as_posix()
    except ValueError:
        recorded_reference = str(reference)
    output = {
        "schemaVersion": 2,
        "reference": recorded_reference,
        "referenceSha256": sha256_file(reference),
        "measurementSpecVersion": report["measurementSpecVersion"],
        "measurementSpecHash": spec_hash,
        "measurementSpec": spec,
        "sampleSeconds": args.sample_seconds,
        "offsetsSeconds": offsets,
        "expectedDurationSeconds": expected_duration,
        "durationSource": duration_source,
        "pooledBaseline": {
            "definition": "one canonical chronological pooled multiphase measurement",
            **pooled,
        },
        # Keep the established reader shape while making its single pooled source
        # explicit. There are no incompatible per-phase audits to average.
        "robustBaseline": {
            "definition": "compatibility summary of one canonical pooled multiphase measurement",
            "metrics": {
                name: single_measurement_summary(value)
                for name, value in pooled.items()
            },
        },
    }
    out_path = Path(args.out).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    print(f"Reference baseline: {out_path}")
    print(f"SHA-256: {output['referenceSha256']}")
    print(f"Measurement spec: {spec_hash}")
    print(json.dumps(output["pooledBaseline"], indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
