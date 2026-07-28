# Cat Explainer Video Pipeline

Hệ thống tạo video explainer 1920×1080:

```text
transcript → semantic storyboard → measured per-scene TTS + word alignment
           → compiled timeline → Remotion → encoding/audio/visual audits → MP4
```

`storyboard.json` là nguồn authored. `timeline.json` là artifact compile có
timing provenance; không sửa trực tiếp để xuất production.

## Hai route authoring

Route A dùng chính session agent, không cần API key:

```powershell
npm run build-storyboard -- --project <id>
npm run storyboard-to-tts -- --storyboard projects/<id>/storyboard.json
py -3.11 scripts/tts_kokoro.py --scenes projects/<id>/tts_scenes.json --outdir public/audio/<id>
py -3.11 scripts/align_words.py --wav public/audio/<id>/voice.wav --outdir projects/<id> --model small --lang en --transcript projects/<id>/transcript.txt
npm run compile-storyboard -- --storyboard projects/<id>/storyboard.json --out projects/<id>/timeline.json --durations projects/<id>/durations.json --words projects/<id>/words.json --audio audio/<id>/voice.wav
```

Route B dùng API để author hàng loạt:

```powershell
npm run generate -- --project <id> --tts-kokoro
```

Cả hai route đều phải có TTS đo thật trước khi tạo `timeline.json` production.
Artifact ước lượng chỉ mang tên `timeline.estimated.json`; preview được nhưng
render/publish sẽ từ chối.

## Kiểm tra, preview và xuất bản

```powershell
npm run validate -- projects/<id>/timeline.json
npm run quality -- projects/<id>/timeline.json
npm run preview:project -- --project <id>
npm run render -- --project <id>
npm run publish -- --project <id>
```

`render` và `publish` kiểm provenance, hash audio/storyboard/timing artifacts,
schema, director quality, thời lượng MP4, encoding, loudness và visual audit.
Mỗi run ghi vào staging có lock; chỉ promote sang `output/<id>/` khi toàn bộ gate
pass. Run lỗi không thay đổi build production trước đó.

Các flag `--skip-*`, `--diagnostic*` và `--allow-unprovenanced-timing` chỉ dành
cho chẩn đoán. Artifact tạo với chúng không được publish.

## Artifact

```text
projects/<id>/
  transcript.txt
  storyboard-data.ts    # Route A
  storyboard.json       # authored source
  tts_scenes.json
  durations.json
  words.json
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

- Transcript/source coverage và semantic assets hợp lệ.
- Timing provenance là `measured`; ID scene khớp storyboard/durations/timeline.
- Hash audio, storyboard và timing artifacts khớp artifact đã compile.
- H.264, 1920×1080, 30fps; audio khoảng −18 đến −16 LUFS.
- Visual reference thresholds: flat ≤50%, edge density ≥0.16,
  saturation ≥0.15, near-duplicate ≤22%.

Quy tắc đầy đủ và director policy nằm trong [CLAUDE.md](CLAUDE.md);
[AGENTS.md](AGENTS.md) là entry point bắt buộc cho agent.
