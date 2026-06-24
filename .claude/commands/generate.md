# /generate — Generate Timeline từ Script/URL/Transcript

Chỉ chạy bước generate AI → timeline.json (không render).
Dùng khi muốn xem/chỉnh timeline trước khi render.

## Cách dùng
```
/generate <input> [options]
```

Examples:
```
/generate Tại sao Bitcoin tăng giá?
/generate https://youtube.com/watch?v=abc123
/generate transcript.txt
/generate Lãi suất FED --audio audio/voice.mp3 --duration 90 --out fed-timeline.json
```

## Quy trình

### 1. Parse arguments từ `$ARGUMENTS`

Phân tích để tìm:
- `--audio <path>` → audio file (optional)
- `--duration <N>` → override duration seconds (optional)
- `--out <file>` → output path (default: `timeline.json`)
- Còn lại là input chính

Nhận dạng mode:
- URL pattern (`http://` hoặc `https://`) → `--url`
- File tồn tại với `.txt` extension → `--transcript`
- Còn lại → `--idea`

### 2. Kiểm tra prerequisites

- `ANTHROPIC_API_KEY` phải có. Nếu thiếu: "Set bằng: $env:ANTHROPIC_API_KEY='sk-ant-...'"
- Nếu mode transcript: file phải tồn tại
- Liệt kê assets có sẵn từ `public/assets/`

### 3. Chạy generate

```bash
npx ts-node scripts/generate-timeline.ts \
  --[idea|url|transcript] "<input>" \
  [--audio <audio>] \
  [--duration <N>] \
  --out <outfile>
```

### 4. Hiển thị kết quả

Sau khi generate xong:
- Đọc và parse file output
- Hiển thị tóm tắt: số events, duration, assets được dùng
- Liệt kê assets nào không tìm thấy trong `public/assets/` (warnings)

### 5. Gợi ý bước tiếp theo

```
Timeline đã lưu: <outfile>

Bước tiếp:
  Preview:  /preview
  Validate: /validate <outfile>
  Render:   /render --timeline <outfile>
  Sửa:      /edit-timeline <outfile>
```

## Chú ý

- Script tự động lưu vào `<outfile>_script.txt` khi dùng mode idea
- Nếu AI trả về JSON không hợp lệ: hiển thị raw output và gợi ý thử lại
- Với URL mode: cần `yt-dlp` installed. Nếu không có, Claude sẽ dùng URL làm context
