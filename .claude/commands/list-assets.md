---
description: Liệt kê asset manifest (kind/style/action/emotion/topics), lọc theo topic
argument-hint: [topic] hoặc --used <path-to-timeline.json>
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
