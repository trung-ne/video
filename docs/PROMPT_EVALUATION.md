> ## ⛔ Archived Route B analysis
> This document evaluates the retired API-generation prompt and is kept only as incident/history context. Production is Route A only; `src/ai/systemPrompt.ts` is now a fail-closed compatibility tombstone plus asset-list helpers. Do not use recommendations below as current authoring instructions.
>
> ## ✅ Cập nhật 2026-07-02 — đã xử lý 2 vấn đề #1
> - **CLAUDE.md (mâu thuẫn V3↔V4):** đã XOÁ bộ RULE 1-10 + SCENE PATTERNS + phân tích V3 khỏi CLAUDE.md, chuyển sang [rules_history.md](rules_history.md) kèm bảng "V3 nào bị V4 thay thế". CLAUDE.md còn 311 dòng (từ 679), chỉ giữ luật hiện hành + tóm tắt 1 dòng các RULE V3 không mâu thuẫn.
> - **Hệ quality mâu thuẫn V4 (điểm PROMPT_EVALUATION chưa bắt):** `qualityCheck.ts` từng thưởng ảnh thật (ngược V4.1) → đã sửa `BACKGROUND_REAL/VARIETY` sang "nền trắng mặc định, ảnh là cú đấm 2-4 lần", thêm SOLO_RATIO + POSE_MONOTONY (cat_happy) + OPENING_DARK. `validateTimeline.ts` gỡ hết luật thẩm mỹ → thành cổng SCHEMA thuần. Giờ **một sự thật một chỗ**: schema ở validateTimeline, thẩm mỹ ở qualityCheck.
> - Còn lại (chưa làm, việc lớn): hợp nhất 4 tầng rule trùng trong systemPrompt.ts (vấn đề tiêu chí 3).

---

# Cấu trúc đánh giá Prompt — Cat Explainer Video System

> Rubric xây dựng dựa trên các nguyên tắc prompt engineering cốt lõi trong "Claude Code in Action"
> (quản lý context, custom commands có cấu trúc, kỷ luật hooks/SDK) áp dụng cho 2 prompt lớn nhất
> của dự án: [`src/ai/systemPrompt.ts`](../src/ai/systemPrompt.ts) (1312 dòng — sinh timeline) và
> [`CLAUDE.md`](../CLAUDE.md) (679 dòng — chỉ dẫn cho Claude Code khi làm việc trong repo).

---

## 1. Khung 6 tiêu chí

Mỗi prompt được chấm 0–5 trên từng trục. Điểm tổng = trung bình có trọng số.

| # | Tiêu chí | Câu hỏi kiểm tra | Trọng số |
|---|----------|-------------------|----------|
| 1 | **Rõ ràng & không mơ hồ** | Mỗi rule có thể áp dụng máy móc, không cần suy diễn? Có ví dụ đúng/sai cụ thể không? | 20% |
| 2 | **Cấu trúc & khả năng scan** | Có phân cấp rõ (H2/H3, bảng, code block)? Model có thể tìm đúng section bằng 1 lần quét? | 15% |
| 3 | **Quản lý context / độ dài** | Prompt có tỷ lệ tín hiệu/nhiễu tốt? Có lặp lại rule ở nhiều nơi gây drift không? | 20% |
| 4 | **Nhất quán nội bộ** | Các rule có mâu thuẫn nhau không (vd rule cũ vs rule mới đè lên)? | 20% |
| 5 | **Khả năng kiểm chứng (verifiable)** | Có cơ chế validate tự động (code) đối chiếu với rule, hay chỉ dựa vào model tự giác? | 15% |
| 6 | **Khả năng bảo trì** | Khi thêm rule mới, có patttern rõ để chèn vào đúng chỗ không, hay phải rewrite? | 10% |

**Thang điểm:**
- 5 = xuất sắc, là ví dụ mẫu
- 3 = ổn, có 1-2 điểm cần sửa
- 1 = có vấn đề nghiêm trọng, dễ gây lỗi output
- 0 = thiếu hẳn tiêu chí này

---

