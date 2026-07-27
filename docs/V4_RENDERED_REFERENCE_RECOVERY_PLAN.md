# V4 rendered-reference recovery plan

## 1. Kết luận từ v3

`video-003-tai-sao-eng-v3.mp4` chứng minh pre-render gate hiện có thể đạt
`100/100` trong khi output thật vẫn không đạt refer:

| Metric | Refer | V3 | Target production |
|---|---:|---:|---:|
| Flat-frame ratio | 45.0% | 60.0% | target <=45%, hard max 50% |
| Edge density | 0.197 | 0.140 | >=0.16 |
| Saturation | 0.182 | 0.211 | >=0.15 |
| Near-duplicate | 17.6% | 33.0% | <=22% |
| Video bitrate | 4.43 Mbps | 0.59 Mbps | publish profile 3-5 Mbps |
| Narration loudness | -27.3 LUFS | -25.5 LUFS | -18 to -16 LUFS |

Các nguyên nhân có thể xác nhận trực tiếp từ timeline/render:

- 180/180 cảnh dùng đúng một character và một prop.
- 180/180 cảnh dùng đúng một text overlay.
- Chỉ có 33 asset cho 360 lượt đặt asset.
- Tám pose mèo xuất hiện khoảng 22-23 lần/pose.
- Chỉ 4/180 cảnh là `photo_broll`.
- `heroVisual`, `visualRegister` và `backgroundSrc` đang được tin như bằng chứng
  chất lượng, dù renderer có thể tạo ra một frame rất thưa.
- Stage SVG được tính là full background dù phần lớn diện tích vẫn là màu trống.
- Mastering chỉ chạy trong nhánh sinh TTS. Audio có sẵn có thể đi thẳng vào render.
- Pipeline ghi “Render complete” trước khi encoding/visual/audio audit hoàn tất.

Mục tiêu của V4 là biến **MP4 đã render** thành nguồn sự thật cuối cùng; metadata
chỉ là dự báo để tránh render lãng phí.

## 2. Definition of done

Một video chỉ được gọi là production-ready khi đồng thời:

1. Storyboard schema hợp lệ và phủ toàn transcript.
2. Pre-render semantic gate có 0 blocker, 0 major.
3. Low-resolution audit render vượt visual thresholds.
4. Audio asset được master và audit, bất kể nguồn audio là TTS mới hay file có sẵn.
5. Full render vượt encoding, visual và audio audit.
6. Báo cáo cuối có `passed: true`; CLI exit code khác 0 nếu bất kỳ gate nào fail.

Target cho video dài trên 10 phút:

- 6 visual register thật, không register nào quá 30%.
- Không lặp cùng scene fingerprint trong 4 cảnh liên tiếp.
- 20-35% cảnh không có mèo; infographic/evidence/photo được tự đứng làm focal.
- 20-30% full tableau có bối cảnh và hành động.
- 20-30% infographic/map/chart/diagram.
- 15-20% evidence/framebox/survey/screenshot.
- 8-15% photo hoặc footage thật.
- 10-15% visual gag.
- Hero visual thật mỗi 30-45 giây.
- Ít nhất 25 pose/costume/action variant và 30 focal asset cho video dài.
- Một pose không quá 8% tổng số cảnh; một stage không quá 12%.
- Flat frame target <=45%, hard max 50%.
- Edge density >=0.16, saturation >=0.15, near-duplicate <=22%.
- Narration từ -18 đến -16 LUFS, true peak <=-1.5 dBTP.

## 3. Phase 0 — Một nguồn cấu hình và một publish gate

### Code

Mở rộng `config/reference-quality.json`:

- Thêm `renderedVisual.maximumFlatFrameRatio`.
- Thêm `composition` quotas: cat-presence, photo/evidence/tableau ratios,
  maximum pose/stage/fingerprint reuse.
- Thêm `encoding.targetVideoBitrate`, `minimumVideoBitrate`,
  `audioBitrate`, codec, resolution và fps.
- Tất cả prompt, storyboard gate, timeline gate và audit script phải đọc cùng file.

Tạo `scripts/publish.ts` làm entry point duy nhất:

```text
schema -> storyboard/timeline gate -> audio prepare/audit
       -> proxy render -> pixel audit
       -> full render -> encoding + pixel + audio audit
       -> production-report.json
```

Không in `Render complete` trước khi toàn bộ chuỗi audit pass. File MP4 fail audit
được giữ để chẩn đoán nhưng đổi trạng thái thành `diagnostic`, không phải publish.

### Acceptance

- Một fixture có metadata đẹp nhưng frame phẳng phải làm `publish` exit code 1.
- `production-report.json` chứa đường dẫn và kết quả của mọi gate.

## 4. Phase 1 — Storyboard schema đo visual thật, không đo nhãn

### Schema

Thêm vào `SceneBrief`:

```ts
focalType:
  | "character_action"
  | "full_scene"
  | "chart"
  | "map"
  | "diagram"
  | "evidence"
  | "photo"
  | "screenshot"
  | "visual_gag";
characterRequired: boolean;
visualFingerprint: string;
silentFrameTakeaway: string;
focalOccupancyTarget: number;
noveltyFromPrevious: string[];
```

Thêm `VisualTreatmentPlan` cấp section/video:

- quota register theo thời lượng;
- shot ledger;
- asset/pose/stage usage budget;
- claim-to-visual mapping;
- danh sách hero cần tạo;
- motif được phép lặp và những thứ không được lặp.

`heroVisual` không còn là boolean tùy ý. Compiler chỉ công nhận hero nếu scene có
ít nhất một điều kiện thật:

- photo/screenshot/map/chart chiếm vùng focal đủ lớn;
- evidence card có claim/source hợp lệ;
- tableau có stage + action + prop semantic;
- diagram có ít nhất ba node và quan hệ;
- visual gag có setup và payoff khác frame.

### Gate

Thêm các rule:

- `TEMPLATE_SHAPE_DOMINANCE`: một entity-shape như `1 cat + 1 prop + 1 text`
  không được quá 25% timeline.
- `CHARACTER_ALWAYS_PRESENT`: fail nếu character xuất hiện trên 80% cảnh dài.
- `POSE_REUSE`, `STAGE_REUSE`, `LABEL_REUSE`.
- `HERO_METADATA_ONLY`: hero không có component/occupancy tương ứng.
- `REGISTER_COMPONENT_MISMATCH`: register khai báo khác cấu trúc renderer.
- `SPARSE_STAGE`: backgroundSrc có thật nhưng foreground/background occupancy thấp.
- `GENERIC_TAKEAWAY`: takeaway chỉ đổi keyword hoặc không mô tả quan hệ.

## 5. Phase 2 — Prompt director theo shot ledger

### Story-map prompt

Sửa `src/ai/prompts/storyMapPrompt.ts` để mỗi section trả thêm:

- `claimVisuals`: claim nào dùng chart/map/evidence/photo/action;
- `treatmentSequence`: ngôn ngữ hình ảnh dự kiến;
- `heroConcept`: một câu mô tả frame cụ thể, không dùng cờ boolean;
- `requiredProps`, `requiredSettings`, `requiredCharacterRoles`;
- `noCharacterOpportunity`;
- `visualContrastFromPreviousSection`.

### Scene-plan prompt

Sửa `src/ai/prompts/scenePlanPrompt.ts`:

- Truyền sáu scene fingerprint gần nhất, không chỉ hai register.
- Truyền usage count của pose, stage, prop, label và grammar.
- Truyền quota còn thiếu của toàn video/section.
- Bắt buộc làm “silent-frame test”: người xem tắt tiếng phải hiểu ý gì?
- Character là optional. Prompt phải giải thích vì sao cần mèo nếu thêm mèo.
- Prop phải có verb/action; cấm prop trang trí nhỏ bên cạnh character.
- Không dùng heading taxonomy chung (`THE BIG PICTURE`, `MONEY`, `CHILDREN`)
  thay cho thông điệp cụ thể của narration.
- Hero phải mô tả composition, focal scale, data/evidence/action và payoff.

Ví dụ negative bắt buộc:

- Một mèo bên trái + icon nhỏ bên phải + heading.
- Đổi màu nền nhưng giữ nguyên composition.
- Gắn `photo_broll` hoặc `heroVisual` mà ảnh chỉ nằm trong thumbnail nhỏ.
- Evidence card không có claim cụ thể.
- Hai scene khác narration nhưng dùng cùng stage, pose và prop relation.

### Critic pass

Thêm pass `visual-critic` sau scene planning. Critic chấm 0-2 cho:

- narration fidelity;
- silent-frame clarity;
- semantic prop/action;
- visual-language novelty;
- hero strength;
- evidence integrity.

Scene có tổng dưới 8/12 hoặc mục nào bằng 0 phải repair. Repair prompt nhận scene
trước/sau, usage ledger và lý do fail cụ thể.

## 6. Phase 3 — Asset fulfillment thay vì fallback

Hiện `asset-requests.json` chỉ là queue; pipeline vẫn có thể tiếp tục với asset
fallback. Sửa thành:

1. Resolve asset có sẵn.
2. Nếu thiếu, ghi request có prompt, role, style, transparency, aspect ratio,
   setting, action và target scene.
3. Chạy bước fulfillment hoặc dừng ở trạng thái `assets_required`.
4. Rebuild `public/assets.manifest.json`.
5. Resolve lại; không cho production render nếu còn fallback semantic.

Asset budget cho video dài:

- 20-30 pose/costume/action character riêng;
- 10-15 full-scene/stage có foreground, midground, background;
- props theo nghĩa narration, không chỉ finance icon chung;
- map/chart/survey/evidence/photo/screenshot assets riêng;
- composite hero asset khi các icon rời không truyền tải đủ ý.

Thêm metadata manifest:

```ts
visualDensity;
recommendedScale;
aspectRatio;
semanticRoles;
actionTags;
settingTags;
isFallback;
```

Asset resolver phải ưu tiên action/setting match và phạt asset đã dùng quá budget.

## 7. Phase 4 — Mở rộng visual grammar và renderer

Nâng cấp/thêm grammar:

- `MAP_FLOW`: bản đồ + điểm + mũi tên có nghĩa.
- `DATA_CHART`: bar/line/population/pyramid từ dữ liệu transcript.
- `SURVEY_CARD`: question/choices/result, không bịa dữ liệu.
- `PHOTO_EVIDENCE`: ảnh lớn + caption/source.
- `SCREEN_CAPTURE`: UI/screenshot trong TV/phone/computer frame.
- `FULL_SCENE_ACTION`: subject thực hiện verb lên object trong setting.
- `HISTORY_TIMELINE`: mốc thời gian và thay đổi theo giai đoạn.
- `VISUAL_METAPHOR`: setup/payoff có quan hệ rõ.

Renderer cần:

- focal asset chiếm 25-55% vùng content;
- infographic có ít nhất 3 vùng thông tin hoặc quan hệ;
- stage có foreground/midground và prop gắn vào anchor;
- photo/evidence có chế độ full-width/full-frame, không luôn là thumbnail;
- scene 7-9 giây có ít nhất hai visual states có ý nghĩa;
- animation làm rõ quan hệ, không dùng chuyển động để che frame rỗng.

## 8. Phase 5 — Pre-render gate chống điểm A giả

Sửa `src/ai/qualityCheck.ts` để tính từ cấu trúc đã compile:

- entity-shape histogram;
- visual fingerprint histogram;
- character/pose/stage/asset frequency;
- focal bounding-box occupancy;
- component thật theo register;
- label/text reuse;
- scene-state count;
- hero qualification;
- semantic relation giữa action/object/setting và transcript keywords.

Không tính `backgroundSrc` là “đầy” chỉ vì path tồn tại. Asset manifest và
compiler phải cung cấp density/occupancy proxy.

Thêm bad fixtures:

- `one-cat-one-prop-180-scenes`;
- `metadata-hero-only`;
- `sparse-stage-masquerading-as-tableau`;
- `same-pose-different-path`;
- `generic-heading-loop`;
- `photo-thumbnail-masquerading-as-broll`;
- `unmastered-existing-audio`.

Các fixture này phải fail đúng rule trong `npm run check`.

## 9. Phase 6 — Proxy render và feedback theo scene

Trước full render, tạo low-resolution proxy và chạy `visual-audit.py`:

- 480p hoặc 360p;
- sample mỗi 5 giây;
- xuất contact sheet;
- map mỗi sample về `sceneId`;
- liệt kê 20 scene flat nhất, duplicate clusters và scene edge thấp nhất.

Mở rộng report:

```json
{
  "worstFlatScenes": [],
  "duplicateScenePairs": [],
  "lowDensityScenes": [],
  "registerMetrics": {},
  "sectionMetrics": {}
}
```

Nếu proxy fail, repair đúng section/scene và render proxy lại tối đa hai vòng.
Không full-render video 25 phút khi proxy đã fail.

## 10. Phase 7 — Audio luôn được chuẩn hóa

Tách mastering khỏi nhánh TTS thành `prepareAudio()` dùng cho mọi nguồn:

1. Resolve audio timeline.
2. Audit LUFS/true peak.
3. Nếu ngoài chuẩn, tạo file mastered riêng.
4. Audit lại và cập nhật timeline/runtime props sang file mastered.
5. Sau khi mux MP4, audit audio stream lần cuối.

Không overwrite file raw. Cache theo checksum để không master lại cùng một audio.

Acceptance:

- Audio có sẵn ở -25.5 LUFS phải tự động thành khoảng -17 LUFS.
- Full MP4 phải nằm trong -18 đến -16 LUFS và true peak <=-1.5 dBTP.

## 11. Phase 8 — Encoding và publish profile

CRF 18 trên hình phẳng có thể cho bitrate rất thấp; tăng bitrate không tự tạo thêm
chi tiết hình. Vì vậy:

- Giữ CRF/preset chất lượng cho master render.
- Thêm publish profile 1080p H.264 với target 3-5 Mbps nếu nền tảng yêu cầu.
- Encoding audit kiểm tra codec, resolution, fps, pixel format và audio.
- Nếu giữ bitrate floor, dùng cấu hình encoder thật thay vì chỉ audit sau render.
- Không xem bitrate cao là thay thế cho edge density/visual diversity.

## 12. Thứ tự triển khai và commit

### Commit 1 — `feat(quality): make rendered output the publish source of truth`

- config mới;
- `publish.ts`;
- production report;
- fail-closed status.

### Commit 2 — `feat(schema): add treatment plans and visual fingerprints`

- schema/types;
- compiler fields;
- migration/backward compatibility.

### Commit 3 — `feat(director): plan scenes against visual usage budgets`

- story-map prompt;
- scene prompt;
- ledger;
- visual critic và repair pass.

### Commit 4 — `feat(assets): block semantic fallbacks and fulfill asset requests`

- asset request schema;
- manifest metadata;
- resolver budgets;
- unresolved state.

### Commit 5 — `feat(visuals): add evidence map chart and full-scene grammars`

- grammar registry;
- compiler;
- renderer;
- component tests.

### Commit 6 — `feat(quality): detect template repetition before render`

- structural gates;
- bad fixtures;
- threshold tests.

### Commit 7 — `feat(audit): add proxy render and scene-level visual feedback`

- proxy command;
- enhanced visual report;
- contact sheet;
- repair loop integration.

### Commit 8 — `fix(audio): master every narration source before render`

- centralized audio preparation;
- checksum cache;
- final mux audit.

### Commit 9 — `fix(render): enforce production encoding profile`

- codec/bitrate profile;
- final encoding audit;
- CLI completion semantics.

### Commit 10 — `test(e2e): lock reference-quality acceptance`

- chạy ít nhất ba transcript khác chủ đề;
- lưu metric summary;
- xác nhận không transcript nào quay lại template `cat + prop + label`.

## 13. Rollout

1. Dùng v3 làm regression fixture: pre-render gate mới phải bắt được lỗi mà gate cũ bỏ qua.
2. Tạo một bản 3-5 phút để tune prompt/grammar nhanh.
3. Chỉ khi proxy đạt toàn bộ metric mới chạy lại video 25 phút.
4. Chạy ba transcript khác chủ đề để tránh tối ưu riêng cho video-003.
5. Đặt pipeline mới làm mặc định; giữ `--diagnostic` cho artifact fail nhưng không
   bao giờ gắn nhãn production-ready.

