---
description: Sửa nội dung video đúng tầng — storyboard là nguồn, timeline là compile output
argument-hint: <project-id> + mô tả thay đổi
---

# /edit-timeline — Sửa artifact đúng tầng

Production source là `storyboard.json`, không phải compiled events.

- Sửa ý nghĩa/asset/register: sửa scene brief trong storyboard rồi compile lại.
- Sửa transcript: regenerate source ranges/checksum.
- Sửa timing: chạy lại TTS + alignment; không đoán frame.
- Không sửa `timeline.json` trực tiếp. Muốn diagnostic thay đổi khung hình, tạo
  bản copy ngoài canonical project path; production luôn sửa storyboard rồi compile lại.

Không thêm generic cat pair, CSS-only BEAT hoặc asset path ngoài manifest.

Nếu có một output/report canonical bị fail, chạy triage read-only trước khi sửa:

```powershell
npm run triage -- --project <id>
```

Triage Route A/source-only chỉ đọc artifact để tìm gate thất bại đầu tiên; không
sửa source, compile, render, promote hoặc bypass. Dựa vào kết quả, sửa source of
record rồi chạy lại canonical gates; không chữa trực tiếp generated timeline,
TTS/alignment, report hoặc output.
