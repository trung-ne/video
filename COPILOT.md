# Copilot Setup — Cat Explainer Video Generator

**This project uses a structured video generation system. See [CLAUDE-UPDATED.md](./CLAUDE-UPDATED.md) for full rules, commands, and workflows.**

## Quick Start

### 1. Create a new video project
```bash
npx ts-node scripts/new-project.ts --idea "Your video topic here"
```
Creates: `projects/video-XXX-your-topic/`

### 2. Generate timeline from transcript
```bash
npx ts-node scripts/generate-timeline.ts --project video-001
```

### 3. Preview in Remotion Studio
```bash
npm start
```
Then open http://localhost:3000

### 4. Render to MP4
```bash
npx ts-node scripts/render.ts --project video-001
```

---

## Project Structure

Each video gets its own folder:
```
projects/video-001-your-topic/
├── idea.txt            # Original idea
├── transcript.txt      # Script/transcript
├── timeline.json       # Generated timeline (editable)
├── output.mp4          # Rendered video
└── metadata.json       # Project metadata & status
```

---

## Available Assets

### 30 Backgrounds (public/backgrounds/)
office, family, city, classroom, etc. — use with `background` event type

### 10+ Cat Characters (public/assets/characters/)
cat, cat_business, cat_police, cat_teacher, cat_mom, cat_dad, cat_sunglasses, cat_worker, cat_child_school, cat_child_boy, cat_child_girl

### 15+ Props (public/assets/props/)
marshmallow, brain, muscle_arm, clover, round_table, dinner_table, computer_desk, speech_bubble, thought_bubble, photo_frame, concept_card, trophy, piggy_bank, hourglass, book, calendar

---

## Timeline Event Types

### Basic (Standard)
- `enter` — Add asset to canvas
- `exit` — Remove asset
- `move` — Smooth transition to new position
- `emphasize` — Pulse, shake, bounce, highlight
- `camera` — Zoom & pan
- `text` — Text overlay (6 styles: TITLE, STAT, CALLOUT, SECTION, BODY, CAPTION)
- `clear` — Clear assets

### Enhanced (For richer videos like the original)
- `background` — Real photo background (with blur option)
- `speechBubble` — Speech/thought bubble anchored to character
- `card` — Concept card (colored box with icon + label)
- `transition` — Flash/wipe/zoom between scenes

---

## 6 Critical Rules

1. **Hold State** — Assets don't disappear unless explicitly removed (exit/clear)
2. **Position Grid** — Use x=0.25/0.5/0.75, y=0.35/0.55/0.72 for consistency
3. **Timing** — 1 Vietnamese word ≈ 7 frames; assets enter 10-15 frames before voice
4. **Animation** — popIn/slideLeft/slideRight/zoomIn based on semantic meaning
5. **Camera** — Zoom 1.2-1.5 to focus, reset to 1.0 between topics
6. **Scene** — Structure: 0-10% intro, 10-40% concept, 40-75% buildup, 75-90% climax, 90-100% CTA

---

## Full Documentation

See **[CLAUDE-UPDATED.md](./CLAUDE-UPDATED.md)** for:
- Complete commands & options
- All 8 scene patterns
- Text styling guide (6 preset styles)
- Color palette
- Position reference grid
- Troubleshooting

---

## Example Workflow

```bash
# 1. Create project
npx ts-node scripts/new-project.ts --idea "Marshmallow test of Walter Mischel"

# Output: projects/video-001-marshmallow-test/ created

# 2. Edit transcript (if needed)
# vim projects/video-001-marshmallow-test/transcript.txt

# 3. Generate timeline
npx ts-node scripts/generate-timeline.ts --project video-001-marshmallow-test

# 4. Preview & edit
npm start  # http://localhost:3000 → scrub timeline, adjust as needed

# 5. Render to MP4
npx ts-node scripts/render.ts --project video-001-marshmallow-test

# Done! Video saved to: projects/video-001-marshmallow-test/output.mp4
```

---

## Using with Copilot

When working with Copilot:

1. **Create project** — Ask Copilot to help write transcript or idea
2. **Generate timeline** — Copilot can suggest scene patterns & asset usage
3. **Edit timeline** — Copilot can adjust timing, add camera moves, optimize pacing
4. **Analyze results** — Copilot can review and suggest improvements

Example Copilot prompts:
```
"I have a video about [topic]. Help me write a compelling 2-minute script."

"Generate a timeline using the marshmallow test assets (cat_child_*, props/marshmallow, round_table)"

"Add more emotional pacing to this timeline — more camera zooms and speech bubbles when characters interact"

"Check if this timeline follows the hold-state rule and scene structure pattern"
```

---

## Environment Setup

```bash
# Install dependencies (if not done)
npm install

# Set Anthropic API key (required for timeline generation)
$env:ANTHROPIC_API_KEY = "sk-ant-..."

# Or in .env file
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
```

---

## Troubleshooting

- **Project not created?** — Check `/projects` folder exists
- **Timeline generation fails?** — Validate API key & transcript format
- **Asset not showing?** — Verify asset path matches available SVGs (run `npx ts-node scripts/list-assets.ts`)
- **Video render fails?** — Ensure `timeline.json` is valid, check `/output` folder exists
- **TypeScript errors?** — Run `npx tsc --noEmit` for detailed errors

---

**Questions?** See [CLAUDE-UPDATED.md](./CLAUDE-UPDATED.md) for complete reference.
