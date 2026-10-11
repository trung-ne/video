---
description: Bổ sung asset production còn thiếu vào generated-assets/ rồi rebuild manifest
argument-hint: <logical ref hoặc mô tả asset cần thêm>
---

# /add-asset — Bổ sung asset production

Dùng khi gate báo `LEGACY_ASSET` / `ASSET_EXISTS`, hoặc khi authoring cần một
asset chưa có trong bộ hiện tại.

## Nguồn asset được phép

| Thư mục | Dùng cho | styleFamily |
|---|---|---|
| `public/generated-assets/characters/` | nhân vật mèo (PNG nền trong) | `editorial_cat_v1` |
| `public/generated-assets/icons/` | icon/prop | `flat_icon_v1` |
| `public/generated-assets/scenes/` | stage/bối cảnh vẽ | `flat_stage_v1` |
| `public/generated-backgrounds/` | bản nền chất lượng cao, **đè** `scenes/` khi trùng tên | `flat_stage_v1` |
| `public/backgrounds/` | ảnh thật (JPG) cho BEAT/photo | `photo` |

⛔ **Không thêm vào `public/assets/`** — bộ SVG vẽ tay đã ngừng dùng, chỉ giữ để
tương thích ngược. Không tạo emoji/text placeholder thay cho asset thật.

## Quy ước đặt tên (quyết định alias tự động)

Alias `logical ref → file thật` do [build-asset-manifest.ts](scripts/build-asset-manifest.ts)
suy ra từ tên file, **không có bảng khai báo tay**. Đặt đúng tên là đủ:

| Logical ref cần | Tên file phải đặt |
|---|---|
| `characters/cat_angry` | `generated-assets/characters/cat_angry.png` |
| `finance/tax_rate` | `generated-assets/icons/finance-tax-rate.png` |
| `props/laptop` | `generated-assets/icons/props-laptop.png` |
| `ui/arrow_left` | `generated-assets/icons/ui-arrow-left.png` |
| `assets/scenes/rooftop.svg` (stage) | `generated-assets/scenes/rooftop.png` |

Quy tắc: `<category>-<tên đổi _ thành ->.png`. Riêng characters giữ nguyên `_`.

## Sau khi thêm file

```powershell
npm run build-assets                              # sinh lại manifest + alias
npm run list-assets -- <topic>                    # xác nhận đã index
npm run quality -- projects/<id>/timeline.json    # LEGACY_ASSET phải hết
```

Không cần hardcode alias trong prompt/code: `listAvailableAssets()` đọc thẳng
alias-map, nên asset mới vào vocabulary Route A ngay sau `build-assets`.

## Khi asset thiếu lúc authoring Route A

`build-storyboard.ts` ghi semantic request không resolve được vào
`projects/<id>/asset-needs.json` và dừng trước TTS. Xử lý: thêm/chọn lại asset theo
hướng dẫn trên → `build-assets` → sửa scene-local trong `storyboard-data.ts` → build
lại. Không dùng Route B generate/repair và không hạ ngưỡng gate.
