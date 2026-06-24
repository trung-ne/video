# /render — Render Timeline → MP4

Render timeline.json thành file MP4 hoàn chỉnh.

## Cách dùng
```
/render [options]
```

Options:
```
/render                                     # Dùng timeline.json mặc định
/render --timeline fed-timeline.json        # Dùng timeline file cụ thể
/render --out output/my-video.mp4           # Đặt tên output
/render --timeline t.json --out v.mp4       # Cả hai
```

## Quy trình

### 1. Xác định files

Parse `$ARGUMENTS`:
- `--timeline <file>` → default: `timeline.json`
- `--out <file>` → default: `output/video-<timestamp>.mp4`
- `--composition <id>` → default: `CatExplainer`

### 2. Validate trước khi render

Đọc timeline file. Kiểm tra:

**Lỗi nghiêm trọng (dừng render):**
- File không tồn tại hoặc JSON không hợp lệ
- `durationInFrames` = 0 hoặc không có
- Bất kỳ `enter` event nào có `src` không tồn tại trong `public/assets/`

**Warnings (tiếp tục nhưng báo):**
- Assets không được exit (hold-state, thường OK)
- Frame numbers gần nhau có thể gây overlap

Nếu có lỗi nghiêm trọng: dừng và hiển thị lỗi. Gợi ý `/validate` để xem chi tiết.

### 3. Tạo output directory

```bash
New-Item -ItemType Directory -Force output
```

### 4. Chạy render

```bash
npx ts-node scripts/render.ts --timeline <timeline> --out <out>
```

Hiển thị output của lệnh theo realtime nếu có thể.

### 5. Confirm kết quả

Sau khi render:
- Kiểm tra file output tồn tại
- Hiển thị file size
- Hiển thị duration

```
✅ Render xong!
📹 output/video.mp4 (X.X MB)
⏱️  Duration: X giây
```

## Troubleshooting tự động

| Lỗi thường gặp | Xử lý |
|----------------|-------|
| "Cannot find module" | Chạy `npm install` |
| "Asset not found" | Liệt kê assets thiếu, gợi ý dùng placeholder |
| "output directory not found" | Tạo thư mục `output/` |
| TypeScript error | Chạy `npx tsc --noEmit` và hiển thị lỗi |
