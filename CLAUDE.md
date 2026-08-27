# Cat Explainer Video System — Project Rules

## Tổng quan

Hệ thống tạo video giải thích tài chính 2D phong cách "Mèo giải thích".
Pipeline: **Script/URL/Transcript → semantic storyboard → measured TTS/alignment → compiled timeline → Remotion → audited MP4**

> **PRODUCTION POLICY: ROUTE A ONLY.** Route B/API generation is locked.
> `scripts/generate-timeline.ts`, `npm run generate`, and `new-project.ts --auto`
> must not be used. Every storyboard is session-authored in
> `projects/<id>/storyboard-data.ts` before TTS/alignment/compile.

Mục tiêu: Tạo hàng trăm video, chỉ thay script/audio — không vẽ lại asset, không làm lại animation.

---

## ⭐ V4 — DIRECTOR'S RULES (so sánh trực tiếp output/test_copy.mp4 vs refer/meo.mp4 — ƯU TIÊN CAO NHẤT, override các rule cũ nếu mâu thuẫn)

Phân tích 16 frames video gen vs 241 frames video mẫu cho thấy 7 gap lớn. Các rule sau là BẮT BUỘC:

### V4.1 — NỀN TRẮNG LÀ MẶC ĐỊNH, ẢNH THẬT LÀ "CÚ ĐẤM" (đảo ngược RULE 1 cũ)
Video mẫu ~70% thời lượng là **nền trắng sạch + nhân vật to, biểu cảm mạnh**. Ảnh thật chỉ xuất hiện có chủ đích:
- **Evidence**: ảnh chụp bài báo/khảo sát xếp chồng (mở đầu, trích dẫn số liệu)
- **Emotional beat**: ảnh full-bleed KHÔNG có mèo đè lên (hoàng hôn cô đơn, tòa nhà Samsung, cô gái sang chảnh) — ảnh TỰ kể, mèo tránh ra
- Ảnh nền mờ đằng sau mèo suốt video = wallpaper vô nghĩa → CẤM. Nếu ảnh không liên quan trực tiếp câu narration đang đọc thì dùng nền trắng.
- STAT_REVEAL mặc định dùng nền trắng. Nền tối chỉ là treatment có chủ đích cho tối đa 3 climax thật sự trong một video, không phải mặc định cho mọi con số.
- Khi dùng ảnh full-bleed làm emotional beat: KHÔNG đặt nhân vật che chủ thể ảnh; hoặc để ảnh chạy solo 3-5s, hoặc mèo đứng nhỏ lệch góc (scale ≤1.2, x≤0.35, y≥0.7).

### V4.2 — MỘT KHUNG HÌNH = MỘT LỚP TEXT
Video gen bị: title pill + body text + phụ đề tự động chồng nhau, phụ đề 2 dòng đè lên body text. Rule:
- Khi phụ đề (subtitle) bật: KHÔNG đặt BODY/CAPTION ở y>0.75. Vùng y 0.82–1.0 là ĐẤT RIÊNG của phụ đề.
- Tối đa 1 text overlay + 1 phụ đề trên màn hình. Title pill chỉ sống 3-4s đầu scene rồi exit.

### V4.3 — CẢM XÚC POSE PHẢI MATCH TỪNG CÂU, KHÔNG PHẢI TỪNG SCENE
Video gen dùng cat_happy giơ tay cười cho cả nội dung tiêu cực. Video mẫu đổi biểu cảm theo TỪNG CÂU (mồ hôi lạnh khi lo, mắt híp khi mỉa mai, gãi đầu khi bối rối):
- Mỗi scene ≥ 2 swap pose; pose mặc định là `cat` neutral / `cat_explain`, KHÔNG phải cat_happy.
- cat_happy CHỈ khi narration thực sự tích cực (giải pháp, kết luận tốt, đùa vui).
- Câu hỏi tu từ → cat_shrug/cat_think; số liệu xấu → cat_sad/cat_surprised; mỉa mai → cat_explain.

### V4.4 — CHỐNG MỞ MÀN ĐEN
Frame 0-10s video gen gần như đen kịt (fadeBlack + scrim + ảnh tối). Rule: 3 giây đầu video PHẢI thấy rõ nhân vật/tiêu đề. Không dùng transition fadeBlack ở scene 1; scrim trên ảnh nền tối đa 35% opacity.

