# Cat Explainer Video System — Enhanced Project Rules

## Tổng quan

Hệ thống tạo video giải thích tài chính 2D phong cách "Mèo giải thích".
**Pipeline: Idea → Folder `/projects/video-XXX/` → Script → Transcript → Timeline → MP4**

Mục tiêu: Tạo hàng trăm video trong folder riêng, dễ quản lý, dễ tìm lại.

---

## Cấu trúc dự án (MỚI)

```
video/
├── src/                          # Remotion source (không thay đổi)
├── public/
│   ├── assets/                   # SVG library (dùng chung tất cả video)
│   ├── backgrounds/              # 30 ảnh nền (dùng chung)
│   └── audio/                    # Global audio files
├── scripts/
│   ├── new-project.ts            # ✨ TẠO FOLDER VIDEO MỚI
│   ├── generate-timeline.ts      # Generate timeline
│   └── render.ts                 # Render MP4
├── projects/                     # 📁 FOLDER TỪng VIDEO (MỚI)
│   ├── video-001-marshmallow-test/
│   │   ├── idea.txt              # Ý tưởng gốc
│   │   ├── transcript.txt        # Script/transcript
│   │   ├── timeline.json         # Generated timeline
│   │   ├── output.mp4            # Rendered video
│   │   └── metadata.json         # {idea, date, status, duration, assetList}
│   ├── video-002-rich-vs-poor/
│   │   ├── idea.txt
│   │   ├── transcript.txt
│   │   ├── timeline.json
│   │   ├── output.mp4
│   │   └── metadata.json
│   └── ...
├── timeline.json                 # Symlink to active project's timeline
├── CLAUDE.md                     # Original rules
└── CLAUDE-UPDATED.md             # File này
```

---

## Quick Commands (MỚI)

```bash
# 1. TẠO PROJECT MỚI
npx ts-node scripts/new-project.ts --idea "Chủ đề video"

# Hoặc chỉ định folder name
npx ts-node scripts/new-project.ts --idea "Marshmallow test" --name "marshmallow-test"

# 2. GENERATE TIMELINE (auto vào projects/video-XXX/)
npx ts-node scripts/generate-timeline.ts --project video-001 --transcript transcript.txt

# 3. RENDER MP4 (auto lấy timeline từ projects/video-XXX/)
npx ts-node scripts/render.ts --project video-001

# 4. PREVIEW (mở Studio để xem project đang active)
npm start

# 5. QUICK WORKFLOW (idea → script → timeline → MP4)
npx ts-node scripts/new-project.ts --idea "..." --auto
```

---

## Metadata.json Structure

Mỗi project có file `metadata.json`:

```json
{
  "id": "video-001",
  "name": "marshmallow-test",
  "idea": "Thí nghiệm marshmallow của Walter Mischel...",
  "createdAt": "2026-06-22T10:30:00Z",
  "updatedAt": "2026-06-22T11:45:00Z",
  "status": "completed",
  "durationSeconds": 180,
  "durationFrames": 5400,
  "assets": ["characters/cat", "props/marshmallow", "props/round_table"],
  "scriptSource": "idea",
  "transcriptLines": 45,
  "timelineVersion": 2,
  "outputPath": "projects/video-001/output.mp4",
  "outputSize": 52428800,
  "notes": "Thêm speech bubble cho mèo con ở phút 2:30"
}
```

---

## Project Workflow (Chi tiết)

### Step 1: Create Project
```bash
npx ts-node scripts/new-project.ts --idea "Tại sao người giàu khó vượt qua..."
```

**Output:**
```
✓ Created: projects/video-002-tai-sao-nguoi-giau-kho/
  ├── idea.txt (ghi ý tưởng)
  ├── metadata.json (status: "ideated")
  └── .gitkeep
```

### Step 2: Write Transcript
Edit `projects/video-002/transcript.txt`:
```
[0s-5s]
Mèo: "Bạn có bao giờ nghĩ tại sao người giàu lại khó vượt qua khó khăn không?"

[5s-15s]
Bởi vì... họ chưa bao giờ phải tập cách vượt qua nó!
```

Update metadata: `status: "transcript_written"`

### Step 3: Generate Timeline
```bash
npx ts-node scripts/generate-timeline.ts --project video-002
```

**Auto:**
- Đọc `projects/video-002/transcript.txt`
- Gọi Claude AI
- Lưu `projects/video-002/timeline.json`
- Update metadata: `status: "timeline_generated"`, `timelineVersion: 1`

### Step 4: Preview & Edit
```bash
npm start  # Opens Studio at http://localhost:3000
```

Edit timeline.json trực tiếp → metadata auto increment `timelineVersion`

### Step 5: Render
```bash
npx ts-node scripts/render.ts --project video-002
```

**Auto:**
- Đọc `projects/video-002/timeline.json`
- Render qua Remotion
- Lưu MP4: `projects/video-002/output.mp4`
- Update metadata: `status: "completed"`, `outputPath`, `outputSize`

---

## Các Loại Project Input (Choose 1)

