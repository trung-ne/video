# Cat Explainer Video System — Project Rules

## Tổng quan

Hệ thống tạo video giải thích tài chính 2D phong cách "Mèo giải thích".
Pipeline: **Script/URL/Transcript → Claude AI → timeline.json → Remotion → MP4**

Mục tiêu: Tạo hàng trăm video, chỉ thay script/audio — không vẽ lại asset, không làm lại animation.

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
│   ├── generate-timeline.ts      # AI pipeline: 3 input modes → timeline.json
│   └── render.ts                 # timeline.json → MP4 via remotion render
├── public/
│   └── assets/                   # SVG assets (user tự thêm)
│       ├── characters/cat.svg
│       ├── finance/{bank,money,house,stock,interest_rate,inflation,chart_up}.svg
│       ├── people/{person,company}.svg
│       └── ui/{arrow_up,arrow_down}.svg
├── timeline.json                 # Active timeline (input cho render)
├── output/                       # MP4 render ra đây
└── CLAUDE.md                     # File này
```

---

## Commands nhanh

```bash
# Preview trong Remotion Studio
npm start

# Generate timeline từ ý tưởng
npx ts-node scripts/generate-timeline.ts --idea "Chủ đề video"

# Generate từ URL YouTube
npx ts-node scripts/generate-timeline.ts --url "https://youtube.com/watch?v=..."

# Generate từ transcript file
npx ts-node scripts/generate-timeline.ts --transcript transcript.txt

# Render ra MP4
npx ts-node scripts/render.ts --timeline timeline.json --out output/video.mp4

# TypeScript check
npx tsc --noEmit
```

**Environment variable cần thiết:**
```
$env:ANTHROPIC_API_KEY = "sk-ant-..."
```

---

## Pipeline AI → Video

```
Transcript/Idea
    ↓
Claude AI (systemPrompt.ts)
    ↓ SceneTimeline JSON (scenes[])
SceneCompiler (sceneCompiler.ts)
    ↓ Timeline JSON (events[])
Remotion → MP4
```

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

### 11 loại event:

| Type | Tác dụng |
|------|---------|
| `enter` | Đưa asset vào canvas với animation |
| `exit` | Xóa asset khỏi canvas |
| `move` | Di chuyển asset mượt đến vị trí mới |
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

## SHOW DON'T TELL — Nguyên tắc Visual Storytelling (từ phân tích video thật)

> Phân tích 241 frames gốc + 20 frames render → Video gốc truyền đạt bằng hình, video render lecture bằng chữ.

### ⚠️ QUY TẮC NỀN TẢNG — HÌNH ẢNH PHẢI MATCH TRANSCRIPT
Visual không phải trang trí — nó phải **phản ánh đúng cảm xúc và bối cảnh của lời dẫn** tại từng thời điểm.

```
Transcript buồn / số liệu đáng lo  → background tối + cat_sad
Transcript tích cực / giải pháp    → background ấm + cat_happy  
Transcript đặt câu hỏi / nghi ngờ  → cat_shrug / cat_think
Transcript reveal bất ngờ          → cat_surprised + flash transition
Transcript kể bối cảnh gia đình    → phòng khách ấm, 2 mèo đứng cạnh
Transcript giải thích khái niệm khó → nền TRẮNG, ít text, icon chính giữa
```

Đọc kỹ tone của từng đoạn transcript trước khi chọn layout, background, pose.

### 5 Nguyên tắc cốt lõi

**1. Background = câu văn đầu tiên**
Không viết "Bây giờ chúng ta ở nhà hàng" — hãy chuyển sang background nhà hàng minh họa.
Background thay đổi khi **bối cảnh câu chuyện thay đổi**, không phải theo đồng hồ.

Trường hợp dùng nền trắng `#FFFFFF` hợp lệ:
- Màn hình có nhiều asset cùng lúc (3+ icons) → trắng để icons nổi, tránh rối
- Kiến thức phức tạp cần tập trung tối đa → trắng loại bỏ distraction
- ICON_TRIPLE / QA_REVEAL với nhiều phần tử → trắng là nền chuẩn

**2. Trần 12 từ trên màn hình**
Video gốc tối đa ~12 từ cùng lúc. Nếu icon/pose đã nói được ý đó — bỏ text đi.
```
❌ TITLE (10t) + CALLOUT (8t) + BODY (15t) = 33 từ → lecture
✅ Chỉ CALLOUT hoặc chỉ BODY — không bao giờ cả ba
```

