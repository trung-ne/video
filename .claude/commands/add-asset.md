# /add-asset — Thêm SVG Asset Mới

Hướng dẫn thêm SVG asset vào thư viện và tạo placeholder nếu cần.

## Cách dùng
```
/add-asset <tên> [category]
/add-asset cpi finance
/add-asset gdp
/add-asset teacher characters
/add-asset --placeholder <tên> [category]
```

## Quy trình

### 1. Parse arguments từ `$ARGUMENTS`

- Tên asset (bắt buộc): ví dụ `cpi`, `gdp`, `teacher`
- Category (optional): `finance` | `people` | `characters` | `ui` | tên mới
  - Nếu không có: gợi ý category phù hợp dựa trên tên
- `--placeholder` flag: tạo SVG placeholder ngay (không cần user vẽ)

### 2. Xác định category

Nếu không có category, gợi ý:
- Tên liên quan tài chính (bank, money, tax, cpi, gdp, bond...) → `finance`
- Tên người/tổ chức (person, teacher, government, worker...) → `people`
- Tên nhân vật (cat, dog, robot...) → `characters`
- UI elements (arrow, icon, badge...) → `ui`

Hỏi xác nhận: "Đặt vào category `finance`? (y/n hoặc gõ category khác)"

### 3. Kiểm tra đã tồn tại chưa

```
Kiểm tra: public/assets/<category>/<name>.svg
```

Nếu đã tồn tại: "Asset này đã có. Muốn overwrite? (y/n)"

### 4a. Nếu có `--placeholder` flag

Tạo placeholder SVG ngay tại đúng path.

**Template placeholder cho finance:**
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="160" height="160">
  <circle cx="80" cy="72" r="52" fill="#3498DB" opacity="0.15"/>
  <circle cx="80" cy="72" r="52" fill="none" stroke="#3498DB" stroke-width="3"/>
  <text x="80" y="68" text-anchor="middle" font-size="18" font-weight="bold" fill="#2980B9" font-family="Arial"><NAME_UPPER></text>
  <text x="80" y="90" text-anchor="middle" font-size="28" fill="#2980B9" font-family="Arial">📊</text>
  <text x="80" y="140" text-anchor="middle" font-size="14" fill="#555" font-family="Arial"><LABEL></text>
</svg>
```

Thay `<NAME_UPPER>` = tên viết hoa, `<LABEL>` = tên hiển thị.

Thông báo: "Placeholder tạm đã tạo. Thay bằng SVG thật sau!"

### 4b. Nếu không có `--placeholder`

Hướng dẫn đầy đủ:

```
📋 Hướng dẫn thêm asset "<name>" vào "<category>":

1. CHUẨN BỊ FILE SVG:
   - Kích thước viewBox: 160×160
   - Background: transparent
   - Màu sắc đậm, dễ thấy trên nền #FAFAF8
   - Không embed fonts (dùng shapes thay vì text)

2. ĐẶT FILE:
   → public/assets/<category>/<name>.svg

3. SỬ DỤNG TRONG TIMELINE:
   {
     "type": "enter",
     "assetId": "<name>",
     "src": "<category>/<name>",
     ...
   }

4. VERIFY:
   Chạy /list-assets để xác nhận asset đã được nhận diện
   Chạy /validate để kiểm tra timeline dùng asset này
```

### 5. Nếu user paste nội dung SVG

Nếu user cung cấp SVG content trong message:
- Lưu vào đúng path
- Kiểm tra viewBox có phải 160×160 không
- Kiểm tra không có external resources (no `<image href="http://...">`)
- Confirm: "✅ Lưu: public/assets/<category>/<name>.svg"

### 6. Sau khi thêm

```
✅ Asset "<category>/<name>" đã sẵn sàng!

Dùng trong timeline:
  "src": "<category>/<name>"

Kiểm tra:
  /list-assets
  
Thêm vào video hiện tại:
  /edit-timeline thêm <name> vào video
```

## SVG Best Practices

Nhắc user những điều quan trọng:
- **160×160 viewBox**: `viewBox="0 0 160 160" width="160" height="160"`
- **Transparent background**: không có `<rect fill="white">` bao phủ toàn bộ
- **Màu sắc**: dùng màu đậm như `#3498DB`, `#E74C3C`, `#27AE60`, `#F39C12`
- **Tên file**: lowercase, underscore thay space: `interest_rate.svg` không phải `interest rate.svg`
- **Test nhanh**: mở SVG trong trình duyệt để kiểm tra trông như thế nào
