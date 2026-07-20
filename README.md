# Cat Explainer Video Generator

Generate professional 2D explainer videos in the style of "Mèo Giải Thích" channel.

**Pipeline:** Idea → Transcript → Timeline (JSON) → Remotion → MP4

---

## 📁 Project Organization

Each video gets its own folder:

```
projects/
├── video-001-marshmallow-test/
│   ├── idea.txt           # Original concept
│   ├── transcript.txt     # Script/narration
│   ├── timeline.json      # Events timeline (editable)
│   ├── output.mp4         # Final rendered video
│   └── metadata.json      # Project info & status
├── video-002-rich-vs-poor/
│   ├── ...
```

---

## 🚀 Quick Start

### Create a new video
```bash
npx ts-node scripts/new-project.ts --idea "Your topic"
```

### Generate timeline from transcript
```bash
npx ts-node scripts/generate-timeline.ts --transcript projects/<id>/transcript.txt --out projects/<id>/timeline.json
```

### Preview in Remotion Studio
```bash
npm start
# Open: http://localhost:3000
```

### Render to MP4
```bash
npx ts-node scripts/render.ts --timeline projects/<id>/timeline.json --out output/<id>.mp4
```

---

## 📚 Documentation

- **[CLAUDE.md](./CLAUDE.md)** — Full system rules (V4 director rules), commands, pipeline, scene patterns
- **[COPILOT.md](./COPILOT.md)** — Quick reference for Copilot integration

---

## 🎨 Assets Available

### 30 Backgrounds
office, family, city, classroom, etc.
```
public/backgrounds/office_01.jpg
public/backgrounds/family_dinner.jpg
...
```

### 10+ Cat Characters
```
characters/cat_business
characters/cat_police
characters/cat_teacher
characters/cat_mom
characters/cat_dad
characters/cat_child_school
...
```

### 15+ Props
```
props/marshmallow
props/brain
props/round_table
props/speech_bubble
props/concept_card
...
```

---

## 📝 Example Workflow

```bash
# 1. Create project
$ npx ts-node scripts/new-project.ts --idea "Marshmallow test"
✅ Created: projects/video-001-marshmallow-test/

# 2. Write transcript
$ vim projects/video-001-marshmallow-test/transcript.txt

# 3. Generate timeline
$ npx ts-node scripts/generate-timeline.ts --transcript projects/video-001-marshmallow-test/transcript.txt --out projects/video-001-marshmallow-test/timeline.json

# 4. Preview
$ npm start
# → http://localhost:3000 (edit timeline if needed)

# 5. Render
$ npx ts-node scripts/render.ts --timeline projects/video-001-marshmallow-test/timeline.json --out output/video-001-marshmallow-test.mp4
✅ Done: output/video-001-marshmallow-test.mp4
```

---

## ⚙️ Setup

```bash
# Install dependencies
npm install

# Set API key (for timeline generation)
export ANTHROPIC_API_KEY="sk-ant-..."
```

---

## 🎬 Video Features

### Basic Events
- `enter` — Add asset
- `exit` — Remove asset
- `move` — Smooth transition
- `emphasize` — Pulse/shake/bounce
- `camera` — Zoom & pan
- `text` — Text overlay (6 styles)
- `clear` — Clear canvas

### Enhanced Events (For richer videos)
- `background` — Real photo background
- `speechBubble` — Speech/thought bubbles
- `card` — Concept cards (colored boxes)
- `transition` — Flash/wipe/zoom effects

---

## 🎯 6 Critical Rules

1. **Hold State** — Assets stay unless removed (exit/clear)
2. **Position Grid** — x=0.25/0.5/0.75, y=0.35/0.55/0.72
3. **Timing** — 1 word ≈ 7 frames; enter 10-15 frames early
4. **Animation** — popIn/slideLeft/slideRight/zoomIn per meaning
5. **Camera** — Zoom 1.2-1.5, reset 1.0, duration 25-35 frames
6. **Scene** — 0-10% intro, 10-40% concept, 40-75% buildup, 75-90% climax, 90-100% CTA

---

## 🛠️ Commands Reference

```bash
# Project management
npx ts-node scripts/new-project.ts --idea "..."
npx ts-node scripts/new-project.ts --transcript "file.txt"
npx ts-node scripts/new-project.ts --url "https://youtube.com/watch?v=..."

# Timeline & Render (trỏ vào project qua path — KHÔNG có flag --project)
npx ts-node scripts/generate-timeline.ts --transcript projects/<id>/transcript.txt --out projects/<id>/timeline.json
npx ts-node scripts/render.ts --timeline projects/<id>/timeline.json --out output/<id>.mp4

# Studio
npm start

# Validation
npx tsc --noEmit
```

---

## 📊 Project Status Tracking

Each project's `metadata.json` tracks:
- Creation date
- Last updated
- Status: created → transcript_provided → timeline_generated → completed
- Timeline version
- Asset list
- Output size

---

## 🐛 Troubleshooting

| Problem | Solution |
|---------|----------|
| Asset not showing | Check asset path, run `npx ts-node scripts/list-assets.ts` |
| Timeline generation fails | Validate API key & transcript format |
| Render fails | Ensure `timeline.json` is valid, `/output` exists |
| TypeScript errors | Run `npx tsc --noEmit` |

---

## 📖 Learn More

Read **[CLAUDE.md](./CLAUDE.md)** for:
- V4 director's rules + scene layout patterns
- Text styling guide (preset styles)
- `projects/` folder convention
- Full command options
- Complete troubleshooting

---

**Made with ❤️ for efficient, scalable video creation**
