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

## VISUAL GRAMMAR (chọn 1/scene, LUÂN PHIÊN — đừng lặp 1 kiểu)
| grammar | dùng khi | slots cần điền |
|---|---|---|
| STAT_REVEAL | 1 con số gây sốc | { "stat": "0.72", "anchor": "<asset thể hiện số đang đo>", "who": "<role?>" } |
| COMPARE | 2 thứ đối lập | { "left": "...", "right": "..." } |
| POLICY_LIST | liệt kê 2-4 mục/nhân vật | { "items": "A|B|C" } |
| DIALOGUE_QA | hỏi–đáp giữa 2 nhân vật | { "asker": "<role>", "answerer": "<role>", "askerText": "≤8 từ", "answererText": "≤8 từ" } |
| TABLEAU | nhân vật NGỒI trong bối cảnh | { "stage": "<stage src>", "who": "<role>", "seatB": "<role?>", "anchorA": "...", "anchorB": "...", "lineA": "≤8 từ?", "lineB": "≤8 từ?" } |
| EVIDENCE | trích dẫn/khảo sát/số liệu | { "title": "?", "body": "nguyên văn ngắn", "choices": "A|B|C?" } |
| FRAMEBOX | chiếu ảnh/dữ liệu trong khung TV | { "content": "backgrounds/x.jpg | #hex", "caption": "?" } |
| CHAR_PROP | mèo nhìn/chỉ vào đồ vật | { "prop": "finance/money", "label": "?" } |
| DIAGRAM | luồng A→B→C (mũi tên) | { "items": "A|B|C" } |
| CAUSE_EFFECT | nguyên nhân → hệ quả | { "cause": "...", "effect": "...", "causeIcon": "finance/x?", "effectIcon": "?" } |
| QA_REVEAL | hỏi rồi hé lộ đáp | { "question": "...", "answer": "..." } |
| ICON_TRIPLE | 3 khái niệm vòng tròn màu | { "items": "A|B|C", "icons": "finance/x|props/y|...?" } |
| BEAT | khoảnh khắc cảm xúc, không nhân vật | { "image": "backgrounds/....jpg | #hex" } |
| SOLO | direct address + concept card lớn | { "who": "<role>", "action": "...", "keyword": "≤4 từ", "prop": "<asset liên quan?>" } |

Icon/prop dùng cho CHAR_PROP/CAUSE_EFFECT/ICON_TRIPLE: finance/* (money, house, stock, inflation, chart_up, wallet, piggy_bank, debt, loan...), props/* (trophy, book, brain, hourglass, calendar, marshmallow...).

STAGE cho TABLEAU (backgroundSrc + anchor khả dụng):
${stageLines}
Nếu KHÔNG stage nào khớp bối cảnh → có thể tạo stage mới bằng skill **gen-stage** (vẽ SVG đồng bộ style + đăng ký anchor), rồi dùng \`stage\` = path mới. Đừng cố nhét bối cảnh sai vào stage sẵn có.

## CASTING (bắt buộc nếu >1 vai)
Khai báo "cast": role → { src, badge }. Giữ nguyên xuyên video (người xem nhận diện qua costume+số). Ví dụ: "guy": { "src": "characters/cat", "badge": "1" }.

## QUY TẮC
- Số scene ~1 mỗi 5-9 giây narration (video ${durationSeconds}s → ~${Math.max(8, Math.round(durationSeconds / 7))} scene). Một scene là một VISUAL SHOT, không phải một đoạn văn dài.
- Mỗi scene chỉ nên chứa 1-2 câu ngắn, khoảng 12-35 từ. Nếu narration dài hơn 45 từ, BẮT BUỘC tách thành nhiều scene/shot liên tiếp.
- **ƯU TIÊN TABLEAU / bối cảnh (QUAN TRỌNG — chống "mèo trên nền trắng"):** mọi scene có KHÔNG GIAN VẬT LÝ (ở nhà, quán, phố, lớp học, công viên, văn phòng, cửa hàng, bàn ăn, phòng ngủ) PHẢI dùng TABLEAU với stage. **≥35% scene phải là TABLEAU; TABLEAU + BEAT ≥45%.** SOLO chỉ dùng khi thực sự là lời bình trực tiếp với khán giả — **SOLO ≤20% số scene**.
- **MONTAGE tương phản:** KHÔNG 2 STAT_DRAMA liền nhau; sau 1 scene tối (STAT_DRAMA) nên là scene sáng. Xen kẽ năng lượng.
- narration = ĐÚNG câu transcript của scene (nguồn phụ đề) — không tóm tắt cụt.
- Luân phiên grammar: mỗi 8 scene ≥1 EVIDENCE/FRAMEBOX, ≥2 TABLEAU/DIALOGUE_QA, ≥1 BEAT. Không lặp cùng grammar quá 2 scene. SOLO ≤20%.
- Mỗi claim có số liệu/chính sách/khảo sát phải dùng EVIDENCE hoặc FRAMEBOX; không được thay bằng icon trang trí.
- STAT_REVEAL: số là focal typography, \`anchor\` phải nói rõ số đó đo tiền/dân số/tỷ lệ gì. SOLO phải có keyword đủ mạnh cho concept card; thêm \`prop\` khi narration có danh từ cụ thể.
- Title/keyword KHÔNG được copy 6+ từ đầu narration. Text overlay phải bổ sung ý, không lặp phụ đề.
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
