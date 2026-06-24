# /preview — Mở Remotion Studio

Mở Remotion Studio để xem preview video trực tiếp trong trình duyệt.
Có thể scrub timeline, xem từng frame, kiểm tra animations.

## Cách dùng
```
/preview
/preview --timeline fed-timeline.json
```

## Quy trình

### 1. Nếu có `--timeline` argument

Copy timeline file được chỉ định thành `timeline.json` (backup file cũ trước):
```
timeline.json.bak → backup
<file>.json → timeline.json
```

Cập nhật `src/Root.tsx` defaultProps để dùng timeline mới. Thực ra không cần — Root.tsx đọc từ file thông qua props khi render. Chỉ cần user tự chọn trong Studio.

### 2. Kiểm tra port 3000

Kiểm tra xem Studio đã chạy chưa:
```powershell
Test-NetConnection -ComputerName localhost -Port 3000 -InformationLevel Quiet
```

Nếu đã chạy: "Studio đang chạy tại http://localhost:3000"

### 3. Khởi động Studio

```bash
npm start
```

Thông báo:
```
🎬 Remotion Studio đang khởi động...
   URL: http://localhost:3000
   
   Trong Studio:
   - Chọn composition "CatExplainer" ở sidebar trái
   - Scrub timeline để xem animation
   - Space để play/pause
   - Ctrl+K để search compositions
   
   Tắt Studio: Ctrl+C trong terminal
```

### 4. Mở trình duyệt (nếu có thể)

```powershell
Start-Process "http://localhost:3000"
```

## Tips sử dụng Studio

- **Kiểm tra hold state**: Scrub nhanh qua timeline, assets cũ phải vẫn còn khi asset mới xuất hiện
- **Kiểm tra camera**: Khi scrub đến CameraEvent, viewport phải zoom vào đúng vị trí
- **Kiểm tra timing**: So sánh với audio (nếu có), asset phải xuất hiện trước voice 0.5s
- **Kiểm tra emphasis**: EmphasizeEvent phải visible rõ ràng, không quá subtle