### V4.5 — PHÁ THẾ ĐỘC DIỄN SOLO
Video gen: 8/11 scene là SOLO mèo giữa màn hình → nhàm. Quota bắt buộc mỗi video:
- SOLO ≤ 40% số scene. Ít nhất: 1 DIALOGUE (2 mèo), 1 ICON_TRIPLE/QA_REVEAL, 1 STAT_DRAMA hoặc evidence-card, 1 full-bleed emotional beat.
- Hai scene SOLO liên tiếp → scene sau phải đổi pose + vị trí (x lệch 0.35/0.65) + background.

### V4.6 — PROP THAY LỜI, MÈO TƯƠNG TÁC PROP
Video mẫu: mèo đội mũ tốt nghiệp cầm bằng trước tòa Samsung, mèo nhìn cuộn giấy. Video gen: mèo tay không suốt 90% thời lượng.
- Mỗi scene kể-chuyện nên có ≥1 prop mèo NHÌN VÀO hoặc chỉ tay vào (mèo x=0.38 nhìn phải, prop x=0.65).
- Khi narration nhắc danh từ cụ thể (tiền, nhà, bằng cấp, cúp...) mà có SVG → prop phải xuất hiện trong ≤1s.

### V4.7 — PHỤ ĐỀ GỌN
Phụ đề video gen tràn 2-3 dòng, cắt giữa từ, nhảy vị trí. Rule: phụ đề ≤ 2 dòng, ≤ 42 ký tự/dòng, vị trí cố định y=0.9, không bao giờ đè lên text overlay khác (xem V4.2).
**Đã enforce trong code:** [sceneCompiler.ts](src/engine/sceneCompiler.ts) chunk phụ đề ≤76 ký tự + tự đẩy text overlay y>0.74 lên 0.72; [AnimatedText.tsx](src/components/AnimatedText.tsx) neo phụ đề theo cạnh đáy (baseline không nhảy); scrim clamp ≤0.35; scene 1 tự bỏ fadeBlack.

**Hai hệ kiểm tra (một sự thật, một chỗ):**
- [validateTimeline.ts](src/ai/validateTimeline.ts) = **cổng SCHEMA** (pass/fail cứng): trường bắt buộc, enum hợp lệ, path asset/background tồn tại, range vị trí. Chạy trong pipeline trước render.
- [qualityCheck.ts](src/ai/qualityCheck.ts) = **thẻ điểm ĐẠO DIỄN V4** (score 0-100, A-F): nền trắng-mặc-định, SOLO ≤40%, cat_happy ≤30% (POSE_MONOTONY), OPENING_DARK, ảnh-là-cú-đấm 2-4 lần, word-cap 12 từ, nhịp cắt... Toàn bộ luật thẩm mỹ nằm ở đây — không lặp sang validateTimeline.

### V4.8 — NGÔN NGỮ ĐIỆN ẢNH (vượt lên video mẫu)
1. **Cold open:** câu đầu video = con số shock nhất / câu hỏi đau nhất toàn script. Không chào hỏi. Script mở chậm → đảo climax lên làm teaser.
2. **3 hồi:** đặt vấn đề (0-25%) → đào sâu, mỗi scene lật góc nhìn mới (25-70%) → climax ở 60-75% → chốt insight + CTA.
3. **Montage tương phản:** 2 scene liền nhau đối cực năng lượng (tối→sáng, dồn dập→lặng). Không 2 STAT_DRAMA liền nhau.
4. **Rule of thirds:** frame có 2 phần tử → mèo x≈0.33/0.67. Chỉ deadcenter khi độc thoại với khán giả.
5. **Quy tắc 180°:** DIALOGUE — A trái nhìn phải, B phải nhìn trái, giữ nguyên bên qua mọi scene.
6. **Chekhov's gun:** prop/nhân vật ở hook mở đầu phải quay lại ở scene kết — khép vòng tròn.
7. **Khoảng thở:** sau reveal lớn giữ 1.5-2s không phần tử mới, chỉ pose phản ứng.
8. **Kuleshov:** mèo nhìn hướng X → prop popIn hướng X → mèo đổi pose. Diễn tả "nghĩ về/muốn/sợ" không cần text.
9. **Nhịp cắt theo cảm xúc:** giải thích = scene 12-18s; cao trào = scene 5-8s dồn dập. Nhịp đều = ru ngủ.

---

## Cấu trúc dự án