## 2. Đánh giá `src/ai/systemPrompt.ts` (buildSystemPrompt)

### Điểm số

| Tiêu chí | Điểm | Ghi chú |
|----------|------|---------|
| Rõ ràng & không mơ hồ | 4/5 | Rule kèm ví dụ JSON cụ thể (ICON_TRIPLE, layout patterns), bảng tra cứu emotion×function → treatment rất tốt. Trừ điểm vì một số rule diễn đạt bằng văn xuôi dài (dòng 44-76) thay vì bullet có thể scan nhanh. |
| Cấu trúc & khả năng scan | 4/5 | Phân cấp H2 rõ, dùng bảng nhiều. Nhưng file 1312 dòng đặt toàn bộ trong 1 template string — khó nhảy tới đúng section khi debug. |
| Quản lý context / độ dài | 2/5 | **Vấn đề lớn nhất.** Prompt lặp lại cùng 1 rule ở ≥3 tầng: mục "V4 RULES" (dòng 59-64) → "NGÔN NGỮ ĐIỆN ẢNH" (66-76) → "ENGINE QUYẾT ĐỊNH" (342-416) → "MOMENT TEMPLATES" (419-635) đều nhắc lại quy tắc pose/background/layout theo cách khác nhau. Model phải tự hợp nhất 4 nguồn rule — tăng rủi ro áp dụng phiên bản cũ. |
| Nhất quán nội bộ | 3/5 | Có annotation tốt kiểu "(đảo ngược RULE 1 cũ)" giúp model biết ưu tiên bản mới. Nhưng vẫn còn rule trùng lặp không đánh dấu quan hệ (vd mục BACKGROUNDS dòng 197 lặp lại gần y nguyên nội dung V4.1 trong CLAUDE.md). |
| Khả năng kiểm chứng | 4/5 | Có `validateTimeline()` + `qualityCheck.ts` đối chiếu output với rule (SUBTITLE_ZONE, SOLO_RATIO, POSE_MONOTONY...) — đây là điểm mạnh hiếm gặp: rule không chỉ nằm trong text mà được enforce bằng code. |
| Khả năng bảo trì | 3/5 | Thêm rule mới thường nghĩa là chèn thêm 1 đoạn văn xuôi mới thay vì mở rộng bảng có sẵn — dễ tạo thêm tầng lặp lại (xem tiêu chí 3). |

**Điểm tổng có trọng số: 3.35/5**

### Vấn đề cụ thể cần sửa
1. **Tầng hóa rule bị trùng (nghiêm trọng nhất):** hợp nhất 4 khối rule về pose/background/layout (dòng 59-76, 197-239, 342-416) thành MỘT bảng tra cứu duy nhất mà các phần khác trỏ tới, thay vì diễn giải lại.
2. Một số văn xuôi dài (dòng 44-76) nên rút thành bullet ngắn có thể scan trong <5s.
3. Không có version/changelog marker rõ ràng để biết "V4 rule nào override rule nào" ngoài comment thủ công trong ngoặc.

---

## 3. Đánh giá `CLAUDE.md`

### Điểm số

