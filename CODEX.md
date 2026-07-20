# Codex Runbook

`CLAUDE.md` là nguồn luật tối cao. File này là bản rút gọn để Codex chạy đúng quy trình và không lệch chuẩn.

## Quy trình đọc
1. Đọc `CLAUDE.md` trước.
2. Đọc `CLAUDE-UPDATED.md` để lấy ngữ cảnh lịch sử.
3. Đọc `WORKFLOW.md` khi cần thứ tự thao tác cụ thể.
4. Nếu có xung đột, ưu tiên `V4 — DIRECTOR'S RULES` trong `CLAUDE.md`.

## Cách làm việc
- Bám workspace hiện tại, không làm việc trên giả định.
- Dùng todo list khi task có nhiều bước.
- Chỉ sửa đúng phạm vi yêu cầu, tránh đụng vào phần khác.
- Nếu thiếu dữ liệu, đọc file liên quan thay vì đoán.

## Luồng chuẩn khi làm video
```bash
# Tạo project
npx ts-node scripts/new-project.ts --idea "Chủ đề video"

# Generate timeline từ transcript
npx ts-node scripts/generate-timeline.ts --transcript projects/<project>/transcript.txt --out projects/<project>/timeline.json

# Validate timeline
npm run validate -- projects/<project>/timeline.json

# Preview trong Remotion Studio
npm start

# Render MP4
npx ts-node scripts/render.ts --timeline projects/<project>/timeline.json --out output/<project>.mp4
```

## Luật phải giữ
- Nền trắng là mặc định; ảnh thật chỉ là evidence hoặc emotional beat.
- Không chồng quá nhiều text trong một frame.
- Pose phải khớp cảm xúc từng câu narration.
- Asset giữ trạng thái cho tới khi `exit` hoặc `clear`.
- Render chỉ sau khi validate xong.

## Ghi nhớ
- Với `/generate`, `/new-video`, `timeline.json`, hoặc render MP4, luôn bám `CLAUDE.md` trước tiên.
- Nếu cần luật chi tiết, mở `CLAUDE.md` thay vì tự thêm quy ước mới.