```
video/
├── src/
│   ├── index.ts                  # Remotion entry point (registerRoot)
│   ├── Root.tsx                  # Composition + preview default
│   ├── Video.tsx                 # Main render: camera + assets + audio
│   ├── types/timeline.ts         # Tất cả event types
│   ├── animations/index.ts       # getEnterAnimation / getExitAnimation / getEmphasizeAnimation
│   ├── engine/timelineEngine.ts  # computeFrameState(timeline, frame) → FrameState
│   ├── components/
│   │   ├── AnimatedAsset.tsx     # SVG render + enter/exit/emphasize animations
│   │   └── AnimatedText.tsx      # Text render + fade animation
│   └── ai/
│       ├── systemPrompt.ts       # buildSystemPrompt() + listAvailableAssets() + buildScriptFromIdea()
│       └── validateTimeline.ts   # validateTimeline() + printValidationResult()
├── scripts/
│   ├── generate-timeline.ts      # Route B legacy — locked/fail-closed
│   └── render.ts                 # timeline.json → MP4 via remotion render
├── public/
│   └── assets/                   # SVG assets (user tự thêm)
│       ├── characters/cat.svg
│       ├── finance/{bank,money,house,stock,interest_rate,inflation,chart_up}.svg
│       ├── people/{person,company}.svg
│       └── ui/{arrow_up,arrow_down}.svg
├── projects/                     # 📁 MỖI VIDEO = 1 FOLDER (xem bên dưới)
├── timeline.json                 # Legacy scratch fixture; production dùng projects/<id>/timeline.json
├── output/                       # render ra đây, 1 folder/video: output/<id>/video.mp4 + audits
└── CLAUDE.md                     # File này
```

### Quy ước `projects/` — mỗi video một folder

Mỗi video sống trong `projects/video-XXX-<slug>/` để dễ quản lý hàng trăm video. Tạo bằng [new-project.ts](scripts/new-project.ts):

```bash
npx ts-node scripts/new-project.ts --idea "Chủ đề"      # hoặc --transcript <file> | --url <youtube> | --name <slug>
```

Nội dung một folder (những file thực sự sinh ra qua pipeline):
```
projects/video-003-tai-sao-eng/
├── idea.txt            # ý tưởng gốc (khi tạo bằng --idea)
├── transcript.txt      # script/transcript
├── storyboard-data.ts  # [session-authored] SCENES viết tay — nguồn authored
├── storyboard.json     # Storyboard (briefs) — nguồn authored của route storyboard
├── timeline.json       # SceneTimeline (scenes[]) — COMPILE ra từ storyboard
├── tts_scenes.json     # narration tách theo scene cho TTS
├── sceneNN.wav         # audio từng scene (TTS) + voice.wav ghép
├── durations.json      # thời lượng thực mỗi scene (patch durationFrames)
├── words.json          # word-level alignment (align_words.py) để neo beat
└── metadata.json       # chỉ new-project.ts tạo lúc khởi tạo
```

Build storyboard + render nhận **cả** `--project <id>` lẫn path tường minh:
```bash
npx ts-node scripts/build-storyboard.ts --project <id>           # Route A duy nhất
npx ts-node scripts/render.ts --project <id>                     # hoặc --timeline projects/<id>/timeline.json
```

(render mặc định ghi ra `output/<id>/video.mp4`, id lấy từ `--project` hoặc tên folder cha của `--timeline`; chỉ định `--out` khi cần path khác.)

⚠️ `timeline.json` ở root chỉ là legacy scratch fixture, không phải production input.
Production luôn dùng `projects/<id>/timeline.json`; `metadata.json` chỉ được
`new-project.ts` ghi lúc tạo — generate/render không tự cập nhật status/version.

---

## Commands nhanh

```bash
# Preview trong Remotion Studio
npm start

# Build storyboard từ storyboard-data.ts viết tay (Route A duy nhất)
npx ts-node scripts/build-storyboard.ts --project <id>

# storyboard-data.ts của video >=8 scene phải export VISUAL_TREATMENT_PLAN

# Compile storyboard → timeline (cần durations.json + words.json trước)
npx ts-node scripts/compile-storyboard.ts --storyboard projects/<id>/storyboard.json \
  --out projects/<id>/timeline.json --durations projects/<id>/durations.json \
  --words projects/<id>/words.json --audio audio/<id>/voice.wav

# Render ra MP4 (→ output/<id>/video.mp4)
npx ts-node scripts/render.ts --project <id>

# TypeScript check
npx tsc --noEmit
```

