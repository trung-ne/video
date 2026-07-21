# TODO — Storyboard V5 & nâng chất lượng render (bám refer/meo.mp4)

Cập nhật: 2026-07-20. Mục tiêu: mọi video render tiệm cận `refer/meo.mp4` bất kể transcript.

---

## ✅ ĐÃ XONG (verified bằng render/test)

### Fixes renderer/compiler (P0)
- [x] Phụ đề luôn trắng (fix 3 tầng; gốc: `timelineEngine` default `#1a1a1a`) — [AnimatedText.tsx](../src/components/AnimatedText.tsx), [timelineEngine.ts](../src/engine/timelineEngine.ts), [sceneCompiler.ts](../src/engine/sceneCompiler.ts)
- [x] Clamp mèo tí hon (scale<1.4 trên `characters/*` → auto-scale) — sceneCompiler
- [x] BODY ở top band → tự thành CALLOUT pill — sceneCompiler
- [x] PaperCard vô hình trên nền trắng (clip-path nuốt box-shadow → `filter: drop-shadow`) — [PaperCard.tsx](../src/components/PaperCard.tsx)
- [x] Render có cổng schema fail-fast (`validateTimeline`, bỏ qua bằng `--skip-validate`) — [render.ts](../scripts/render.ts)

### Nội dung khung hình (P1-P3)
- [x] `speechBubbles` nối vào `scenes[]` (type + compiler `compileSpeechBubble` + validate) — [scene.ts](../src/types/scene.ts), sceneCompiler, [validateTimeline.ts](../src/ai/validateTimeline.ts)
- [x] 6 quality gate mới: ENDING_DARK, TEXT_TRUNCATED, SCALE_ABUSE, KEYWORD_MISSING, BUBBLE_MISSING, EVIDENCE_MISSING — [qualityCheck.ts](../src/ai/qualityCheck.ts)
- [x] systemPrompt V5: "5 thanh ghi", casting badge, speech-bubble-first, cấm scale/…/BODY-top — [systemPrompt.ts](../src/ai/systemPrompt.ts)
- [x] 3 stage SVG + anchor + layout TABLEAU — [public/assets/scenes/](../public/assets/scenes/), [stageAnchors.ts](../src/engine/stageAnchors.ts)

### Tầng Storyboard (authoring → compile)
- [x] Schema [storyboard.ts](../src/types/storyboard.ts) (SceneBrief/Beat/VisualGrammar)
- [x] 8 grammar thuần [visualGrammars.ts](../src/engine/visualGrammars.ts) (COMPARE/STAT_REVEAL/POLICY_LIST/DIALOGUE_QA/TABLEAU/EVIDENCE/BEAT/SOLO + FREEFORM passthrough)
- [x] [storyboardCompiler.ts](../src/engine/storyboardCompiler.ts) + CLI [compile-storyboard.ts](../scripts/compile-storyboard.ts)
- [x] Pass authoring [storyboardPrompt.ts](../src/ai/storyboardPrompt.ts)
- [x] Nối `generate-timeline --storyboard` (gen storyboard → compile → TTS → re-compile timing khoá cứng + word-align) — [generate-timeline.ts](../scripts/generate-timeline.ts)
- [x] Skills cập nhật khuyến nghị `--storyboard` — [/generate](../.claude/commands/generate.md), [/new-video](../.claude/commands/new-video.md)
- [x] Verified: 5 grammar render đúng; beat "zero point seven" nhấn `shake` đúng frame khi có words.json

---

## ⏳ CÒN LẠI

### 0. Commit toàn bộ đợt refactor (ƯU TIÊN — chống mất như vụ sceneCompiler bị xóa lạc)
- [ ] Chia commit theo chủ đề: (a) loadTimeline unify + doc, (b) P0 renderer fixes, (c) V5 prompt/gates/stages, (d) tầng storyboard. Chưa có commit nào cho toàn bộ công việc nhiều phiên.

### 1. Beat-timing chính xác bằng whisper (#5)
- [ ] Cài whisper (máy hiện KHÔNG có whisper/whisperx/faster-whisper). Khuyến nghị `faster-whisper` (nhẹ, có word timestamp) hoặc `whisperx` (align tốt nhất).
- [ ] Viết `scripts/align_words.py`: input `projects/<id>/voice.wav` → output `projects/<id>/words.json` = `[{word,startSec,endSec}]` (timestamp tuyệt đối trên voice.wav).
- [ ] Nối vào generate-timeline sau TTS, trước re-compile (đường TS đã sẵn — `readWords()` + `compileStoryboard({words})` đã proven; chỉ cần file xuất hiện).
- Ghi chú: KHÔNG bắt buộc — thiếu whisper thì beat vẫn chạy xấp xỉ theo tỉ lệ ký tự.

### 2. Quality gates cho tầng storyboard
- [ ] `INTENT_REALIZED`: mỗi brief có visualGrammar hợp lệ + slot đủ cho grammar đó.
- [ ] `BEAT_UNANCHORED`: beat importance≥0.8 phải có emphasize tại frame (cảnh báo nếu miss).

### 3. Golden loop — nghiệm thu bám refer (cần API key + TTS)
- [ ] Regen video-003 bằng `generate-timeline --storyboard --tts-kokoro ...`.
- [ ] Trích dense contact sheet: `ffmpeg -i out.mp4 -vf "fps=1/42,scale=320:-1,tile=6x6" sheet.png` — đặt CẠNH sheet của `refer/meo.mp4`.
- [ ] Soát theo checklist 10 gap đạo diễn (tableau, casting, bubble, evidence, TV-frame, keyword, diagram, real-anchor, đa phong cách, kết sáng).
- [ ] Lặp prompt/gate tới khi `quality-check` grade ≥ B và 0 BEAT_UNANCHORED.

### 4. Mở rộng bộ stage (nâng dần độ giống refer)
- [ ] Thêm SVG stage + anchor: office_desk, bar_counter, park_bench, classroom, street, cafe (thêm vào [stageAnchors.ts](../src/engine/stageAnchors.ts)).

### 5. (Tùy chọn — nợ kỹ thuật)
- [ ] Gộp/bỏ generator trùng: đã xóa `generate-via-cli.ts`; rà thêm nếu còn.
- [ ] Rút gọn CODEX.md/COPILOT.md/WORKFLOW.md/SETUP.md thành pointer về CLAUDE.md.
- [ ] `autoFixBackgrounds` chỉ chạy authoring-time — cân nhắc chạy cả load-time nếu muốn file sửa tay tự lành nền.

---

## Cách chạy nhanh (tham chiếu)
```bash
# Storyboard pipeline (khuyến nghị)
npx ts-node scripts/generate-timeline.ts --transcript projects/<id>/transcript.txt --storyboard --tts-kokoro --tts-voice af_heart --tts-lang a --out projects/<id>/timeline.json

# Biên dịch lại sau khi sửa tay storyboard.json
npx ts-node scripts/compile-storyboard.ts --storyboard projects/<id>/storyboard.json --durations projects/<id>/durations.json --words projects/<id>/words.json --out projects/<id>/timeline.json

# Render + quality check
npx ts-node scripts/render.ts --timeline projects/<id>/timeline.json --out output/<id>.mp4
npx ts-node scripts/quality-check.ts --timeline projects/<id>/timeline.json
```
