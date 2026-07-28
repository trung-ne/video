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