Route A (`build-storyboard.ts` + TTS local + `compile-storyboard.ts` +
`render.ts`) chạy hoàn toàn offline và không dùng API key.

---

## Pipeline Route A → Video

Chỉ có **1 route authoring** được phép:

```
                      ROUTE A — session-authored (KHÔNG cần API key)
Transcript ─→ projects/<id>/storyboard-data.ts   ← agent đọc transcript, viết tay SCENES
                 ↓ scripts/build-storyboard.ts --project <id>   (thuần cơ học)
              storyboard.json
                      │
                      ├─ storyboard-to-tts.ts → tts_*.py → voice.wav + durations.json
                      └─ align_words.py → words.json
                      ↓ scripts/compile-storyboard.ts (cần durations + words)
              projects/<id>/timeline.json  (SceneTimeline — scenes[])
                      ↓ loadTimeline()  ← điểm compile DUY NHẤT (compileScenes + injectLiveliness)
              Timeline (events[]) — TRANSIENT, KHÔNG lưu ra đĩa
                      ↓
                Remotion → MP4
```

⚠️ **TTS + word alignment phải chạy TRƯỚC `compile-storyboard.ts`** — compiler cần `durations.json`/`words.json` để chốt khung hình theo audio thật.

**Nguồn authored = `storyboard.json`** (route A còn lùi thêm một bậc: `storyboard-data.ts`). `timeline.json` là **sản phẩm compile** — sửa tay nó sẽ bị ghi đè ở lần compile sau; muốn đổi nội dung thì sửa storyboard rồi compile lại (xem [/edit-timeline](.claude/commands/edit-timeline.md)).

**`scenes[]` là định dạng authored duy nhất mà engine phía dưới hiểu.** Mọi thứ ngữ nghĩa (layout presets, `validateTimeline`, `qualityCheck`) đều thao tác trên `scenes[]`. `events[]` chỉ là đích compile tạm thời.
- Compile `scenes → events` xảy ra ở **đúng 1 nơi**: [loadTimeline.ts](src/engine/loadTimeline.ts) (gọi `compileScenes` + `injectLiveliness`).
- Cả **preview** ([Root.tsx](src/Root.tsx)) lẫn **render** ([render.ts](scripts/render.ts)) đều đi qua `loadTimeline()` → xem đúng cái sẽ render.
- **KHÔNG BAO GIỜ** lưu file `events[]` ra đĩa. Route A chỉ ghi authored
  `storyboard.json`; `timeline.json` vẫn là sản phẩm compile.

**Hai tầng biến đổi (cố ý, đừng nhầm):**
- **Authoring-time** (chạy lúc generate, GHI ĐÈ scenes trên đĩa): `autoFixBackgrounds` ([backgroundResolver.ts](src/ai/backgroundResolver.ts)) sửa nền lười → được *persist* trước khi compile. Không chạy post-hoc trên timeline có provenance.
- **Load-time** (chạy mỗi lần preview/render, TRANSIENT): `compileScenes` + `injectLiveliness` trong `loadTimeline()`.
- Hệ quả: không sửa tay compiled timeline. Muốn sửa nền, đổi storyboard rồi compile
  lại để provenance/hash được tái tạo; `quality-check --fix` từ chối timeline đã
  có provenance.
- **Render có cổng schema:** [render.ts](scripts/render.ts) gọi `validateTimeline` trước khi render, sai schema → dừng ngay (bỏ qua bằng `--skip-validate`).

**SceneTimeline** (format AI tạo ra):
- Mỗi `scene` có `backgroundSrc`, `layout`, `entities`, `texts`
- SceneCompiler tự chuyển thành events: BackgroundEvent, EnterEvent, TextEvent...
- Auto-scale theo layout: SOLO→1.9, DIALOGUE→1.65, STAT_DRAMA→1.6, v.v.
- Auto text color trắng khi `backgroundSrc` là dark gradient

**Scene bắt buộc có:**
```json
{
  "backgroundSrc": "linear-gradient(...)",  // BẮT BUỘC — mỗi scene khác nhau
  "layout": "SOLO",                          // xem danh sách layout bên dưới
  "entities": [...],
  "texts": [...]
}
```

