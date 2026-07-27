"""Measure how much of each PNG is actual content vs transparent padding.

The generated art carries uneven transparent margins (56-81% of the canvas),
so two assets authored at the same `scale` render at noticeably different
visual sizes. build-asset-manifest.ts uses this to store a per-asset
`contentScale` that cancels the padding out.

Emits JSON on stdout: {"<relative/path.png>": [widthFraction, heightFraction]}
Exits 0 with "{}" if Pillow is unavailable, so the manifest build degrades
gracefully instead of failing.
"""

import json
import sys
from pathlib import Path

def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    try:
        from PIL import Image
    except ImportError:
        print("{}")
        return 0

    public = Path(sys.argv[1] if len(sys.argv) > 1 else "public")
    out = {}
    for directory in ("generated-assets", "generated-backgrounds"):
        root = public / directory
        if not root.is_dir():
            continue
        for path in sorted(root.rglob("*.png")):
            try:
                with Image.open(path) as im:
                    im = im.convert("RGBA")
                    width, height = im.size
                    box = im.split()[-1].getbbox()
            except Exception:
                continue
            if not box or width == 0 or height == 0:
                continue
            rel = path.relative_to(public).as_posix()
            out[rel] = [
                round((box[2] - box[0]) / width, 4),
                round((box[3] - box[1]) / height, 4),
            ]
    print(json.dumps(out))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