### Mode A: From Idea
```bash
npx ts-node scripts/new-project.ts --idea "Nhà nghèo vượt khó hay người giàu?"
```
→ Tạo folder + idea.txt
→ Bạn tự viết transcript
→ Claude generate timeline từ transcript

### Mode B: From Transcript File
```bash
npx ts-node scripts/new-project.ts --transcript "path/to/transcript.txt"
```
→ Copy transcript vào project
→ Claude generate timeline

### Mode C: From YouTube URL
```bash
npx ts-node scripts/new-project.ts --url "https://youtu.be/DoZYFPvyHyQ"
```
→ Extract transcript qua youtube-transcript-api
→ Claude generate timeline

### Mode D: Full Auto (Idea → Timeline)
```bash
npx ts-node scripts/new-project.ts --idea "..." --auto
```
→ Claude viết script
→ Claude generate timeline
→ (Optional) Render MP4 luôn

---

## 6 RULES ANIMATION BẮT BUỘC

### RULE 1 — HOLD STATE (Quan trọng nhất!)
Assets KHÔNG tự biến mất giữa các scenes.
Khi thêm asset mới, assets cũ VẪN ở lại canvas.
Chỉ xóa bằng `ExitEvent` hoặc `ClearEvent`.

```
✅ ĐÚNG:  Fed xuất hiện frame 60 → Tiền xuất hiện frame 120 → cả 2 cùng hiện
❌ SAI:   Fed xuất hiện → mất đi → Tiền xuất hiện
```

### RULE 2 — POSITION GRID 3×3
```
(0.25, 0.35)  (0.5, 0.35)  (0.75, 0.35)   ← Hàng trên
(0.25, 0.55)  (0.5, 0.55)  (0.75, 0.55)   ← Hàng giữa
(0.25, 0.72)  (0.5, 0.72)  (0.75, 0.72)   ← Hàng dưới

Cat character: x=0.5, y=0.68 (cố định)
Title: x=0.5, y=0.10-0.14
Subtitle: x=0.5, y=0.88
```

### RULE 3 — TIMING (1 giây = 30 frames)
- Asset enter **trước** voice: 10-15 frames
- Emphasize trùng lúc voice nhấn mạnh
- Camera duration: 25-35 frames

### RULE 4 — ANIMATION CHOICE
```
Khái niệm mới        → popIn / slideUp
Nguyên nhân (trái)   → slideLeft
Hệ quả (phải)        → slideRight
Kết luận             → zoomIn
Mất nhẹ              → fadeOut
Mất nhanh            → popOut
```

### RULE 5 — CAMERA MOTION
- Zoom vào: 1.2–1.5
- Reset: 1.0 khi chuyển topic
- Không zoom > 1.8
- Duration: 25-35 frames

### RULE 6 — SCENE STRUCTURE
```
0-10%   Intro:    cat + title
10-40%  Concept:  asset chính
40-75%  Buildup:  tích lũy assets
75-90%  Climax:   zoom + emphasis
90-100% CTA:      kêu gọi hành động
```

---

## Asset Library (NEW: 30 backgrounds + 27 characters/props)

### Backgrounds (dùng chung)
`public/backgrounds/` — 30 ảnh Unsplash:
office_01, office_trading, meeting_room, bank_interior, family_dinner, living_room,
kitchen, classroom, library, street_market, city_street, supermarket, coffee_shop,
restaurant, gym, hospital, city_skyline, sunrise, countryside, apartment, construction,
real_estate, airport, factory, ...

### Characters (SVG)
- `characters/cat` — Mèo chính (8 phiên bản: cat_business, cat_police, cat_teacher, ...)
- `characters/cat_child_school`, `cat_child_boy`, `cat_child_girl`
- `characters/cat_mom`, `cat_dad`, `cat_sunglasses`, `cat_worker`

### Props (SVG)
- `props/marshmallow`, `brain`, `muscle_arm`, `clover`, `round_table`, `dinner_table`
- `props/computer_desk`, `speech_bubble`, `thought_bubble`, `photo_frame`
- `props/concept_card`, `trophy`, `piggy_bank`, `hourglass`, `book`, `calendar`

### UI
- `ui/arrow_up`, `arrow_down`, `flash_effect`, ...

---

## NEW Event Types (dùng để video giống video gốc)

### background — Ảnh thật làm nền
```json
{"frame": 60, "type": "background", "src": "backgrounds/office_01.jpg", "blur": 8, "duration": 20}
```

### speechBubble — Bong bóm thoại
```json
{"frame": 120, "type": "speechBubble", "bubbleId": "b1", "anchorAssetId": "dad_cat",
 "text": "Con học hành như thế này à?", "style": "speech", "direction": "right", "exitFrame": 200}
```

### card — Concept card (khung màu + icon)
```json
{"frame": 200, "type": "card", "cardId": "card1", "position": {"x": 0.25, "y": 0.45},
 "background": "#FFB3D1", "iconSrc": "props/marshmallow", "label": "Marshmallow"}
```

