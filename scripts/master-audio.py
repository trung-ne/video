#!/usr/bin/env python3
"""Normalize narration to the production loudness profile with ffmpeg."""

import argparse
import os
import subprocess
import sys
import tempfile


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--lufs", type=float, default=-17.0)
    parser.add_argument("--true-peak", type=float, default=-1.5)
    parser.add_argument("--lra", type=float, default=11.0)
    args = parser.parse_args()

    if not os.path.isfile(args.input):
        print(f"audio input not found: {args.input}", file=sys.stderr)
        return 1

    output_dir = os.path.dirname(os.path.abspath(args.output))
    os.makedirs(output_dir, exist_ok=True)
    fd, temp_path = tempfile.mkstemp(prefix="master-", suffix=".wav", dir=output_dir)
    os.close(fd)
    try:
        command = [
            "ffmpeg", "-y", "-v", "error", "-i", args.input,
            "-af", f"loudnorm=I={args.lufs}:TP={args.true_peak}:LRA={args.lra}",
            "-ar", "48000", "-ac", "1", temp_path,
        ]
        subprocess.run(command, check=True)
        os.replace(temp_path, args.output)
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)
    print(f"mastered {args.input} -> {args.output} ({args.lufs} LUFS, {args.true_peak} dBTP)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