**3. Icon xuất hiện SAU câu hỏi**
```
Frame 0:  3 vòng tròn "?" → suspense
Frame 30: "Ai đang chơi?" → icon mèo THAY THẾ dấu ? đầu tiên
Frame 60: "Luật là gì?"   → icon cuộn giấy thay thế dấu ? thứ hai
```
Không hiện icon trước narration. Người xem phải tự điền trước khi được trả lời.

**4. Tư thế mèo = động từ cảm xúc**
Mỗi moment cảm xúc = một pose variant cụ thể. KHÔNG dùng `cat` neutral cho tất cả.

**5. Prop phải có tương tác**
Mèo đứng ở (x=0.35) nhìn sang phải nơi prop (x=0.65). Prop không phải đồ trang trí nổi trôi.

### Bảng Mapping: Narration → Visual (không dùng text giải thích)

| Khi nói về... | Dùng visual này | KHÔNG viết text |
|---|---|---|
| "thích nhau / yêu" | heart icon ĐẶT GIỮA 2 nhân vật | "họ thích nhau" |
| "nhà giàu có lợi thế" | cat_business scale lớn + house icon | "nhà giàu có lợi thế" |
| "người nghèo khó khăn" | cat_sad scale nhỏ, cúi xuống | "người nghèo khó khăn" |
| "quy tắc / chính sách" | scroll icon trong vòng tròn | "quy tắc là..." |
| "phần thưởng" | gift/trophy icon (reveal SAU câu hỏi) | "phần thưởng là..." |
| "thời gian dài" | calendar + nhiều tờ | "mấy chục năm" |
| "sai lầm / từ chối" | ❌ X đỏ ĐÈ LÊN asset bị từ chối | "điều này sai" |
| "buồn / lo lắng" | cat_sad + teardrop asset | "điều này rất buồn" |
| "không biết" | cat_shrug + 3 vòng ? | "chúng ta không biết" |
| "3 khái niệm song song" | ICON_TRIPLE stagger reveal | bullet points |
| "nhân quả" | 2 asset + arrow GIỮA họ | "vì vậy / dẫn đến" |
| "thành công" | trophy popIn + cat_happy | "thành công" |
| "nghiêm trọng / shock" | dark background + cat_surprised | bold text |
| "đang nghiên cứu" | cat_think nhìn vào laptop prop | "đang nghiên cứu" |
| "xã hội / nhiều người" | LINEUP 4+ mèo | text mô tả nhóm |

---

## PHÂN TÍCH VIDEO THẬT — "MÈO GIẢI THÍCH" (từ 241 frames refer/frames/)

> **Phương pháp:** Extract 241 frames (cứ 5 giây/frame) từ video gốc kênh thật, phân tích từng frame.
> Video dài 20 phút, giải thích chính sách sinh con Hàn Quốc/Hungary qua nhân vật mèo 2D.

### PHÁT HIỆN MỚI NHẤT (v2 — phân tích refer/frames/*.jpg)

| Kỹ thuật | Thực tế video thật | Gap với hệ thống hiện tại |
|---|---|---|
| **Mở đầu bằng newspaper cards** | 0–15s: Ảnh chụp bài báo thật chồng lên nhau (jagged paper edge) làm bằng chứng | Chưa có component này |
| **Illustrated backgrounds** | Phòng làm việc, nhà hàng, bar, hang động, đám cưới — có bàn ghế, lửa, đèn | Chỉ có CSS gradient |
| **Nhân vật ở BOTTOM** | Khi có illustrated bg: mèo y=0.68–0.78, đứng trước scene | Mèo luôn ở y=0.52 center |
| **Speech bubble oval** | Bong bóng thoại hình oval trắng có đuôi — dùng props/speech_bubble | Dùng CALLOUT rectangle |
| **Real photo backgrounds** | Ảnh thật (hoàng hôn, silhouette) làm full-screen bg | Không hỗ trợ |
| **Survey/poll card** | Card "Khảo sát" có checkbox choices xuất hiện như flash card | Chưa có component |
| **TV frame với data** | Khung TV hoạt hình, bản đồ thế giới bên trong | Chưa có component |
| **Avatar circles** | Mặt mèo trong circle frame (dating app profile style) | Chưa có component |
| **Numbered badges** | Số thứ tự trên người mèo (ranking/game theory) | Chưa có component |
| **Floating decorations** | Đám mây, bong bóng nổi trôi xung quanh nhân vật | Có thể dùng SVG props |

