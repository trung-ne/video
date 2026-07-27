# AGENTS.md — Cat Explainer Video System

> **Nguồn sự thật đầy đủ là [CLAUDE.md](CLAUDE.md). ĐỌC FILE ĐÓ TRƯỚC khi làm bất cứ việc gì trong repo này.**
> File này chỉ là điểm vào cho agent không tự nạp `CLAUDE.md` (Codex, v.v.), kèm
> các luật tuyệt đối không được vi phạm. Khi hai file mâu thuẫn → `CLAUDE.md` thắng.

Hệ thống tạo video giải thích tài chính 2D phong cách "Mèo giải thích":
`Transcript → storyboard → timeline.json → Remotion → MP4`.

---

## 5 luật KHÔNG ĐƯỢC VI PHẠM

1. **KHÔNG dùng helper modulo/keyword để thay storyboard.** Không sinh scene bằng
   `index % N`, bảng regex từ khoá, hay vòng lặp gán layout máy móc. Mỗi scene phải
   là một quyết định đạo diễn có chủ đích dựa trên nội dung câu narration đó.
   *(Repo từng có `scripts/session-v3.ts`/`session-v4.ts` vi phạm điều này — đã xoá.)*

2. **KHÔNG bypass production gate.** `validateTimeline` (schema) và `qualityCheck`
   (thẻ điểm đạo diễn V4/V5) phải pass trước khi render. Các flag `--skip-validate`,
   `--skip-quality`, `--skip-visual-audit` **chỉ** dùng để chẩn đoán, không dùng để
   xuất bản. Gate fail → sửa storyboard/asset rồi chạy lại, không hạ ngưỡng.

3. **Sửa đúng tầng.** Nguồn authored là `storyboard.json` (hoặc
   `projects/<id>/storyboard-data.ts` ở route A). `timeline.json` là **sản phẩm
   compile** — sửa tay sẽ bị ghi đè. `events[]` **không bao giờ** được lưu ra đĩa.

4. **TTS + word alignment chạy TRƯỚC `compile-storyboard.ts`** — compiler cần
   `durations.json` + `words.json` để chốt khung hình theo audio thật.

5. **Luật thẩm mỹ hiện hành = mục "V4 — DIRECTOR'S RULES" trong [CLAUDE.md](CLAUDE.md).**
   Tóm tắt: nền trắng là mặc định (ảnh thật chỉ dùng như "cú đấm" có chủ đích, không
   làm wallpaper); một khung hình = một lớp text; pose mèo đổi theo **từng câu**, không
   phải từng scene; SOLO ≤ 40% số scene; 3 giây đầu phải thấy rõ nhân vật/tiêu đề.

---

## Hai route authoring

**Route A — session-authored (KHÔNG cần API key).** Agent tự đọc transcript trong
phiên chat và viết tay nội dung scene:

```bash
# 1. Viết projects/<id>/storyboard-data.ts  (export SCENES, CAST) — việc authoring
npx ts-node scripts/build-storyboard.ts --project <id>          # → storyboard.json
npx ts-node scripts/storyboard-to-tts.ts --storyboard projects/<id>/storyboard.json
py -3.11 scripts/tts_kokoro.py --scenes projects/<id>/tts_scenes.json --outdir public/audio/<id>
py -3.11 scripts/align_words.py --wav public/audio/<id>/voice.wav --outdir projects/<id> \
    --model small --lang en --transcript projects/<id>/transcript.txt
npx ts-node scripts/compile-storyboard.ts --storyboard projects/<id>/storyboard.json \
    --out projects/<id>/timeline.json --durations projects/<id>/durations.json \
    --words projects/<id>/words.json --audio audio/<id>/voice.wav
npx ts-node scripts/render.ts --project <id>                    # → output/<id>/video.mp4
```

**Route B — API.** `generate-timeline.ts` tự chạy story map → section plan →
visualCritic → repair loop qua API (cần `ANTHROPIC_API_KEY`, có fallback Gemini/Grok/
DeepSeek). Dùng cho chạy hàng loạt / không giám sát.

```bash
npm run generate -- --project <id> --tts-kokoro
```

Cả hai route đều hội tụ về `storyboard.json` rồi đi chung phần đuôi compile/render.

---

## Quy ước thư mục

| Đường dẫn | Nội dung |
|---|---|
| `projects/<id>/` | Nguồn: `transcript.txt`, `storyboard-data.ts`, `storyboard.json`, `timeline.json`, `tts_scenes.json`, `durations.json`, `words.json` |
| `output/<id>/` | Sản phẩm render: `video.mp4`, `contact.jpg`, `*-audit.json`, `production-report.json` |
| `public/assets/` | SVG assets (`characters/`, `finance/`, `props/`, `scenes/`, `people/`, `ui/`) |
| `config/reference-quality.json` | Ngưỡng của mọi audit (encoding, audio LUFS, visual density) |

`--project <id>` được hỗ trợ ở `generate-timeline.ts`, `render.ts`,
`preview-project.ts`, `build-storyboard.ts`. `render.ts` không có `--out` sẽ mặc định
ghi ra `output/<id>/video.mp4`.

---

## Lệnh kiểm tra

```bash
npm run validate -- projects/<id>/timeline.json   # schema gate
npm run quality  -- projects/<id>/timeline.json   # thẻ điểm đạo diễn V4/V5 (0-100, A-F)
npx tsc --noEmit                                  # type check
```

Chi tiết đầy đủ (12 loại event, layout presets, bảng pose mèo, liveliness engine,
troubleshooting) — xem [CLAUDE.md](CLAUDE.md).
