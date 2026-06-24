# /new-video — Full Pipeline: Idea/URL/Transcript → MP4

Chạy toàn bộ pipeline tạo video tự động từ đầu đến cuối.

## Cách dùng
```
/new-video <input>
```

Input có thể là:
- Ý tưởng: `Tại sao lạm phát tăng?`
- URL YouTube: `https://youtube.com/watch?v=...`
- Path transcript: `transcript.txt`
- Với audio: `Lãi suất là gì? --audio audio/voice.mp3`

## Quy trình thực hiện

Khi user gọi `/new-video $ARGUMENTS`, thực hiện theo thứ tự sau:

### Bước 1 — Nhận dạng input

Phân tích `$ARGUMENTS` để xác định mode:
- Nếu bắt đầu bằng `http://` hoặc `https://` → Mode URL
- Nếu kết thúc bằng `.txt` hoặc có `--transcript` → Mode Transcript
- Còn lại → Mode Idea

Kiểm tra nếu có `--audio <path>` trong arguments, lưu lại audio path.

Kiểm tra `ANTHROPIC_API_KEY` đã set chưa. Nếu chưa, hỏi user.

### Bước 2 — Generate timeline

Xác định output filename từ input:
- Từ ý tưởng: dùng slug của ý tưởng (ví dụ: `lai-suat.json`)
- Mặc định: `timeline.json`

Chạy lệnh phù hợp:

**Mode Idea:**
```bash
npx ts-node scripts/generate-timeline.ts --idea "<idea>" [--audio <audio>] --out timeline.json
```

**Mode URL:**
```bash
npx ts-node scripts/generate-timeline.ts --url "<url>" [--audio <audio>] --out timeline.json
```

**Mode Transcript:**
```bash
npx ts-node scripts/generate-timeline.ts --transcript <file> [--audio <audio>] --out timeline.json
```

Chờ lệnh hoàn thành. Nếu lỗi, báo cáo lỗi cụ thể cho user.

### Bước 3 — Validate tự động

Đọc `timeline.json` vừa tạo và kiểm tra:
- File tồn tại và là JSON hợp lệ
- Tất cả assets được dùng có file SVG tương ứng trong `public/assets/`
- `durationInFrames` > 0
- Không có frame number vượt quá `durationInFrames`

Nếu có lỗi assets không tồn tại: liệt kê assets bị thiếu và hỏi user có muốn tiếp tục không.

### Bước 4 — Preview (hỏi user)

Hỏi: "Preview trong Remotion Studio trước khi render? (y/n)"

Nếu yes:
```bash
npm start
```
Thông báo: "Studio đang chạy tại http://localhost:3000. Nhấn Enter khi muốn render..."

### Bước 5 — Render

Tạo output filename: `output/<slug>-<timestamp>.mp4`

Chạy:
```bash
npx ts-node scripts/render.ts --timeline timeline.json --out output/<filename>.mp4
```

Hiển thị progress. Sau khi xong, thông báo path của MP4.

### Bước 6 — Tóm tắt

Hiển thị:
```
✅ Video hoàn chỉnh!

📹 File: output/<filename>.mp4
⏱️  Duration: X giây
🎬 Frames: N events
📁 Timeline: timeline.json
```

## Rules quan trọng khi chạy

1. Luôn validate trước khi render — không render timeline có lỗi nghiêm trọng
2. Nếu asset thiếu, gợi ý placeholder hoặc hỏi user
3. Lưu timeline.json sau khi generate để user có thể chỉnh sửa
4. Nếu render thất bại, kiểm tra: output/ directory tồn tại, TypeScript compile được
