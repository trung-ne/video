# Reference-quality production plan

Mục tiêu: mọi video mới tiến gần ngôn ngữ hình ảnh của `refer/meo.mp4` mà vẫn
dùng character/art nguyên bản của project.

## Definition of done

- Production luôn đi qua `transcript → storyboard → timeline → render`.
- Visual shot trung bình 5-9 giây.
- `TABLEAU ≥35%`; `TABLEAU + BEAT ≥45%`; `SOLO ≤20%`.
- Evidence/FrameBox ≥10% scene khi nội dung có claim/số liệu.
- Không lặp cùng register quá hai shot.
- Quality report: 0 blocker, 0 major, grade A/B.
- Pixel audit: không có từ hai lỗi trở lên trong `WHITE_DOMINANCE`,
  `LOW_COLOUR_REGISTER`, `LOW_VISUAL_DENSITY`, `FRAME_SIMILARITY`.

## P0 — Enforced pipeline

- [x] Storyboard là default của `generate-timeline.ts`.
- [x] Direct timeline chỉ còn qua `--legacy-direct`.
- [x] Render chặn blocker/major trước khi encode.
- [x] Render chạy visual audit trên MP4 thật.

## P1 — Director authoring

- [x] Prompt yêu cầu shot 5-9 giây và narration ≤45 từ/shot.
- [x] Prompt siết stage/tableau, evidence và register rotation.
- [x] Stage anchors phủ các bối cảnh hiện có trong `public/assets/scenes`.
- [ ] Thêm semantic evidence manifest: claim/source/date/highlight/asset.
- [ ] Thêm research pass trước storyboard cho video factual.

## P2 — Visual systems

- [ ] Character lock + pose matrix 30-50 pose cho mỗi main cast.
- [ ] Hand/prop anchor để nhân vật cầm, nhìn, chỉ đúng đồ vật.
- [ ] Grammar chuyên biệt: ranking lineup, matching graph, population pyramid,
  map heat, threshold scale, zero-sum balance.
- [ ] Typography register: handwritten, newspaper, marker highlight, diagram
  annotation, impact word.

## P3 — Golden regression loop

- [ ] Duy trì một transcript ngắn và một transcript dài làm golden fixtures.
- [ ] Render fixtures sau mỗi thay đổi compiler/prompt.
- [ ] Lưu contact sheet và visual-audit JSON làm baseline.
- [ ] Chỉ merge khi schema, director gate và pixel audit đều pass.

## Escape hatches

Các flag sau chỉ dùng cho chẩn đoán, không dùng để xuất bản:

- `--legacy-direct`
- `--skip-quality`
- `--skip-visual-audit`
- `--skip-validate`
