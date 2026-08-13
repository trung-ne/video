"""Normalize visible production pixels to each locked style palette.

This is a conservative post-process: transparent pixels, alpha edges and image
geometry are preserved. It corrects accidental off-palette generator colours
without replacing the original drawing, texture, or silhouette.
"""

from pathlib import Path
from PIL import Image

PALETTES = {
    "c": [(183, 167, 216), (255, 248, 232), (244, 154, 122), (41, 39, 43)],
    "d": [(123, 99, 182), (255, 253, 245), (239, 86, 61), (34, 183, 193), (226, 182, 70), (32, 30, 33)],
    "f": [(137, 114, 168), (237, 224, 188), (201, 79, 39), (22, 19, 15), (243, 232, 210)],
}


def closest(color, palette):
    # RGB is intentional: a style lock wants discrete spot colours, not a
    # perceptual re-grade that might retain forbidden teal/orange hues.
    return min(palette, key=lambda target: sum((a - b) ** 2 for a, b in zip(color, target)))


for style, palette in PALETTES.items():
    root = Path.cwd() / "public" / "styles" / style
    for asset in list((root / "generated-assets").rglob("*.png")) + list((root / "generated-backgrounds").glob("*.png")):
        source = Image.open(asset).convert("RGBA")
        alpha = source.getchannel("A")
        # Pillow's palette quantizer is implemented in C and avoids iterating
        # millions of Python pixels per full-resolution asset.
        palette_image = Image.new("P", (1, 1))
        palette_bytes = []
        for red, green, blue in palette:
            palette_bytes.extend((red, green, blue))
        palette_image.putpalette(palette_bytes + [0] * (768 - len(palette_bytes)))
        rgb = source.convert("RGB").quantize(palette=palette_image, dither=Image.Dither.NONE).convert("RGB")
        rgb.putalpha(alpha)
        # Some imported PNGs retain a literal black palette index. Map that
        # index to the style's designated outline black as a final exact pass.
        data = [(*palette[-1], a) if (r, g, b) == (0, 0, 0) else (r, g, b, a)
                for r, g, b, a in rgb.getdata()]
        rgb.putdata(data)
        rgb.save(asset)
    print(f"Normalized visible palette for style {style}")
