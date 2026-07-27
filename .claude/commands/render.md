---
description: Production render → output/<id>/video.mp4, kèm encoding/visual/audio audit
argument-hint: <project-id-or-path>
---

# /render — Production render

```powershell
npm run render -- --project <id-or-path>
```

Mặc định ghi ra `output/<id>/video.mp4` (kèm `contact.jpg`, `*-audit.json`,
`production-report.json` trong cùng folder). Chỉ định `--out` khi cần path khác.

Render chỉ chạy khi schema và semantic quality gate pass. Sau render tự chạy:

- encoding audit: H.264, 1920×1080, 30fps, bitrate floor;
- visual audit bỏ subtitle band;
- thresholds edge `0.16`, saturation `0.15`, near duplicate `22%`.

Các flag `--skip-quality`, `--skip-validate`, `--skip-visual-audit` chỉ dành cho
diagnostic, không dùng để xuất bản.