### QUY TẮC VỊ TRÍ NHÂN VẬT THEO BACKGROUND (CẬP NHẬT)

```
Background tối/scene đầy đủ   → nhân vật y=0.68–0.78 (đứng ở BOTTOM, background thấy rõ phía trên)
Background trắng / gradient    → nhân vật y=0.52 (center như bình thường)
Dialogue trong scene thật      → 2 mèo y=0.70, x=0.28 và x=0.72 (ngồi/đứng ở dưới scene)
```

### PHÁT HIỆN QUAN TRỌNG NHẤT — KHÁC VỚI GIẢ ĐỊNH BAN ĐẦU

| Giả định cũ | Thực tế video thật |
|-------------|-------------------|
| Nền trắng `#FAFAF8` là chủ đạo | **Nền là ILLUSTRATED SCENE** (phòng khách, nhà hàng, bãi biển, hang động, thành phố đêm) |
| 1 con mèo tím duy nhất | **Nhiều mèo màu sắc khác nhau** với costume phù hợp vai (business suit, graduation, crown) |
| Text overlay là cách dạy chính | **DIALOGUE qua speech bubbles** giữa các nhân vật là phương pháp chính |
| Camera zoom nhấn mạnh | **Camera gần như KHÔNG zoom** — rất tĩnh, assets di chuyển thay vì viewport |
| Icons/assets tài chính làm hero | **Nhân vật mèo tương tác với nhau** là hero, asset chỉ là prop |
| Text 6 style phức tạp | **Text đơn giản**: title đen lớn + subtitle nhỏ + callout pill |

---

## 10 RULES BẮT BUỘC (V3 — CẬP NHẬT TỪ VIDEO THẬT)

### RULE 1 — ILLUSTRATED BACKGROUND (Quan trọng nhất!)
**Background phải là SCENE CÓ KHÔNG GIAN, không phải màu phẳng.**

Video thật dùng illustrated backgrounds cho từng bối cảnh:
```
Giới thiệu / giải thích nhẹ → phòng khách ấm (sofa, cửa sổ, cây)
Bữa ăn / gia đình           → bàn ăn tối (nhà hàng, ánh đèn vàng)
Thành phố / kinh tế          → cityscape ban đêm (tòa nhà, đèn)
Thiên nhiên / nông thôn      → countryside xanh (cây, đồng cỏ)
Bãi biển / lãng mạn          → sunset beach (cát, biển, hoàng hôn)
Hang động / nguyên thủy      → cave dark (đá, lửa)
Số liệu / drama               → dark solid hoặc gradient tối
Kết luận / hy vọng            → "#FAFAF8" hoặc warm gradient
```
- Dùng `BackgroundEvent` với `src` là ảnh path hoặc gradient phức tạp
- Chuyển background mỗi 15-30 giây theo không gian câu chuyện
- Nhân vật đứng TRƯỚC background, KHÔNG bị che khuất

### RULE 2 — DIALOGUE LÀ CÁCH DẠY CHÍNH
**Kiến thức được truyền tải qua nhân vật NÓI VỚI NHAU, không phải text overlay.**

Pattern dialogue chuẩn:
```
Mèo A hỏi (speech bubble trái) → Mèo B trả lời (speech bubble phải)
→ Text CAPTION nhỏ tóm tắt lesson ở dưới cùng
```

Khi nào dùng dialogue:
- Giải thích định nghĩa qua Q&A ("Đó là gì?", "Đó là...")
- Kể tình huống giả định ("Nếu mày là X thì...?")
- Contrast 2 mindset / 2 quan điểm
- Transition giữa concepts

### RULE 3 — NHIỀU MÈO — CÁ TÍNH HÓA NHÂN VẬT
Video thật có 5+ mèo với màu sắc và costume khác nhau cho các vai:

```
Mèo tím chính   → narrator/guide (characters/cat)
Mèo nữ vàng    → nhân vật ví dụ nữ (characters/cat_female nếu có)
Mèo nam xám    → nhân vật ví dụ nam/chồng
Mèo rich       → nhân vật giàu (costume: suit/crown)
Mèo poor       → nhân vật nghèo (costume: đơn giản)
```

Khi không có asset khác nhau: dùng 2 `characters/cat` với vị trí đối lập (x:0.25 vs x:0.75).

