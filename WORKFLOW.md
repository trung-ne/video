# Workflow Guide — Làm video từ ý tưởng đến render

Quy trình chi tiết tạo video từ đầu đến cuối.

> **💡 Chọn kiến trúc phù hợp model của bạn:**
> - **Model yếu (Haiku free tier)**: Tách thành 3 session nhỏ (xem phần "Kiến trúc tối ưu")
> - **Model mạnh (Sonnet/API paid)**: Làm trong 1 session duy nhất

---

## Kiến trúc tối ưu theo Model

### Model Yếu (Free Tier - Haiku, rate limit ~3-5 req/min)

**Vấn đề:** Context limit + rate limit → không thể làm full pipeline trong 1 session.

**Giải pháp:** Tách thành **3 session độc lập**:

```
📋 Session 1 (30k tokens)     📝 Session 2 (20k tokens)     ✅ Session 3 (15k tokens)
├─ Đọc transcript             ├─ Load timeline.json         ├─ Load timeline final
├─ Gen timeline + TTS         ├─ Fix bugs/issues            ├─ Render MP4
├─ Save timeline.json         ├─ Verify structure           └─ Publish
└─ Save voice.wav             └─ Save changes
```

**Chi phí:** `3 sessions × 30k tokens ≈ $0.24` (Claude API Haiku) hoặc **miễn phí** (Claude.ai free, chỉ chờ rate limit)

**Workflow:**
1. **Session 1**: Tạo timeline + audio, lưu `projects/<video>/timeline.json`
2. **Wait** ~5-10 phút (rate limit)
3. **Session 2**: Load timeline, fix lỗi, test structure, lưu changes
4. **Wait** ~5-10 phút
5. **Session 3**: Verify final, render (hoặc chạy render.ts tay)

### Model Mạnh (Sonnet 4.6 API, Claude Studio - no rate limit)

**Ưu điểm:** Context lớn (200k), không rate limit, quality cao.

**Workflow:** Làm **toàn bộ trong 1 session dài**:
```
📝 Start Session (80-120k tokens total)
├─ Đọc transcript
├─ Gen timeline + TTS
├─ Verify output
├─ Fix bugs nếu cần
├─ Render MP4
└─ Done
```

**Chi phí:** `120k tokens ≈ $0.36` (Sonnet API) = rẻ hơn 1 cà phê.

---

## Overview: 5 bước chính

```
💡 Ý tưởng/Transcript → 🤖 AI tạo Timeline → 🎙️ TTS Audio → 🎨 Render → 📹 Video
```

| Bước | Input | Output | Tool |
|------|-------|--------|------|
| 1 | Ý tưởng / transcript | Script + tóm tắt | Claude AI (burnin) hoặc bạn viết |
| 2 | Transcript + script | timeline.json | `generate-timeline.ts` + Claude |
| 3 | Timeline + narration | voice.wav + durations.json | `tts_edge.py` hoặc `tts_kokoro.py` |
| 4 | Timeline + audio | MP4 | `render.ts` (Remotion) |
| 5 | MP4 | Video final | Xem, chỉnh sửa nếu cần |

---

## Chi tiết từng bước

### BƯỚC 1: Chuẩn bị Transcript/Script

**Cho ý tưởng mới:**
- Viết script tương đối chi tiết (ít nhất 3-5 đoạn)
- Hoặc: gợi ý idea, để AI viết → bạn review

**Cho video từ YouTube:**
- Extract transcript từ video
- Dịch sang tiếng Việt (nếu cần)

**Cho video từ bài viết:**
- Copy full text hoặc tóm tắt thành narration (~130 từ/phút cho tiếng Anh, 130 từ/phút cho tiếng Việt)

**Lưu file:** `projects/<project-name>/transcript.txt`

---

### BƯỚC 2: Generate Timeline từ Transcript

#### **Tùy chọn A: Transcript không có audio**

```bash
cd c:\Users\Administrator\Documents\video

# Dùng Edge TTS (nhanh, tiếng Việt)
npx ts-node scripts/generate-timeline.ts \
  --transcript projects/my-video/transcript.txt \
  --tts --tts-voice vi-VN-HoaiMyNeural \
  --out projects/my-video/timeline.json

# Hoặc dùng Kokoro TTS (chất lượng cao, tiếng Anh)
npx ts-node scripts/generate-timeline.ts \
  --transcript projects/my-video/transcript.txt \
  --tts-kokoro --tts-voice af_heart --tts-lang a \
  --out projects/my-video/timeline.json
```

