# /validate — Kiểm tra Timeline JSON

Validate timeline.json trước khi render. Phát hiện lỗi assets thiếu, frame overflow, JSON sai schema.

## Cách dùng
```
/validate
/validate timeline.json
/validate fed-timeline.json --fix
```

## Quy trình

### 1. Xác định file cần validate

Parse `$ARGUMENTS`:
- Nếu có argument là file `.json` → dùng file đó
- Mặc định: `timeline.json`
- `--fix` flag → tự động sửa những lỗi có thể sửa được

### 2. Đọc và parse JSON

```typescript
import { validateTimeline } from "./src/ai/validateTimeline";
```

Nếu JSON parse lỗi: hiển thị dòng lỗi, gợi ý dùng JSON validator online.

### 3. Chạy validation đầy đủ

Kiểm tra theo thứ tự:

**Structural checks:**
- fps = 30 ✓
- width = 1920, height = 1080 ✓
- durationInFrames > 0 ✓
- events là array ✓

**Per-event checks:**
- frame là number, không âm, không vượt durationInFrames
- type là một trong 7 loại hợp lệ
- assetId/textId/src không rỗng
- position.x và position.y trong [0, 1]
- animation values hợp lệ

**Asset existence checks:**
- Với mỗi `enter` event: kiểm tra `public/assets/<src>.svg` tồn tại

**Logic checks:**
- `exit` event cho assetId chưa từng `enter` → warning
- `emphasize` event cho assetId không active → warning
- Quá nhiều assets cùng lúc (>8) → warning (có thể cluttered)

### 4. Hiển thị kết quả

```
📋 Validating: timeline.json
   Duration: 450 frames (15.0s)
   Events: 18

✅ Passed: 15 checks
⚠️  Warnings: 2
   WARN: assets "finance/chart_down" never exited (hold-state OK)
   WARN: 9 assets active simultaneously — có thể cluttered

❌ Errors: 1
   ERROR: Event[5] frame=135: asset not found: public/assets/finance/cpi.svg
```

### 5. Nếu có `--fix` flag

Tự động sửa những lỗi nhỏ:
- `fps` sai → đổi thành 30
- `width`/`height` thiếu → thêm 1920/1080
- `background` thiếu → thêm "#FAFAF8"
- `animationDuration` thiếu → thêm giá trị mặc định (18 frames)

Với lỗi assets thiếu: không tự sửa, nhưng gợi ý:
```
💡 Asset "finance/cpi.svg" không tồn tại.
   Tùy chọn:
   1. Thêm SVG: public/assets/finance/cpi.svg
   2. Đổi sang asset có sẵn: /list-assets
   3. Bỏ event này khỏi timeline
```

### 6. Exit code

- Không có errors → "✅ Timeline hợp lệ, sẵn sàng render"
- Có errors → "❌ Fix errors trước khi render"
- Chỉ có warnings → "⚠️ Timeline có warnings nhưng có thể render được"
