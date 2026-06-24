# /list-assets — Liệt kê tất cả SVG Assets

Hiển thị toàn bộ assets có sẵn trong `public/assets/`, có thể dùng trong timeline.

## Cách dùng
```
/list-assets
/list-assets finance
/list-assets --used timeline.json
```

## Quy trình

### 1. Scan thư mục `public/assets/`

Đọc đệ quy tất cả files `.svg` trong `public/assets/`.

Với mỗi file, tạo asset ID = path tương đối từ `public/assets/`, bỏ `.svg`:
- `public/assets/characters/cat.svg` → `characters/cat`
- `public/assets/finance/bank.svg` → `finance/bank`

### 2. Nhóm theo category

Hiển thị theo nhóm thư mục:

```
📁 public/assets/
│
├── characters/ (1 assets)
│   └── characters/cat
│
├── finance/ (7 assets)
│   ├── finance/bank
│   ├── finance/chart_up
│   ├── finance/house
│   ├── finance/inflation
│   ├── finance/interest_rate
│   ├── finance/money
│   └── finance/stock
│
├── people/ (2 assets)
│   ├── people/company
│   └── people/person
│
└── ui/ (2 assets)
    ├── ui/arrow_down
    └── ui/arrow_up

Total: 12 assets
```

### 3. Nếu có `--used <timeline>` flag

Đọc timeline file, tìm tất cả `enter` events.
Hiển thị:
- Assets đang được dùng (với ✅)
- Assets trong library nhưng chưa dùng (với ○)
- Assets được dùng trong timeline nhưng không có file SVG (với ❌)

```
Timeline: timeline.json
┌──────────────────────────┬────────┐
│ Asset                    │ Status │
├──────────────────────────┼────────┤
│ characters/cat           │ ✅ used │
│ finance/bank             │ ✅ used │
│ finance/money            │ ✅ used │
│ finance/house            │ ✅ used │
│ finance/inflation        │ ✅ used │
│ finance/interest_rate    │ ✅ used │
│ finance/chart_up         │ ○ not used │
│ finance/stock            │ ○ not used │
│ people/person            │ ✅ used │
│ people/company           │ ✅ used │
│ ui/arrow_up              │ ○ not used │
│ ui/arrow_down            │ ○ not used │
└──────────────────────────┴────────┘
```

### 4. Nếu có filter argument (category name)

Chỉ hiển thị assets trong category đó:
```
/list-assets finance
→ Chỉ hiện assets bắt đầu bằng "finance/"
```

### 5. Tip thêm asset

Cuối output luôn hiển thị:
```
💡 Thêm SVG: Đặt file vào public/assets/<category>/<name>.svg
   Tham chiếu trong timeline: "src": "<category>/<name>"
   Xem hướng dẫn: /add-asset
```
