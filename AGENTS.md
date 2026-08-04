# AGENTS.md — Cat Explainer Video System

> **Nguồn sự thật đầy đủ là [CLAUDE.md](CLAUDE.md). ĐỌC FILE ĐÓ TRƯỚC khi làm bất cứ việc gì trong repo này.**
> File này chỉ là điểm vào cho agent không tự nạp `CLAUDE.md` (Codex, v.v.), kèm
> các luật tuyệt đối không được vi phạm. Khi hai file mâu thuẫn → `CLAUDE.md` thắng.

Hệ thống tạo video giải thích tài chính 2D phong cách "Mèo giải thích":
`Transcript → storyboard → timeline.json → Remotion → MP4`.

---

## 7 luật KHÔNG ĐƯỢC VI PHẠM

1. **KHÔNG dùng helper modulo/keyword để thay storyboard.** Không sinh scene bằng
   `index % N`, bảng regex từ khoá, hay vòng lặp gán layout máy móc. Mỗi scene phải
   là một quyết định đạo diễn có chủ đích dựa trên nội dung câu narration đó.
   *(Repo từng có `scripts/session-v3.ts`/`session-v4.ts` vi phạm điều này — đã xoá.)*

2. **KHÔNG bypass production gate.** Schema, director quality, measured timing
   provenance, artifact hash và render audit phải pass. Các flag `--skip-*`,
   `--diagnostic*`, `--allow-unprovenanced-timing` **chỉ** dùng để chẩn đoán;
   artifact tạo theo đường này không được xuất bản. Gate fail → sửa
   storyboard/asset/timing source rồi chạy lại, không hạ ngưỡng.

3. **Sửa đúng tầng.** Nguồn authored là `storyboard.json` (hoặc
   `projects/<id>/storyboard-data.ts` ở route A). `timeline.json` là **sản phẩm
   compile** — sửa tay sẽ bị ghi đè. `events[]` **không bao giờ** được lưu ra đĩa.

4. **TTS + word alignment chạy TRƯỚC `compile-storyboard.ts`** — compiler cần
   `durations.json` + `words.json` để chốt khung hình theo audio thật.

5. **Asset: chỉ dùng art production, không thêm vào `public/assets/`.** Storyboard
   vẫn viết logical ref (`characters/cat_explain`, `finance/money`); resolver
   [assetPaths.ts](src/engine/assetPaths.ts) tra alias-map trong manifest để ra
   file thật. Thiếu asset → thêm vào `generated-assets/` theo quy ước tên rồi
   `npm run build-assets` (xem [/add-asset](.claude/commands/add-asset.md)) —
   **không** hardcode path trong prompt/code.

6. **Luật thẩm mỹ hiện hành = mục "V4 — DIRECTOR'S RULES" trong [CLAUDE.md](CLAUDE.md).**
   Tóm tắt: nền trắng là mặc định (ảnh thật chỉ dùng như "cú đấm" có chủ đích, không
   làm wallpaper); một khung hình = một lớp text; pose mèo đổi theo **từng câu**, không
   phải từng scene; SOLO ≤ 40% số scene; 3 giây đầu phải thấy rõ nhân vật/tiêu đề.

7. **CHỈ ROUTE A. ROUTE B/API ĐÃ KHÓA.** Không chạy `npm run generate`,
   `scripts/generate-timeline.ts`, hay `new-project.ts --auto`. Mọi project phải
   được agent đọc transcript và viết tay `storyboard-data.ts` theo từng câu/beat,
   sau đó mới chạy `build-storyboard.ts`. Không được chạy TTS chỉ vì source
   coverage pass.

---

## Một route authoring duy nhất

**Route A — session-authored (KHÔNG cần API key).** Agent tự đọc transcript trong
phiên chat và viết tay nội dung scene:

```bash
# 1. Viết projects/<id>/storyboard-data.ts  (export SCENES, CAST) — việc authoring
npx ts-node scripts/build-storyboard.ts --project <id>          # → storyboard.json
npx ts-node scripts/storyboard-to-tts.ts --storyboard projects/<id>/storyboard.json
# Router chọn backend theo TTS_BACKEND_<LANG> trong .env, sinh/verify từng scene.
# Vietnamese mặc định Edge; EN/JA/KO mặc định Qwen3 qua local HTTP model server.
py -3.11 scripts/tts_router.py --project <id>
npx ts-node scripts/compile-storyboard.ts --storyboard projects/<id>/storyboard.json \
    --out projects/<id>/timeline.json --durations projects/<id>/durations.json \
    --words projects/<id>/words.json --audio audio/<id>/voice.wav
npx ts-node scripts/render.ts --project <id>                    # → output/<id>/video.mp4
```

**Route B — API: ĐÃ KHÓA.** `generate-timeline.ts` được giữ trong repo làm mã
tham khảo nhưng fail-closed trước khi đọc API key hoặc ghi artifact.

Route A tạo `storyboard.json`, rồi đi tiếp qua phần đuôi compile/render.

---

## Quy ước thư mục

| Đường dẫn | Nội dung |
|---|---|
| `projects/<id>/` | Nguồn: `transcript.txt`, `storyboard-data.ts`, `storyboard.json`, `timeline.json`, `tts_scenes.json`, `durations.json`, `words.json` |
| `output/<id>/` | Sản phẩm render: `video.mp4`, `video.contact.jpg`, `video.*-audit.json`, `video.production-report.json`; `.runs/` giữ rollback/diagnostic |
| `public/generated-assets/` | Art production: `characters/`, `icons/`, `scenes/` (PNG) |
| `public/generated-backgrounds/` | Nền chất lượng cao, **đè** `generated-assets/scenes/` khi trùng tên |
| `public/backgrounds/` | Ảnh thật JPG cho BEAT/photo |
| `public/assets/` | ⛔ Bộ SVG vẽ tay **đã ngừng dùng** — giữ để tương thích, không thêm mới |
| `config/reference-quality.json` | Ngưỡng của mọi audit (encoding, audio LUFS, visual density) |

`--project <id>` được hỗ trợ ở `render.ts`, `preview-project.ts`,
`build-storyboard.ts`. `render.ts` không có `--out` sẽ mặc định
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
