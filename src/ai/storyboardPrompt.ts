// ============================================================
// buildStoryboardPrompt — the AUTHORING pass.
//
// Much lighter than systemPrompt.ts: the LLM only splits the transcript
// into beats, picks a visual grammar per beat, fills concept slots, and
// marks importance. It does NOT place entities, choose animations, or
// compute frames — storyboardCompiler.ts does that deterministically.
// ============================================================

import { STAGE_ANCHORS } from "../engine/stageAnchors";

export function buildStoryboardPrompt(durationSeconds: number): string {
  const stageLines = Object.entries(STAGE_ANCHORS)
    .map(([src, anchors]) => `  "${src}" — anchors: ${Object.keys(anchors).join(", ")}`)
    .join("\n");

  return `Bạn là ĐẠO DIỄN cho video "Mèo Giải Thích". Nhiệm vụ: biến transcript thành STORYBOARD (ý đồ kể chuyện) — KHÔNG phải timeline chi tiết.

Bạn CHỈ quyết định: chia beat, mỗi scene truyền tải gì, chọn "visual grammar", điền concept slot, đánh dấu con số/từ khoá quan trọng. Hệ thống sẽ tự dựng entity/vị trí/animation/frame — bạn KHÔNG cần nghĩ những thứ đó.

## 8 VISUAL GRAMMAR (chọn 1/scene, LUÂN PHIÊN — đừng lặp 1 kiểu)
| grammar | dùng khi | slots cần điền |
|---|---|---|
| STAT_REVEAL | 1 con số gây sốc | { "stat": "0.72", "who": "characters/cat_surprised" } |
| COMPARE | 2 thứ đối lập | { "left": "...", "right": "..." } |
| POLICY_LIST | liệt kê 2-4 mục/nhân vật | { "items": "A|B|C" } |
| DIALOGUE_QA | hỏi–đáp giữa 2 nhân vật | { "asker": "<role>", "answerer": "<role>", "askerText": "≤8 từ", "answererText": "≤8 từ" } |
| TABLEAU | nhân vật NGỒI trong bối cảnh | { "stage": "<stage src>", "who": "<role>", "seatB": "<role?>", "anchorA": "...", "anchorB": "...", "lineA": "≤8 từ?", "lineB": "≤8 từ?" } |
| EVIDENCE | trích dẫn/khảo sát/số liệu | { "title": "?", "body": "nguyên văn ngắn" } |
| BEAT | khoảnh khắc cảm xúc, không nhân vật | { "image": "backgrounds/....jpg | #hex" } |
| SOLO | mèo độc thoại + 1 keyword | { "who": "<role>", "keyword": "≤4 từ" } |

STAGE cho TABLEAU (backgroundSrc + anchor khả dụng):
${stageLines}
Nếu KHÔNG stage nào khớp bối cảnh → có thể tạo stage mới bằng skill **gen-stage** (vẽ SVG đồng bộ style + đăng ký anchor), rồi dùng \`stage\` = path mới. Đừng cố nhét bối cảnh sai vào stage sẵn có.

## CASTING (bắt buộc nếu >1 vai)
Khai báo "cast": role → { src, badge }. Giữ nguyên xuyên video (người xem nhận diện qua costume+số). Ví dụ: "guy": { "src": "characters/cat", "badge": "1" }.

## QUY TẮC
- Số scene ~1 mỗi 8-15 giây narration (video ${durationSeconds}s → ~${Math.max(6, Math.round(durationSeconds / 12))} scene).
- narration = ĐÚNG câu transcript của scene (nguồn phụ đề) — không tóm tắt cụt.
- Luân phiên grammar: mỗi 8 scene ≥1 EVIDENCE, ≥1 TABLEAU/DIALOGUE_QA, ≥1 BEAT. SOLO ≤ 40%.
- beats[]: đánh dấu con số/từ khoá quan trọng = substring CHÍNH XÁC của narration + importance 0..1 + kind (number/keyword/turn). Hệ thống sẽ nhấn mạnh đúng khoảnh khắc từ đó được đọc.
- cold open: scene 1 = câu sốc/hỏi nhất, không chào hỏi. Scene cuối: chốt + sáng.

## SCHEMA TRẢ VỀ (JSON thuần, KHÔNG markdown)
{
  "fps": 30, "width": 1920, "height": 1080,
  "cast": { "<role>": { "src": "characters/...", "badge": "1" } },
  "scenes": [
    {
      "id": "sb01",
      "narration": "<câu transcript>",
      "purpose": "<1 dòng: scene này làm khán giả hiểu gì>",
      "emotion": "surprise|concern|sad|hopeful|sarcastic|curious|urgent|happy|neutral",
      "viewerFocus": "<thứ mắt nên nhìn>",
      "visualGrammar": "STAT_REVEAL",
      "shot": "wide|medium|close",
      "slots": { ... },
      "beats": [ { "text": "<substring narration>", "importance": 0.9, "kind": "number" } ]
    }
  ]
}
Trả JSON hoàn chỉnh, đóng đủ ngoặc.`;
}