**Kết quả:**
- ✅ `projects/my-video/timeline.json` — timeline sẵn sàng render
- ✅ `public/audio/<my-video>/voice.wav` — âm thanh đã generate
- ✅ `public/audio/<my-video>/durations.json` — thông tin timing mỗi scene

#### **Tùy chọn B: Có audio file sẵn**

```bash
# Nếu đã có audio trước, dùng --audio (không cần TTS)
npx ts-node scripts/generate-timeline.ts \
  --transcript projects/my-video/transcript.txt \
  --audio "audio/my-video/voice.mp3" \
  --out projects/my-video/timeline.json
```

#### **Tùy chọn C: Chỉ generate ý tưởng thành timeline (AI viết script)**

```bash
# AI sẽ viết script → tạo timeline + generate audio cùng lúc
npx ts-node scripts/generate-timeline.ts \
  --idea "Tại sao Bitcoin tăng giá?" \
  --tts --tts-voice af_heart \
  --duration 60 \
  --out projects/my-video/timeline.json
```

**Khi nào dùng:**
- Muốn AI viết script thay vì bạn
- Video ngắn (<3 phút)

### Khi AI generate xong

**Kiểm tra output:**

```bash
# Xem timeline structure
cat projects/my-video/timeline.json | jq '.scenes | length'  # Số scenes

# Xem duration
cat projects/my-video/timeline.json | jq '.durationInFrames'  # Tổng frames

# Xem audio duration
cat public/audio/my-video/durations.json | jq '.totalSec'  # Tổng giây
```

**Nếu timeline có lỗi:**
- Mở `projects/my-video/timeline.json`
- Fix theo CLAUDE.md rules (QUY TẮC 1-12)
- **HOẶC:** update `systemPrompt.ts` để AI gen đúng lần tới

**Nếu audio không match video:**
- Check: narration trong mỗi scene có đầy đủ không?
- Rerun TTS: `py -3.11 scripts/tts_kokoro.py --scenes ... --outdir ...`

---

### BƯỚC 3: Preview timeline (tùy chọn)

```bash
# Mở Remotion Studio
npm start

# Trên browser → http://localhost:3000
# → Chọn composition → Adjust timeline if needed
# → Export single frame nếu cần check visual
```

**Nếu thấy vấn đề:**
1. Edit `timeline.json` trực tiếp (hoặc dùng `/edit-timeline` skill nếu dùng Claude Code)
2. Refresh browser → preview cập nhật
3. Lặp lại cho đến khi OK

---

### BƯỚC 4: Render thành MP4

```bash
# Render với timeline hiện tại
npx ts-node scripts/render.ts \
  --timeline projects/my-video/timeline.json \
  --out output/my-video.mp4

# Hoặc render cùng lúc từ timeline.json (default)
npx ts-node scripts/render.ts
```

**Render settings:**
- Resolution: 1920×1080 (30fps)
- Duration: `durationInFrames / 30` = seconds
- Audio: tự động từ `timeline.audio`

**Tiến trình:**
- Remotion sẽ render từng frame → ffmpeg encode → MP4
- Thời gian: tùy độ dài video (vài phút cho 1 phút video)

**Output:**
- ✅ `output/my-video.mp4` — video hoàn chỉnh

---

### BƯỚC 5: Check video + publish

```bash
# Xem video trong Windows Explorer hoặc media player
explorer output\my-video.mp4

# Hoặc:
& "C:\Program Files\VideoLAN\VLC\vlc.exe" output\my-video.mp4
```

**Checklist:**

- [ ] Âm thanh match hình ảnh?
- [ ] Text rõ và không bị cắt?
- [ ] Animation smooth?
- [ ] Background / color hợp lý?
- [ ] Duration phù hợp (không quá nhanh/chậm)?

**Nếu có vấn đề:**

| Vấn đề | Fix |
|--------|-----|
| Âm thanh không match | Regenerate timeline với TTS đúng |
| Icon/text quá nhỏ | Update QUY TẮC 12 trong systemPrompt.ts |
| Background sai/không hiện | Check `backgroundSrc` trong timeline |
| Animation quá nhanh | Tăng `durationFrames` scene hoặc `animationDuration` event |

