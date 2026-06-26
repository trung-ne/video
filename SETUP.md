# Setup Guide — Cat Explainer Video System

Hướng dẫn cài đặt project trên máy khác.

## 1. Yêu cầu hệ thống

- **Windows 11 Pro** hoặc tương tự (hoặc macOS/Linux với Node.js 18+)
- **Node.js 18+** (kiểm tra: `node -v`)
- **Python 3.11** hoặc **Python 3.14** (cần 3.11 cho Kokoro TTS)
- **Git** (kiểm tra: `git -v`)

---

## 2. Clone project

```bash
git clone <repo-url>
cd video
```

---

## 3. Cài Node.js dependencies

```bash
npm install
```

---

## 4. Cài Python packages

### 4a. Cài Edge TTS (nhanh, không cần GPU)

```bash
pip install edge-tts miniaudio soundfile
```

**Dùng khi:** cần tạo video tiếng Việt nhanh hoặc không có GPU.

### 4b. Cài Kokoro TTS (chất lượng cao, yêu cầu Python 3.11)

```bash
# Kiểm tra Python 3.11 đã cài chưa
py -0

# Nếu chưa, tải từ python.org:
# https://www.python.org/downloads/release/python-3119/
# → Cài với "Add Python to PATH" ✓

# Sau đó cài packages cho Python 3.11:
py -3.11 -m pip install torch --index-url https://download.pytorch.org/whl/cpu
py -3.11 -m pip install kokoro soundfile

# Tải spacy model (yêu cầu cho Kokoro):
py -3.11 -m pip install https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl --trusted-host github.com
```

**Dùng khi:** cần chất lượng âm thanh cao nhất, video tiếng Anh, và máy có GPU/RAM đủ.

---

## 5. Setup environment variables

### Anthropic API Key (bắt buộc để generate timeline với AI)

```bash
# Windows PowerShell:
$env:ANTHROPIC_API_KEY = "sk-ant-..."

# Windows CMD:
set ANTHROPIC_API_KEY=sk-ant-...

# macOS/Linux bash:
export ANTHROPIC_API_KEY="sk-ant-..."
```

Lấy key tại: https://console.anthropic.com

### Tùy chọn: Google Gemini key (fallback nếu Anthropic không khả dụng)

```bash
$env:AISTUDIO_API_KEY = "AIza..."
```

---

## 6. Kiểm tra setup

```bash
# TypeScript compile check
npx tsc --noEmit

# Xem danh sách assets có sẵn
npx ts-node scripts/list-assets.ts

# Test TTS (Edge)
python scripts/tts_edge.py --help

# Test TTS (Kokoro - nếu cài)
py -3.11 scripts/tts_kokoro.py --help
```

---

## 7. Test render

```bash
# Mở Remotion Studio (preview)
npm start
# → Truy cập http://localhost:3000

# Hoặc render video test
npx ts-node scripts/render.ts --timeline timeline.json --out output/test.mp4
```

---

## Troubleshooting

| Lỗi | Giải pháp |
|-----|----------|
| `ModuleNotFoundError: No module named 'edge_tts'` | `pip install edge-tts miniaudio` |
| `ModuleNotFoundError: No module named 'kokoro'` | `py -3.11 -m pip install kokoro torch` |
| `ANTHROPIC_API_KEY not found` | Set env var theo bước 5 |
| `ffprobe không tìm thấy` | Không bắt buộc. Timeline sẽ dùng duration estimate. |
| `Cannot find module '@anthropic-ai/sdk'` | `npm install` lại |

---

## Cấu trúc project

```
video/
├── src/                    # React + Remotion code
│   ├── Video.tsx          # Main render component
│   ├── engine/            # Timeline compiler
│   ├── ai/                # AI prompts & validation
│   └── components/        # AnimatedAsset, Text, PaperCard, etc.
├── scripts/
│   ├── generate-timeline.ts    # AI → timeline.json
│   ├── render.ts               # timeline.json → MP4
│   ├── tts_edge.py            # Edge TTS (Python)
│   └── tts_kokoro.py          # Kokoro TTS (Python 3.11)
├── public/
│   ├── assets/            # SVG icons (characters, finance, etc.)
│   ├── backgrounds/       # Real photo backgrounds
│   └── audio/             # Generated audio + voice.wav
├── timeline.json          # Active timeline (input for render)
├── CLAUDE.md              # Project rules & patterns
└── package.json
```

---

## Bước tiếp theo

→ Xem **WORKFLOW.md** để học quy trình làm video.