**Layout presets (V3):** SOLO · DIALOGUE · DUAL_CONTRAST · SIZE_HIERARCHY · CHAR_PROP · ICON_TRIPLE · QA_REVEAL · LINEUP · STAT_DRAMA · CLOSE_UP

---

## Timeline Format (raw events — dùng khi edit thủ công)

Timeline là file JSON event-driven. Mỗi event kích hoạt tại một frame cụ thể.

```json
{
  "fps": 30,
  "width": 1920,
  "height": 1080,
  "durationInFrames": 450,
  "background": "#FAFAF8",
  "audio": "audio/voice.mp3",
  "events": [ ...events... ]
}
```

### 12 loại event:

| Type | Tác dụng |
|------|---------|
| `enter` | Đưa asset vào canvas với animation |
| `exit` | Xóa asset khỏi canvas |
| `move` | Di chuyển asset mượt đến vị trí mới |
| `swap` | Đổi pose/costume của asset đang hiển thị (giữ nguyên vị trí) — dùng cho micro-variation |
| `emphasize` | Nhấn mạnh asset đang hiển thị |
| `camera` | Zoom/pan camera |
| `text` | Hiển thị text overlay |
| `clear` | Xóa một số hoặc toàn bộ assets |
| `background` | Thay đổi background với crossfade (BẮT BUỘC mỗi scene lớn) |
| `speechBubble` | Speech bubble gắn vào nhân vật cụ thể |
| `card` | Concept card với icon + label |
| `transition` | Flash/wipe/fadeBlack giữa scenes |

### Animation types:
- **Enter**: `popIn` `fadeIn` `slideLeft` `slideRight` `slideUp` `slideDown` `zoomIn` `none`
- **Exit**: `fadeOut` `popOut` `slideLeft` `slideRight` `zoomOut`
- **Emphasize**: `pulse` `shake` `bounce` `highlight`

---

## Luật nội dung & bố cục — nguồn sự thật

