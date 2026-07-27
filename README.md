# Cat Explainer Video Pipeline

Pipeline tạo video explainer 1920×1080 bằng storyboard semantic, asset nguyên bản,
TTS có forced alignment và Remotion.

```text
transcript
  -> global story map
  -> section scene plans
  -> semantic asset resolver
  -> natural-section TTS + word alignment
  -> deterministic SceneTimeline
  -> semantic quality gate
  -> Remotion render
  -> visual/audio/encoding audits
```

## Production workflow

```powershell
# Tạo project
npx ts-node scripts/new-project.ts --transcript .\transcript.txt --name my-topic

# Build lại manifest sau khi thêm asset
npm run build-assets

# Generate storyboard v2 + TTS + timeline
npm run generate -- --project video-004-my-topic --tts-kokoro

# Preview đúng project, không copy timeline về root
npm run preview:project -- --project video-004-my-topic

# Publish mặc định: pre-render gate -> proxy audit -> full render -> final audits
npm run publish -- --timeline projects/video-004-my-topic/timeline.json --out output/video-004-my-topic.mp4
```

Có thể truyền đường dẫn đầy đủ thay cho project ID:

```powershell
npm run generate -- --project projects/video-004-my-topic --tts
npm run publish -- --timeline projects/video-004-my-topic/timeline.json --out output/video.mp4
```

## Project artifacts

```text
projects/video-XXX-slug/
  project.json          versioned project manifest
  metadata.json         project status
  transcript.txt        narration source of truth
  story-map.json        global sections, claims and story arc
  storyboard.json       semantic storyboard v2
  asset-requests.json   unresolved generation queue, only when needed
  words.json            aligned words with stable transcript wordIndex
  audio-audit.json      LUFS and true-peak report
  timeline.json         authored SceneTimeline
```

MP4/WAV và generated logs không phải source code và không được commit.

## Required gates

- Transcript source-range coverage và checksum: 100%.
- Không unresolved asset, empty semantic focal point hoặc generic character pair.
- Flat/solid scenes: tối đa 50%, mục tiêu dưới 45%.
- Ít nhất 6 visual registers; không register nào quá 30%.
- Character chỉ xuất hiện tối đa 80% cảnh; không để một template shape quá 25%.
- Video dài cần ít nhất 20 pose/costume/action variant.
- Hero visual ít nhất mỗi 45 giây.
- Edge density `>=0.16`, saturation `>=0.15`, near-duplicate `<=22%`.
- Audio từ `-18` đến `-16 LUFS`, true peak `<=-1.5 dBTP`.
- H.264, 1920×1080, 30fps và encoding audit pass.

`--diagnostic`, `--skip-quality` và `--skip-visual-audit` chỉ dùng để chẩn đoán,
không tạo production artifact.

`render.ts` tạo media chẩn đoán; chỉ `publish.ts` mới chạy proxy trước và ghi
`production-report.json` với trạng thái `production-ready`. Audio có sẵn cũng
được audit/master tự động, không chỉ audio vừa sinh từ TTS.

## Assets

Asset được đọc từ `public/assets.manifest.json`, gồm SVG, PNG và JPG:

```powershell
npm run build-assets
npm run list-assets
npm run list-assets -- character
npm run list-assets -- --used projects/video-004-my-topic/timeline.json
```

Bộ PNG trong `public/generated-assets/characters/` là lead teal cat chính. Không
trộn character style legacy vào cùng scene/video production.

## Development checks

```powershell
npm run check
npm run quality -- projects/video-004-my-topic/timeline.json
npm run visual-audit -- --video output/video.mp4 --ffmpeg <ffmpeg-path>
```

Chi tiết kiến trúc và thứ tự triển khai:

- [Reference quality plan](docs/REFERENCE_QUALITY_PLAN.md)
- [Implementation plan](docs/REFERENCE_QUALITY_IMPLEMENTATION_PLAN.md)
- [V4 rendered-reference recovery](docs/V4_RENDERED_REFERENCE_RECOVERY_PLAN.md)

`src/ai/systemPrompt.ts` và direct-to-events pipeline là compatibility path cho
schema v1. Production mặc định dùng prompt modules trong `src/ai/prompts/`.
