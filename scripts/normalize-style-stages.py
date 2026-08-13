"""Center-crop style stages to exact 16:9 without scaling their artwork."""

from pathlib import Path
from PIL import Image


for style in ("c", "d", "f"):
    root = Path.cwd() / "public" / "styles" / style
    for folder in ("generated-assets/scenes", "generated-backgrounds"):
        for path in (root / folder).glob("*.png"):
            with Image.open(path) as image:
                width, height = image.size
                # Crop only the minimum excess at the top/bottom. Never stretch art.
                # Exact 16:9 requires an integer width divisible by 16. ImageGen's
                # 1672px output is 8px too wide, so remove only edge pixels.
                target_width = width - (width % 16)
                target_height = target_width * 9 // 16
                if width * 9 == height * 16:
                    continue
                if target_width <= 0 or target_height <= 0 or target_width > width or target_height > height:
                    raise RuntimeError(f"Cannot crop {path} ({width}x{height}) to 16:9")
                left = (width - target_width) // 2
                top = (height - target_height) // 2
                cropped = image.crop((left, top, left + target_width, top + target_height))
                cropped.save(path)
                print(f"Cropped {path.relative_to(root)}: {width}x{height} -> {target_width}x{target_height}")
