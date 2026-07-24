# /new-video — Full Pipeline: Idea/URL/Transcript → MP4

Chạy toàn bộ pipeline tạo video tự động từ đầu đến cuối.
**Mọi artifact của một video sống trong `projects/<id>/`** (theo quy ước trong CLAUDE.md) — KHÔNG ghi ra `timeline.json` ở root.

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

### Bước 1 — Nhận dạng input + tạo project folder

Phân tích `$ARGUMENTS` để xác định mode:
- Nếu bắt đầu bằng `http://` hoặc `https://` → Mode URL
- Nếu kết thúc bằng `.txt` hoặc có `--transcript` → Mode Transcript
- Còn lại → Mode Idea

Kiểm tra nếu có `--audio <path>` trong arguments, lưu lại audio path.

**Tạo project folder** — mỗi video 1 folder `projects/video-XXX-<slug>/`:
```bash
npx ts-node scripts/new-project.ts --idea "<idea>"          # Mode Idea
npx ts-node scripts/new-project.ts --transcript <file>       # Mode Transcript
npx ts-node scripts/new-project.ts --url "<url>"             # Mode URL
```
`new-project.ts` in ra đường dẫn folder vừa tạo — ghi nhớ nó làm `projects/<id>/` cho các bước sau. Mọi file (transcript, tts_scenes, timeline, audio, output) đều nằm trong folder này.

### Bước 2 — Generate timeline (ghi vào `projects/<id>/timeline.json`)

Chọn cách generate — **mặc định dùng Mode A (in-session, không cần API key)** trừ khi user nói "chạy script" hoặc muốn dùng API key riêng:

**Mode A — In-session (mặc định, dùng quota chat này, KHÔNG cần API key)**
Làm theo đúng quy trình của [/generate](generate.md), nhưng **BẮT BUỘC tạo
`storyboard.json` trước `timeline.json`**. Không được viết helper keyword/modulo
để sinh thẳng scenes và không dùng một visual cho cả đoạn narration dài. Mỗi
visual shot 5-9 giây; compile storyboard bằng `scripts/compile-storyboard.ts`,
sau đó mới TTS-lock timing và validate.

**Mode B — Script (cần `ANTHROPIC_API_KEY` trong env)**
Kiểm tra API key; nếu chưa có, hỏi user hoặc quay lại Mode A. Storyboard pipeline
tự bật:
```bash
# Kokoro (tiếng Anh)
npx ts-node scripts/generate-timeline.ts --transcript projects/<id>/transcript.txt --tts-kokoro --tts-voice af_heart --tts-lang a --out projects/<id>/timeline.json
# Edge (tiếng Việt)
npx ts-node scripts/generate-timeline.ts --transcript projects/<id>/transcript.txt --tts --tts-voice vi-VN-HoaiMyNeural --out projects/<id>/timeline.json
# Từ idea / url: thay --transcript bằng --idea "<idea>" hoặc --url "<url>"
```

Chờ lệnh hoàn thành. Nếu lỗi, báo cáo lỗi cụ thể cho user.

### Bước 3 — Validate + quality gate tự động

Đọc `projects/<id>/timeline.json` và kiểm tra:
- File tồn tại và là JSON hợp lệ (format `scenes[]`)
- Tất cả assets được dùng có file SVG tương ứng trong `public/assets/`
- `durationInFrames` > 0; mỗi scene `startFrame`/`durationFrames` khớp `durations.json`

Nếu có lỗi assets không tồn tại: liệt kê assets bị thiếu và hỏi user có muốn tiếp tục không.
(Lưu ý: `render.ts` cũng tự chạy `validateTimeline` như cổng schema fail-fast trước khi render.)

Chạy thêm:
```bash
npx ts-node scripts/quality-check.ts projects/<id>/timeline.json
```
Chỉ render khi **0 blocker, 0 major, grade A/B**. `render.ts` enforce cổng này;
`--skip-quality` chỉ dùng cho debug.

### Bước 4 — Preview (hỏi user)

Hỏi: "Preview trong Remotion Studio trước khi render? (y/n)"

Nếu yes:
```bash
npm start
```
Thông báo: "Studio đang chạy tại http://localhost:3000. Nhấn Enter khi muốn render..."
(Studio preview lấy timeline mặc định từ root — để xem đúng project này, render trực tiếp ở Bước 5 hoặc trỏ preview vào `projects/<id>/timeline.json`.)

### Bước 5 — Render (ghi vào `output/<id>.mp4`)

```bash
npx ts-node scripts/render.ts --timeline projects/<id>/timeline.json --out output/<id>.mp4
```

Hiển thị progress. Sau khi xong, thông báo path của MP4.
Render tự chạy pixel-level visual audit và ghi
`output/<id>.visual-audit.json`. Nếu audit fail, không được báo video
production-ready.

### Bước 6 — Tóm tắt

Hiển thị:
```
✅ Video hoàn chỉnh!

📹 File:      output/<id>.mp4
⏱️  Duration:  X giây
🎬 Scenes:    N scenes
📁 Project:   projects/<id>/  (timeline.json, transcript.txt, voice.wav, durations.json)
```

## Rules quan trọng khi chạy

1. **Mọi thứ vào `projects/<id>/`** — không ghi `timeline.json` ở root (nhất quán với /generate và quy ước folder trong CLAUDE.md).
2. Luôn validate trước khi render — không render timeline có lỗi nghiêm trọng.
3. Nếu asset thiếu, gợi ý placeholder hoặc hỏi user.
4. Lưu `projects/<id>/timeline.json` sau khi generate để user có thể chỉnh sửa.
5. Nếu render thất bại, kiểm tra: `output/` tồn tại, TypeScript compile được (`npx tsc --noEmit`).
6. Không dùng `--legacy-direct`, `--skip-quality`, `--skip-visual-audit` trong
   production; các flag này chỉ dành cho chẩn đoán.
