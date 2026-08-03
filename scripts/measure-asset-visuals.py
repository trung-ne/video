"""Measure palette and density traits for every production raster asset."""

import colorsys
import json
import statistics
import sys
from collections import Counter
from pathlib import Path


def metrics(path, public):
    from PIL import Image, ImageStat

    with Image.open(path) as source:
        rgba = source.convert("RGBA")
        width, height = rgba.size
        rgba.thumbnail((320, 320))
        pixels = [p for p in rgba.getdata() if p[3] >= 24]
        if not pixels:
            return None
        saturations = []
        luminance = []
        buckets = Counter()
        for red, green, blue, _ in pixels:
            r, g, b = red / 255.0, green / 255.0, blue / 255.0
            _, saturation, value = colorsys.rgb_to_hsv(r, g, b)
            saturations.append(saturation)
            luminance.append(0.2126 * r + 0.7152 * g + 0.0722 * b)
            buckets[(red // 32 * 32, green // 32 * 32, blue // 32 * 32)] += 1
        ordered = sorted(saturations)
        p95 = ordered[min(len(ordered) - 1, round((len(ordered) - 1) * 0.95))]
        alpha_box = rgba.getchannel("A").getbbox()
        content_fraction = 0.0
        content_box = None
        if alpha_box:
            content_fraction = ((alpha_box[2] - alpha_box[0]) * (alpha_box[3] - alpha_box[1])) / (rgba.width * rgba.height)
            content_box = {
                "x": round(alpha_box[0] / rgba.width, 5),
                "y": round(alpha_box[1] / rgba.height, 5),
                "width": round((alpha_box[2] - alpha_box[0]) / rgba.width, 5),
                "height": round((alpha_box[3] - alpha_box[1]) / rgba.height, 5),
            }
        dominant = ["#%02x%02x%02x" % color for color, _ in buckets.most_common(4)]
        return {
            "width": width,
            "height": height,
            "aspectRatio": round(width / height, 5),
            "contentBox": content_box,
            "meanSaturation": round(statistics.fmean(saturations), 4),
            "p95Saturation": round(p95, 4),
            "luminanceContrast": round(statistics.pstdev(luminance), 4),
            "contentFraction": round(content_fraction, 4),
            "dominantColors": dominant,
        }


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    try:
        from PIL import Image  # noqa: F401
    except ImportError:
        print("{}")
        return 0
    public = Path(sys.argv[1] if len(sys.argv) > 1 else "public")
    output = {}
    for folder in ("generated-assets", "generated-backgrounds", "backgrounds"):
        root = public / folder
        if not root.is_dir():
            continue
        for path in sorted(root.rglob("*")):
            if path.suffix.lower() not in (".png", ".jpg", ".jpeg", ".webp"):
                continue
            try:
                value = metrics(path, public)
                if value:
                    output[path.relative_to(public).as_posix()] = value
            except Exception as exc:
                print(f"warning: {path}: {exc}", file=sys.stderr)
    print(json.dumps(output, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
