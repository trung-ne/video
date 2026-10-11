# Cat Explainer Video Pipeline

Hệ thống tạo video explainer 1920×1080:

```text
transcript → session-authored semantic storyboard → measured per-scene TTS/alignment
           → compiled timeline → Remotion → encoding/audio/visual audits → MP4
```

## Route A only

Production chỉ có Route A, không cần API key. Agent đọc toàn bộ transcript và viết
từng scene riêng trong `projects/<id>/storyboard-data.ts`; builder tạo
`storyboard.json`. `timeline.json` là artifact compile, không sửa trực tiếp.

Route B/API generation đã bị khóa. `npm run generate` và
`scripts/generate-timeline.ts` luôn thoát mã 2 trước khi tải provider, đọc
credential hoặc ghi artifact. `new-project.ts --auto` cũng không được dùng.

### Video ngắn

```powershell
npx ts-node scripts/new-project.ts --transcript <file> --name <slug>
# Viết projects/<id>/storyboard-data.ts
npm run build-storyboard -- --project <id>
npm run storyboard-to-tts -- --storyboard projects/<id>/storyboard.json
py -3.11 scripts/tts_edge.py --scenes projects/<id>/tts_scenes.json --outdir public/audio/<id> --manifest projects/<id>/durations.json --voice vi-VN-NamMinhNeural
py -3.11 scripts/align_words.py --wav public/audio/<id>/voice.wav --outdir projects/<id> --model small --lang vi --scenes projects/<id>/tts_scenes.json
npm run compile-storyboard -- --storyboard projects/<id>/storyboard.json --out projects/<id>/timeline.json --durations projects/<id>/durations.json --words projects/<id>/words.json --alignment projects/<id>/alignment.json --audio audio/<id>/voice.wav
```

### Video dài

Builder phải hoàn thành và kiểm toàn bộ storyboard trước khi chia chunk. Chunk chỉ
được suy ra từ `SECTIONS` nguyên vẹn; mỗi chunk phải pass tuần tự authoring → TTS →
alignment → compile → visual proof trước khi chunk kế tiếp được mở khóa.

```powershell
npm run build-storyboard -- --project <id>
npm run plan-chunks -- --project <id>
npm run process-chunks -- --project <id> --execute --voice vi-VN-NamMinhNeural --lang vi
npm run assemble-chunks -- --project <id> --execute
npm run render -- --project <id>
```

Proof timeline/MP4 gồm halo một scene để kiểm seam nhưng không được publish. Final
assembly chỉ dùng core audio/timing/timeline, nối ở ranh giới PCM chính xác, rồi vẫn
phải pass toàn bộ global gate và canonical render.

## Kiểm tra, preview và xuất bản

```powershell
npm run validate -- projects/<id>/timeline.json
npm run quality -- projects/<id>/timeline.json
npm run preview:project -- --project <id>
npm run render -- --project <id>
npm run publish -- --project <id>
```

`render` và `publish` kiểm lineage/hash, measured timing, schema, director quality,
spatial integrity, thời lượng MP4, encoding, loudness và visual audit. Mỗi run ghi
vào staging có lock; chỉ promote sang `output/<id>/` khi toàn bộ gate pass. Run lỗi
không thay đổi build production trước đó.

Các flag `--skip-*`, `--diagnostic*` và `--allow-unprovenanced-timing` chỉ dành cho
chẩn đoán. Artifact tạo với chúng không được publish.

## Artifact

```text
projects/<id>/
  transcript.txt
  storyboard-data.ts    # authored Route A source
  storyboard.json       # built semantic storyboard
  chunks/               # derived checkpoints/proofs for long videos
  tts_scenes.json
  durations.json
  words.json
  alignment.json
  timeline.json         # measured compiled artifact

output/<id>/
  video.mp4
  video.contact.jpg
  video.*-audit.json
  video.production-report.json
  .runs/                # rollback + diagnostics, ignored by Git
```

MP4, WAV, logs và run artifacts không phải source code và không được commit.
`output/imagegen/` là ngoại lệ có chủ đích cho asset generation.

## Quality gates

- Transcript/source coverage, semantic cadence và production assets hợp lệ.
- Timing provenance là `measured`; ID scene khớp storyboard/durations/alignment/timeline.
- Hash audio, storyboard, timing, chunk receipts và canonical assembly khớp.
- H.264, 1920×1080, 30fps; audio khoảng −18 đến −16 LUFS.
- Visual reference: flat ≤50%, edge density ≥0.16, saturation 0.15–0.205,
  global near-duplicate ≤22%, within-scene near-duplicate ≤15%.

Quy tắc đầy đủ và director policy nằm trong [CLAUDE.md](CLAUDE.md);
[AGENTS.md](AGENTS.md) là entry point bắt buộc cho agent.
