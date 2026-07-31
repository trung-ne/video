"""Selectively mute high-use generated assets and record a versioned audit trail."""

import argparse
import colorsys
import hashlib
import json
from collections import Counter
from pathlib import Path


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--storyboard", required=True)
    parser.add_argument("--manifest", default="public/assets.manifest.json")
    parser.add_argument("--public", default="public")
    parser.add_argument("--overrides", default="config/asset-style-overrides.json")
    parser.add_argument("--minimum-uses", type=int, default=4)
    parser.add_argument("--minimum-saturation", type=float, default=0.45)
    parser.add_argument("--reduction", type=float, default=0.18)
    args = parser.parse_args()

    from PIL import Image

    storyboard = json.loads(Path(args.storyboard).read_text(encoding="utf-8"))
    manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    aliases = manifest.get("aliases", {})
    by_path = {entry["path"]: entry for entry in manifest.get("entries", [])}
    usage = Counter()
    for scene in storyboard.get("scenes", []):
        for logical in (scene.get("resolvedAssets") or {}).values():
            physical = aliases.get(logical, logical)
            usage[physical] += 1

    selected = []
    public = Path(args.public)
    factor = 1.0 - args.reduction
    for relative, uses in usage.most_common():
        entry = by_path.get(relative)
        saturation = ((entry or {}).get("visualMetrics") or {}).get("meanSaturation", 0)
        if uses < args.minimum_uses or saturation < args.minimum_saturation:
            continue
        path = public / relative
        if not path.exists() or path.suffix.lower() != ".png" or not relative.startswith("generated-"):
            continue
        before = sha256(path)
        with Image.open(path) as source:
            image = source.convert("RGBA")
            output = []
            for red, green, blue, alpha in image.getdata():
                if alpha < 8:
                    output.append((red, green, blue, alpha))
                    continue
                hue, sat, value = colorsys.rgb_to_hsv(red / 255, green / 255, blue / 255)
                nr, ng, nb = colorsys.hsv_to_rgb(hue, sat * factor, value)
                output.append((round(nr * 255), round(ng * 255), round(nb * 255), alpha))
            image.putdata(output)
            image.save(path, optimize=True)
        selected.append({
            "path": relative,
            "usesInPilot": uses,
            "reduction": args.reduction,
            "previousSha256": before,
            "sha256": sha256(path),
        })

    override_path = Path(args.overrides)
    payload = {
        "schemaVersion": 1,
        "paletteProfile": "editorial-muted-v2",
        "sourceStoryboard": str(Path(args.storyboard).as_posix()),
        "assets": selected,
    }
    override_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Normalized {len(selected)} high-use assets; wrote {override_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
