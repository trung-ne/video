"""Promote only the candidates accepted during manual contact-sheet review."""

import hashlib
import json
from pathlib import Path

REJECTED = {
    "backgrounds/evidence-retail-01.jpg",
    "backgrounds/evidence-retail-pexels-4073274.jpg",
}


def main():
    candidates = json.loads(Path("config/photo-source-candidates.json").read_text(encoding="utf-8"))["entries"]
    catalog_path = Path("config/photo-backgrounds.json")
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    catalog["schemaVersion"] = 2
    catalog["reviewedAt"] = "2026-07-31"
    approved = 0
    for row in candidates:
        photo_path = row["path"]
        if photo_path in REJECTED:
            continue
        local = Path("public") / photo_path
        if not local.exists():
            raise RuntimeError(f"missing candidate: {local}")
        digest = hashlib.sha256(local.read_bytes()).hexdigest()
        if digest != row["sha256"]:
            raise RuntimeError(f"candidate changed after review: {photo_path}")
        catalog["entries"][photo_path] = {
            "approved": True,
            "faceReviewed": True,
            "creator": row.get("creator", "Unknown contributor"),
            "license": row["license"],
            "sourcePage": row["sourcePage"],
            "sha256": digest,
            "semanticTags": list(dict.fromkeys(row.get("semanticTags", [row.get("category")]))),
            "treatments": row.get("treatments", ["full_bleed", "cutaway"]),
            "safeCrop": row["safeCrop"],
        }
        approved += 1
    catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Approved {approved} manually reviewed no-face photos")


if __name__ == "__main__":
    main()
