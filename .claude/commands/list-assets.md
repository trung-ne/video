---
description: Liệt kê asset manifest (kind/style/action/emotion/topics), lọc theo topic
argument-hint: [topic] hoặc --used <path-to-timeline.json>
---

---
description: Liệt kê asset production khả dụng từ manifest (đã loại bộ legacy)
argument-hint: <topic> hoặc --used projects/<id>/timeline.json
---

# /list-assets — Semantic asset manifest

```powershell
npm run build-assets
npm run list-assets
npm run list-assets -- character
npm run list-assets -- --used projects/<id>/timeline.json
```

Không scan riêng SVG. Manifest gồm SVG/PNG/JPG, content hash, kind, style family,
action, emotion và topics. Asset trùng hash được tính là alias.

**Vốn từ authoring = `aliases` trong manifest** — chỉ gồm logical ref đã resolve
được sang art production (`generated-assets/`, `generated-backgrounds/`,
`backgrounds/`). Bộ `public/assets/*.svg` mang `styleFamily: legacy` và bị
resolver loại; nếu một ref chỉ còn legacy, gate báo `LEGACY_ASSET` → xem
[/add-asset](.claude/commands/add-asset.md).