| Tiêu chí | Điểm | Ghi chú |
|----------|------|---------|
| Rõ ràng & không mơ hồ | 4/5 | Rule đánh số (V4.1–V4.8, RULE 1–10) rất cụ thể, có bảng mapping narration→visual chi tiết. |
| Cấu trúc & khả năng scan | 4/5 | Header phân cấp tốt, bảng nhiều, TOC ngầm qua H2. Hơi dài (679 dòng) cho 1 file luôn load full vào context. |
| Quản lý context / độ dài | 2/5 | File tự nhận là "V4 override rule cũ nếu mâu thuẫn" nhưng KHÔNG xóa rule cũ (RULE 1-10 gốc mâu thuẫn trực tiếp với V4.1 vẫn còn nguyên ở dưới) → mọi lần load context, model phải tự resolve mâu thuẫn giữa "ảnh thật là mặc định" (RULE 1) và "nền trắng là mặc định" (V4.1). |
| Nhất quán nội bộ | 2/5 | Mâu thuẫn trực tiếp: RULE 1 (dòng ~230) nói ảnh nền thật PHẢI là mặc định cho scene kể chuyện; V4.1 (đầu file) nói ngược lại là nền trắng mặc định, ảnh thật là ngoại lệ. Dựa vào ghi chú "ưu tiên cao nhất, override" là cách xử lý mong manh — dễ bị model đọc rule cũ trước và áp dụng nhầm khi rule V4 nằm quá xa so với chỗ dùng. |
| Khả năng kiểm chứng | 5/5 | Điểm mạnh nhất — mọi rule quan trọng đều trỏ thẳng tới file code enforce nó (sceneCompiler.ts, AnimatedText.tsx, validateTimeline, backgroundResolver.ts). Đây là pattern rất tốt, hiếm gặp trong CLAUDE.md thông thường. |
| Khả năng bảo trì | 3/5 | Thêm quy tắc mới (V5?) sẽ tiếp tục pattern "thêm khối mới ở đầu, không xóa khối cũ" → phình to dần, tăng rủi ro mâu thuẫn ngầm. |

**Điểm tổng có trọng số: 3.15/5**

### Vấn đề cụ thể cần sửa
1. **Xóa hoặc gạch rõ phần RULE 1-10 (V3) đã bị V4 override thay vì giữ song song** — hiện tại người đọc/model phải tự nhớ "V4 thắng V3" xuyên suốt 679 dòng.
2. Cân nhắc tách CLAUDE.md thành file chính (ngắn, chỉ rule hiện hành) + file lịch sử/tham khảo riêng (`docs/rules_history.md`) để giảm token load mỗi session mà vẫn giữ ngữ cảnh cũ khi cần tra cứu.
3. Thêm 1 dòng đầu file dạng "Rule có hiệu lực: chỉ đọc mục V4 + RULE 2,3,4,6,7,9,10 (không mâu thuẫn V4); BỎ QUA RULE 1,5,8 (đã bị V4.1/V4.8 thay thế)" để loại bỏ hoàn toàn việc model phải tự suy luận thứ tự ưu tiên.

---

## 4. Nguyên tắc áp dụng khi viết prompt mới cho dự án này

Rút ra từ đánh giá trên, mọi prompt/rule mới (system prompt, CLAUDE.md, skill file) nên tuân theo:

1. **Một sự thật, một chỗ.** Nếu 1 rule (vd "pose theo cảm xúc") cần nhắc ở nhiều section, section sau chỉ trỏ link (`xem mục X`) — không diễn giải lại bằng câu chữ khác.
2. **Override phải xóa, không phải đè.** Khi có rule version mới thay thế rule cũ, xóa rule cũ khỏi file thay vì giữ lại kèm ghi chú "ưu tiên cao hơn".
3. **Rule quan trọng phải có code enforce đi kèm** — nếu không thể validate tự động, ít nhất phải có ví dụ đúng/sai cụ thể ngay cạnh rule.
4. **Bullet/bảng > văn xuôi** cho bất kỳ rule nào dài quá 2 câu — giúp cả người đọc và model scan nhanh.
5. **Đánh version rõ ràng ở đầu file** (vd "V4 — có hiệu lực từ 2026-XX-XX, override mục Y,Z") thay vì rải rác trong ngoặc đơn.

---

## 5. Tóm tắt điểm

| Prompt | Điểm tổng | Vấn đề #1 cần sửa |
|--------|-----------|--------------------|
| `src/ai/systemPrompt.ts` | 3.35/5 | Hợp nhất 4 tầng rule trùng lặp về pose/background/layout |
| `CLAUDE.md` | 3.15/5 | Xóa/gạch rõ RULE 1-10 (V3) đã bị V4 override thay vì giữ song song gây mâu thuẫn |

Cả hai đều mạnh về **khả năng kiểm chứng** (code enforcement) — đây là điểm nên giữ và nhân rộng.
Cả hai đều yếu về **quản lý context/độ dài** do lặp tầng rule — đây là ưu tiên sửa số 1.
