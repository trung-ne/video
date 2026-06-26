# /generate — Generate Timeline + Audio (đồng bộ) từ Transcript/Idea

Tạo `timeline.json` + audio TTS **cùng lúc**, duration LOCK theo audio thực tế.
Có 2 mode. Mặc định dùng **Mode A (in-session)** trừ khi user nói "chạy script".

## Cách dùng
```
/generate <transcript.txt | idea | url> [--voice <name>] [--tts kokoro|edge] [--lang a]
```

Examples:
```
/generate @projects/video-x/transcript.txt
/generate @projects/video-x/transcript.txt --tts edge --voice vi-VN-HoaiMyNeural
/generate Tại sao Bitcoin tăng giá?
```

TTS mặc định: **Kokoro** `af_heart` (tiếng Anh, `--lang a`). Tiếng Việt → `--tts edge --voice vi-VN-HoaiMyNeural`.

---

## ⚠️ 4 NGUYÊN TẮC BẮT BUỘC (không được vi phạm)

1. **LUÔN gen audio** — không bao giờ tạo timeline mà không có audio. Thiếu audio = video câm + duration sai.
2. **FULL TRANSCRIPT** — narration phải phủ TOÀN BỘ transcript, không tóm tắt cụt. Mọi đoạn/section trong transcript đều phải có scene tương ứng.
3. **DURATION LOCK** — mỗi scene `startFrame`/`durationFrames` lấy CHÍNH XÁC từ `durations.json` (do TTS sinh ra). KHÔNG đoán.
4. **KHÔNG ĐÈ TEXT** — không 2 text cùng dải y cùng lúc (xem RULE 13b trong systemPrompt). Mỗi text có `exitFrame`.

---

## MODE A — In-session (KHÔNG cần API key, dùng quota chat này)

Đây là mode user thường dùng. Claude tự sinh timeline trong session, chỉ chạy Python cho TTS (miễn phí).

### Bước 1 — Đọc transcript đầy đủ
Đọc hết file transcript. Xác định ngôn ngữ (Anh/Việt) → chọn voice phù hợp.

### Bước 2 — Cắt scene phủ FULL transcript
Chia transcript thành các beat tự nhiên (theo "Scene N:" nếu có, hoặc theo ý/đoạn).
- Mỗi scene 1 beat = 1-4 câu transcript.
- `narration` của scene = ĐÚNG nội dung transcript đoạn đó, làm sạch cho TTS (bỏ timestamp "0:00", viết số ra chữ nếu cần, bỏ ký tự lạ). **KHÔNG cắt bớt ý** — đây là giọng đọc của video.
- Transcript dài (10-20 phút) → 15-40 scenes là bình thường. ĐỪNG nén còn 5-7 scene.

### Bước 3 — Ghi tts_scenes.json
Ghi `projects/<proj>/tts_scenes.json` = `[{"id":"scene01","text":"..."}, ...]`
(id đánh số liền: scene01, scene02… — nếu 1 beat dài tách scene06b, scene06c…)

### Bước 4 — Chạy TTS (BẮT BUỘC)
```bash
# Kokoro (tiếng Anh)
py -3.11 scripts/tts_kokoro.py --scenes "projects/<proj>/tts_scenes.json" --outdir "projects/<proj>" --voice af_heart --lang a

# Edge (tiếng Việt)
python scripts/tts_edge.py --scenes "projects/<proj>/tts_scenes.json" --outdir "projects/<proj>" --voice vi-VN-HoaiMyNeural
```
Sinh ra: `voice.wav` + `durations.json` (+ sceneNN.wav từng scene) trong project folder.

### Bước 5 — Copy audio sang public/ (để Remotion đọc)
```bash
mkdir -p "public/audio/<proj>" && cp "projects/<proj>/voice.wav" "public/audio/<proj>/voice.wav"
```

### Bước 6 — Đọc durations.json → viết SceneTimeline (scenes[], KHÔNG viết events tay)
Đọc `projects/<proj>/durations.json`. Với MỖI scene lấy `startFrame` + `frames`.

