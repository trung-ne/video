---
description: Full production pipeline — transcript → storyboard → TTS → timeline → MP4
argument-hint: <transcript-file> hoặc <project-id>
---

# /new-video — Full production pipeline

> **ROUTE A ONLY. Route B/API generation is locked.**

```powershell
npx ts-node scripts/new-project.ts --transcript <file> --name <slug>
npx ts-node scripts/build-storyboard.ts --project <id>
npm run build-assets
npx ts-node scripts/storyboard-to-tts.ts --storyboard projects/<id>/storyboard.json
py -3.11 scripts/tts_kokoro.py --scenes projects/<id>/tts_scenes.json --outdir public/audio/<id> --manifest projects/<id>/durations.json
py -3.11 scripts/align_words.py --wav public/audio/<id>/voice.wav --outdir projects/<id> --model small --lang vi --transcript projects/<id>/transcript.txt
npx ts-node scripts/compile-storyboard.ts --storyboard projects/<id>/storyboard.json --out projects/<id>/timeline.json --durations projects/<id>/durations.json --words projects/<id>/words.json --audio audio/<id>/voice.wav
npm run validate -- projects/<id>/timeline.json
npm run quality -- projects/<id>/timeline.json
npm run preview:project -- --project <id>
npm run render -- --project <id>
```

Trước `build-storyboard.ts`, agent phải đọc transcript và viết tay
`projects/<id>/storyboard-data.ts` theo từng câu/beat. Không được dùng các
heading `Phân cảnh N` làm toàn bộ scene boundary cho transcript dài. Không chạy
TTS nếu storyboard chỉ pass source coverage nhưng chưa pass granularity/director
review.

Với tiếng Việt, dùng Edge voice phù hợp. Artifact nguồn (storyboard/timeline/tts/
audio) nằm trong `projects/<id>/`; artifact render (video.mp4, contact.jpg,
*-audit.json, production-report.json) mặc định vào `output/<id>/`.
Không dùng helper modulo/keyword để thay storyboard. Nếu semantic hoặc asset gate
fail, sửa storyboard/asset request rồi chạy lại; không bypass production gate.
