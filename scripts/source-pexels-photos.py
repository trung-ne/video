"""Download a curated, license-page-backed Pexels candidate set for review."""

import hashlib
import json
import urllib.request
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw

PHOTOS = [
    ("device", 34862486, "Jakub Zerdzicki"), ("device", 35028998, "Jakub Zerdzicki"),
    ("device", 25025802, "Jakub Zerdzicki"), ("device", 8296993, "Mikhail Nilov"),
    ("device", 6694896, "Tima Miroshnichenko"), ("device", 27920041, "Jakub Zerdzicki"),
    ("document", 8296974, "Mikhail Nilov"), ("document", 4386292, "Kaboompics"),
    ("document", 8297220, "Mikhail Nilov"), ("document", 33175649, "Bia Limova"),
    ("document", 6694543, "Tima Miroshnichenko"), ("document", 8296970, "Mikhail Nilov"),
    ("document", 33175657, "Bia Limova"),
    ("market", 10653886, "Aedrian Salazar"), ("market", 16594724, "Rômulo Queiroz"),
    ("market", 28682356, "StockRadars Co."),
    ("construction", 35854242, "Peter Dyllong"), ("construction", 31656151, "SHOX ART"),
    ("construction", 12454407, "Erik Mclean"), ("construction", 35556669, "Takeshi Arai"),
    ("construction", 34360439, "SHOX ART"), ("construction", 37244506, "Bingqian Li"),
    ("factory", 21405378, "Ari Boa"),
    ("housing", 5505895, "Jinzhe Liu"), ("housing", 13631997, "Claiton Conto"),
    ("logistics", 24244232, "Diego F. Parra"),
    ("retail", 4483608, "Tiger Lily"), ("retail", 10697106, "On Shot"),
    ("retail", 4437148, "Roy Broo"), ("retail", 12706241, "iam luisao"),
    ("retail", 10907746, "Laudia Tysara"), ("retail", 4073274, "Patrick Winzler"),
    ("retail", 17546505, "Nicolás Rueda"),
    ("street", 37319814, "Artem Korolev"), ("street", 37319834, "Artem Korolev"),
]

TREATMENTS = {
    "device": ["screen", "cutaway"], "document": ["document", "cutaway"],
    "market": ["screen", "headline", "tv_frame"], "construction": ["full_bleed", "cutaway"],
    "factory": ["full_bleed", "cutaway"], "housing": ["full_bleed", "cutaway"],
    "logistics": ["full_bleed", "map"], "retail": ["full_bleed", "cutaway"],
    "street": ["full_bleed", "cutaway"],
}


def main():
    outdir = Path("public/backgrounds")
    outdir.mkdir(parents=True, exist_ok=True)
    catalog_path = Path("config/photo-source-candidates.json")
    payload = json.loads(catalog_path.read_text(encoding="utf-8")) if catalog_path.exists() else {"schemaVersion": 1, "entries": []}
    rows = payload["entries"]
    known = {row.get("sourcePage") for row in rows}
    for category, photo_id, creator in PHOTOS:
        page = f"https://www.pexels.com/photo/{photo_id}/"
        if page in known:
            continue
        url = f"https://images.pexels.com/photos/{photo_id}/pexels-photo-{photo_id}.jpeg?auto=compress&cs=tinysrgb&w=1280"
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(request, timeout=45) as response:
                image = Image.open(BytesIO(response.read())).convert("RGB")
            filename = f"evidence-{category}-pexels-{photo_id}.jpg"
            target = outdir / filename
            image.save(target, quality=90, optimize=True)
            rows.append({
                "path": f"backgrounds/{filename}", "category": category,
                "title": f"Pexels photo {photo_id}", "creator": creator,
                "license": "Pexels License", "sourcePage": page, "sourceUrl": url,
                "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
                "semanticTags": [category], "treatments": TREATMENTS[category],
                "safeCrop": {"x": 0.5, "y": 0.5, "width": 0.9, "height": 0.82},
                "faceReviewed": False, "approved": False,
            })
            known.add(page)
        except Exception as exc:
            print(f"skip {photo_id}: {exc}")
    catalog_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    tiles = []
    for row in rows:
        path = Path("public") / row["path"]
        if not path.exists():
            continue
        image = Image.open(path).convert("RGB")
        image.thumbnail((360, 205))
        tile = Image.new("RGB", (380, 245), "white")
        tile.paste(image, ((380 - image.width) // 2, 4))
        ImageDraw.Draw(tile).text((8, 215), f"{row['category']} | {path.name}", fill="black")
        tiles.append(tile)
    sheet = Image.new("RGB", (1520, ((len(tiles) + 3) // 4) * 245), "#dddddd")
    for index, tile in enumerate(tiles):
        sheet.paste(tile, ((index % 4) * 380, (index // 4) * 245))
    contact = Path("output/photo-source-candidates.contact.jpg")
    contact.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(contact, quality=88)
    print(f"Candidate catalog: {len(rows)} images; review {contact}")


if __name__ == "__main__":
    main()