### RULE 4 — Q&A TEACHING PATTERN
Kỹ thuật dạy quan trọng: đặt câu hỏi trước, hiện icon, rồi trả lời.

```
Frame 0:   "Trong trò chơi này — AI đang chơi?" [mèo nhìn lên, think bubble]
Frame 30:  Icon person xuất hiện, callout "Người chơi"
Frame 60:  "Luật chơi là gì?" [mèo gesture sang trái]
Frame 90:  Icon rules xuất hiện, callout "Luật chơi"
Frame 120: "Phần thưởng là gì?" [mèo gesture sang phải]
Frame 150: Icon reward xuất hiện, callout "Phần thưởng"
```

Dùng khi: giải thích framework/cấu trúc (3 phần của X, 2 mặt của Y).

### RULE 5 — CAMERA: TUYỆT ĐỐI KHÔNG ZOOM LIÊN TỤC
Từ 241 frames video thật: **camera hầu như không zoom**. Assets di chuyển, camera đứng yên.

```
✅ ĐÚNG:  MoveEvent để asset trượt từ left sang center
✅ ĐÚNG:  Nhân vật walk từ phải vào center (entry animation)
❌ SAI:   Camera zoom vào asset đang đứng yên
❌ SAI:   Camera pan sang trái rồi phải
```

Nếu cần zoom: tối đa 1 lần/video, zoom 1.1-1.15 max, reset ngay sau 25 frames.

### RULE 6 — HOLD STATE
Assets KHÔNG tự biến mất giữa scenes. Chỉ xóa bằng `ExitEvent` hoặc `ClearEvent`.

```
✅ ĐÚNG:  Mèo A frame 0 → Mèo B frame 60 → cả 2 cùng hiện
❌ SAI:   Mèo A frame 0 → scene mới → Mèo A biến mất không giải thích
```

### RULE 7 — POSITION GRID 3×3
```
(0.25, 0.30)  (0.5, 0.30)  (0.75, 0.30)   ← Callout/label row
(0.25, 0.52)  (0.5, 0.52)  (0.75, 0.52)   ← Character/asset row (TRUNG TÂM)
(0.25, 0.72)  (0.5, 0.72)  (0.75, 0.72)   ← Supporting row

Mèo chính (solo):    x=0.50, y=0.52 (center screen)
Mèo chính (cạnh B):  x=0.35, y=0.52 (lệch trái nhường phải cho B)
Title/Section:       x=0.50, y=0.10-0.14
Body text:           x=0.50, y=0.82-0.86
Caption:             x=0.50, y=0.90-0.93
```

### RULE 8 — PACING — BACKGROUND THEO BỐI CẢNH, KHÔNG THEO ĐỒNG HỒ
Background thay đổi khi **câu chuyện chuyển sang không gian/bối cảnh mới**, không phải sau mỗi N giây.
Giữ nguyên background khi narration vẫn ở cùng 1 bối cảnh — dù kéo dài 1 phút.

**Khi nào dùng nền trắng `#FFFFFF`:**
- Màn hình có 3+ assets cùng lúc (ICON_TRIPLE, QA_REVEAL) → trắng để không rối
- Kiến thức khó, cần người xem tập trung tối đa → loại bỏ mọi distraction
- Size hierarchy so sánh to/nhỏ → trắng để tương quan rõ ràng

```
Intro (0-10%):      phòng khách ấm, mèo đứng solo
Setup (10-25%):     nhà hàng/bữa ăn hoặc cityscape, giới thiệu nhân vật
Concept 1 (25-40%): nền phù hợp concept, icon circles
Concept 2 (40-55%): nền khác, dialogue/comparison
Drama/Climax (55-70%): dark nền, STAT text lớn
Concept 3 (70-85%): nền countryside/tự nhiên nếu nói về "gốc rễ"
CTA (85-100%):      phòng khách lại hoặc "#FAFAF8"
```

### RULE 9 — ASSET SIZE — CHỈ 3 MỨC
```
HERO (đứng một mình, không có cat):     scale 2.0–3.0
MAIN (cạnh 1 nhân vật khác):           scale 1.2–1.6
SUPPORTING (3+ items cùng lúc):         scale 0.8–1.0
```

### RULE 10 — ICON CIRCLES — GROUPING TECHNIQUE
Video thật dùng kỹ thuật "icon trong vòng tròn màu" để group 3 concepts:

```json
[
  { "assetId": "icon1", "src": "finance/money",    "position": {"x":0.22,"y":0.45}, "scale": 0.9 },
  { "assetId": "icon2", "src": "finance/bank",     "position": {"x":0.50,"y":0.45}, "scale": 0.9 },
  { "assetId": "icon3", "src": "finance/savings",  "position": {"x":0.78,"y":0.45}, "scale": 0.9 }
]
```
Kèm CALLOUT text dưới mỗi icon: (x:0.22/0.50/0.78, y:0.62)
Dùng màu background callout khác nhau cho mỗi nhóm.

---

## SCENE LAYOUT PATTERNS (V3 — từ video thật)

### PATTERN A — SOLO (Nhân vật đứng một mình trong scene)
```
Khi dùng:  Intro, giới thiệu topic, khoảnh khắc cảm xúc
Mèo:       x=0.50, y=0.52, scale 1.6–2.0
Background: Phòng khách ấm hoặc "#FAFAF8" clean
Text:       TITLE phía trên, 1 BODY dưới, tối thiểu
Action:     Mèo bounce hoặc gesture khi nói
```

### PATTERN B — DIALOGUE SCENE (Hai nhân vật nói chuyện)
```
Khi dùng:  Giải thích qua Q&A, kể tình huống, contrast mindset
Mèo A:     x=0.28, y=0.52, scale 1.3, nhìn sang phải
Mèo B:     x=0.72, y=0.52, scale 1.3, nhìn sang trái
Background: Scene có không gian (nhà hàng, cityscape, phòng khách)
Text:       SpeechBubble trên mỗi nhân vật + CAPTION ngắn dưới cùng
Action:     Nhân vật gesture khi nói (pulse), đối phương idle
```

### PATTERN C — DUAL CONTRAST (2 thứ đối lập)
```
Khi dùng:  So sánh giàu/nghèo, thành công/thất bại, có/không có
Asset A:   x=0.25, y=0.50, scale 1.4, enterAnimation slideRight (từ trái vào)
Asset B:   x=0.75, y=0.50, scale 1.4, enterAnimation slideLeft (từ phải vào)
Label A:   CALLOUT x=0.25, y=0.20, màu xanh/xanh lá
Label B:   CALLOUT x=0.75, y=0.20, màu đỏ/cam
Background: Gradient nhẹ hoặc phòng khách mờ
Camera:    PAN_LR (zoom vào trái → zoom vào phải → reset)
```

### PATTERN D — SIZE HIERARCHY (To-nhỏ = cấp bậc)
```
Khi dùng:  Bố mẹ-con, thầy-trò, xã hội-cá nhân
Nhân vật lớn: x=0.50, y=0.42, scale 2.0–2.5 (nền tảng, tác nhân lớn)
Nhân vật nhỏ: x=0.42, y=0.65, scale 0.9–1.1 (cá nhân, người bị ảnh hưởng)
Background:   Trắng sạch để tương quan kích thước rõ ràng
Text:         Label dưới mỗi nhân vật, BODY giải thích quan hệ
```

### PATTERN E — CHARACTER + PROP (Nhân vật với đồ vật)
```
Khi dùng:  Đang nghiên cứu, đang chờ, đang làm việc cụ thể
Mèo:       x=0.40, y=0.52, scale 1.4, nhìn sang phải
Prop:      x=0.65, y=0.50, scale 1.2–1.5
Background: Clean hoặc scene phù hợp hành động
Text:       CAPTION nhỏ dưới prop + BODY ngắn
```

### PATTERN F — ICON TRIPLE (3 concepts song song)
```
Khi dùng:  3 thành phần, 3 bước, 3 ví dụ cùng nhóm
Icons:     x=0.22/0.50/0.78, y=0.42, scale 0.9–1.0
Labels:    CALLOUT dưới mỗi icon x=0.22/0.50/0.78, y=0.62
           Màu khác nhau (xanh lá/cam/đỏ)
Background: Trắng sạch để icons nổi
SECTION:   Header trên cùng, BODY giải thích dưới
Stagger:   Icons xuất hiện lần lượt mỗi 15-20 frames
```

