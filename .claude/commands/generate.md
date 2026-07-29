---
description: Route B/API generator — LOCKED, không được sử dụng
argument-hint: <project-id-or-path>
---

# /generate — LOCKED

Route B đã bị khóa. Command này không còn là production entry point và
`scripts/generate-timeline.ts` sẽ thoát với mã lỗi 2 trước khi đọc API key hoặc
ghi artifact.

Mọi video phải dùng Route A: agent viết tay `storyboard-data.ts`, chạy
`build-storyboard.ts`, rồi mới chạy TTS/alignment/compile/render.
