---
description: Thêm asset SVG/ảnh mới vào manifest (không dùng emoji/text placeholder)
argument-hint: <mô tả asset cần thêm>
---

# /add-asset — Thêm asset semantic

Thêm asset nguyên bản vào `public/assets/`, `public/generated-assets/` hoặc thư mục
background phù hợp. Không tạo emoji/text placeholder.

Sau khi thêm:

```powershell
npm run build-assets
npm run list-assets -- <topic>
npm run check
```

Kiểm tra entry trong `public/assets.manifest.json` có đúng `kind`, `styleFamily`,
action/emotion/topics và không bị gom nhầm thành duplicate alias.