**Luật thẩm mỹ/đạo diễn hiện hành = mục [V4 — DIRECTOR'S RULES](#-v4--directors-rules) ở đầu file này.** V4 là bản mới nhất và thắng mọi rule cũ khi mâu thuẫn.

Bộ rule V3 gốc + phân tích 241 frames video mẫu đã chuyển sang [docs/rules_history.md](docs/rules_history.md) để giảm nhiễu context. Các RULE V3 sau **vẫn còn hiệu lực** (không mâu thuẫn V4) — tóm tắt 1 dòng:

- **Dialogue là cách dạy chính** — mèo hỏi ↔ mèo trả lời qua speech bubble; kèm caption tóm tắt (V3 RULE 2, xem thêm V4.5).
- **Nhiều mèo cá tính hóa** — màu/costume khác nhau cho từng vai; không có asset riêng thì đặt 2 mèo đối lập x=0.25/0.75 (V3 RULE 3).
- **Q&A teaching** — hỏi trước → hiện icon → trả lời; dùng cho framework nhiều phần (V3 RULE 4).
- **Hold-state** — asset không tự biến mất giữa scene; chỉ xoá bằng exit/clear (V3 RULE 6).
- **Position grid 3×3** — hàng callout y≈0.30, nhân vật y≈0.52, phụ trợ y≈0.72 (V3 RULE 7; lưu ý V4.2 cấm text ở y>0.74 khi có phụ đề).
- **Asset size 3 mức** — HERO 2.0–3.0 / MAIN 1.2–1.6 / SUPPORTING 0.8–1.0 (V3 RULE 9).
- **Icon circles** — group 3 concept bằng icon trong vòng tròn màu + label dưới (V3 RULE 10).
- **Camera gần như không zoom** — assets di chuyển thay vì viewport; tối đa 1 zoom nhẹ/video (V3 RULE 5).

**SCENE LAYOUT PATTERNS A–K** (SOLO, DIALOGUE, DUAL_CONTRAST, SIZE_HIERARCHY, CHAR_PROP, ICON_TRIPLE, Q&A_REVEAL, LINEUP, STAT_DRAMA, CLOSE_UP, SCENE_BỐI_CẢNH): mô tả đầy đủ trong [src/ai/systemPrompt.ts](src/ai/systemPrompt.ts) (nguồn AI thực đọc khi gen) và [docs/rules_history.md](docs/rules_history.md).

## CHỐNG NHÀM CHÁN — Liveliness Engine (mới)

Video mẫu không bao giờ để màn hình đứng yên — cứ ~5s có thứ thay đổi (pose mèo, bong bóng, icon, mũi tên, cắt cảnh). Hệ thống hỗ trợ điều này ở 3 tầng:

1. **Scene density — hard authoring gate** — Route A phải author scene theo từng
   câu/beat, mục tiêu khoảng 1 scene / 11–15s. **Trước khi build storyboard và
   tuyệt đối trước TTS**, Codex phải tính `minimumScenes = ceil(transcriptWords / 40)`
   và ghi con số đó vào quyết định authoring. `SCENES.length < minimumScenes` là
   lỗi authoring: không được build/TTS/render, phải tách lại các beat. Mỗi scene
   cũng không được ôm quá 60 từ nguồn trừ khi có lý do đạo diễn được ghi rõ trong
   `purpose`; một đoạn giải thích dài phải được tách ở đổi chủ thể, hành động,
   số liệu, ví dụ, cú lật cảm xúc hoặc kết luận. Không được coi "coverage 100%"
   là bằng chứng storyboard đạt mật độ. Builder thực thi ngưỡng tổng để không
   thể lặp lại lỗi video dài với quá ít scene.

   **Không được nén authoring bằng factory cơ học.** `storyboard-data.ts` không
   được dùng modulo/index để chọn pose, prop, grammar hay slot; cũng không được
   dùng `BEATS.map(...helper...)` để biến hàng marker thành scene chung. Mỗi
   `AuthoredScene` phải có direction/slots/semantic intent riêng. Builder từ
   chối hai pattern này trước khi tạo storyboard.

   **Cấm bulk-mutate authored storyboard.** Không dùng regex, source transform,
   codemod, hay override map sinh hàng loạt để đổi grammar/register/slots trong
   `storyboard-data.ts`. Sửa theo scene-local patch, build ngay sau batch nhỏ;
   source fail phải được sửa bằng patch có mục tiêu, không tiếp tục transform.

2. **Authored semantic cadence** — mỗi scene phải có một trạng thái hình bền vững
   cho tối đa 28 từ narration. Builder gọi `authoredCadenceIssues`; beat phải chứa
   cụm từ nguyên văn và action/target mà grammar thật sự render được. `advance: next`
   chỉ được dùng để chuyển sang teaching layer đã author sẵn. Grammar không có trạng
   thái kế tiếp thì phải tách scene hoặc author pose/prop/focus/cutaway thật.

3. **Compiler/renderer không được bịa nhịp** — cấm component tự lắc, đổi màu, pan,
   zoom hay hiện card theo chu kỳ thời gian. `liveliness.ts` chỉ bảo toàn authored
   events; `emphasize` ngắn không được tính là đổi semantic state. Quality gate đo
   maximum stable hold từ component xuất hiện thật và đo stable painted geometry
   từ kích thước compiler tạo ra; không tin `focalOccupancyTarget` tự khai.

---

## Asset Library Rules

### V4.9 — Semantic selection + diversity budgets

- Video >=8 scene phải có `VISUAL_TREATMENT_PLAN`: usage budgets, >=6 visual modes,
  hero cadence <=45s và palette `editorial-muted-v2`.
- `preferredAssetId` chỉ là ưu tiên và không vượt budget. `lockedAssetId` bắt buộc có
  `continuityReason`.
- Cùng stage <=5% video và <=2 scene liên tiếp; pose <=8%; STAT_REVEAL <=8%.
- Photo scene khai một treatment trong: full_bleed, tv_frame, document, screen, map,
  headline, cutaway. Một treatment <=35% photo scene; một ảnh <=2 lần.
- Không có semantic match thì build fail và ghi `asset-needs.json`; cấm fallback.

### 3 nguồn art production (⛔ `public/assets/` đã ngừng dùng)

| Thư mục | Dùng cho | styleFamily |
|---|---|---|
| `public/generated-assets/{characters,icons,scenes}/` | nhân vật, icon/prop, stage (PNG) | `editorial_cat_v1` / `flat_icon_v1` / `flat_stage_v1` |
| `public/generated-backgrounds/` | nền chất lượng cao, **đè** `scenes/` khi trùng tên | `flat_stage_v1` |
| `public/backgrounds/` | ảnh thật JPG cho BEAT/photo | `photo` |
| `public/assets/**.svg` | ⛔ bộ vẽ tay cũ — giữ để tương thích ngược, **không thêm mới** | `legacy` (resolver loại) |

### Logical ref → file thật: alias-map tự sinh

Storyboard **vẫn viết ref logic ổn định** (`characters/cat_explain`, `finance/money`,
`assets/scenes/cafe.svg`). [assetPaths.ts](src/engine/assetPaths.ts) tra `aliases`
trong `public/assets.manifest.json` để ra file thật lúc render/validate.

Alias do [build-asset-manifest.ts](scripts/build-asset-manifest.ts) **suy ra từ file
có thật trên đĩa**, không có bảng khai tay. Thêm asset mới = đặt đúng tên rồi
`npm run build-assets`:

| Logical ref | Tên file cần đặt |
|---|---|
| `characters/cat_angry` | `generated-assets/characters/cat_angry.png` |
| `finance/tax_rate` | `generated-assets/icons/finance-tax-rate.png` |
| `props/laptop` | `generated-assets/icons/props-laptop.png` |
| `assets/scenes/rooftop.svg` | `generated-assets/scenes/rooftop.png` |

Quy tắc: `<category>-<tên đổi _ thành ->.png`; riêng `characters/` giữ nguyên `_`.

**Không hardcode path trong prompt hay code** — `listAvailableAssets()` đọc thẳng
alias-map nên asset mới tự vào vốn từ authoring sau `build-assets`.

Gate liên quan (trong `qualityCheck`):
- `ASSET_EXISTS` (BLOCKER) — không có file nào trên đĩa.
- `LEGACY_ASSET` (MAJOR) — chỉ còn art legacy, chưa có bản production → xem [/add-asset](.claude/commands/add-asset.md).

### Cat Pose Variants (characters/cat_*)
| File | Dùng khi |
|------|---------|
| `cat` | Trung tính, đứng bình thường |
| `cat_explain` | Đang giải thích, chỉ tay phải |
| `cat_talk` | Đang nói trong dialogue |
| `cat_think` | Đang suy nghĩ, trước reveal |
| `cat_surprised` | Ngạc nhiên, shock (plot twist, big stat) |
| `cat_happy` | Vui mừng, kết luận tốt, CTA |
| `cat_sad` | Buồn, lo lắng, bad news |
| `cat_shrug` | Không biết, câu hỏi ngỏ |
| `cat_point_left` | Chỉ tay trái |

### SVG Guidelines
- Background transparent
- Màu sắc đậm, dễ thấy trên nền sáng `#FAFAF8`
- Không embed font (dùng shapes/paths thay vì text nếu có thể)
- File size < 10KB

---

## AI Integration

### Anthropic SDK
- Model: `claude-sonnet-4-6`
- Script generation: max_tokens 2000
- Timeline generation: max_tokens 8000

### System Prompt Location
`src/ai/systemPrompt.ts` — Chỉnh sửa file này để thay đổi behavior của AI khi tạo timeline.

### Validation
Trước khi render, luôn validate:
```typescript
import { validateTimeline } from "./src/ai/validateTimeline";
const result = validateTimeline(timeline);
```

---

## Troubleshooting

| Vấn đề | Giải pháp |
|--------|----------|
| Asset không hiện | Kiểm tra `src` trong timeline có đúng path không. Chạy `npx ts-node scripts/list-assets.ts` |
| Animation giật | Tăng `animationDuration` lên 25-30 frames |
| Video quá tối/sáng | Đổi background trong storyboard rồi compile lại |
| Audio không đồng bộ | Chạy `ffprobe public/audio/voice.mp3` kiểm tra duration |
| TypeScript error | `npx tsc --noEmit` để xem chi tiết lỗi |
| Render fail | Kiểm tra `output/` directory tồn tại |

---

## Skills (Slash Commands)

Dùng trong Claude Code:

| Command | Tác dụng |
|---------|---------|
| `/new-video` | Full pipeline: ý tưởng → script → timeline → MP4 |
| `/generate` | Chỉ generate timeline (3 modes) |
| `/render` | Render timeline.json hiện tại → MP4 |
| `/preview` | Mở Remotion Studio |
| `/validate` | Schema validate timeline.json (errors/warnings) |
| `quality-check` | Full quality checklist 22 rules → score 0-100, grade A-F |
| `/list-assets` | Liệt kê tất cả SVG có sẵn |
| `/edit-timeline` | Sửa storyboard đúng tầng rồi compile lại |
| `/add-asset` | Hướng dẫn thêm SVG mới |