### transition — Flash/wipe chuyển cảnh
```json
{"frame": 300, "type": "transition", "style": "flash", "duration": 15}
```

---

## Skills / Slash Commands

### Claude Code Skills (trang chủ)
| Skill | Tác dụng |
|-------|---------|
| `/new-video` | Tạo project mới + tất cả folder |
| `/generate` | Generate timeline từ transcript |
| `/render` | Render MP4 từ timeline |
| `/preview` | Mở Remotion Studio |
| `/list-projects` | List tất cả projects |
| `/project-status <id>` | Xem metadata của project |
| `/edit-timeline` | Sửa timeline.json hiện tại |
| `/validate` | Validate timeline.json |

### Copilot Workflow (see copilot-export/)
- Same commands, nhưng context là cái folder projects

---

## Copilot Setup

Trong Copilot, dùng prompt này:

```
I'm working with a Cat Explainer Video Generator system.

PROJECT STRUCTURE:
- /projects/video-XXX/ contains each video's folder
- Each folder has: idea.txt, transcript.txt, timeline.json, output.mp4, metadata.json

COMMANDS:
1. Create project: npx ts-node scripts/new-project.ts --idea "..."
2. Generate timeline: npx ts-node scripts/generate-timeline.ts --project video-001
3. Render video: npx ts-node scripts/render.ts --project video-001

SVG ASSETS (in public/assets/):
- 30 backgrounds (office, family, city, etc.)
- 10+ cat characters (business, police, teacher, mom, dad, etc.)
- 15+ props (marshmallow, brain, table, cards, bubbles, etc.)

TIMELINE EVENTS:
- enter, exit, move, emphasize, camera, text, clear (basic)
- background, speechBubble, card, transition (new - for richer videos)

TEXT STYLES:
TITLE (72px, dark), STAT (120px, red), CALLOUT (pill with bg), 
SECTION (with bar), BODY (44px), CAPTION (30px, gray)

RULES:
1. Hold state — assets don't disappear unless exit/clear
2. Position grid — use x=0.25/0.5/0.75, y=0.35/0.55/0.72
3. Timing — 1 word ≈ 7 frames, asset enter 10-15 frames before voice
4. Animation — popIn/slideLeft/slideRight/zoomIn per semantic
5. Camera — zoom 1.2-1.5, reset 1.0, duration 25-35 frames
6. Scene structure — 0-10% intro, 10-40% concept, 40-75% buildup, 75-90% climax, 90-100% CTA

Help me create/edit video projects following these rules.
```

---

## Project Versioning & History

Mỗi khi generate timeline:
```
v1: Initial generation
v2: Edit + adjust timing
v3: Final render
```

Stored in `metadata.json` → `timelineVersion`

Optional: Git commit mỗi version
```bash
cd projects/video-001 && git add timeline.json && git commit -m "v2: fix timing at 2:30"
```

---

## Troubleshooting

| Vấn đề | Giải pháp |
|--------|----------|
| Project folder không tạo | Kiểm tra `/projects` dir tồn tại |
| Asset không hiện | Check `src` path đúng, run `npx ts-node scripts/list-assets.ts` |
| Transcript bị mất | Backup ở `projects/video-XXX/transcript.txt` — không delete |
| Timeline không generate | Validate transcript format, check Claude API key |
| Render fail | Kiểm tra `timeline.json` valid, output dir tồn tại |
| TypeScript error | Run `npx tsc --noEmit` |

---

## Example: Full Workflow (Marshmallow Test Video)

```bash
# 1. Create project
npx ts-node scripts/new-project.ts --idea "Marshmallow test của Walter Mischel chứng minh gì?"

# Output: projects/video-001-marshmallow-test/ tạo xong

# 2. Edit idea.txt (nếu cần)
# vi projects/video-001-marshmallow-test/idea.txt

# 3. Write transcript
# Bạn tự viết hoặc copy từ YouTube: projects/video-001-marshmallow-test/transcript.txt

# 4. Generate timeline
npx ts-node scripts/generate-timeline.ts --project video-001-marshmallow-test

# Output: projects/video-001-marshmallow-test/timeline.json được tạo

# 5. Preview
npm start  # http://localhost:3000 → scrub timeline, edit nếu cần

# 6. Render
npx ts-node scripts/render.ts --project video-001-marshmallow-test

# Output: projects/video-001-marshmallow-test/output.mp4 ✓ xong
```

Lúc này folder trông như:
```
projects/video-001-marshmallow-test/
├── idea.txt
├── transcript.txt
├── timeline.json (v3)
├── output.mp4 (52MB)
└── metadata.json (status: "completed")
```

---

## Next Steps

1. Run `npm install` (nếu chưa)
2. Tạo `/projects` folder: `mkdir projects`
3. Chạy lệnh đầu tiên: `npx ts-node scripts/new-project.ts --idea "..."`
4. Follow workflow trên

Mỗi video = 1 folder sạch sẽ, dễ quản lý, dễ tìm lại lâu sau.
