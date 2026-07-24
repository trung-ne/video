# /generate — Semantic storyboard v2

Production command:

```powershell
npm run generate -- --project <id-or-path> --tts-kokoro
```

Vietnamese Edge TTS:

```powershell
npm run generate -- --project <id-or-path> --tts --tts-voice vi-VN-HoaiMyNeural
```

Pipeline bắt buộc: story map → section plans → source coverage → semantic asset
resolve → section TTS → word alignment → compile → quality gate. Không tự viết
timeline bằng modulo/keyword và không bỏ qua blocker/major.

Artifacts nằm trong `projects/<id>/`. Nếu có `asset-requests.json`, generate hoặc
thêm asset được yêu cầu, chạy `npm run build-assets`, rồi generate lại.