### PATTERN G — Q&A REVEAL (Câu hỏi → tiết lộ)
```
Khi dùng:  Giải thích framework, teach "Ai/Cái gì/Tại sao"
Frame 0:   Mèo center + BODY câu hỏi (think bubble)
Frame 30:  Icon/asset xuất hiện + CALLOUT trả lời
Frame 60:  Mèo gesture → icon mới + CALLOUT tiếp theo
...lặp lại cho mỗi phần của framework
Background: Trắng hoặc phòng khách
```

### PATTERN H — LINEUP (Hàng ngang nhiều nhân vật)
```
Khi dùng:  Giới thiệu nhiều loại người, so sánh nhiều trường hợp
4 nhân vật: x=0.15/0.38/0.62/0.85, y=0.52, scale 0.85–1.0
3 nhân vật: x=0.25/0.50/0.75, y=0.52, scale 0.85–1.0
Background: Trắng + gradient nhẹ
Label:      Tên dưới mỗi nhân vật (CAPTION)
SECTION:    Header trên cùng
Entrance:   Stagger slideUp mỗi nhân vật cách 12 frames
```

### PATTERN I — STAT DRAMA (Số liệu gây sốc)
```
Khi dùng:  Tiết lộ con số bất ngờ, climax của argument
Mèo:       EXIT trước để màn hình sạch
STAT text: Center (0.5, 0.42), font siêu lớn, màu đỏ/trắng
CAPTION:   Giải thích stat (0.5, 0.65)
Background: Dark gradient (tối để text trắng nổi)
Camera:    Không zoom — để text tự nói
```

### PATTERN J — CLOSE UP (Cận cảnh cảm xúc)
```
Khi dùng:  Khoảnh khắc cảm xúc mạnh, cưỡng lại cám dỗ
Mèo:       x=0.50, y=0.50, scale 1.6–2.0
Background: Trắng sạch, KHÔNG có distraction
Text:       Tối thiểu, chỉ 1 CAPTION ngắn hoặc SpeechBubble
Action:     Mèo "thể hiện" cảm xúc (stare, shake, bounce)
```

### PATTERN K — SCENE BỐI CẢNH (Scene có không gian đầy đủ)
```
Khi dùng:  Kể chuyện có bối cảnh thực (gia đình, công sở)
Background: Illustrated scene ảnh thật hoặc gradient phức tạp
Nhân vật:  2-3 mèo đặt tự nhiên trong scene (không aligned grid)
Text:       Chỉ speech bubbles, tối thiểu text overlay
Props:      Đồ vật phù hợp scene (bàn, cửa sổ, etc.)
```

---

### BẢNG CHỌN PATTERN THEO NỘI DUNG

| Nội dung scene | Pattern |
|----------------|---------|
| Intro / hook mở đầu | A (Solo) |
| Giải thích định nghĩa qua Q&A | G (Q&A Reveal) |
| Kể tình huống / dialogue | B (Dialogue Scene) |
| So sánh 2 thứ đối lập | C (Dual Contrast) |
| Quan hệ to-nhỏ / cấp bậc | D (Size Hierarchy) |
| Nhân vật đang làm việc gì | E (Char + Prop) |
| 3 khái niệm song song | F (Icon Triple) |
| Nhiều loại người cùng lúc | H (Lineup) |
| Tiết lộ số liệu drama | I (Stat Drama) |
| Cảm xúc mạnh / cận cảnh | J (Close Up) |
| Kể chuyện bối cảnh đầy đủ | K (Scene Bối Cảnh) |

**⚠️ BẮT BUỘC:** Chuyển pattern + background mỗi 15-30 giây.

---

## Asset Library Rules

### Thêm SVG mới
1. Đặt vào `public/assets/<category>/<name>.svg`
2. Kích thước chuẩn: 160×160px viewBox
3. Tham chiếu trong timeline: `"src": "<category>/<name>"` (không có `/` đầu, không có `.svg`)
4. Claude sẽ tự động nhận ra qua `listAvailableAssets()`

### Categories
```
characters/   — nhân vật (cat, dog, teacher...)
finance/      — tài chính (bank, money, house, stock...)
people/       — người/tổ chức (person, company, family...)
ui/           — UI elements (arrow_up, arrow_down, percent...)
```

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
| Video quá tối/sáng | Đổi `background` trong timeline.json |
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
| `/validate` | Kiểm tra timeline.json |
| `/list-assets` | Liệt kê tất cả SVG có sẵn |
| `/edit-timeline` | Sửa timeline.json thông minh |
| `/add-asset` | Hướng dẫn thêm SVG mới |