⚠️ **LUÔN viết format `scenes[]`** (SceneTimeline) — KHÔNG tự dựng `events[]`.
`sceneCompiler` (chạy lúc render) sẽ tự: đặt slot, auto blur+scrim cho ảnh nền, auto màu chữ trên nền tối, tính exitFrame, auto-scale nhân vật, clearPrevious. Viết events tay = mất hết các xử lý này (đè text, nền ảnh không blur).

Mỗi scene là 1 object:
```json
{
  "id": "scene01",
  "startFrame": <từ durations.json>,
  "durationFrames": <frames từ durations.json>,
  "layout": "SOLO | DIALOGUE | ICON_TRIPLE | STAT_DRAMA | ...",
  "backgroundSrc": "linear-gradient(...) | #FFFFFF | backgrounds/restaurant.jpg",
  "narration": "<đúng câu transcript của scene này>",
  "clearPrevious": true,
  "entities": [
    { "assetId": "cat1", "src": "characters/cat_explain", "slot": "CENTER_MID", "enterAnimation": "popIn", "enterDelay": 0 }
  ],
  "texts": [
    { "id": "t1", "content": "...", "style": "TITLE", "slot": "TOP_TITLE", "delay": 8, "duration": 120 }
  ]
}
```
Quy tắc nội dung (theo CLAUDE.md): layout variety, background variety (≥5 nền khác nhau, dùng `backgrounds/*.jpg` cho scene cảm xúc/bối cảnh), pose match emotion, **mỗi text có `duration`** để không đè, để trống `scale` cho compiler tự scale to.

### Bước 7 — Ghi timeline.json (format scenes[])
```json
{
  "fps": 30, "width": 1920, "height": 1080,
  "durationInFrames": <totalFrames từ durations.json>,
  "background": "#FAFAF8",
  "audio": "audio/<proj>/voice.wav",
  "scenes": [ /* các scene ở Bước 6 */ ]
}
```
render.ts tự compile `scenes[]` → `events[]` khi render. KHÔNG cần compile tay.

### Bước 8 — Self-check trước khi xong
- [ ] Format là `scenes[]` (KHÔNG phải `events[]`)
- [ ] `audio` field có giá trị, file tồn tại ở `public/audio/<proj>/voice.wav`
- [ ] `durationInFrames` == `durations.json.totalFrames`; mỗi scene `startFrame`/`durationFrames` khớp durations.json
- [ ] Số scene == số scene trong tts_scenes.json (phủ FULL transcript)
- [ ] Mỗi text có `duration`; không 2 text cùng dải y (RULE 13b)
- [ ] `backgroundSrc` đa dạng; scene cảm xúc/bối cảnh dùng `backgrounds/*.jpg` (kiểm tra file tồn tại trong public/backgrounds/)
- [ ] Mọi `src` asset tồn tại (chạy `/list-assets` nếu nghi ngờ)

---

## MODE B — Script (cần ANTHROPIC_API_KEY trong env)

Khi user yêu cầu "chạy script" hoặc muốn AI tự sinh qua pipeline:
```bash
# Kokoro
npx ts-node scripts/generate-timeline.ts --transcript "<file>" --tts-kokoro --tts-voice af_heart --tts-lang a --out "<proj>/timeline.json"
# Edge
npx ts-node scripts/generate-timeline.ts --transcript "<file>" --tts --tts-voice vi-VN-HoaiMyNeural --out "<proj>/timeline.json"
```
Script tự chạy TTS + patch duration + set audio. KHÔNG chạy thiếu cờ `--tts-kokoro`/`--tts`/`--audio`.

---

## Bước tiếp theo (cả 2 mode)
```
Render: /render --timeline projects/<proj>/timeline.json --out output/<proj>.mp4
```

## Chú ý
- Audio nằm CÙNG folder timeline (`projects/<proj>/voice.wav`) + bản copy ở `public/audio/<proj>/`.
- Kokoro chạy bằng `py -3.11`; Edge bằng `python` (3.14).
- Engine có safety-net tự xóa text đè nhau lúc render, nhưng vẫn phải set `duration` đúng — đừng phụ thuộc.
