"""Fail-closed raster contract checks for a production style tree."""

from pathlib import Path
import sys


def main() -> int:
    try:
        from PIL import Image
    except ImportError as error:
        print(f"Pillow is required for style raster QA: {error}", file=sys.stderr)
        return 2

    if len(sys.argv) != 2 or sys.argv[1] not in {"c", "d", "f"}:
        print("Usage: python scripts/check-style-raster.py c|d|f", file=sys.stderr)
        return 2

    root = Path.cwd() / "public" / "styles" / sys.argv[1]
    failures: list[str] = []
    for folder in ("generated-assets/characters", "generated-assets/icons"):
        for asset in sorted((root / folder).glob("*.png")):
            with Image.open(asset) as image:
                if "A" not in image.getbands() or image.getchannel("A").getextrema()[0] != 0:
                    failures.append(f"{asset.relative_to(root)} must have transparent alpha outside its art")

    for folder in ("generated-assets/scenes", "generated-backgrounds"):
        for asset in sorted((root / folder).glob("*.png")):
            with Image.open(asset) as image:
                width, height = image.size
                if width * 9 != height * 16:
                    failures.append(f"{asset.relative_to(root)} must be exact 16:9, got {width}x{height}")
                if "A" in image.getbands() and image.getchannel("A").getextrema()[0] != 255:
                    failures.append(f"{asset.relative_to(root)} must be opaque")

    if failures:
        print("Raster QA failures:\n" + "\n".join(failures), file=sys.stderr)
        return 1
    print(f"Style {sys.argv[1]} raster QA passed (transparent cutouts; opaque 16:9 stages).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