**Nếu OK:**
- Upload lên YouTube / platform
- Đặt title, description, thumbnail

---

## Quick Reference: Commands (Session-based)

### 🔴 SESSION 1: Timeline + Audio Generation

**Mục tiêu:** Tạo timeline từ transcript + TTS audio, verify cơ bản.

```bash
cd c:\Users\Administrator\Documents\video

# Edge TTS (nhanh, tiếng Việt)
npx ts-node scripts/generate-timeline.ts \
  --transcript projects/my-video/transcript.txt \
  --tts --tts-voice vi-VN-HoaiMyNeural \
  --out projects/my-video/timeline.json

# Hoặc Kokoro TTS (cao chất, tiếng Anh)
npx ts-node scripts/generate-timeline.ts \
  --transcript projects/my-video/transcript.txt \
  --tts-kokoro --tts-voice af_heart --tts-lang a \
  --out projects/my-video/timeline.json

# Verify output
cat projects/my-video/timeline.json | jq '.scenes | length'  # Số scenes
cat projects/my-video/timeline.json | jq '.durationInFrames'  # Frames
cat public/audio/my-video/durations.json | jq '.totalSec'  # Duration giây
```

**Lưu:** `projects/my-video/timeline.json` + `public/audio/my-video/voice.wav`

---

### 🟡 SESSION 2: Fix & Verify Timeline (sau 5-10 min)

**Mục tiêu:** Load timeline từ session 1, fix lỗi, verify structure, save changes.

```bash
# Load + inspect timeline
cat projects/my-video/timeline.json | jq '.events | length'  # Events count

# Validate timeline
npx ts-node scripts/validate-timeline.ts projects/my-video/timeline.json

# Nếu cần fix: edit file trực tiếp hoặc dùng /edit-timeline skill
# ... edit và save ...

# Verify cuối cùng
npx ts-node scripts/validate-timeline.ts projects/my-video/timeline.json
```

**Lưu:** Changes vào `projects/my-video/timeline.json`

---

### 🟢 SESSION 3: Render Final (sau 5-10 min thêm)

**Mục tiêu:** Render MP4 từ timeline đã verify.

```bash
# Render
npx ts-node scripts/render.ts \
  --timeline projects/my-video/timeline.json \
  --out output/my-video.mp4

# Hoặc dùng default timeline.json
npx ts-node scripts/render.ts
```

**Output:** `output/my-video.mp4` ✅

---

## Alternative: Single-Session (Model Mạnh)

Nếu dùng **Claude Sonnet API** hoặc **Claude Studio** (không rate limit), chạy hết trong 1 session:

```bash
# Tất cả trong 1 lần
npx ts-node scripts/generate-timeline.ts --transcript ... --tts-kokoro ...
npx ts-node scripts/validate-timeline.ts projects/my-video/timeline.json
npx ts-node scripts/render.ts --timeline projects/my-video/timeline.json ...
```

**Lợi ích:** Nhanh, không chờ, có context toàn bộ để fix lỗi ngay.

### Run TTS riêng (nếu muốn regenerate audio)

```bash
# Edge TTS
python scripts/tts_edge.py --scenes <scenes.json> --outdir <dir> --voice en-US-AvaNeural

# Kokoro TTS
py -3.11 scripts/tts_kokoro.py --scenes <scenes.json> --outdir <dir> --voice af_heart --lang a
```

### Preview + Render

```bash
# Preview (hot reload)
npm start

# Render
npx ts-node scripts/render.ts --timeline timeline.json --out output/video.mp4
```

### Validate timeline

```bash
npx ts-node scripts/validate-timeline.ts timeline.json
```

---

## Các lỗi thường gặp & cách fix

### ❌ "AI returned invalid JSON"

**Nguyên nhân:** Timeline JSON AI generate bị lỗi cú pháp.

**Fix:**
1. Kiểm tra `ANTHROPIC_API_KEY` có đúng không
2. Rerun: `npx ts-node scripts/generate-timeline.ts ...`
3. Nếu lặp lại: update systemPrompt.ts để AI generate dễ hiểu hơn

### ❌ "audio file not found"

**Nguyên nhân:** Path audio trong timeline không đúng, hoặc TTS chưa chạy.

