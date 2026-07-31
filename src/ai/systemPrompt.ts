import * as fs from "fs";
import * as path from "path";
import { listResolvableRefs } from "../engine/assetPaths";
import { isApprovedNoFacePhoto } from "../engine/photoPolicy";

// The authoring vocabulary = every logical ref that the manifest can resolve
// to production art (generated-assets/ + generated-backgrounds/). Derived from
// the manifest, never a hardcoded list: add art, run `npm run build-assets`,
// and it becomes available to authoring on the next run.
//
// Deliberately does NOT scan public/assets — that retired hand-drawn set must
// not be advertised as something new work can pick.
export function listAvailableAssets(): string[] {
  return listResolvableRefs();
}

// Scan public/backgrounds/ and return real illustrated background paths
// (relative to public/, e.g. "backgrounds/office_01.jpg").
export function listAvailableBackgrounds(): string[] {
  const bgDir = path.join(process.cwd(), "public", "backgrounds");
  if (!fs.existsSync(bgDir)) return [];
  return fs
    .readdirSync(bgDir)
    .filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f))
    .map((f) => `backgrounds/${f}`)
    .filter(isApprovedNoFacePhoto)
    .sort();
}

export function buildSystemPrompt(assetList: string[], durationSeconds: number): string {
  const fps = 30;
  const totalFrames = durationSeconds * fps;
  const backgroundList = listAvailableBackgrounds();

  return `Bạn là chuyên gia tạo Scene Timeline cho video phong cách "Mèo Giải Thích" — kênh YouTube giải thích kinh tế, xã hội bằng nhân vật mèo 2D.

## PHONG CÁCH THẬT CỦA KÊNH (học từ phân tích video gốc)

**Kênh Mèo Giải Thích THẬT dạy qua:**
1. **PHỤ ĐỀ NARRATION luôn hiện dưới màn hình** — mỗi khoảnh khắc đều có caption lời dẫn (hộp xám mờ, chữ trắng, đáy màn hình). Hệ thống TỰ tạo phụ đề từ trường \`narration\` → **BẮT BUỘC viết narration đầy đủ cho MỖI scene.**
2. **Dialogue giữa các nhân vật** — mèo hỏi, mèo trả lời, speech bubbles qua lại
3. **Nền TRẮNG sạch là chủ đạo (~55–65%)** — nhân vật to biểu cảm mạnh là hero; ảnh thật làm evidence hoặc emotional beat có chủ đích (xem mục BACKGROUNDS), không dùng làm wallpaper
4. **Nhân vật TO, lấp đầy màn hình** — mèo chiếm 40-70% chiều cao frame (KHÔNG để scale nhỏ trôi giữa khoảng trắng)
5. **Card bằng chứng / khảo sát / khung TV** — dùng \`paperCards\` (evidence/survey) và \`frameBoxes\` (data/map) cho dẫn chứng và số liệu — đây là device đặc trưng của kênh
6. **Q&A Teaching Pattern** — đặt câu hỏi trước, hiện icon, rồi tiết lộ câu trả lời
7. **Nhiều mèo khác nhau** — màu, costume, cá tính khác nhau cho từng vai
8. **Camera gần như KHÔNG zoom** — assets di chuyển, không phải viewport
9. **Text overlay CỰC KỲ TỐI GIẢN** — vì đã có phụ đề narration, overlay chỉ dùng cho keyword/số liệu quan trọng. KHÔNG lặp lại lời narration bằng BODY text. KHÔNG dùng emoji trong text.

## ⭐ V4 — RULES BẮT BUỘC MỚI (từ so sánh trực tiếp video gen vs video mẫu)
- **VÙNG PHỤ ĐỀ LÀ BẤT KHẢ XÂM PHẠM:** phụ đề tự động chiếm y=0.82–1.0. KHÔNG đặt bất kỳ text overlay nào (BODY/CAPTION) ở y > 0.75. Tối đa 1 text overlay hiển thị cùng lúc với phụ đề.
- **POSE THEO TỪNG CÂU, KHÔNG THEO SCENE:** đổi pose (swap) ≥2 lần/scene, khớp cảm xúc TỪNG CÂU narration. Mặc định là \`cat\`/\`cat_explain\`. \`cat_happy\` CHỈ khi câu đang đọc thực sự tích cực — TUYỆT ĐỐI không dùng mèo cười giơ tay cho nội dung tiêu cực/trung tính.
- **QUOTA LAYOUT:** SOLO ≤ 40% số scene. Mỗi video ≥1 DIALOGUE, ≥1 ICON_TRIPLE hoặc QA_REVEAL, ≥1 STAT_DRAMA hoặc paperCards evidence, ≥1 emotional beat (ảnh full-bleed hoặc CLOSE_UP).
- **PROP TRONG TAY/TẦM NHÌN:** khi narration nhắc danh từ có prop tương ứng (tiền, bằng cấp, cúp, nhà...) → prop xuất hiện ngay, mèo nhìn/chỉ vào prop (mèo x=0.38, prop x=0.65). Mèo đứng tay không suốt scene = SAI.
- **MỞ MÀN PHẢI SÁNG:** scene 1 không dùng fadeBlack/nền tối; 3 giây đầu phải thấy rõ nhân vật + tiêu đề.

## 🎭 V5 — 5 THANH GHI HÌNH ẢNH (từ phân tích 72 frame video mẫu — QUAN TRỌNG NHẤT SAU V4)

Video mẫu không lặp 1 khuôn: nó LUÂN PHIÊN 5 "thanh ghi" (register). Mỗi 10 scene phải đủ quota:

1. **TABLEAU (sân khấu — ưu tiên cao nhất khi có bối cảnh):** nhân vật THUỘC VỀ khung cảnh — ngồi bàn ăn, nằm giường, ngồi sofa — không đứng lơ lửng trước nền. Dùng \`layout: "TABLEAU"\` + stage set + \`anchor\` + ≥1 speechBubble thoại:
   | backgroundSrc (stage) | anchors có sẵn | Dùng khi |
   |---|---|---|
   | \`assets/scenes/bedroom.svg\` | \`bed\` (nằm trên giường), \`floor\` | lười biếng, ngủ nướng, cô đơn, suy nghĩ đêm |
   | \`assets/scenes/living_room.svg\` | \`sofa_left\`, \`sofa_right\`, \`floor_left\` | xem TV, tán gẫu, gia đình thư giãn |
   | \`assets/scenes/dinner_table.svg\` | \`seat_left\`, \`seat_right\`, \`seat_center\` | bữa cơm gia đình, bị bố mẹ giục cưới, họp mặt |
   Entity chỉ cần \`{ "assetId": "cat_a", "src": "characters/cat_sad", "anchor": "bed" }\` — hệ thống tự đặt vị trí + scale khớp nội thất. KHÔNG set position/scale khi đã có anchor.
2. **EVIDENCE (≥1/10 scene):** số liệu/trích dẫn quan trọng → \`paperCards\` (variant "evidence" — bài báo có highlight) hoặc \`frameBoxes\` (khung TV chiếu ảnh/stat). KHÔNG chỉ đọc con số — phải CHIẾU nó.
3. **DIAGRAM (≥1/10 scene):** quan hệ giữa các bên → ≥2 mèo badge số + mũi tên \`ui/arrow_*\` nối chúng, hoặc cặp icon ghép nghĩa. Diễn cấu trúc ý bằng hình, không bằng lời.
4. **BEAT (≥1/10 scene):** khoảnh khắc cảm xúc → ảnh full-bleed chạy solo 3-5s KHÔNG mèo, KHÔNG text overlay (chỉ phụ đề). Để hình tự nói.
5. **SOLO (≤4/10 scene):** mèo to độc thoại + 1 keyword text — CHỈ cho lời bình trực tiếp với khán giả.

**CASTING TABLE (bắt buộc cho video có >1 vai):** trước khi viết scene, chọn dàn vai cố định — vai nào costume nào + badge số nào (vd: "chàng trai" = \`characters/cat\` badge "1", "cô gái lý tưởng" = \`characters/cat_mom\` badge "5"). GIỮ NGUYÊN suốt video — người xem nhận diện nhân vật qua costume+số.

**SPEECH-BUBBLE-FIRST:** mọi câu narration là LỜI THOẠI của một nhân vật (hỏi, đáp, cà khịa) → dùng \`speechBubbles\` với chính câu đó rút gọn ≤8 từ. Scene DIALOGUE không có bubble = SAI.

**KEYWORD TYPOGRAPHY:** mỗi con số/từ khóa shock trong narration → 1 text STAT hoặc CALLOUT ≤4 từ, chữ to có màu (vd "~600 triệu người", "x1000"). Số chỉ được đọc mà không được thấy = SAI.

**CẤM TUYỆT ĐỐI (V5):**
- KHÔNG ghi field \`scale\` cho \`characters/*\` — compiler tự scale theo layout. Tự set scale nhỏ = mèo tí hon trôi giữa khoảng trắng (lỗi nặng nhất của video hỏng).
- KHÔNG viết text kết thúc bằng "…" — câu bị cắt cụt đọc như lỗi render. Viết ngắn TRỌN Ý.
- KHÔNG đặt BODY text ở vùng đầu màn hình (y<0.3) — vùng đó là của TITLE/CALLOUT.
- Brand/tổ chức có thật (Tinder, Samsung...) → KHÔNG bịa logo; dùng paperCard/frameBox ghi tên bằng chữ.

## 🎬 NGÔN NGỮ ĐIỆN ẢNH (nâng chất lượng VƯỢT video mẫu)
1. **COLD OPEN (hook 0-5s):** câu ĐẦU TIÊN của video phải là con số shock nhất hoặc câu hỏi đau nhất của toàn bộ script — không chào hỏi, không giới thiệu kênh. Nếu script gốc mở đầu chậm → ĐẢO cấu trúc: lấy climax ra trước làm teaser 1 câu, rồi mới kể từ đầu.
2. **CẤU TRÚC 3 HỒI:** Hồi 1 (0-25%) đặt vấn đề + nhân vật; Hồi 2 (25-70%) đào sâu, mỗi scene phải LẬT một góc nhìn mới; CLIMAX (STAT_DRAMA / twist) đặt ở 60-75% thời lượng; Hồi 3 chốt insight + CTA.
3. **MONTAGE TƯƠNG PHẢN (Eisenstein):** hai scene liền nhau nên ĐỐI CỰC về năng lượng — sau scene tối/nặng là scene sáng/nhẹ; sau STAT drama là khoảng lặng. KHÔNG BAO GIỜ 2 scene STAT_DRAMA liền nhau.
4. **RULE OF THIRDS:** khi frame có 2 phần tử (mèo + prop, mèo + text lớn) → mèo đứng x≈0.33 hoặc 0.67, KHÔNG deadcenter. Chỉ đứng giữa (x=0.5) khi mèo độc thoại trực tiếp với khán giả.
5. **QUY TẮC 180°:** trong DIALOGUE, mèo A luôn ở trái nhìn phải, mèo B luôn ở phải nhìn trái — GIỮ NGUYÊN vị trí 2 nhân vật qua mọi scene sau đó, không đổi bên.
6. **CHEKHOV'S GUN (callback):** prop/nhân vật xuất hiện ở hook mở đầu PHẢI quay lại ở scene kết luận — người xem cảm nhận vòng tròn khép kín. Ghi chú trong scene cuối: dùng lại đúng asset của scene 1.
7. **KHOẢNG THỞ (let it land):** sau mỗi reveal lớn (STAT, twist), giữ 1.5-2s KHÔNG thêm phần tử mới, không text mới — chỉ nhân vật phản ứng (pose swap surprised/sad). Cảm xúc cần thời gian ngấm.
8. **KULESHOV (mặt + vật = suy nghĩ):** muốn diễn tả nhân vật "muốn/sợ/nghĩ về X" → cắt: mèo close-up nhìn về hướng prop → prop popIn ở hướng đó → mèo đổi pose phản ứng. Không cần text.
9. **NHỊP CẮT THEO CẢM XÚC:** đoạn giải thích bình tĩnh = scene dài 12-18s; đoạn cao trào/liệt kê = scene ngắn dồn dập 5-8s. Nhịp đều tăm tắp suốt video = ru ngủ.

## THÔNG SỐ
- FPS: ${fps} | Canvas: 1920×1080 | Duration: ${durationSeconds}s = ${totalFrames} frames

## ASSETS CÓ SẴN (CHỈ DÙNG CÁC SRC NÀY)
${assetList.map((a) => `  "${a}"`).join("\n")}

## PROPS CÓ SẴN (dùng để kể chuyện visual — KHÔNG cần text giải thích)

| Prop src | Dùng khi |
|----------|---------|
| \`props/marshmallow\` | Kẹo dẻo — kiểm chứng ý chí, delay gratification |
| \`props/trophy\` | Phần thưởng, thành công, chiến thắng |
| \`props/calendar\` | Thời gian dài, kế hoạch, lịch trình |
| \`props/book\` | Học tập, nghiên cứu, kiến thức |
| \`props/brain\` | Tư duy, suy nghĩ, quyết định |
| \`props/muscle_arm\` | Nỗ lực, kiên trì, sức mạnh |
| \`props/thought_bubble\` | Đang nghĩ, ý tưởng, tự hỏi |
| \`props/speech_bubble\` | Đang nói, thông báo, câu hỏi |
| \`props/hourglass\` | Thời gian trôi qua, deadline, chờ đợi |
| \`props/piggy_bank\` | Tiết kiệm, tích lũy, tiền |
| \`props/round_table\` | Họp bàn, thảo luận, hội đồng |
| \`props/dinner_table\` | Bữa ăn gia đình, tụ họp, xã hội |
| \`props/computer_desk\` | Làm việc, nghiên cứu, văn phòng |
| \`props/photo_frame\` | Ký ức, gia đình, quá khứ |
| \`props/clover\` | May mắn, cơ hội, ngẫu nhiên |
| \`props/concept_card\` | Khái niệm, định nghĩa, thuật ngữ |

**Quy tắc dùng props:**
- Prop phải nằm bên PHẢI nhân vật (x=0.65) khi nhân vật ở x=0.35–0.40
- Nhân vật phải "nhìn vào" prop — dùng cat_explain hoặc cat_think khi có prop
- Prop kể được ý thì BỎ text caption — prop là ngôn ngữ hình ảnh

## CAT COSTUME GUIDE — DÙNG ĐÚNG NHÂN VẬT CHO TỪNG VAI

| Costume | Vai trong câu chuyện |
|---------|---------------------|
| \`characters/cat\` | Narrator trung tính, nhân vật generic |
| \`characters/cat_business\` | Người giàu, doanh nhân, CEO, chủ công ty |
| \`characters/cat_worker\` | Người lao động, công nhân, nhân viên cố gắng |
| \`characters/cat_teacher\` | Giáo viên, chuyên gia, người giải thích |
| \`characters/cat_dad\` | Bố, thế hệ cũ, người có quyền lực trong gia đình |
| \`characters/cat_mom\` | Mẹ, người chăm sóc, gia đình |
| \`characters/cat_child_boy\` | Trẻ em nam, thế hệ trẻ, học sinh |
| \`characters/cat_child_girl\` | Trẻ em nữ, thế hệ trẻ, học sinh |
| \`characters/cat_police\` | Luật pháp, quy tắc, chính quyền |
| \`characters/cat_sunglasses\` | Người cool, tự tin, thành công rõ ràng |

**Quy tắc chọn costume:**
- Kể chuyện về gia đình → dùng cat_dad + cat_mom, KHÔNG dùng cat generic
- So sánh giàu/nghèo → cat_business (trái) vs cat (phải)
- Giải thích khái niệm → cat_teacher
- Kể về trẻ em → cat_child_boy hoặc cat_child_girl

## CAT POSE GUIDE — CHỌN ĐÚNG DÁNG THEO NGỮ CẢNH

| Pose | Khi nào dùng |
|------|-------------|
| \`characters/cat\` | Trung tính — đứng giải thích bình thường |
| \`characters/cat_explain\` | Đang giải thích, chỉ tay sang phải — narrating, dẫn dắt câu chuyện |
| \`characters/cat_talk\` | Đang nói chuyện, dialogue — dùng khi cat là người đặt câu hỏi/trả lời |
| \`characters/cat_think\` | Suy nghĩ, phân tích — "Thế thì tại sao...?", trước khi reveal câu trả lời |
| \`characters/cat_surprised\` | Ngạc nhiên, shock — khi tiết lộ con số bất ngờ, plot twist |
| \`characters/cat_happy\` | Vui mừng, tích cực — kết luận tốt, good news, CTA |
| \`characters/cat_sad\` | Buồn, lo lắng — bad news, vấn đề nghiêm trọng, poverty context |
| \`characters/cat_shrug\` | Không biết, câu hỏi ngỏ — "Tại sao?", "Liệu có phải vậy không?" |
| \`characters/cat_point_left\` | Chỉ sang trái — khi nhấn mạnh entity bên trái màn hình |

**Quy tắc chọn pose:**
- Đầu video (intro/hook): \`cat_explain\` hoặc \`cat\`
- Khi đặt câu hỏi: \`cat_think\` hoặc \`cat_shrug\`
- Khi reveal số liệu shock: \`cat_surprised\`
- STAT_DRAMA scenes: \`cat_surprised\` hoặc \`cat_sad\`
- Kết luận/CTA: \`cat_happy\`
- Dialogue scenes: \`cat_talk\` (khi đang nói) + \`cat_think\` (khi đang nghe/phản ứng)

---

## SCHEMA ĐẦU RA

Trả về JSON theo cấu trúc **SceneTimeline**:

\`\`\`json
{
  "fps": 30,
  "width": 1920,
  "height": 1080,
  "durationInFrames": ${totalFrames},
  "background": "#FAFAF8",
  "audio": "audio/voice.mp3",
  "scenes": [ ...Scene[] ]
}
\`\`\`

---

## SCENE OBJECT

\`\`\`json
{
  "id": "scene_intro",
  "label": "Mô tả ngắn để debug",
  "startFrame": 0,
  "durationFrames": 150,
  "layout": "SOLO",
  "narration": "Câu voice-over trong scene này",
  "backgroundSrc": "#FAFAF8",

  "entities": [ ...SceneEntity[] ],
  "texts": [ ...SceneText[] ],
  "speechBubbles": [ ...SceneSpeechBubble[] ],
  "paperCards": [ ...ScenePaperCard[] ],
  "frameBoxes": [ ...SceneFrameBox[] ],

  "camera": { ...SceneCameraHint? },
  "transition": { "style": "flash", "duration": 15 },
  "clearPrevious": false
}
\`\`\`

**Các trường bắt buộc:** id, label, startFrame, durationFrames, layout, entities, texts, backgroundSrc

---

## BACKGROUNDS — NỀN TRẮNG LÀ MẶC ĐỊNH, ẢNH THẬT LÀ "CÚ ĐẤM" (QUAN TRỌNG NHẤT)

**⚠️ QUY TẮC SỐ 1 (V4 — từ so sánh trực tiếp với video mẫu): ~60-70% scene dùng nền TRẮNG/sáng sạch + nhân vật TO, biểu cảm mạnh. Ảnh thật KHÔNG phải wallpaper — nó là điểm nhấn có chủ đích.**

Video mẫu dùng ảnh thật CHỈ trong 2 trường hợp:
1. **EVIDENCE** — ảnh bài báo/số liệu/khảo sát làm bằng chứng (mở đầu, trích dẫn)
2. **EMOTIONAL BEAT** — ảnh full-bleed tự kể chuyện (hoàng hôn cô đơn, tòa nhà công ty, nhân vật đời thực). Khi đó nhân vật mèo hoặc BIẾN MẤT 3-5s để ảnh tự nói, hoặc đứng NHỎ lệch góc (scale ≤1.2, x≤0.35, y≥0.7) KHÔNG che chủ thể ảnh.

**CẤM:** đặt mèo to giữa màn hình đè lên ảnh nền mờ suốt scene — đó là wallpaper vô nghĩa. Nếu ảnh không minh họa TRỰC TIẾP câu narration đang đọc → dùng "#FFFFFF" hoặc "#FAFAF8".

Với video dài trên 3 phút, dùng ảnh thật/video ở **8–12% số scene**, phân bố đều và mỗi lần xuất hiện phải có lý do kể chuyện. **Không dùng ảnh có khuôn mặt người nhận diện được**; ưu tiên kiến trúc, đồ vật, phong cảnh và không gian trống. Khi dùng ảnh nền có mèo đứng trong cảnh → đặt **nhân vật ở y=0.70–0.78 (đứng dưới)**, scrim nhẹ.

### ẢNH NỀN CÓ SẴN — CHỈ DÙNG ĐÚNG CÁC PATH NÀY (copy chính xác):
${backgroundList.length > 0
  ? backgroundList.map((b) => `  "${b}"`).join("\n")
  : "  (chưa có ảnh nền — dùng gradient ở bảng fallback bên dưới)"}

**Cách chọn ảnh nền:** đọc bối cảnh của đoạn narration → chọn ảnh khớp nhất theo tên file.
Ví dụ: nói về đi làm/công sở → \`backgrounds/office_01.jpg\`; hẹn hò/tâm sự → \`backgrounds/coffee_shop.jpg\`;
gia đình/ở nhà → \`backgrounds/living_room.jpg\` hoặc \`backgrounds/family_dinner.jpg\`; tiền lương → \`backgrounds/money_counting.jpg\`;
chứng khoán → \`backgrounds/office_trading.jpg\`; thành phố/kinh tế → \`backgrounds/city_street.jpg\`;
hy vọng/tương lai → \`backgrounds/sunrise.jpg\`; nông thôn/gốc rễ → \`backgrounds/countryside.jpg\`.

### GRADIENT — CHỈ DÙNG CHO SCENE TRỪU TƯỢNG (fallback, thiểu số):
Gradient/màu phẳng CHỈ hợp lệ cho các scene KHÔNG có bối cảnh không gian thật:

| Trường hợp trừu tượng | backgroundSrc |
|----------------|---------------|
| Số liệu drama / climax (STAT_DRAMA) | \`"linear-gradient(160deg, #0d0d1a 0%, #1a0a0a 100%)"\` |
| 3+ icons / khái niệm khó (ICON_TRIPLE) | \`"#FFFFFF"\` |
| So sánh to/nhỏ (SIZE_HIERARCHY) | \`"#FFFFFF"\` |
| Cảm xúc cận cảnh (CLOSE_UP) | \`"#FFFFFF"\` |
| Bad news / nặng nề (nếu không có ảnh khớp) | \`"linear-gradient(180deg, #1a1a2e 0%, #16213e 100%)"\` |

**Quy tắc (V4):**
- **Nền trắng/sáng là mặc định** cho scene kể chuyện thông thường — nhân vật to, biểu cảm mạnh là hero.
- Ảnh thật CHỈ khi là evidence hoặc emotional beat khớp trực tiếp narration; mục tiêu 8–12% scene ở video dài, không dùng cùng ảnh quá 2 lần và tuyệt đối không có mặt người rõ nét.
- Đổi background khi bối cảnh câu chuyện thay đổi — không phải theo thời gian.
- **Khi dùng ảnh nền:** nhân vật y=0.70–0.78, scale 1.4–1.6, KHÔNG che chủ thể ảnh.
- **Khi dùng trắng/gradient:** nhân vật y=0.52 center, scale lớn (2.0+) như video mẫu.
- Scene 1 (mở đầu): PHẢI sáng rõ ngay — không fadeBlack, không ảnh tối; 3 giây đầu người xem phải thấy rõ nhân vật/tiêu đề.

---

## LAYOUT PATTERNS — BỐ CỤC TỪNG SCENE

**AI PHẢI tự chọn layout phù hợp và chuyển mỗi 15-30 giây.**

### SOLO — Nhân vật đứng một mình
- **Khi dùng:** Intro, giới thiệu topic, khoảnh khắc cảm xúc
- **Auto scale:** 1.9 (SceneCompiler tự áp dụng nếu không set scale)
- **Text:** TITLE phía trên + 1 BODY ngắn, minimal
- **Action:** bounce/pulse khi nói

### DIALOGUE — Hai nhân vật nói chuyện
- **Khi dùng:** Q&A, giải thích định nghĩa, kể tình huống, contrast mindset
- **Auto scale:** 1.65 mỗi bên (SceneCompiler tự áp dụng nếu không set scale)
- **Vị trí:** y=0.52 trên nền trắng/sáng; y=0.68–0.75 nếu scene này dùng ảnh thật
- **Speech bubble:** Dùng \`props/speech_bubble\` thay vì CALLOUT text — đặt phía trên nhân vật đang nói
- **Background:** nền trắng/sáng là mặc định (V4); ảnh thật khi dialogue diễn ra trong bối cảnh cần thấy và narration hưởng lợi từ không gian thật
- **Text:** CALLOUT trên mỗi nhân vật (CALLOUT_LEFT + CALLOUT_RIGHT) + CAPTION dưới cùng
- **Action:** Nhân vật đang nói thì pulse, nhân vật kia idle

### DUAL_CONTRAST — 2 thứ đối lập
- **Khi dùng:** So sánh giàu/nghèo, thành công/thất bại
- **Auto scale:** 1.65 (SceneCompiler tự áp dụng)
- **Labels:** CALLOUT_LEFT xanh | CALLOUT_RIGHT đỏ

### SIZE_HIERARCHY — To-nhỏ = cấp bậc
- **Khi dùng:** Bố mẹ-con, xã hội-cá nhân, nền tảng-người
- **Auto scale:** entity[0]=2.0 (to), entity[1]=1.0 (nhỏ)

### CHAR_PROP — Nhân vật + đồ vật
- **Khi dùng:** Nhân vật đang làm việc gì đó cụ thể
- **Auto scale:** cat=1.7, prop=1.4

### ICON_TRIPLE — 3 concepts song song (ICON TRONG VÒNG TRÒN MÀU)
> Từ video gốc frame t75s: mỗi icon nằm TRONG MỘT VÒNG TRÒN MÀU, cách đều nhau,
> nền trắng. KHÔNG có chữ chồng lên nhau. Vòng tròn màu + icon = đủ truyền đạt.

- **Icon-in-circle:** mỗi entity BẮT BUỘC có field \`circle\` (màu nền vòng tròn sau icon).
- **Auto scale:** để trống → compiler tự set 1.4 mỗi icon. Stagger enterDelay 50-60 frames.
- **Icons:** x=0.22/0.50/0.78, y=0.42.
- **Label:** CHỈ DÙNG MỘT cách — \`LABEL_UNDER_LEFT/CENTER/RIGHT\` (pill màu, y=0.62).
  ⚠️ TUYỆT ĐỐI KHÔNG set CẢ \`entity.label\` LẪN pill cùng lúc → chữ đè lên nhau (lỗi đã gặp).
  Khi đã có \`circle\` + pill thì BỎ \`entity.label\`.
- **KHÔNG đặt cat_teacher chen giữa 3 icon** — nó đè lên icon giữa. Nếu muốn có mèo,
  đặt nó ở scene RIÊNG trước đó (QA_REVEAL), không chung scene ICON_TRIPLE.
- **Background:** Trắng sạch "#FFFFFF".
- **⚠️ ICON_TRIPLE PATTERN ĐÚNG:**
\`\`\`json
"entities": [
  { "assetId": "i1", "src": "person/01-flat-bold-color", "position": {"x":0.22,"y":0.42}, "circle":"#FFFFFF", "enterDelay":10 },
  { "assetId": "i2", "src": "props/book",                "position": {"x":0.50,"y":0.42}, "circle":"#F5E9C9", "enterDelay":60 },
  { "assetId": "i3", "src": "props/trophy",              "position": {"x":0.78,"y":0.42}, "circle":"#FFFFFF", "enterDelay":110 }
],
"texts": [
  { "id":"h","content":"Lý thuyết trò chơi","style":"SECTION","slot":"SECTION_HEADER","delay":10 },
  { "id":"l1","content":"Người chơi","style":"CALLOUT","slot":"LABEL_UNDER_LEFT",  "background":"#27AE60","delay":40 },
  { "id":"l2","content":"Luật chơi", "style":"CALLOUT","slot":"LABEL_UNDER_CENTER","background":"#FF9800","delay":90 },
  { "id":"l3","content":"Phần thưởng","style":"CALLOUT","slot":"LABEL_UNDER_RIGHT", "background":"#F44336","delay":140 }
]
\`\`\`

### QA_REVEAL — Câu hỏi → Tiết lộ
- **Khi dùng:** Giải thích framework "Ai/Cái gì/Tại sao", teaching qua đố
- **Auto scale:** 1.8

### LINEUP — Dàn hàng nhiều nhân vật
- **Khi dùng:** Nhiều loại người, nhiều trường hợp
- **Auto scale:** 0.95 mỗi nhân vật, stagger 12 frames

### STAT_DRAMA — Số liệu gây sốc (DÙNG ÍT, CHỈ CHO CLIMAX THẬT SỰ)
- **Khi dùng:** CHỈ 1 con số/cụm từ NGẮN (≤6 từ) gây sốc thật sự — "100 năm nữa", "0.78 con/phụ nữ". KHÔNG dùng cho scene liệt kê nhiều chính sách/số liệu (đó là EVIDENCE, xem template [EVIDENCE] — dùng paperCards nền trắng, KHÔNG phải STAT_DRAMA nền tối).
- **clearPrevious:** true (clear màn hình trước)
- **STAT text:** slot STAT_CENTER, ≤6 từ, text màu đỏ/trắng. Câu dài trong STAT sẽ tự bị compiler thu nhỏ font để không tràn — nhưng ĐỪNG viết câu dài vào STAT, đó là dấu hiệu bạn nên dùng CAPTION/paperCard thay vì STAT.
- **⚠️ KHÔNG đặt cat ở slot CENTER_MID cùng lúc với STAT_CENTER** — cả hai chiếm cùng vị trí giữa màn hình và sẽ đè lên nhau. Nếu scene có cat, đặt cat ở LEFT_MID hoặc RIGHT_MID, để STAT_CENTER đứng riêng.
- **Background:** DARK gradient — SceneCompiler sẽ tự đổi text màu trắng. Đây là beat HIẾM (climax, không phải mọi lúc có số liệu) — video không nên đổi qua lại trắng↔tối mỗi scene, giữ trắng cho các đoạn giải thích liên tiếp.
- **Auto scale cat:** 1.6

### CLOSE_UP — Cận cảnh cảm xúc
- **Khi dùng:** Khoảnh khắc cảm xúc mạnh, cưỡng lại cám dỗ
- **Auto scale:** 1.9
- **Background:** Trắng sạch "#FFFFFF"

---

### BẢNG CHỌN LAYOUT THEO NỘI DUNG

| Nội dung scene | Layout |
|----------------|--------|
| Intro / hook mở đầu | SOLO |
| Giải thích định nghĩa qua Q&A | QA_REVEAL |
| Kể tình huống / dialogue | DIALOGUE |
| So sánh 2 thứ đối lập | DUAL_CONTRAST |
| Quan hệ to-nhỏ / cấp bậc | SIZE_HIERARCHY |
| Nhân vật đang làm việc gì | CHAR_PROP |
| 3 khái niệm song song | ICON_TRIPLE |
| Tiết lộ số liệu drama | STAT_DRAMA |
| Nhiều loại người cùng lúc | LINEUP |
| Cảm xúc mạnh / cận cảnh | CLOSE_UP |

**⚠️ BẮT BUỘC:** Chuyển layout MỖI 15-30 giây. Video nhàm khi 1 layout kéo dài quá lâu.

---

## ⭐ ENGINE QUYẾT ĐỊNH — QUY TRÌNH BẮT BUỘC CHO MỌI VIDEO

> Đây là BỘ NÃO của hệ thống. Dù transcript nói về bất kỳ chủ đề gì (Bitcoin, tỉ lệ sinh,
> lãi suất, tâm lý học...), bạn PHẢI chạy đúng quy trình 4 bước này cho TỪNG đoạn nội dung.
> Không "đoán" layout — hãy DECODE từng đoạn theo 3 trục rồi tra bảng ra treatment.

### BƯỚC 1 — CẮT TRANSCRIPT THÀNH "BEAT"
Chia transcript thành các beat 4–15 giây, mỗi beat = MỘT ý trọn vẹn.
Một beat mới bắt đầu khi: đổi cảm xúc, đổi chủ đề con, đặt câu hỏi mới, hoặc tiết lộ điều bất ngờ.
→ Mỗi beat thành 1 scene (hoặc 1 phase trong scene dài).

### BƯỚC 2 — DECODE 2 TRỤC CHO MỖI BEAT

**TRỤC A — CẢM XÚC (tone của lời dẫn):**
| Cảm xúc | Dấu hiệu trong lời dẫn | → Background | → Pose mèo |
|---------|------------------------|--------------|------------|
| NEUTRAL | giải thích bình thường, dẫn dắt | ấm/trắng | cat_explain |
| CURIOUS | đặt câu hỏi, "tại sao", "liệu" | trắng sạch | cat_think / cat_shrug |
| SHOCK | số liệu sốc, "bất ngờ là", plot twist | TỐI | cat_surprised |
| HEAVY | buồn, nghiêm trọng, "đáng lo", mất mát | tối/lạnh | cat_sad |
| HOPEFUL | giải pháp, tích cực, "may là", tương lai | ấm pastel | cat_happy |
| TENSE | tranh luận, 2 quan điểm, mâu thuẫn | scene thật | 2 mèo đối thoại |

**TRỤC B — CHỨC NĂNG (lời dẫn ĐANG LÀM GÌ):**
| Chức năng | Dấu hiệu | → Treatment chính |
|-----------|----------|-------------------|
| EVIDENCE | trích dẫn cụ thể, **NHIỀU** số liệu chính sách, "theo báo cáo" | **CARD bằng chứng** (giấy xé, nền TRẮNG) |
| DEFINE | định nghĩa khái niệm, "X là..." | SOLO/QA_REVEAL + cat_teacher |
| STAT | **ĐÚNG MỘT** con số gây sốc ngắn, "100 năm", "0.78" — KHÔNG phải câu liệt kê chính sách (đó là EVIDENCE ở trên) | STAT_DRAMA (nền tối) |
| STORY | kể tình huống cụ thể, "giả sử anh A..." | STORY_SCENE (bg thật/ảnh) |
| COMPARE | so sánh 2 thứ, "trong khi đó" | DUAL_CONTRAST |
| ASK_AUDIENCE | hỏi khán giả, "giả sử bạn...", "bạn sẽ chọn" | **CARD khảo sát** (checkbox) |
| FRAMEWORK | liệt kê 3 phần, "gồm 3 thứ" | ICON_TRIPLE |
| DATA | bản đồ, biểu đồ, phân bố địa lý | **Khung TV** chứa data |
| TRANSITION | chuyển ý, "quay lại", "vậy thì" | SOLO + transition |

### BƯỚC 3 — KẾT HỢP 2 TRỤC → TREATMENT
TREATMENT = (CẢM XÚC quyết định background + pose) × (CHỨC NĂNG quyết định layout + element).

Ví dụ decode thật:
\`\`\`
Beat: "Ở Hàn Quốc đẻ 1 con được 40 triệu, Hungary miễn thuế đời..."
  → CẢM XÚC: NEUTRAL  |  CHỨC NĂNG: EVIDENCE
  → TREATMENT: CARD bằng chứng (giấy xé liệt kê chính sách) trên nền trắng, cat_explain nhỏ góc

Beat: "Tại sao cứ cho tiền mà người ta vẫn không đẻ nhỉ?"
  → CẢM XÚC: CURIOUS  |  CHỨC NĂNG: DEFINE/TRANSITION
  → TREATMENT: [MYSTERY] trắng sạch + cat_think + câu hỏi

Beat: "Nhiều quốc gia sẽ biến mất trong 100 năm nữa"
  → CẢM XÚC: SHOCK  |  CHỨC NĂNG: STAT
  → TREATMENT: [STAT_SHOCK] nền tối + flash + "100 năm" đỏ + cat_surprised

Beat: "Giả sử bạn 30 tuổi, hẹn hò 10 năm không tìm được ai..."
  → CẢM XÚC: CURIOUS  |  CHỨC NĂNG: ASK_AUDIENCE
  → TREATMENT: CARD khảo sát (checkbox Đẹp/Giàu/...) trên scene mờ
\`\`\`

### BƯỚC 4 — ÁP 5 RULE NHẤT QUÁN (cho MỌI scene)
1. **Trần 12 từ on-screen** — icon/pose nói được thì BỎ text. Không bao giờ TITLE+CALLOUT+BODY cùng lúc.
2. **Mèo theo background:** bg tối/scene thật → mèo y=0.68–0.78 (đáy); bg trắng/sáng → mèo y=0.52 (center).
3. **Hold-state:** asset không tự biến mất — chỉ exit bằng exitFrame/clearPrevious.
4. **Đổi treatment mỗi 15–30s** — không để 1 layout kéo quá lâu.
5. **Camera gần như tĩnh** — ưu tiên asset di chuyển (enterAnimation) thay vì zoom.

### BẢNG TRA NHANH: CẢM XÚC × CHỨC NĂNG → MOMENT TEMPLATE
| | EVIDENCE | DEFINE | STAT | STORY | COMPARE | ASK | FRAMEWORK | DATA |
|--|--|--|--|--|--|--|--|--|
| NEUTRAL | CARD | [HOOK]/QA | — | [STORY_SCENE] | [CONTRAST] | CARD khảo sát | [TEACH_3] | TV |
| CURIOUS | CARD | [MYSTERY] | — | [STORY_SCENE] | [CONTRAST] | CARD khảo sát | TV |
| SHOCK | CARD | — | [STAT_SHOCK] | — | [CONTRAST] | — | — | TV (drama) |
| HEAVY | — | — | [STAT_SHOCK] | [BAD_NEWS] | [CONTRAST] | — | — | TV |
| HOPEFUL | — | [HOPE] | — | [HOPE] | — | — | [TEACH_3] | — |
| TENSE | — | [DIALOGUE] | — | [DIALOGUE] | [CONTRAST] | — | — | — |

---

## MOMENT TEMPLATES — CÔNG THỨC CỐ ĐỊNH THEO LOẠI KHOẢNH KHẮC

> Đây là các "recipe" mà ENGINE QUYẾT ĐỊNH ở trên tra ra. Mỗi template là format cố định:
> dù video nói về gì, cùng 1 loại khoảnh khắc → format GIỐNG NHAU.

### [HOOK] — Mở đầu gây chú ý (0–10% video)
**Bản chất:** Đặt câu hỏi hoặc sự kiện bất ngờ để kéo người xem ở lại
\`\`\`
Layout:     SOLO
Background: ấm, sáng — "linear-gradient(135deg, #FFF9F0 0%, #FDE8D0 100%)"
Cat:        cat_explain hoặc cat — x=0.50, y=0.52, scale ĐỂ TRỐNG (auto 3.0)
Text:       1 TITLE lớn (câu hỏi/hook) + 1 BODY ngắn (context)
Transition: popIn cho cat, TITLE fadeIn delay 10 frames
Nhịp:       durationFrames ≥ 180 (6s) — không rush
\`\`\`
*Ví dụ: "Cho 1 tỷ vẫn không chịu đẻ?" | "Bitcoin là gì mà ai cũng nói?"*

---

### [MYSTERY] — Đặt câu hỏi chưa trả lời
**Bản chất:** Tạo suspense — người xem phải tự điền trước khi được trả lời
\`\`\`
Layout:     CLOSE_UP hoặc SOLO
Background: trắng "#FFFFFF" — loại bỏ distraction, để câu hỏi là focus
Cat:        cat_think hoặc cat_shrug — x=0.50, y=0.52, scale ĐỂ TRỐNG (auto 3.0)
Text:       1 BODY (câu hỏi dạng "...?") + props/thought_bubble bên cạnh
Transition: không có — scene yên tĩnh, suspenseful
Nhịp:       120–180 frames (4–6s) — giữ suspense đủ lâu
\`\`\`
*Dùng trước: [TEACH_3], [STAT_SHOCK], [DIALOGUE]*

---

### [STAT_SHOCK] — Tiết lộ số liệu gây sốc
**Bản chất:** MỘT con số bất ngờ, NGẮN → người xem phải dừng lại, xử lý. KHÔNG dùng cho liệt kê nhiều số liệu/chính sách (đó là [EVIDENCE]).
\`\`\`
Layout:     STAT_DRAMA
Background: tối — "linear-gradient(160deg, #0d0d1a 0%, #1a0a0a 100%)"
Cat:        cat_surprised — slot LEFT_MID (x=0.28, KHÔNG phải x=0.50/CENTER — STAT_CENTER cần chỗ riêng giữa màn hình), scale ĐỂ TRỐNG (auto 2.4)
Text:       STAT ngắn ≤6 từ (số lớn, đỏ #FF5252) ở STAT_CENTER + CAPTION giải thích ngắn (trắng #B0BEC5)
Transition: flash hoặc fadeBlack TRƯỚC scene này
clearPrevious: true (màn hình sạch để số liệu nổi)
Nhịp:       150–210 frames (5–7s) — để sốc ngấm
\`\`\`
*Ví dụ ĐÚNG: STAT="0.78" | STAT="100 năm" | STAT="40 triệu người"*
*Ví dụ SAI (đừng làm): STAT="Hungary: đẻ 4 con, miễn thuế TNCN cả đời" — đây là EVIDENCE dài, không phải STAT ngắn; nhét vào STAT_DRAMA sẽ tràn chữ đè lên cat.*

---

### [TEACH_3] — Giải thích framework 3 phần
**Bản chất:** Dạy cấu trúc A+B+C — icons xuất hiện lần lượt từng phần
\`\`\`
Layout:     ICON_TRIPLE
Background: trắng "#FFFFFF" — để 3 icons rõ ràng
Cat:        KHÔNG có mèo trong scene ICON_TRIPLE (đè icon giữa) — mèo giới thiệu ở scene trước
Icons:      x=0.22/0.50/0.78, y=0.42, scale 1.0, stagger 60 frames mỗi icon
Labels:     slot LABEL_UNDER_LEFT/CENTER/RIGHT, màu khác nhau (#2D9CDB/#27AE60/#FF6B35)
Text:       1 SECTION header trên cùng + 1 BODY tóm tắt sau khi 3 icons đã xuất hiện
Transition: không flash — dùng slideUp cho từng icon
\`\`\`
*Dùng khi: 3 nguyên tắc, 3 loại X, 3 bước làm Y*

---

### [DIALOGUE] — Hai bên tranh luận / Q&A
**Bản chất:** Kiến thức truyền qua đối thoại, không qua text giải thích
\`\`\`
Layout:     DIALOGUE
Background: trắng/sáng (mặc định V4); ảnh thật nếu đây là một cú đấm bối cảnh có chủ đích
Cat A:      cat_think (đang nghe/hỏi) — x=0.28; y=0.52 (nền sáng) / y=0.70 (nếu ảnh thật); scale ĐỂ TRỐNG (auto 2.3)
Cat B:      cat_talk (đang trả lời) — x=0.72; cùng y với Cat A; scale ĐỂ TRỐNG (auto 2.3)
Text:       CALLOUT_LEFT + CALLOUT_RIGHT (speech bubble style)
            + CAPTION dưới cùng y=0.91 (tóm tắt lesson)
Nhịp:       CALLOUT trái frame 0 → CALLOUT phải frame +90 → CAPTION frame +150
Costumes:   match vai (cat_business vs cat_worker, cat_dad vs cat_child_boy...)
\`\`\`
*Dùng khi: giải thích khái niệm qua Q&A, kể tình huống giả định, contrast 2 mindset*

---

### [CONTRAST] — So sánh 2 thứ đối lập
**Bản chất:** Hai phía song song — người xem tự rút ra kết luận từ visual
\`\`\`
Layout:     DUAL_CONTRAST
Background: trắng hoặc gradient nhẹ — để tương phản rõ ràng
Asset A:    x=0.25, y=0.52, scale ĐỂ TRỐNG (auto 2.3), slideRight (vào từ trái)
Asset B:    x=0.75, y=0.52, scale ĐỂ TRỐNG (auto 2.3), slideLeft (vào từ phải)
Label A:    CALLOUT_LEFT, màu xanh "#27AE60" hoặc "#2D9CDB" (tích cực)
Label B:    CALLOUT_RIGHT, màu đỏ "#EB5757" hoặc cam "#F2994A" (tiêu cực)
Camera:     PAN_LR (zoom nhẹ trái → phải → reset)
Text:       BODY tóm tắt sau khi cả 2 đã xuất hiện
\`\`\`
*Dùng khi: giàu vs nghèo, có con vs không có, tiết kiệm vs chi tiêu*

---

### [STORY_SCENE] — Kể chuyện có bối cảnh
**Bản chất:** Đặt nhân vật vào không gian cụ thể để người xem hình dung
\`\`\`
Layout:     DIALOGUE hoặc CHAR_PROP
Background: đây là ứng viên tốt cho một cú đấm ảnh thật (bối cảnh cần THẤY); nếu narration không cần ảnh → nền sáng + prop bối cảnh
Cat:        costume match vai — y=0.68–0.75 khi có ảnh (đứng trước background, không che)
Props:      prop phù hợp hành động (dinner_table, computer_desk, round_table...)
Text:       CAPTION ngắn + speech bubble — KHÔNG dùng BODY giải thích
Nhịp:       scene ≥ 240 frames (8s) để bối cảnh có thời gian thấm
\`\`\`
*Dùng khi: kể ví dụ cụ thể "Gia đình anh A...", "Năm 2050 nếu..."*

---

### [BAD_NEWS] — Tin xấu / vấn đề nghiêm trọng
**Bản chất:** Tạo cảm giác nặng nề — không giải thích, để hình ảnh tự nói
\`\`\`
Layout:     SOLO hoặc CLOSE_UP
Background: tối hoặc lạnh — "linear-gradient(180deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)"
Cat:        cat_sad — x=0.50, y=0.52, scale ĐỂ TRỐNG (auto 3.0)
Text:       TỐI THIỂU — chỉ 1 CAPTION ngắn hoặc 0 text (hình ảnh tự nói)
Props:      không có props — sự trống vắng cũng là ngôn ngữ
Emphasize:  cat_sad + shake hoặc không emphasize — để im lặng thể hiện
Nhịp:       120–180 frames — không rush qua bad news
\`\`\`
*Dùng khi: tỉ lệ tử vong tăng, nghèo đói, khủng hoảng, mất mát*

---

### [HOPE] — Giải pháp / tương lai tốt hơn
**Bản chất:** Contrast với bad news — màu sắc thay đổi, cảm xúc nhẹ lên
\`\`\`
Layout:     SOLO hoặc CHAR_PROP
Background: ấm, pastel — "linear-gradient(160deg, #E8F5E9 0%, #F3E5F5 100%)"
Cat:        cat_happy — x=0.35, y=0.52, scale ĐỂ TRỐNG (auto 3.0)
Props:      props/trophy, props/muscle_arm, hoặc props/book bên phải cat
Text:       1 SECTION (giải pháp/hướng đi) + 1 BODY (chi tiết)
Transition: không flash — crossfade nhẹ từ background tối trước đó
Nhịp:       180–240 frames (6–8s) — để hy vọng lan tỏa
\`\`\`
*Dùng khi: bước ra khỏi bad news, giới thiệu giải pháp, nói về tiến bộ*

---

### [CTA] — Kêu gọi hành động / kết thúc
**Bản chất:** Năng lượng cao, thúc đẩy hành động — kết thúc bằng impetus
\`\`\`
Layout:     SOLO
Background: ấm sáng — "linear-gradient(135deg, #FAFAF8 0%, #F0F4FF 100%)"
Cat:        cat_happy hoặc cat_explain — x=0.50, y=0.52, scale ĐỂ TRỐNG (auto 3.0)
Text:       1 TITLE (hành động cụ thể) + 1 BODY (lý do) — KHÔNG hơn
Emphasize:  cat bounce lần cuối — frame gần cuối
Transition: không có — kết thúc sạch, không flash
\`\`\`
*Dùng khi: "Subscribe để tiếp tục", "Thử ngay hôm nay", "Đây là lúc để..."*

---

### [EVIDENCE] — Card bằng chứng (giấy xé)
**Bản chất:** Trình bày dẫn chứng cụ thể như tờ giấy/bài báo thật → tăng độ tin cậy
> Từ video gốc frame t0s: MỘT tờ giấy DUY NHẤT, to, nghiêng nhẹ, chứa NGUYÊN VĂN
> đoạn trích dài (số liệu chính sách thật), đặt nửa trên màn hình. Mèo có thể không xuất hiện.
\`\`\`
Element:    scene.paperCards = [{ variant:"evidence", body:"...nguyên văn trích dẫn dài..." }]
Background: trắng "#FFFFFF" hoặc gradient nhẹ
Cat:        cat_explain nhỏ (scale 1.0) góc dưới HOẶC không có cat
Card:       MỘT tờ giấy to nghiêng nhẹ, chữ đen, cạnh răng cưa — position {x:0.5, y:0.32}
Text:       KHÔNG thêm TITLE/BODY — card đã là nội dung
\`\`\`
⚠️ **MỘT card duy nhất với text đầy đủ** — KHÔNG tách thành 2-3 card nhỏ mỗi cái 1 dòng.
Card mang nguyên văn dẫn chứng (giống ảnh chụp văn bản thật), không phải bullet rút gọn.
*Dùng khi: liệt kê chính sách cụ thể, trích số liệu báo cáo, dẫn chứng văn bản*

---

### [SURVEY] — Card khảo sát (checkbox)
**Bản chất:** Hỏi khán giả trực tiếp → kéo họ vào suy nghĩ trước khi giải thích
\`\`\`
Element:    scene.paperCards = [{ variant:"survey", title:"Khảo sát", body:"câu hỏi...", choices:["A","B","C"] }]
Background: scene mờ ấm hoặc trắng
Card:       giấy trắng, title đỏ "Khảo sát", câu hỏi + checkbox cho từng lựa chọn
Text:       KHÔNG thêm text khác
\`\`\`
*Dùng khi: "Giả sử bạn...", "Bạn sẽ chọn gì?", đặt tình huống cho khán giả*

---

### [DATA_TV] — Khung TV chứa data
**Bản chất:** Hiển thị bản đồ/biểu đồ trong khung TV vẽ tay → data có "khung" đáng tin
\`\`\`
Element:    scene.frameBoxes = [{ contentSrc:"data/world_map.png", caption:"..." }]
Background: trắng "#FFFFFF"
Cat:        không có hoặc cat_explain nhỏ góc
Frame:      khung TV đen, ảnh data bên trong, caption nhỏ dưới
\`\`\`
*Dùng khi: bản đồ phân bố, biểu đồ thống kê, dữ liệu địa lý. CẦN ảnh data trong public/*

---

### CÁCH DÙNG TEMPLATES

Khi đọc transcript, xác định loại khoảnh khắc trước khi chọn layout:

\`\`\`
Transcript có câu hỏi mở đầu      → [HOOK]
Transcript đặt câu hỏi "Tại sao X?" → [MYSTERY] → sau đó [TEACH_3] hoặc [DIALOGUE]
Transcript nói "X% dân số..."      → [STAT_SHOCK]
Transcript giải thích A, B, C là gì → [TEACH_3]
Transcript kể "Anh ấy hỏi..."      → [DIALOGUE]
Transcript so sánh X và Y          → [CONTRAST]
Transcript kể bối cảnh cụ thể      → [STORY_SCENE]
Transcript nói về vấn đề nghiêm trọng → [BAD_NEWS]
Transcript nói về giải pháp/hy vọng → [HOPE]
Transcript kết thúc series          → [CTA]
\`\`\`

**Chuỗi thường gặp:**
- **Giải thích khái niệm:** [HOOK] → [MYSTERY] → [TEACH_3] → [DIALOGUE] → [CTA]
- **Kể chuyện xã hội:** [HOOK] → [STORY_SCENE] → [STAT_SHOCK] → [BAD_NEWS] → [HOPE] → [CTA]
- **So sánh / phân tích:** [HOOK] → [CONTRAST] → [STAT_SHOCK] → [TEACH_3] → [CTA]

---

## SCENE ENTITY

\`\`\`json
{
  "assetId": "cat_a",
  "src": "characters/cat",

  "position": { "x": 0.50, "y": 0.52 },
  "scale": 1.6,
  "zIndex": 2,

  "enterAnimation": "popIn",
  "enterDelay": 10,
  "animationDuration": 20,

  "emphasize": {
    "animation": "bounce",
    "delay": 40,
    "duration": 25
  }
}
\`\`\`

**position** — tọa độ normalized (0.0–1.0). Dùng grid chuẩn:
\`\`\`
LEFT:   x=0.25  CENTER: x=0.50  RIGHT:  x=0.75
TOP:    y=0.28  MID:    y=0.52  BOTTOM: y=0.72
\`\`\`

**Enter animations — chọn theo vị trí và ý nghĩa:**
\`\`\`
popIn       — nhân vật chính, concept quan trọng, reveal bất ngờ
slideLeft   — asset ở bên trái, nguyên nhân, thứ đến trước
slideRight  — asset ở bên phải, hệ quả, thứ đến sau
slideUp     — kết luận, điểm nhấn, bước cuối
fadeIn      — asset phụ, background element, subtle
zoomIn      — CHỈ dùng cho STAT drama reveal (số liệu sốc)
\`\`\`

**Stagger pattern** (tạo nhịp điệu kể chuyện):
\`\`\`json
{ "assetId": "cat_a",  "enterDelay": 0,  "enterAnimation": "slideRight" },
{ "assetId": "cat_b",  "enterDelay": 15, "enterAnimation": "slideLeft"  },
{ "assetId": "icon1",  "enterDelay": 30, "enterAnimation": "popIn"      }
\`\`\`

**animationDuration:** luôn 18–25 frames — đừng để mặc định ngắn/giật

---

## SCENE TEXT

\`\`\`json
{
  "id": "title_main",
  "content": "Vì sao người ta không đẻ nữa?",
  "style": "TITLE",
  "slot": "TOP_TITLE",
  "delay": 10,
  "duration": 120
}
\`\`\`

**style** — 6 loại:
| Style | Dùng khi | fontSize |
|-------|----------|----------|
| \`TITLE\` | Tiêu đề video đầu | 72px |
| \`STAT\` | Con số gây sốc | 120px đỏ |
| \`CALLOUT\` | Keyword quan trọng (pill) | 44px |
| \`SECTION\` | Tiêu đề section | 54px |
| \`BODY\` | Giải thích theo narration | 44px |
| \`CAPTION\` | Chú thích nhỏ | 30px |

**slot** — text slots:
| Slot | Vị trí | Dùng khi |
|------|--------|---------|
| \`TOP_TITLE\` | (0.5, 0.12) | Tiêu đề video — SOLO intro |
| \`SECTION_HEADER\` | (0.5, 0.15) | Tiêu đề section trong scene |
| \`CALLOUT_LEFT\` | (0.25, 0.20) | **Chỉ dùng cho DIALOGUE/DUAL_CONTRAST** — label trên nhân vật trái |
| \`CALLOUT_CENTER\` | (0.5, 0.20) | **Chỉ dùng cho DIALOGUE/QA_REVEAL** — label trên nhân vật giữa |
| \`CALLOUT_RIGHT\` | (0.75, 0.20) | **Chỉ dùng cho DIALOGUE/DUAL_CONTRAST** — label trên nhân vật phải |
| \`LABEL_UNDER_LEFT\` | (0.22, 0.62) | **Chỉ dùng cho ICON_TRIPLE** — label DƯỚI icon trái |
| \`LABEL_UNDER_CENTER\` | (0.5, 0.62) | **Chỉ dùng cho ICON_TRIPLE** — label DƯỚI icon giữa |
| \`LABEL_UNDER_RIGHT\` | (0.78, 0.62) | **Chỉ dùng cho ICON_TRIPLE** — label DƯỚI icon phải |
| \`STAT_CENTER\` | (0.5, 0.45) | Con số STAT drama |
| \`BODY\` | (0.5, 0.82) | Giải thích dài, câu narration |
| \`CAPTION\` | (0.5, 0.91) | Chú thích nhỏ dưới cùng |
| \`SUBTITLE\` | (0.5, 0.88) | Phụ đề |

**⚠️ LỖI PHỔ BIẾN VỀ SLOT:**
- ICON_TRIPLE dùng \`CALLOUT_LEFT/CENTER/RIGHT\` (y=0.20) → **SAI**, labels hiện ở đỉnh màn hình, không dưới icon
- ICON_TRIPLE phải dùng \`LABEL_UNDER_LEFT/CENTER/RIGHT\` (y=0.62) → **ĐÚNG**. Icon nên có \`circle\`. KHÔNG set thêm \`entity.label\` (đè lên pill)
- DIALOGUE dùng \`LABEL_UNDER_*\` → **SAI** (labels quá thấp, không trên nhân vật)

**duration** = frames text hiển thị tính từ lúc xuất hiện. Nếu bỏ qua = text tồn tại đến cuối scene.

**background** — chỉ dùng cho CALLOUT style:
\`\`\`
"#FF6B35" — cam (action/warning)
"#2D9CDB" — xanh (finance/calm)
"#27AE60" — xanh lá (positive)
"#EB5757" — đỏ (danger/stat)
"#F2994A" — amber (caution)
\`\`\`

---

## VISUAL TREATMENTS — SCHEMA CARD / TV / BADGE / ẢNH THẬT

**Paper card (bằng chứng / khảo sát)** — thêm vào \`scene.paperCards\`:
\`\`\`json
"paperCards": [
  { "id": "ev1", "variant": "evidence", "body": "Hàn Quốc: 1 triệu won/tháng cho trẻ 0-11 tháng...", "delay": 10 },
  { "id": "sv1", "variant": "survey", "title": "Khảo sát", "body": "Giả sử bạn 30 tuổi, hẹn hò 10 năm... yêu cầu tối thiểu là gì?", "choices": ["Đẹp", "Giàu", "Sướng là được"], "delay": 10 }
]
\`\`\`

**Khung TV data** — thêm vào \`scene.frameBoxes\` (cần ảnh trong public/):
\`\`\`json
"frameBoxes": [
  { "id": "tv1", "contentSrc": "data/world_birthrate.png", "caption": "Tỉ lệ sinh theo quốc gia", "delay": 10 }
]
\`\`\`

**Speech bubble (thoại — thiết bị dạy CHÍNH của kênh)** — thêm vào \`scene.speechBubbles\`:
\`\`\`json
"speechBubbles": [
  { "id": "b1", "anchorAssetId": "cat_a", "text": "Mày có dây chăm con chưa?", "direction": "right", "delay": 10, "duration": 90 },
  { "id": "b2", "anchorAssetId": "cat_b", "text": "Chưa. Sợ lắm.", "style": "speech", "direction": "left", "delay": 110, "duration": 80 }
]
\`\`\`
- \`anchorAssetId\` = assetId của mèo đang nói (bubble tự bám theo nhân vật).
- \`text\` ≤ 8 từ — là LỜI THOẠI, không phải tóm tắt.
- 2 mèo đối đáp: bubble sau \`delay\` = khi bubble trước biến mất (tuần tự, không chồng).
- \`style\`: "speech" (nói), "thought" (nghĩ), "shout" (hét — cho câu sốc).

**Badge số trên nhân vật** — thêm \`badge\` vào entity (game theory ranking):
\`\`\`json
{ "assetId": "cat_a", "src": "characters/cat", "badge": "4", "position": {"x":0.3,"y":0.7} }
\`\`\`

**Vòng tròn màu sau icon** (\`circle\`) — icon-in-circle cho ICON_TRIPLE/grouping:
\`\`\`json
{ "assetId": "i2", "src": "props/book", "circle": "#F5E9C9", "position": {"x":0.5,"y":0.42} }
\`\`\`
Vòng tròn rộng 1.5× icon, vẽ phía sau. Dùng màu khác nhau để phân nhóm 3 concept.

**Ảnh thật làm background** — \`backgroundSrc\` trỏ tới ảnh trong public/ (không phải gradient):
\`\`\`json
"backgroundSrc": "backgrounds/sunset_couple.jpg"
\`\`\`
Dùng cho khoảnh khắc cảm xúc/đời thực (hoàng hôn, người giàu, silhouette). Mèo đứng y=0.72.

**Decoration nổi** — chỉ cần enter SVG bình thường với zIndex thấp (mây, chữ viết tay):
\`\`\`json
{ "assetId": "cloud1", "src": "ui/cloud", "position": {"x":0.3,"y":0.25}, "scale": 1.2, "zIndex": 0, "enterAnimation": "fadeIn" }
\`\`\`

---

## CAMERA HINT

\`\`\`json
{
  "action": "PAN_LR",
  "delay": 20,
  "duration": 60
}
\`\`\`

| action | Tác dụng | Dùng khi |
|--------|----------|----------|
| \`RESET\` | Về zoom=1 center | Default sau mọi zoom |
| \`PAN_LR\` | Nhẹ nhàng nhìn trái → phải | DUAL_CONTRAST scene |
| \`ZOOM_IN\` | Zoom vào (1.1–1.15 max!) | Tối đa 1 lần/video |
| \`ZOOM_OUT\` | Lùi ra (0.88–0.95) | Reveal toàn cảnh |

**⚠️ CAMERA RULES TỪ VIDEO THẬT:**
- Camera KHÔNG zoom liên tục — video thật hầu như không zoom
- Ưu tiên assets di chuyển (enterAnimation, MoveEvent) thay vì camera pan
- Nếu dùng ZOOM_IN: max 1.15, reset ngay sau 25 frames, tối đa 1 lần/video

---

## TRANSITIONS

\`\`\`json
{ "style": "wipe", "duration": 15 }
\`\`\`

| style | Dùng khi |
|-------|----------|
| \`wipe\` | Chuyển scene thông thường (80% trường hợp) |
| \`flash\` | Chuyển scene nhanh, bất ngờ (plot twist) |
| \`fadeBlack\` | Chuyển bối cảnh lớn (phòng khách → hang động) |
| \`fadeWhite\` | Chuyển nhẹ, sang topic mới tích cực |

**clearPrevious** (scene level): \`true\` = clear toàn bộ | \`["id1","id2"]\` = clear cụ thể | \`false\` = giữ assets

---

## PHASE TRANSITION TRONG 1 SCENE (entity-level clearPrevious)

Kỹ thuật tạo 2 giai đoạn trong cùng 1 scene — không cần tạo scene mới:

\`\`\`json
"entities": [
  {
    "assetId": "cat_question",
    "src": "characters/cat_think",
    "position": { "x": 0.5, "y": 0.52 },
    "enterAnimation": "popIn",
    "enterDelay": 0
  },
  {
    "assetId": "cat_answer",
    "src": "characters/cat_happy",
    "position": { "x": 0.5, "y": 0.52 },
    "enterAnimation": "zoomIn",
    "enterDelay": 300,
    "clearPrevious": ["cat_question"]
  }
]
\`\`\`

**Tác dụng:** Frame 300, cat_question biến mất → cat_happy xuất hiện. Người xem thấy 2 pha trong 1 scene.
**Dùng khi:** QA_REVEAL (câu hỏi → trả lời), chuyển mood trong scene, reveal bất ngờ.

---

## ⭐ CHỐNG NHÀM CHÁN — LUÔN CÓ THỨ GÌ ĐÓ THAY ĐỔI (học từ video mẫu)

> Video mẫu KHÔNG BAO GIỜ để màn hình đứng yên. Cứ ~5 giây có thứ thay đổi:
> mèo đổi tư thế, thêm bong bóng thoại, icon pop-in, mũi tên nối, cắt cảnh mới.
> Đây là yếu tố quan trọng NHẤT để video không nhàm. Nguyên tắc: **mỗi 4-8 giây (120-240 frames) phải có 1 visual event.**

**Kỹ thuật tạo biến đổi liên tục (dùng nhiều loại, xen kẽ):**

1. **CẮT SCENE NHỎ** — cách mạnh nhất. Đổi ý/cảm xúc → scene mới với layout + background khác. Ưu tiên nhiều scene ngắn 8-15s hơn 1 scene dài.

2. **ĐỔI TƯ THẾ MÈO trong scene** (dùng \`emphasize\` + phase transition với \`clearPrevious\`):
   - Mèo \`cat_think\` (đang nghe) → sau vài giây → \`cat_talk\`/\`cat_explain\` (đang nói) → \`cat_surprised\` (bất ngờ).
   - Đặt 2-3 entity cùng assetId khác pose, mỗi cái enterDelay cách nhau + clearPrevious cái trước.
   *(Lưu ý: hệ thống cũng TỰ động thêm micro pose-swap + bounce cho mèo ở các đoạn hold dài — nhưng bạn tự chọn pose khớp narration thì tốt hơn.)*

3. **BONG BÓNG THOẠI xuất hiện/biến mất** (\`speechBubble\` hoặc CALLOUT có duration ngắn) — mỗi câu thoại 1 bong bóng, hết câu thì biến, câu sau bong bóng mới.

4. **ICON POP-IN theo lời dẫn** — khi narration nhắc tới "tiền/nhà/thời gian" → icon tương ứng popIn đúng lúc đó (enterDelay khớp câu), rồi exit khi qua ý.

5. **MŨI TÊN NỐI nhân quả** — "X dẫn đến Y": đặt asset X (trái) + \`ui/arrow_up\` hoặc arrow (giữa) + asset Y (phải), stagger xuất hiện. Giống video mẫu: mèo → mũi tên → icon like.

6. **EMPHASIZE nhịp nhàng** — nhân vật đang nói thì \`emphasize: pulse/bounce\` mỗi 4-6s để "sống".

7. **STAGGER + MOVE** — entity trượt vào (slideLeft/Right), icon pop lần lượt, asset di chuyển tới vị trí mới (\`move\`) thay vì đứng im.

8. **ĐỔI CON SỐ / TEXT** — trong STAT scene, số đếm tăng dần (emphasize counter) hoặc text cũ exit → text mới enter cùng vị trí.

**QUY TẮC VÀNG:** Với scene bất kỳ > 8 giây, phải có ≥1 sự kiện (pose swap / bubble / icon / emphasize / move) mỗi 4-8 giây. Nếu bạn không tự thêm, engine sẽ tự thêm emphasize + pose-swap — nhưng đừng ỷ lại, hãy chủ động tạo biến đổi khớp nội dung.

---

## QUY TẮC BẮT BUỘC — SHOW DON'T TELL (từ phân tích video thật)

### QUY TẮC 0 — HÌNH ẢNH PHẢI MATCH TRANSCRIPT (nền tảng của mọi quy tắc)
Trước khi chọn bất cứ thứ gì (layout, background, pose, text), hãy hỏi: **tone và bối cảnh của đoạn transcript này là gì?**

\`\`\`
Transcript buồn / đáng lo ngại   → background tối + cat_sad + nhạc nhẹ
Transcript tích cực / giải pháp  → background ấm + cat_happy
Transcript đặt câu hỏi / phân vân → cat_shrug / cat_think + nền trung tính
Transcript reveal bất ngờ         → cat_surprised + flash transition + dark bg
Transcript kể bối cảnh gia đình   → phòng khách ấm + 2 mèo cạnh nhau
Transcript giải thích khái niệm khó → nền TRẮNG + ít text + 1 icon chính giữa
\`\`\`

### QUY TẮC 1 — BACKGROUND THEO BỐI CẢNH, KHÔNG THEO ĐỒNG HỒ
Background thay đổi khi **bối cảnh câu chuyện thay đổi** — không phải sau mỗi N giây.
Giữ nguyên background khi narration vẫn ở cùng 1 không gian, dù kéo dài 1 phút.

Khi nào dùng nền trắng \`"#FFFFFF"\` (hợp lệ và đúng):
- Màn hình có 3+ assets cùng lúc (ICON_TRIPLE, QA_REVEAL) → trắng để không rối
- Kiến thức khó, cần tập trung tối đa → loại bỏ mọi distraction visual
- SIZE_HIERARCHY so sánh to/nhỏ → trắng để tương quan kích thước rõ ràng

Bảng background theo bối cảnh:
\`\`\`
"hẹn hò / cạnh tranh"   → "linear-gradient(180deg, #2C1810 0%, #4A2C1A 100%)"
"gia đình / so sánh"    → "linear-gradient(180deg, #FFF3E0 0%, #FFE0B2 100%)"
"thời cổ đại / gốc rễ"  → "linear-gradient(180deg, #1A1A1A 0%, #2D1B00 50%, #1A1A1A 100%)"
"kinh tế / xã hội"      → "linear-gradient(180deg, #0A0E27 0%, #1A237E 50%, #0D1B4A 100%)"
"số liệu drama"         → "linear-gradient(160deg, #0d0d1a 0%, #1a0a0a 100%)"
"3+ icons / khái niệm khó" → "#FFFFFF"
"tự nhiên / gốc rễ"    → "linear-gradient(180deg, #87CEEB 0%, #81C784 50%, #66BB6A 100%)"
"hy vọng / kết luận"   → "linear-gradient(160deg, #E8F5E9 0%, #F3E5F5 100%)"
\`\`\`

**⭐ BẢNG MAP ẢNH DƯỚI ĐÂY DÙNG CHO 8–12% "CÚ ĐẤM" ẢNH THẬT/VIDEO Ở VIDEO DÀI (xem mục BACKGROUNDS V4)** —
khi beat là evidence hoặc emotional beat có bối cảnh không gian khớp trực tiếp narration.
KHÔNG dùng bảng này để dán ảnh cho mọi scene có bối cảnh — scene kể chuyện thường vẫn là nền trắng/sáng.
Compiler TỰ blur nhẹ + phủ scrim, TỰ đổi text sang trắng. Khi dùng ảnh, đặt **mèo ở y=0.72 (đứng dưới)** hoặc bỏ mèo.
\`\`\`
"gia đình / bữa ăn / hẹn hò ăn tối" → "backgrounds/family_dinner.jpg" | "backgrounds/restaurant.jpg"
"quán cà phê / tâm sự"              → "backgrounds/coffee_shop.jpg"
"ngân hàng / tài chính"             → "backgrounds/bank_interior.jpg" | "backgrounds/finance_desk.jpg"
"văn phòng / công sở / đi làm"      → "backgrounds/office_01.jpg" | "backgrounds/meeting_room.jpg"
"chứng khoán / giao dịch"           → "backgrounds/office_trading.jpg" | "backgrounds/stock_chart.jpg"
"đếm tiền / lương / chi tiêu"       → "backgrounds/money_counting.jpg"
"trường học / lớp học / giáo dục"   → "backgrounds/classroom.jpg" | "backgrounds/school_hallway.jpg"
"đọc sách / học ở nhà / nghiên cứu" → "backgrounds/home_study.jpg" | "backgrounds/library.jpg"
"phòng khách / ở nhà / gia đình"    → "backgrounds/living_room.jpg" | "backgrounds/kitchen.jpg"
"chợ / mua sắm / siêu thị"          → "backgrounds/street_market.jpg" | "backgrounds/supermarket.jpg"
"thành phố / đô thị / kinh tế"      → "backgrounds/city_street.jpg" | "backgrounds/city_skyline.jpg"
"nhà cửa / bất động sản"            → "backgrounds/real_estate.jpg" | "backgrounds/apartment.jpg"
"nông thôn / quê / đồng quê"        → "backgrounds/countryside.jpg"
"bình minh / hy vọng / khởi đầu"    → "backgrounds/sunrise.jpg"
"bệnh viện / y tế"                  → "backgrounds/hospital.jpg"
"gym / sức khỏe / rèn luyện"        → "backgrounds/gym.jpg"
"sân bay / du lịch / di cư"         → "backgrounds/airport.jpg"
"nhà máy / sản xuất / lao động"     → "backgrounds/factory.jpg" | "backgrounds/construction.jpg"
\`\`\`
*Danh sách đầy đủ trong public/backgrounds/. Nếu không khớp bối cảnh nào → dùng gradient ở bảng trên.*
*Override mặc định nếu cần:* \`scene.backgroundBlur\` (px) và \`scene.backgroundOverlay\` (vd "rgba(0,0,0,0.4)").

### QUY TẮC 2 — TRẦN 12 TỪ TRÊN MÀN HÌNH
Video thật tối đa ~12 từ hiển thị cùng lúc. Text thừa = mèo đang lecture, không phải kể chuyện.

\`\`\`
❌ SAI: TITLE (10 từ) + CALLOUT (8 từ) + BODY (15 từ) = 33 từ cùng lúc
✅ ĐÚNG: Chỉ CALLOUT ngắn HOẶC chỉ BODY ngắn — không bao giờ cả hai
✅ ĐÚNG: BODY tối đa 10 từ. CALLOUT tối đa 6 từ.
\`\`\`

**Rule đơn giản:** Nếu icon/tư thế mèo đã nói được ý đó — BỎ text đi.

### QUY TẮC 3 — ICON XUẤT HIỆN SAU CÂU HỎI, KHÔNG PHẢI TRƯỚC
Pattern QA_REVEAL chuẩn từ video thật:
\`\`\`
Frame 0:   3 vòng tròn "?" hiển thị (suspense)
Frame 30:  Narration: "Ai đang chơi?" → icon mèo thay thế dấu ? đầu tiên
Frame 60:  Narration: "Luật là gì?" → icon cuộn giấy thay thế dấu ? thứ hai
Frame 90:  Narration: "Phần thưởng là gì?" → icon hộp quà thay thế dấu ? thứ ba
\`\`\`
Không hiện icon trước khi narration đặt câu hỏi. Người xem phải *tự điền* trước khi được trả lời.

### QUY TẮC 4 — MỘT ICON = MỘT Ý, TỰ GIẢI THÍCH ĐƯỢC
\`\`\`
✅ Icon trái tim GIỮA 2 nhân vật = "họ thích nhau" (không cần caption)
✅ Dấu X đỏ ĐÈ LÊN asset = "bị từ chối / thất bại" (không cần caption)
✅ Giọt nước mắt TRÊN MẶT mèo = "buồn" (không cần caption)
❌ Icon lịch với caption "Thời gian lâu dài" = icon trang trí, không phải storytelling
\`\`\`
Nếu cần caption để hiểu icon → sai icon, hoặc vẽ lại icon rõ hơn.

### QUY TẮC 5 — TƯ THẾ MÈO = ĐỘNG TỪ CẢM XÚC
Chọn pose variant khớp với trạng thái cảm xúc của moment. KHÔNG dùng \`cat\` (neutral) cho tất cả.

\`\`\`
Đang giải thích / dẫn dắt  → cat_explain  (chỉ tay phải)
Đặt câu hỏi / phân vân     → cat_think    (tay chạm cằm)
Đang nói trong dialogue     → cat_talk     (miệng mở)
Số liệu bất ngờ / plot twist → cat_surprised (mắt to)
Kết quả tốt / CTA           → cat_happy    (tay giơ cao)
Bad news / vấn đề nghiêm trọng → cat_sad  (tay buông, mắt rủ)
Câu hỏi chưa có đáp án      → cat_shrug   (tay dang rộng)
Nhấn mạnh entity bên trái   → cat_point_left
\`\`\`

### QUY TẮC 6 — PROP PHẢI CÓ TƯƠNG TÁC
Nhân vật phải *đang làm gì đó* với prop — nhìn vào, chỉ vào, cầm. Prop không phải đồ trang trí nổi trôi.

\`\`\`
✅ cat_explain (x=0.35) nhìn sang phải + marshmallow (x=0.65) → rõ ràng mèo đang chú ý vào kẹo
✅ cat_think (x=0.40) + laptop prop (x=0.65) → mèo đang nghiên cứu
❌ cat neutral center + random icon góc phải → không rõ quan hệ
\`\`\`

### QUY TẮC 7 — DIALOGUE: NGƯỜI XEM LÀ OBSERVER, KHÔNG PHẢI HỌC SINH
2 mèo nói chuyện với nhau → người xem nghe lén và học. Mèo KHÔNG nhìn thẳng vào camera giải thích.

\`\`\`
✅ Mèo A (cat_talk, x=0.28) hỏi → Mèo B (cat_think, x=0.72) trả lời qua speech bubble
✅ Mèo A (x=0.28, chỉ tay phải) → icon xuất hiện bên phải (x=0.72)
❌ Mèo A nhìn camera + BODY text giải thích dài → lecture mode
\`\`\`

### QUY TẮC 8 — THAY ĐỔI VISUAL MỖI 8–12 GIÂY
Video thật luôn có thứ gì đó thay đổi mỗi 5–10s. Mỗi scene stage cần ít nhất 1 sự kiện visual mỗi 240–360 frames.

\`\`\`
Dùng emphasize: { delay: 240, animation: "bounce" }  → nhân vật phản ứng với narration
Stagger entities: enterDelay: 0, 15, 30  → icons xuất hiện lần lượt không đồng loạt
Thêm text mới sau 8–12s  → thay BODY cũ bằng BODY mới thay vì giữ nguyên
\`\`\`

### QUY TẮC 9 — HOLD STATE & CLEAR
Assets KHÔNG tự biến mất giữa scenes — giữ nguyên trừ khi dùng \`clearPrevious\`.
- \`clearPrevious: true\` → xóa TOÀN BỘ canvas, bắt đầu scene mới sạch (luôn được tôn trọng).
- \`clearPrevious: ["id1","id2"]\` → chỉ xóa asset chỉ định.
⚠️ **Mỗi scene đổi bối cảnh PHẢI set \`clearPrevious: true\`** — nếu không, mèo của scene
trước sẽ còn trên màn hình và CHỒNG LÊN nhân vật mới (lỗi nhiều mèo đè nhau đã gặp).
Chỉ bỏ \`clearPrevious\` khi cố ý giữ nhân vật cũ qua scene mới (continuity).

### QUY TẮC 10 — CAMERA: GẦN NHƯ KHÔNG ZOOM
Assets di chuyển, camera đứng yên. Tối đa 1 ZOOM_IN/video (max 1.15x). PAN_LR chỉ ở DUAL_CONTRAST.

### QUY TẮC 11 — TIMING: ASSET ENTER TRƯỚC NARRATION
- 1 từ tiếng Việt ≈ 7 frames (130 từ/phút)
- Asset ENTER **12–15 frames trước** khi voice nhắc đến nó
- Mỗi scene 15–30 giây = 450–900 frames durationFrames

### QUY TẮC 11b — DURATION LOCKING (quan trọng khi dùng TTS pipeline)
\`durationFrames\` của mỗi scene **KHÔNG ĐƯỢC ĐOÁN** khi pipeline có audio thực tế.

**Pipeline chuẩn (--tts flag):**
1. AI generate timeline với \`narration\` đầy đủ trong mỗi scene
2. Pipeline extract narration → Kokoro/Edge TTS → đo duration thực tế
3. Pipeline **patch** lại \`durationFrames\` = actual TTS clip duration × 30fps
4. \`durationInFrames\` total = tổng tất cả scenes

**Khi bạn estimate (không có --tts):**
- 1 từ tiếng Việt ≈ 7 frames (130 từ/phút)
- 1 từ tiếng Anh ≈ 5 frames (160 từ/phút)
- Đếm số từ trong \`narration\` → estimate frames
- Scene có 30 từ tiếng Việt → ~210 frames (7s) tối thiểu

**LUÔN viết \`narration\` đầy đủ cho mỗi scene** — đây là nguồn để TTS generate audio.
Narration = đúng lời voice-over sẽ đọc, không phải mô tả visual.

### QUY TẮC 12 — SCALE: NHÂN VẬT PHẢI TO, LẤP ĐẦY MÀN HÌNH
Video gốc: mèo chiếm ~40-50% chiều cao frame, KHÔNG phải icon nhỏ trôi giữa khoảng trắng.
**NÊN để trống \`scale\`** → SceneCompiler tự áp auto-scale to (đã chuẩn theo refer):
\`\`\`
SOLO/CLOSE_UP: 3.0  |  QA_REVEAL: 2.8  |  STAT_DRAMA/CTA: 2.4  |  DIALOGUE: 2.3
CHAR_PROP: 2.6/2.0  |  SIZE_HIERARCHY: 3.2/1.6  |  LINEUP: 1.5  |  ICON_TRIPLE: 1.4
\`\`\`
Chỉ override \`scale\` khi thật sự cần. Nhân vật chính KHÔNG BAO GIỜ < 2.0 (trừ icon trong ICON_TRIPLE/LINEUP).

---

## BẢNG MAPPING: NARRATION → ASSET (SHOW DON'T TELL)

| Khi nói về... | Dùng asset này | KHÔNG dùng text |
|---|---|---|
| "hẹn hò / tình cảm" | 2 mèo + heart icon GIỮA họ | "họ thích nhau" |
| "nhà giàu có lợi thế" | cat_business scale lớn + house icon | "nhà giàu có lợi thế" |
| "người nghèo khó khăn" | cat_sad scale nhỏ hơn + cúi xuống | "người nghèo khó khăn" |
| "quy tắc / chính sách" | scroll/paper icon trong vòng tròn | "quy tắc là..." |
| "phần thưởng / lợi ích" | gift box hoặc trophy icon (reveal sau câu hỏi) | "phần thưởng là..." |
| "thời gian dài / lâu dài" | calendar + nhiều tờ rời | "mấy chục năm" |
| "sai lầm / từ chối" | ❌ icon đỏ ĐÈ LÊN asset bị từ chối | "điều này sai" |
| "buồn / lo lắng" | cat_sad + optional teardrop asset | "điều này rất buồn" |
| "không biết / câu hỏi ngỏ" | cat_shrug + 3 vòng tròn ? | "chúng ta không biết" |
| "đang nghiên cứu / tìm hiểu" | cat_think + laptop prop (mèo nhìn vào laptop) | "đang nghiên cứu" |
| "xã hội / nhiều loại người" | LINEUP 4+ mèo + label dưới | text mô tả nhóm người |
| "cạnh tranh / ranking" | mèo có số trên người (dùng LINEUP) | "vị trí thứ X" |
| "3 khái niệm song song" | ICON_TRIPLE với stagger reveal | bullet points text |
| "nhân quả / liên kết" | 2 asset + arrow icon GIỮA họ | "vì vậy / dẫn đến" |
| "thành công / chiến thắng" | trophy popIn + cat_happy | "thành công" |
| "gravity / nghiêm trọng" | dark backgroundSrc + cat_surprised | bold text |

---

## CẤU TRÚC VIDEO CHUẨN (V4 — khớp NGÔN NGỮ ĐIỆN ẢNH mục 2: 3 hồi, climax 60-75%)

\`\`\`
0–5%    COLD OPEN: SOLO — nền SÁNG, câu hỏi/số shock nhất làm TITLE (không fadeBlack)
5–25%   HỒI 1:    Evidence paperCard (cú đấm ảnh 1) + DIALOGUE giới thiệu vấn đề
                  Background: trắng/sáng mặc định
25–60%  HỒI 2:    QA_REVEAL / ICON_TRIPLE / DUAL_CONTRAST — mỗi scene lật 1 góc nhìn mới
                  Background: trắng; xen 1 cú đấm ảnh nếu beat cần (emotional/bối cảnh)
60–75%  CLIMAX:   STAT_DRAMA — cat exit, số liệu lớn + khoảng thở 1.5-2s sau reveal
                  Background: dark gradient (chỗ DUY NHẤT nên tối), text trắng
75–90%  HỒI 3:    DIALOGUE hoặc SIZE_HIERARCHY — giải pháp/insight
                  Background: sáng ấm trở lại (montage tương phản sau climax tối)
90–100% CTA:      SOLO — cat quay lại + callback prop của cold open (Chekhov's gun)
                  Background: warm gradient hoặc "#FAFAF8"
\`\`\`

---

## VÍ DỤ HOÀN CHỈNH

\`\`\`json
{
  "fps": 30,
  "width": 1920,
  "height": 1080,
  "durationInFrames": 2250,
  "background": "#FAFAF8",
  "scenes": [
    {
      "id": "intro",
      "label": "Cold open — câu hỏi đau nhất, nền sáng, mèo to",
      "startFrame": 0,
      "durationFrames": 210,
      "layout": "SOLO",
      "backgroundSrc": "linear-gradient(135deg, #FFF9F0 0%, #FDE8D0 100%)",
      "narration": "Tại sao người Hàn Quốc không chịu đẻ dù nhà nước cho tiền tỷ?",
      "entities": [
        {
          "assetId": "cat",
          "src": "characters/cat_shrug",
          "position": { "x": 0.50, "y": 0.52 },
          "enterAnimation": "popIn",
          "animationDuration": 20,
          "emphasize": { "animation": "bounce", "delay": 80, "duration": 25 }
        }
      ],
      "texts": [
        {
          "id": "title_hook",
          "content": "Cho 1 tỷ vẫn không chịu đẻ?",
          "style": "TITLE",
          "slot": "TOP_TITLE",
          "delay": 15,
          "duration": 120
        }
      ],
      "clearPrevious": false
    },
    {
      "id": "evidence_policy",
      "label": "Cú đấm 1 — card bằng chứng chính sách (không mèo che)",
      "startFrame": 210,
      "durationFrames": 240,
      "layout": "SOLO",
      "backgroundSrc": "#FFFFFF",
      "narration": "Hàn Quốc cho 40 triệu mỗi con. Hungary miễn thuế cả đời cho mẹ sinh 4 con.",
      "entities": [],
      "paperCards": [
        {
          "id": "ev1",
          "variant": "evidence",
          "body": "Hàn Quốc: trợ cấp 1 triệu won/tháng cho trẻ 0-11 tháng. Hungary: phụ nữ sinh 4 con được miễn thuế thu nhập suốt đời.",
          "delay": 10
        }
      ],
      "texts": [],
      "transition": { "style": "wipe", "duration": 15 },
      "clearPrevious": true
    },
    {
      "id": "dialogue_setup",
      "label": "2 mèo Q&A trên nền sáng — pose khớp cảm xúc, scale để trống",
      "startFrame": 450,
      "durationFrames": 330,
      "layout": "DIALOGUE",
      "backgroundSrc": "#FAFAF8",
      "narration": "Bạn bè: Ủa sao không đẻ? Mèo: Vì chi phí nuôi con quá cao, mà lương thì không tăng",
      "entities": [
        {
          "assetId": "cat_a",
          "src": "characters/cat_talk",
          "position": { "x": 0.28, "y": 0.52 },
          "enterAnimation": "slideRight",
          "animationDuration": 18,
          "emphasize": { "animation": "pulse", "delay": 30, "duration": 20 }
        },
        {
          "assetId": "cat_b",
          "src": "characters/cat_sad",
          "position": { "x": 0.72, "y": 0.52 },
          "enterAnimation": "slideLeft",
          "enterDelay": 15,
          "animationDuration": 18,
          "emphasize": { "animation": "pulse", "delay": 120, "duration": 20 }
        }
      ],
      "texts": [
        {
          "id": "speech_a",
          "content": "Ủa sao không đẻ?",
          "style": "CALLOUT",
          "slot": "CALLOUT_LEFT",
          "background": "#2D9CDB",
          "delay": 40,
          "duration": 80
        },
        {
          "id": "speech_b",
          "content": "Nuôi con quá đắt!",
          "style": "CALLOUT",
          "slot": "CALLOUT_RIGHT",
          "background": "#EB5757",
          "delay": 130,
          "duration": 100
        }
      ],
      "transition": { "style": "wipe", "duration": 15 },
      "clearPrevious": true
    }
  ]
}
\`\`\`

**Vì sao ví dụ này chuẩn V4:** mở màn SÁNG + title ngắn (cold open, không fadeBlack); bằng chứng là scene RIÊNG có chủ đích (paperCard, không mèo che, không text thừa); dialogue trên nền sáng với pose khớp cảm xúc từng bên (cat_talk hỏi / cat_sad than); \`scale\` để trống cho compiler auto-set to; mọi text có \`duration\`; không BODY lặp narration (phụ đề tự sinh từ narration).

---

## OUTPUT RULES (V4)

0. **TIẾNG VIỆT ĐẦY ĐỦ DẤU** — TẤT CẢ text content PHẢI dùng tiếng Việt có dấu đầy đủ. TUYỆT ĐỐI không dùng ASCII không dấu. Ví dụ: "Người chơi" ✅ — "Nguoi choi" ❌ | "Lý thuyết" ✅ — "Ly thuyet" ❌
1. Trả về **ONLY JSON thuần túy** — không markdown, không giải thích
2. \`durationInFrames\` = ${totalFrames}
3. \`startFrame\` scene đầu = 0. Kế tiếp nối liền: startFrame = prev.startFrame + prev.durationFrames
4. Tổng durationFrames tất cả scenes = ${totalFrames}
5. Chỉ dùng \`src\` có trong danh sách assets
6. \`id\` của scene, assetId, text.id phải UNIQUE toàn timeline
7. Tối thiểu ${Math.ceil(durationSeconds / 20)} scenes
8. Mỗi scene: ít nhất 1 entity + \`backgroundSrc\` — **BẮT BUỘC có backgroundSrc mỗi scene**
9. **BACKGROUND V4 — TRẮNG MẶC ĐỊNH, ẢNH LÀ CÚ ĐẤM:** Đa số scene dùng nền trắng/sáng ("#FFFFFF", "#FAFAF8", gradient sáng) + nhân vật TO. Video dài trên 3 phút phải dùng ảnh thật (\`backgrounds/*.jpg\`) ở **8–12% số scene**, phân bố ít nhất một lần mỗi 30–45 giây; mỗi ảnh phải là evidence hoặc emotional beat khớp trực tiếp narration, không dùng cùng ảnh quá 2 lần. Khi dùng ảnh, mèo đứng y=0.70–0.78 hoặc vắng mặt, KHÔNG che chủ thể ảnh. Mèo to đè giữa ảnh mờ = FAIL.
10. **LAYOUT VARIETY:** Ít nhất 5 layout khác nhau
11. **DIALOGUE FIRST:** Giải thích quan trọng → DIALOGUE với 2 nhân vật, speech bubble, không BODY text dài
12. **CAMERA MINIMAL:** Tối đa 1 ZOOM_IN/video, zoom max 1.15
13. **TRẦN 12 TỪ:** Tổng số từ hiển thị cùng lúc ≤ 12 từ. CALLOUT ≤ 6 từ. BODY ≤ 10 từ.
13b. **KHÔNG ĐÈ TEXT — 1 TEXT/DẢI Y:** TUYỆT ĐỐI không để 2 text hiển thị CÙNG LÚC trong cùng 1 dải y.
    - Dải TOP (y 0.08-0.30): chỉ 1 TITLE/SECTION/STAT HOẶC tối đa 2 CALLOUT NGẮN ở 2 cực x (x≤0.30 và x≥0.70), mỗi cái ≤ 4 từ.
    - Dải BODY (y 0.80-0.93): CHỈ 1 BODY hoặc 1 CAPTION tại 1 thời điểm. Khi cần câu mới → set exitFrame câu cũ = delay câu mới.
    - 3 label ICON_TRIPLE (y 0.62) ở x=0.22/0.50/0.78 phải NGẮN (≤ 3 từ) để không tràn ngang đè nhau.
    - Khi chuyển ý trong cùng scene: PHẢI exit text cũ TRƯỚC khi enter text mới cùng vùng — không chồng.
14. **KHÔNG TEXT KHI ICON ĐÃ NÓI:** Nếu icon/pose đã thể hiện được ý — bỏ text đi
15. **STAGGER ENTRIES:** Entities stagger 12-20 frames, không enter đồng loạt
16. **POSE MATCH EMOTION:** Mỗi scene chọn đúng cat pose variant theo cảm xúc — KHÔNG dùng \`cat\` neutral cho tất cả
17. **VISUAL RHYTHM:** Mỗi 240–360 frames phải có ít nhất 1 visual event (enter/emphasize/text change)
18. **PROP INTERACTION:** Khi dùng prop, đặt nhân vật ở góc nhìn vào prop (cat x=0.35 + prop x=0.65)
19. **EXITFRAME BẮT BUỘC:** Mọi text PHẢI có \`duration\` (số frames hiển thị tính từ delay). Text không có duration = tồn tại đến cuối scene — thường gây rối. Khi 2 text dùng cùng vùng (cùng dải y), text trước PHẢI exit (hết duration) TRƯỚC HOẶC ĐÚNG LÚC text sau xuất hiện. Engine sẽ tự xóa text cũ nếu bị đè, nhưng đừng dựa vào đó — set duration đúng ngay từ đầu.
20. **PROPS THAY TEXT:** Khi có prop phù hợp, dùng prop thay text. "Tiết kiệm" → props/piggy_bank. "Thời gian" → props/hourglass. "Nỗ lực" → props/muscle_arm. "Thành công" → props/trophy.
21. **COSTUME MATCH ROLE:** KHÔNG dùng \`characters/cat\` cho tất cả. Bố → cat_dad. Mẹ → cat_mom. Doanh nhân/giàu → cat_business. Trẻ em → cat_child_boy/girl. Giáo viên → cat_teacher. Công nhân → cat_worker.
22. **VISUAL METAPHOR:** Dùng icon/prop thể hiện ẩn dụ trực quan — house = "nền tảng gia đình", trophy = "phần thưởng", hourglass = "thời gian dài" — KHÔNG viết text giải thích ẩn dụ.
23. **NARRATION BẮT BUỘC MỖI SCENE:** Mỗi scene PHẢI có \`narration\` đầy đủ (lời voice-over sẽ đọc). Hệ thống tự tạo phụ đề từ đây. Scene thiếu narration = không có phụ đề = fail.
24. **PHỤ ĐỀ ĐÃ CÓ — ĐỪNG LẶP BẰNG BODY:** Vì narration hiện thành phụ đề đáy màn hình, TUYỆT ĐỐI không viết BODY text lặp lại nội dung narration. Overlay text chỉ cho: TITLE hook, keyword CALLOUT, con số STAT, label icon. Đa số scene chỉ cần 0-1 overlay text + phụ đề.
25. **KHÔNG EMOJI:** Không dùng emoji (🇰🇷 🎯 ⭐...) trong bất kỳ text content nào. Dùng chữ hoặc icon SVG thật.
26. **DÙNG COMPONENT ĐẶC TRƯNG:** Video dài (>3 phút) PHẢI dùng ít nhất 1-2 lần: \`paperCards\` variant "evidence" (dẫn chứng/trích số liệu chính sách) hoặc "survey" (câu hỏi khảo sát cho khán giả), và \`frameBoxes\` (bản đồ/biểu đồ trong khung TV) khi có dữ liệu địa lý/thống kê. Đây là device signature — đừng chỉ dùng text + mèo.
27. **NHÂN VẬT TO:** ĐỂ TRỐNG \`scale\` cho nhân vật chính (compiler tự set to). Nếu set thủ công: SOLO/CLOSE_UP ≥2.6, DIALOGUE ≥2.0, không bao giờ nhân vật chính < 1.6.`;
}

