---
description: Full production pipeline — transcript → storyboard → TTS → timeline → MP4
argument-hint: <transcript-file> hoặc <project-id>
---

# /new-video — Full production pipeline

> **ROUTE A ONLY. Route B/API generation is locked.**

## Điều kiện hoàn thành — bắt buộc với mọi agent

`/new-video` là lệnh **end-to-end**, không phải lệnh tạo storyboard. Agent phải
tự tiếp tục qua build storyboard → asset resolution → TTS đo thời lượng → word
alignment → compile → validate → quality → render → render audit. Không được
trả lời "đã xong", handoff, hoặc tự dừng sau một artifact trung gian như
`storyboard.json`, `tts_scenes.json`, `durations.json` hay `timeline.json`.

Chỉ được kết thúc khi `output/<id>/video.mp4` **mới được tạo trong lần chạy
hiện tại** và production report/audit cho artifact đó đều pass. Nếu một bước
thất bại, agent phải tự chẩn đoán, sửa đúng authored source hoặc asset, rồi chạy
lại pipeline; cấm dùng skip gate. Chỉ hỏi/dừng khi cần quyền, input hoặc quyết
định sáng tạo mà agent không thể tự suy ra an toàn. User interrupt là ngoại lệ:
agent báo state hiện tại ngắn gọn và tiếp tục khi user yêu cầu tiếp tục.

**Visual-audit fail is never a handoff condition.** `LOW_VISUAL_DENSITY`,
`WITHIN_SCENE_SIMILARITY`, `STATIC_SCENE_RUN`, hoặc `FLAT_REGISTER` nghĩa là
scene source chưa đạt. Agent phải sửa diễn tiến có chủ đích trong từng scene
(pose swap, prop/card reveal, evidence hoặc asset composition), compile và
render full lại. Không được thêm overlay/rail/camera drift toàn cục để đánh lừa
audit, không hạ ngưỡng, và không trả lời dừng khi một trong bốn lỗi còn tồn tại.

**Sửa cơ chế sinh, không chỉ chặn output.** Trước TTS, builder phải pass cadence
theo từng scene: tối đa 28 từ cho mỗi semantic state; phần vượt phải có beat chứa
cụm từ nguyên văn với transition bền vững mà grammar render được, hoặc phải tách
scene. `advance: next` chỉ timing teaching layer đã author sẵn. Component/compiler
không được tự lắc, đổi màu, pan/zoom hay reveal theo đồng hồ để tạo khác biệt pixel.
Trước render, stable composition density phải được suy ra từ geometry thật của
card/frame/evidence/circle; `focalOccupancyTarget` không phải bằng chứng.

## Production authoring contract

### Long-video checkpoint rule

Video dài có `SECTIONS` phải build **toàn bộ** `storyboard.json` trước, rồi mới
lập plan semantic. Không được cắt `SCENES` trước khi build hoặc chia theo số scene.
Mỗi chunk gồm section nguyên vẹn và có halo một scene để kiểm seam. Chunk sau bị
khóa cho đến khi chunk trước đã pass authoring → TTS → alignment → compile →
visual proof; pass cục bộ không thay thế global gate cuối video.

```powershell
npx ts-node scripts/plan-chunks.ts --project <id>
npx ts-node scripts/process-storyboard-chunks.ts --project <id> --execute --voice vi-VN-NamMinhNeural --lang vi
npx ts-node scripts/assemble-storyboard-chunks.ts --project <id> --execute --lang vi
npm run render -- --project <id>
```

`process-storyboard-chunks.ts` chỉ resume artifact có attestation/hash/policy còn
khớp. `--chunk-proof` là render non-promotable do orchestrator gọi; không dùng
trực tiếp để xuất bản. Final render từ project có `chunk-plan.json` từ chối nếu
thiếu hoặc drift chunk assembly provenance.

Trước khi viết `SCENES`, bắt buộc export `VISUAL_TREATMENT_PLAN` đầy đủ: usage budgets,
ít nhất 6 visual modes, hero cadence tối đa 45 giây và `paletteProfile: "editorial-muted-v2"`.
Asset mới dùng `assetSelections` với semantic query/required tags. `preferredAssetId` không
khóa asset; chỉ dùng `lockedAssetId` khi có `continuityReason`. Photo scene bắt buộc khai
`photoTreatment`. Build sinh `asset-needs.json` thì bổ sung/chọn lại asset, không fallback.

```powershell
npx ts-node scripts/new-project.ts --transcript <file> --name <slug>
npx ts-node scripts/build-storyboard.ts --project <id>
npm run build-assets
npx ts-node scripts/storyboard-to-tts.ts --storyboard projects/<id>/storyboard.json
py -3.11 scripts/tts_edge.py --scenes projects/<id>/tts_scenes.json --outdir public/audio/<id> --manifest projects/<id>/durations.json --voice vi-VN-NamMinhNeural
py -3.11 scripts/align_words.py --wav public/audio/<id>/voice.wav --outdir projects/<id> --model small --lang vi --scenes projects/<id>/tts_scenes.json
npx ts-node scripts/compile-storyboard.ts --storyboard projects/<id>/storyboard.json --out projects/<id>/timeline.json --durations projects/<id>/durations.json --words projects/<id>/words.json --alignment projects/<id>/alignment.json --audio audio/<id>/voice.wav
npm run validate -- projects/<id>/timeline.json
npm run quality -- projects/<id>/timeline.json
npm run preview:project -- --project <id>
npm run render -- --project <id>
```

Trước `build-storyboard.ts`, agent phải đọc transcript và viết tay
`projects/<id>/storyboard-data.ts` theo từng câu/beat. Không được dùng các
heading `Phân cảnh N` làm toàn bộ scene boundary cho transcript dài. Không chạy
TTS nếu storyboard chỉ pass source coverage nhưng chưa pass granularity/director
review.

Video từ 8 scene trở lên phải export `VISUAL_TREATMENT_PLAN` cùng `SCENES`:
ít nhất 3 register target, character-free target, hero concepts, visual motifs
và các kiểu lặp bị cấm. Builder giữ nguyên plan này trong `storyboard.json`.

Với tiếng Việt, dùng Edge voice phù hợp. Artifact nguồn (storyboard/timeline/tts/
audio) nằm trong `projects/<id>/`; artifact render (video.mp4, contact.jpg,
*-audit.json, production-report.json) mặc định vào `output/<id>/`.
Không dùng helper modulo/keyword để thay storyboard. Nếu semantic hoặc asset gate
fail, sửa storyboard/asset request rồi chạy lại; không bypass production gate.
