# AGENTS.md — Cat Explainer Video System

> **Nguồn sự thật đầy đủ là [CLAUDE.md](CLAUDE.md). ĐỌC FILE ĐÓ TRƯỚC khi làm bất cứ việc gì trong repo này.**
> File này chỉ là điểm vào cho agent không tự nạp `CLAUDE.md` (Codex, v.v.), kèm
> các luật tuyệt đối không được vi phạm. Khi hai file mâu thuẫn → `CLAUDE.md` thắng.

Hệ thống tạo video giải thích tài chính 2D phong cách "Mèo giải thích":
`Transcript → storyboard → timeline.json → Remotion → MP4`.

---

## 9 luật KHÔNG ĐƯỢC VI PHẠM

1. **KHÔNG dùng helper modulo/keyword để thay storyboard.** Không sinh scene bằng
   `index % N`, bảng regex từ khoá, hay vòng lặp gán layout máy móc. Mỗi scene phải
   là một quyết định đạo diễn có chủ đích dựa trên nội dung câu narration đó.
   *(Repo từng có `scripts/session-v3.ts`/`session-v4.ts` vi phạm điều này — đã xoá.)*

2. **KHÔNG bypass production gate.** Schema, director quality, measured timing
   provenance, artifact hash và render audit phải pass. Các flag `--skip-*`,
   `--diagnostic*`, `--allow-unprovenanced-timing` **chỉ** dùng để chẩn đoán;
   artifact tạo theo đường này không được xuất bản. Gate fail → sửa
   storyboard/asset/timing source rồi chạy lại, không hạ ngưỡng.
   **Bốn lỗi pixel `LOW_VISUAL_DENSITY`, `WITHIN_SCENE_SIMILARITY`,
   `STATIC_SCENE_RUN`, `FLAT_REGISTER` là blocker production tuyệt đối:**
   không được coi là “còn lại”, không được handoff/report rồi dừng. Agent phải
   sửa scene-local beats, pose/prop/card hoặc asset tại source, render full lại
   và chỉ tiếp tục khi audit artifact mới không còn các lỗi này.
   Gate chỉ là hậu kiểm: nguyên nhân phải được sửa ở generation contract. Builder
   bắt buộc một semantic state/28 từ; beat phải phrase-aligned và renderable.
   Component/compiler bị cấm tự tạo chuyển động/đổi màu/reveal theo chu kỳ; mật độ
   bố cục phải suy ra từ geometry thật, không từ `focalOccupancyTarget` tự khai.

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

8. **Mật độ storyboard là hard gate, không chỉ là cảnh báo.** Trước build/TTS,
   tính `minimumScenes = ceil(số từ transcript / 40)`. Nếu `SCENES.length` thấp
   hơn số này thì dừng, tách lại theo từng câu/beat; cấm render chỉ vì coverage
   đã đủ. Xem quy tắc đầy đủ ở mục *Scene density — hard authoring gate* trong
   `CLAUDE.md`.

   Không được dùng `%`, `index`, hay `BEATS.map(...helper...)` để tự điền pose,
   prop, grammar hoặc slot. Mỗi scene phải là object authored riêng; builder sẽ
   reject authoring cơ học trước khi build.

9. **`/new-video` phải chạy đến render production.** Không được tự kết thúc ở
   storyboard, TTS, alignment hay timeline. Chỉ được báo hoàn thành khi MP4 mới
   trong `output/<id>/video.mp4` cùng report/audit production đã pass; fail thì
   tự sửa source/asset và chạy lại, không bỏ gate. Xem hợp đồng đầy đủ trong
   `.claude/commands/new-video.md`. Render audit fail không phải một trạng thái
   để báo cáo cho user: đó là tín hiệu bắt buộc quay lại source và lặp pipeline.

---

## Một route authoring duy nhất

**Route A — session-authored (KHÔNG cần API key).** Agent tự đọc transcript trong
phiên chat và viết tay nội dung scene:

```bash
# 1. Viết projects/<id>/storyboard-data.ts  (export SCENES, CAST) — việc authoring
npx ts-node scripts/build-storyboard.ts --project <id>          # → storyboard.json
npx ts-node scripts/storyboard-to-tts.ts --storyboard projects/<id>/storyboard.json
 # Vietnamese projects must use Edge's Vietnamese voice; Kokoro is English-only
 # in this repo. Use Kokoro only for a language it explicitly supports.
py -3.11 scripts/tts_edge.py --scenes projects/<id>/tts_scenes.json --outdir public/audio/<id> \
    --manifest projects/<id>/durations.json --voice vi-VN-NamMinhNeural
py -3.11 scripts/align_words.py --wav public/audio/<id>/voice.wav --outdir projects/<id> \
    --model small --lang vi --scenes projects/<id>/tts_scenes.json
npx ts-node scripts/compile-storyboard.ts --storyboard projects/<id>/storyboard.json \
    --out projects/<id>/timeline.json --durations projects/<id>/durations.json \
    --words projects/<id>/words.json --alignment projects/<id>/alignment.json \
    --audio audio/<id>/voice.wav
npx ts-node scripts/render.ts --project <id>                    # → output/<id>/video.mp4
```

**Route B — API: ĐÃ KHÓA.** `generate-timeline.ts` chỉ còn là tombstone không import,
luôn thoát mã 2 trước khi tải provider, đọc API key hoặc ghi artifact. Các provider
SDK và prompt generation cũ không còn là dependency/production source.

Với video dài có `SECTIONS`, build toàn bộ storyboard trước rồi chạy
`plan-chunks.ts` → `process-storyboard-chunks.ts --execute` →
`assemble-storyboard-chunks.ts --execute`. Mỗi semantic chunk phải pass tuần tự
5 checkpoint và proof halo trước khi chunk sau chạy; final canonical render vẫn
phải pass toàn bộ global gate.

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
