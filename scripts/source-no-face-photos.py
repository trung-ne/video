"""Build a reviewable Wikimedia Commons evidence-photo candidate set.

Downloads are candidates only. Nothing enters the production allowlist until a
human reviews the generated contact sheet and sets faceReviewed=true in the
photo catalog.
"""

import argparse
import hashlib
import html
import json
import re
import urllib.parse
import urllib.request
import time
from io import BytesIO
from pathlib import Path

QUERIES = [
    ("device", "smartphone desk still life"),
    ("document", "calculator financial documents flat lay"),
    ("map", "world map satellite earth"),
    ("market", "stock market display screen"),
    ("construction", "construction site machinery no people"),
    ("factory", "factory exterior industrial building"),
    ("street", "Seoul city street night empty"),
    ("retail", "supermarket aisle empty"),
    ("housing", "Korea apartment buildings"),
    ("logistics", "shipping containers port aerial"),
]


def clean(value):
    return re.sub(r"<[^>]+>", "", html.unescape(value or "")).strip()


def api(query, limit):
    params = urllib.parse.urlencode({
        "action": "query", "format": "json", "generator": "search",
        "gsrsearch": f"filetype:bitmap {query}", "gsrnamespace": 6,
        "gsrlimit": limit, "prop": "imageinfo", "iiprop": "url|extmetadata",
        "iiurlwidth": 1280,
    })
    request = urllib.request.Request(
        f"https://commons.wikimedia.org/w/api.php?{params}",
        headers={"User-Agent": "CatExplainerAssetReview/1.0 (local editorial project)"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.load(response)
    return list((payload.get("query", {}).get("pages", {})).values())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--per-category", type=int, default=4)
    parser.add_argument("--outdir", default="public/backgrounds")
    parser.add_argument("--catalog", default="config/photo-source-candidates.json")
    parser.add_argument("--contact-sheet", default="output/photo-source-candidates.contact.jpg")
    parser.add_argument("--categories", help="comma-separated category subset")
    args = parser.parse_args()
    from PIL import Image, ImageDraw, ImageFont

    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    catalog = Path(args.catalog)
    rows = json.loads(catalog.read_text(encoding="utf-8")).get("entries", []) if catalog.exists() else []
    seen = {row.get("sourceUrl") for row in rows}
    requested = set(args.categories.split(",")) if args.categories else None
    for category, query in QUERIES:
        if requested is not None and category not in requested:
            continue
        existing = [row for row in rows if row.get("category") == category]
        accepted = len(existing)
        for page in api(query, args.per_category * 3):
            if accepted >= args.per_category:
                break
            info = (page.get("imageinfo") or [{}])[0]
            meta = info.get("extmetadata") or {}
            license_name = clean((meta.get("LicenseShortName") or {}).get("value"))
            if not any(token in license_name.lower() for token in ("cc0", "cc by", "public domain")):
                continue
            url = info.get("thumburl") or info.get("url")
            if not url or url in seen:
                continue
            seen.add(url)
            try:
                time.sleep(1.25)
                request = urllib.request.Request(url, headers={"User-Agent": "CatExplainerAssetReview/1.0 (local editorial project)"})
                with urllib.request.urlopen(request, timeout=45) as response:
                    image = Image.open(BytesIO(response.read())).convert("RGB")
                if image.width < 900 or image.height < 500:
                    continue
                filename = f"evidence-{category}-{accepted + 1:02d}.jpg"
                target = outdir / filename
                image.save(target, quality=90, optimize=True)
                title = page.get("title", "").removeprefix("File:")
                source_page = "https://commons.wikimedia.org/wiki/" + urllib.parse.quote(page.get("title", "").replace(" ", "_"), safe=":()_-')")
                rows.append({
                    "path": target.as_posix().removeprefix("public/"),
                    "category": category,
                    "query": query,
                    "title": title,
                    "creator": clean((meta.get("Artist") or {}).get("value")) or "Wikimedia Commons contributor",
                    "license": license_name,
                    "sourcePage": source_page,
                    "sourceUrl": info.get("url"),
                    "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
                    "semanticTags": [category] + query.split(),
                    "safeCrop": {"x": 0.5, "y": 0.5, "width": 0.9, "height": 0.82},
                    "faceReviewed": False,
                    "approved": False,
                })
                accepted += 1
            except Exception as exc:
                print(f"skip {url}: {exc}")

    catalog.write_text(json.dumps({"schemaVersion": 1, "entries": rows}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    thumbs = []
    for row in rows:
        image = Image.open(Path("public") / row["path"]).convert("RGB")
        image.thumbnail((360, 210))
        tile = Image.new("RGB", (380, 250), "white")
        tile.paste(image, ((380 - image.width) // 2, 4))
        ImageDraw.Draw(tile).text((10, 218), f"{row['category']} | {Path(row['path']).name}", fill="black")
        thumbs.append(tile)
    cols = 4
    sheet = Image.new("RGB", (cols * 380, ((len(thumbs) + cols - 1) // cols) * 250), "#dddddd")
    for index, tile in enumerate(thumbs):
        sheet.paste(tile, ((index % cols) * 380, (index // cols) * 250))
    contact = Path(args.contact_sheet)
    contact.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(contact, quality=88)
    print(f"Downloaded {len(rows)} candidates; review {contact} before approval")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
