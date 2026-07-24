# /new-video — Full production pipeline

```powershell
npx ts-node scripts/new-project.ts --transcript <file> --name <slug>
npm run build-assets
npm run generate -- --project <id> --tts-kokoro
npm run preview:project -- --project <id>
npm run render -- --project <id> --out output/<id>.mp4
```

Với tiếng Việt, dùng Edge voice phù hợp. Mọi artifact nằm trong project folder.
Không dùng helper modulo/keyword để thay storyboard. Nếu semantic hoặc asset gate
fail, sửa storyboard/asset request rồi chạy lại; không bypass production gate.