**Fix:**
1. Run TTS explicitly: `py -3.11 scripts/tts_kokoro.py --scenes ... --outdir ...`
2. Check path trong timeline.json: phải `audio/my-video/voice.wav` (relative to `public/`)
3. Kiểm tra file tồn tại: `ls public/audio/my-video/voice.wav`

### ❌ Render fail: "cannot find X.svg"

**Nguyên nhân:** Asset SVG trong timeline không tồn tại.

**Fix:**
1. List assets có sẵn: `npx ts-node scripts/list-assets.ts`
2. Kiểm tra `src` trong timeline: phải `characters/cat` không phải `characters/cat.svg`
3. Thêm asset mới nếu cần: copy SVG vào `public/assets/<category>/`

### ❌ "ModuleNotFoundError: kokoro"

**Nguyên nhân:** Kokoro chưa cài cho Python 3.11.

**Fix:**
```bash
py -3.11 -m pip install kokoro torch soundfile
```

### ❌ Video quá tối / quá sáng

**Nguyên nhân:** `backgroundSrc` background lựa chọn không phù hợp.

**Fix:**
1. Edit timeline.json → change `backgroundSrc` to khác
2. Dùng lighter gradient: `linear-gradient(135deg, #FFF9F0 0%, #FDE8D0 100%)`
3. Hoặc darker: `linear-gradient(135deg, #2C1810 0%, #4A2C1A 100%)`

---

## Best Practices

### 1. Tổ chức project folder

```
projects/
├── my-video-001/
│   ├── transcript.txt          ← Narration
│   └── timeline.json           ← Output từ generate
├── my-video-002/
│   ├── transcript.txt
│   └── timeline.json
└── ...
```

### 2. Lưu lại mọi version

```bash
# Mỗi lần regenerate, backup cũ
cp timeline.json timeline.backup-v1.json
```

### 3. Viết narration rõ ràng

- 1 câu = 1 scene (tương đương 5-15 giây video)
- Không quá ngắn (<30 từ) hoặc quá dài (>100 từ)
- Viết như người nói chứ không viết như text học

### 4. Để trống `scale` cho entity

```json
// ✅ ĐÚNG: Để AI + SceneCompiler auto scale
{
  "assetId": "cat",
  "src": "characters/cat"
  // no scale
}

// ❌ SAI: Nhân vật quá nhỏ
{
  "assetId": "cat",
  "scale": 0.5
}
```

### 5. Set `clearPrevious: true` mỗi scene mới

```json
// ✅ Nếu scene đổi background hoặc layout
{
  "id": "s2",
  "clearPrevious": true,
  ...
}
```

---

## Công cụ hỗ trợ

### Dùng CLI (bất kỳ model nào)

```bash
# Generate timeline + TTS
npx ts-node scripts/generate-timeline.ts --transcript <file> --tts-kokoro --out ...

# Validate timeline
npx ts-node scripts/validate-timeline.ts <timeline.json>

# Render MP4
npx ts-node scripts/render.ts --timeline <timeline.json> --out output/video.mp4

# Preview (Remotion Studio)
npm start  # → http://localhost:3000
```

### Dùng Claude Code Skills (Session 1 & 2)

Nếu dùng **Claude Code** (Claude.ai + Code):

```
💡 SESSION 1:
/generate @projects/my-video/transcript.txt  # Tạo timeline + TTS

🔧 SESSION 2:
/edit-timeline @projects/my-video/timeline.json  # Fix lỗi
/validate @projects/my-video/timeline.json       # Verify
/list-assets                                      # Xem available SVGs

✅ SESSION 3 (hoặc tay):
/render --timeline @projects/my-video/timeline.json  # Render MP4
```

**Lợi ích:** Skills tự handle TTS + audio sync, không cần chạy Python riêng.

---

## Lần tới làm gì?

1. **Lên lớp thêm patterns:** Thêm scene layouts mới (PATTERN K, L, ...)
2. **Phát triển assets:** Thêm SVG characters, props, backgrounds
3. **Test script:** Render nhiều video liên tiếp để kiểm tra consistency
4. **Tối ưu quality:** Tune animationDuration, easing, color
5. **Automation:** Build CI/CD pipeline → auto render từ transcript

---

**Cần giúp?** Xem CLAUDE.md để hiểu rules & patterns chi tiết.
