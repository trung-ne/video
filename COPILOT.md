# Copilot Runbook

`CLAUDE.md` là nguồn luật tối cao. File này chỉ là bản rút gọn để Copilot chạy đúng quy trình, không thay thế luật gốc.

## Thứ tự đọc
1. Đọc `CLAUDE.md` trước tiên.
2. Đọc `CLAUDE-UPDATED.md` để hiểu lịch sử và ngữ cảnh.
3. Đọc `WORKFLOW.md` khi cần quy trình thực thi chi tiết.
4. Nếu có mâu thuẫn, ưu tiên mục `V4 — DIRECTOR'S RULES` trong `CLAUDE.md`.

## Cách làm việc
- Luôn bám workspace hiện tại: đọc file, sửa file, validate ngay trong repo.
- Dùng todo list cho task nhiều bước.
- Không đoán dữ liệu còn thiếu; hãy đọc file liên quan hoặc nói rõ đang thiếu gì.
- Giữ thay đổi tối thiểu và đúng phạm vi yêu cầu.

## Luồng video chuẩn
```bash
# 1. Tạo project
npx ts-node scripts/new-project.ts --idea "Chủ đề video"

# 2. Generate timeline từ transcript
npx ts-node scripts/generate-timeline.ts --transcript projects/<project>/transcript.txt --out projects/<project>/timeline.json

# 3. Validate
npm run validate -- projects/<project>/timeline.json

# 4. Preview
npm start

# 5. Render
npx ts-node scripts/render.ts --timeline projects/<project>/timeline.json --out output/<project>.mp4
```

## Quy tắc không được quên
- Nền trắng là mặc định; ảnh thật chỉ dùng khi là evidence hoặc emotional beat.
- Một frame không chồng quá nhiều text; tránh BODY/CAPTION đè subtitle.
- Pose phải khớp cảm xúc từng câu; không dùng `cat_happy` cho nội dung tiêu cực/trung tính.
- HOLD STATE: asset không tự biến mất; chỉ xoá bằng `exit` hoặc `clear`.
- Luôn validate timeline trước khi render.

## Khi Copilot hỗ trợ
Nên yêu cầu Copilot:
- phân tích transcript,
- chọn scene layout và asset phù hợp,
- kiểm tra rule V4,
- tạo hoặc sửa `timeline.json`,
- và đề xuất lệnh chạy cụ thể.

## Ghi nhớ
- Nếu task liên quan `/generate`, `/new-video`, timeline hoặc render, hãy làm theo `CLAUDE.md` trước rồi mới thao tác.
- Nếu cần tài liệu đầy đủ hơn, mở `CLAUDE.md` thay vì thêm rule mới vào đây.
