# /edit-timeline — Sửa Timeline Thông Minh

Chỉnh sửa timeline.json với hiểu biết về context. Có thể thêm/sửa/xóa events, điều chỉnh timing, thêm emphasis.

## Cách dùng
```
/edit-timeline <yêu cầu>
```

Examples:
```
/edit-timeline thêm camera zoom vào bank ở frame 150
/edit-timeline đổi animation của cat thành slideUp
/edit-timeline thêm text "Kết luận" ở cuối video frame 400
/edit-timeline xóa event emphasize của money
/edit-timeline cat xuất hiện sớm hơn 30 frames
/edit-timeline thêm asset people/person cạnh bank
/edit-timeline tất cả fadeIn đổi thành popIn
```

## Quy trình

### 1. Đọc timeline hiện tại

Đọc `timeline.json` (hoặc file được chỉ định trong args).
Parse và hiểu cấu trúc hiện tại:
- Danh sách assets đang trên canvas
- Các frame timing
- Camera state

### 2. Phân tích yêu cầu từ `$ARGUMENTS`

Hiểu ý định người dùng. Các pattern thường gặp:

**Thêm event:**
- "thêm X" → EnterEvent mới
- "thêm camera zoom" → CameraEvent mới
- "thêm text" → TextEvent mới
- "nhấn mạnh X" → EmphasizeEvent mới

**Sửa event:**
- "đổi animation X" → tìm EnterEvent có assetId=X, đổi animation
- "di chuyển X đến" → MoveEvent hoặc sửa position của EnterEvent
- "X xuất hiện sớm/muộn hơn" → điều chỉnh frame number

**Xóa event:**
- "xóa X" → xóa event khỏi array

**Batch:**
- "tất cả X đổi thành Y" → thay thế tất cả instances

### 3. Xác nhận trước khi sửa

Hiển thị:
```
Thay đổi sẽ thực hiện:
  + Thêm CameraEvent tại frame 150: zoom=1.3, center=(0.5, 0.35), duration=30
  
Xác nhận? (y/n)
```

Nếu thay đổi phức tạp hoặc ảnh hưởng nhiều events: liệt kê tất cả thay đổi.

### 4. Apply thay đổi

Sửa `timeline.json` trực tiếp.
Giữ nguyên format (indent 2 spaces, UTF-8).
Sắp xếp events theo frame number sau khi sửa.

### 5. Validate sau khi sửa

Chạy validation nhanh:
- Không có assets thiếu
- Frame numbers hợp lệ

### 6. Confirm

```
✅ Đã sửa timeline.json
   Thay đổi: +1 CameraEvent tại frame 150
   
Preview: /preview
Render:  /render
```

## Rules khi edit

- **KHÔNG** làm mất hold-state: nếu user muốn "xóa asset X", dùng ExitEvent — không xóa EnterEvent
- **Giữ** thứ tự sắp xếp theo frame
- **Kiểm tra** assetId tồn tại khi thêm MoveEvent/EmphasizeEvent
- **Gợi ý** position từ POSITION GRID 3×3 khi user không chỉ định vị trí cụ thể

## Shortcut patterns

| Yêu cầu | Action |
|---------|--------|
| "làm mượt hơn" | Tăng animationDuration của tất cả events lên 5 frames |
| "nhanh hơn" | Giảm animationDuration xuống 10 frames |
| "thêm impact" | Thêm pulse emphasize vào main concept |
| "kết thúc rõ hơn" | Thêm ClearEvent + text CTA ở 95% duration |
| "zoom vào X" | Thêm CameraEvent focus vào position của asset X |
