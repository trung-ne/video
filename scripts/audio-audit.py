#!/usr/bin/env python3
"""Measure integrated loudness/true peak and enforce the production profile."""

import argparse
import json
import re
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("--out")
    parser.add_argument("--min-lufs", type=float, default=-18.0)
    parser.add_argument("--max-lufs", type=float, default=-16.0)
    parser.add_argument("--max-true-peak", type=float, default=-1.5)
    args = parser.parse_args()

    command = [
        "ffmpeg", "-hide_banner", "-nostats", "-i", args.input,
        "-filter_complex", "ebur128=peak=true", "-f", "null", "-",
    ]
    result = subprocess.run(command, text=True, capture_output=True)
    output = result.stderr
    integrated = re.findall(r"I:\s*(-?\d+(?:\.\d+)?)\s*LUFS", output)
    true_peak = re.findall(r"Peak:\s*(-?\d+(?:\.\d+)?)\s*dBFS", output)
    if not integrated or not true_peak:
        print("Unable to parse ffmpeg ebur128 output", file=sys.stderr)
        return 2

    lufs = float(integrated[-1])
    peak = float(true_peak[-1])
    passed = args.min_lufs <= lufs <= args.max_lufs and peak <= args.max_true_peak
    report = {
        "input": args.input,
        "integratedLufs": lufs,
        "truePeakDbtp": peak,
        "thresholds": {
            "minimumLufs": args.min_lufs,
            "maximumLufs": args.max_lufs,
            "maximumTruePeakDbtp": args.max_true_peak,
        },
        "passed": passed,
    }
    encoded = json.dumps(report, indent=2)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as handle:
            handle.write(encoded + "\n")
    print(encoded)
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