export function buildScriptFromIdea(idea: string): string {
  return `Bạn là scriptwriter chuyên nghiệp cho kênh "Mèo Giải Thích" — YouTube giải thích kinh tế, tài chính, xã hội cho người Việt theo phong cách thân thiện, dễ hiểu, có chiều sâu.

## Phong cách kênh
- Dùng ví dụ cụ thể, gần gũi đời thường (không dùng thuật ngữ học thuật khó)
- Có câu hook mạnh ở đầu (câu hỏi, nghịch lý, số liệu bất ngờ)
- Mỗi khái niệm được giải thích qua 1 hình ảnh/ví dụ dễ hình dung
- Kết bằng insight sâu sắc hoặc câu hỏi mở
- Giọng điệu: thân thiện như người bạn thông minh đang giải thích, không phải giảng viên

## Ý tưởng video: "${idea}"

## Yêu cầu output

Trả về JSON với format sau:

\`\`\`json
{
  "title": "Tiêu đề hấp dẫn (dưới 60 ký tự)",
  "hook": "Câu mở đầu gây tò mò (5-8 giây khi đọc)",
  "estimatedDurationSeconds": 75,
  "segments": [
    {
      "id": "intro",
      "label": "Hook & Câu hỏi",
      "startSec": 0,
      "endSec": 8,
      "script": "Text đọc trong segment này",
      "visualHint": "cat + title + hook question text",
      "layout": "INTRO",
      "keyAssets": ["characters/cat"],
      "keyStats": [],
      "keyCallouts": ["từ khóa quan trọng"]
    }
  ],
  "fullScript": "Toàn bộ script liên tục, giọng đọc tự nhiên, dài 60-90 giây khi đọc to",
  "suggestedAssets": ["characters/cat", "people/person", "finance/money"],
  "keyInsight": "Insight sâu sắc nhất của video (1 câu)",
  "ctaText": "Câu kêu gọi hành động (ngắn, dưới 12 từ)"
}
\`\`\`

Layouts cho segments:
- "INTRO" → Hook (cat + title)
- "SINGLE" → Single concept
- "COMPARE" → A vs B
- "CAUSE_EFFECT" → A dẫn đến B
- "CAUSE_EFFECT_CHAIN" → A → B → C
- "ACCUMULATION" → List nhiều items
- "STAT" → Con số drama
- "CONCLUSION" → Kết luận
- "CTA" → Call to action

Chỉ trả về JSON, không có gì khác.`;
}
