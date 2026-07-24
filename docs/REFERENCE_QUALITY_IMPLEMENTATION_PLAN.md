# Reference-quality implementation plan

Tài liệu này là kế hoạch sửa code và prompt ở mức triển khai. Mục tiêu là mọi video
mới có nhịp kể chuyện và độ đa dạng thị giác gần `refer/meo.mp4`, nhưng vẫn dùng
nhân vật, asset và cách thể hiện nguyên bản của project.

## 1. Kết luận sau khi audit toàn project

Pipeline hiện tại pass schema và render ổn, nhưng quality score không đo đúng chất
lượng kể chuyện. `video-003-tai-sao-eng-v2` đạt A dù:

- 143/180 scene dùng nền màu đơn.
- 90 scene là cặp character chung chung, không có prop/evidence/relation có nghĩa.
- Toàn bộ 180 scene chỉ dùng 6 đường dẫn entity; không dùng asset PNG đã generate.
- Visual audit thấp hơn refer: edge density `0.1136` so với `0.1968`,
  saturation `0.1223` so với `0.1816`, near-duplicate `24.92%` so với `17.57%`.
- Audio ở `-25.56 LUFS`, chưa có mastering.

Nguyên nhân trực tiếp của v2 là `projects/video-003-tai-sao-eng/prepare-local.js`:
scene grammar được chọn theo `i % 8`, nội dung card và cast được điền bằng mẫu cố
định. File này phải được coi là fixture thử nghiệm, không phải đường production.

Nguyên nhân hệ thống:

1. `storyboardPrompt.ts` dùng một call lớn cho cả transcript và chỉ yêu cầu
   grammar/slots, chưa yêu cầu scene phải giải thích ý nào bằng hành động gì.
2. `storyboardCompiler.ts` tự thay stage theo thứ tự “chưa dùng”, rồi chuyển sang
   nền pastel khi hết stage. Việc này làm mất ngữ cảnh và tạo nhiều nền màu đơn.
3. `visualGrammars.ts` fallback sang vài pose mèo mặc định; missing semantic asset
   không bị coi là lỗi.
4. Asset không có manifest semantic. Prompt biết tên file nhưng không biết asset
   thể hiện ai, hành động gì, prop gì, style nào hoặc dùng ở ngữ cảnh nào.
5. Quality gate đếm component/layout thay vì kiểm tra scene có truyền tải narration.
6. TTS bị chia theo visual scene và chèn `0.30s` sau mỗi scene; 180 scene tạo khoảng
   54 giây khoảng nghỉ nhân tạo.
7. Pixel audit đo cả subtitle band, nên chữ thay đổi có thể che giấu phần hình ảnh
   đang tĩnh.

## 2. Phần nên giữ và phần phải thay

### Giữ

- `SceneTimeline` là định dạng runtime.
- Compiler deterministic và Remotion render.
- Stage anchor registry.
- Các component `AnimatedAsset`, `PaperCard`, `FrameBox`, `SpeechBubble`, sau khi
  mở rộng metadata/layout.
- Gate trước render và audit sau render.
- Bộ PNG mèo teal trong `public/generated-assets/characters/` làm character lead.
  Nhân vật này có silhouette, màu, muzzle và dấu hiệu nhận diện riêng, phù hợp hơn
  bộ SVG mèo legacy đang bị trộn nhiều identity.

### Thay hoặc loại khỏi production

- Không dùng modulo/keyword helper như `prepare-local.js` để dựng storyboard.
- Bỏ `enforceDistinctStages()`: stage được chọn theo ngữ nghĩa, không theo tiêu chí
  “chưa từng dùng”.
- Bỏ `enrichBackgrounds()` theo kiểu quay vòng pastel.
- Không cho silent fallback sang `cat_explain`, `cat_think`, `cat` hoặc arrow.
- Không dùng một prompt duy nhất cho transcript dài.
- Không copy audio thô thẳng vào render.
- Không coi subtitle, hai character, hoặc một event motion là visual focal point.

## 3. Kiến trúc đích

```text
transcript
  -> normalize + stable word/source indices
  -> global story map: sections, claims, arc, visual opportunities
  -> section scene plans: 10-20 scenes/call
  -> deterministic coverage merge
  -> register/hero scheduler
  -> asset requests
  -> manifest resolver or asset generation queue
  -> natural-section TTS
  -> forced word alignment
  -> timing compiler
  -> semantic timeline gate
  -> Remotion render
  -> content-only visual audit + audio audit + encoding audit
```

Mỗi bước tạo artifact có version và có thể kiểm tra độc lập. LLM làm công việc
biên tập/ngữ nghĩa; code deterministic chịu trách nhiệm coverage, quota, timing,
layout, resolve asset và gate.

## 4. Schema mới

### 4.1. Project manifest

Tạo `src/types/project.ts` và `projects/<id>/project.json`:

```ts
type ProjectManifest = {
  schemaVersion: 2;
  projectId: string;
  language: string;
  transcriptPath: string;
  styleProfile: string;
  characterBible: string;
  storyboardPath: string;
  timelinePath: string;
  audioPath: string;
  wordsPath: string;
  qualityProfile: string;
};
```

CLI nhận `--project <directory>` ở mọi lệnh. `scripts/new-project.ts` hiện xuất
command có `--project`, nhưng generate/render chưa hỗ trợ nhất quán; cần sửa cùng
commit để tránh tài liệu mô tả một CLI không tồn tại.

### 4.2. Storyboard

Mở rộng `src/types/storyboard.ts`:

```ts
type SourceRange = {
  startWord: number;
  endWord: number;
  quoteChecksum: string;
};

type SemanticVisual = {
  subject: string;
  action: string;
  object?: string;
  relation?: string;
  setting?: string;
  takeaway: string;
};

type AssetRequest = {
  role: "character" | "prop" | "stage" | "photo" | "chart" | "ui";
  query: string;
  requiredTags: string[];
  preferredAssetId?: string;
  allowGenerate: boolean;
};

type SceneBriefV2 = {
  id: string;
  sectionId: string;
  sourceRange: SourceRange;
  narration: string;
  purpose: string;
  emotion: string;
  viewerFocus: string;
  visualRegister:
    | "character_action"
    | "infographic"
    | "evidence"
    | "photo_broll"
    | "framebox"
    | "visual_gag"
    | "full_tableau";
  visualGrammar: VisualGrammar;
  semanticVisual: SemanticVisual;
  claimIds: string[];
  heroVisual: boolean;
  assetRequests: AssetRequest[];
  continuity: {
    locationId?: string;
    castIds: string[];
    callbackId?: string;
  };
  slots: Record<string, unknown>;
  beats: Beat[];
};
```

Storyboard root thêm:

- `schemaVersion`.
- `transcriptChecksum` và `promptVersion`.
- `sections`: source range, thesis, emotional turn, target duration.
- `claims`: text, source range, evidence policy và scene IDs hỗ trợ.
- `cast`: character ID, identity, allowed costumes/actions.
- `generation`: provider/model, pass IDs, repair history.

Không cho LLM tự viết lại `narration`. Code cắt nguyên văn theo `sourceRange`; nếu
checksum không khớp thì fail coverage.

### 4.3. Asset manifest

Tạo `src/types/assets.ts`, `src/engine/assetManifest.ts` và
`public/assets.manifest.json`:

```ts
type AssetManifestEntry = {
  id: string;
  path: string;
  sha256: string;
  kind: "character" | "prop" | "stage" | "photo" | "chart" | "ui";
  styleFamily: "editorial_cat_v1" | "flat_stage_v1" | "photo" | "legacy";
  characterId?: string;
  emotion?: string[];
  action?: string[];
  topics?: string[];
  props?: string[];
  facing?: "left" | "right" | "front";
  contentBox?: { x: number; y: number; width: number; height: number };
  anchors?: Record<string, { x: number; y: number }>;
  source?: "original" | "generated" | "licensed";
};
```

Manifest phải scan cả SVG, PNG và JPG. Deduplicate bằng content hash, không chỉ
đường dẫn. Bốn cặp background hiện có cùng hash phải được gom alias thay vì được
quality gate tính là asset khác nhau.

## 5. Thiết kế prompt nhiều pass

### Pass A — global story map

Tạo `src/ai/prompts/storyMapPrompt.ts`. Input là transcript đã đánh stable word
indices. Output chỉ gồm:

- 5-12 section với source range không chồng lấn và phủ 100% transcript.
- thesis, claims, emotional turn và visual opportunities của từng section.
- danh sách claim cần evidence; không được bịa nguồn.
- hero visual schedule sơ bộ, khoảng cách tối đa 45 giây.
- visual motif/callback có thể tái sử dụng.

Không tạo scene chi tiết ở pass này. Với transcript dài, đây là “bản đồ” dùng chung
để các section call không mất mạch.

### Pass B — section scene planning

Tạo `src/ai/prompts/scenePlanPrompt.ts`. Mỗi call chỉ xử lý một section, thường
10-20 scene, và nhận:

- global story map.
- character/style bible.
- 15-30 asset candidates phù hợp được resolver prefilter.
- register history của section trước.
- grammar registry được generate từ code.

Thứ tự quyết định bắt buộc trong prompt:

1. Xác định ý chính trong source range.
2. Viết `semanticVisual`: subject làm gì với object nào, relation nào cần thấy.
3. Chọn visual register.
4. Chọn grammar.
5. Chọn hoặc yêu cầu asset.
6. Viết beats và timing.

Ràng buộc âm:

- Không đặt hai character cạnh nhau nếu không có action/relation/contrast rõ.
- Không dùng character pose để thay thế prop, biểu đồ, bản đồ hoặc evidence.
- Không dùng màu hex làm visual chính của BEAT.
- Không lặp cùng register quá hai scene liên tiếp.
- Không gán evidence cho claim không có trong transcript hoặc source đã cung cấp.
- Không dùng asset ngoài manifest bằng cách đoán path.
- Không để semantic visual không liên quan trực tiếp `sourceRange`.
- Mỗi scene phải có một câu `takeaway` mô tả điều người xem hiểu khi tắt tiếng.

Prompt phải có ít nhất bốn cặp good/bad example:

- Generic two-cat vs character action có prop/relation.
- Pastel title card vs infographic giải thích mechanism.
- Evidence card bịa số vs claim card không gắn con số.
- Stage đẹp nhưng sai bối cảnh vs stage phù hợp setting.

### Pass C — merge và coverage deterministic

Tạo `src/ai/transcriptCoverage.ts`:

- source range bắt đầu từ 0, kết thúc ở word cuối.
- không gap, không overlap ngoài tolerance cấu hình.
- checksum narration khớp transcript.
- scene duration ước tính 5-9 giây; câu dài được chia ở punctuation boundary.
- claim quan trọng có scene hỗ trợ.
- hero gap không quá 45 giây.

Code scheduler được phép yêu cầu repair, không tự thay semantic visual.

### Pass D — targeted repair

Tạo `src/ai/prompts/repairPrompt.ts`. Chỉ gửi scene fail, lỗi cụ thể, hai scene
liền trước/sau và asset candidates. Không regenerate toàn storyboard khi một gate
fail. Mỗi scene tối đa hai lần repair; sau đó dừng với lỗi actionable.

### Prompt source of truth

Tạo `src/ai/directorPolicy.ts` chứa policy dùng chung. `storyboardPrompt.ts`,
command docs và validator phải lấy grammar/quota từ registry/config, không copy
hardcode. `src/ai/systemPrompt.ts` legacy 1.360 dòng không còn là source production;
đánh dấu deprecated và chỉ giữ adapter cho project schema v1.

## 6. Compiler và visual grammar

### `src/engine/visualGrammars.ts`

- Chuyển các `switch` thành `grammarRegistry`, mỗi grammar khai báo:
  `requiredSlots`, `supportedRegisters`, `compiler`, `validator`, `promptExample`.
- `castSrc()` không được fallback. Unknown cast/asset trả `UNRESOLVED_ASSET`.
- `COMPARE` bắt buộc hai phía có label và visual difference có nghĩa.
- `POLICY_LIST` không clone cùng một `characters/cat`.
- `DIAGRAM` bắt buộc node semantic và relation label; arrow đơn lẻ không đủ.
- `EVIDENCE` dùng claim text ngắn, source/date/status; không copy toàn narration.
- `BEAT` chỉ dùng cho punctuation/emotional pause ngắn, không phải nền pastel.
- `SOLO` bắt buộc action, prop, expression hoặc costume liên quan narration.

### `src/engine/storyboardCompiler.ts`

- Xóa `POSE_CYCLE` legacy; resolve pose qua asset manifest.
- Xóa `enforceDistinctStages()`.
- Xóa pastel rotation trong `enrichBackgrounds()`.
- Thêm `resolveSemanticAssets()`: exact ID -> semantic candidate -> generation
  request. Không tìm được asset bắt buộc thì fail trước render.
- Stage reuse được cho phép khi cùng location/section; dùng cooldown để tránh ba
  shot giống nhau, không ép đổi location vô nghĩa.
- Dùng register scheduler deterministic để kiểm tra phân phối, nhưng không đổi ý
  nghĩa scene. Scheduler fail thì gửi scene về repair pass.
- `liveliness.ts` chỉ bổ sung motion sau khi semantic scene hợp lệ. Pose swap phải
  là action beat có chủ đích, không quay vòng ba pose để “tạo nhịp”.

### `src/engine/sceneCompiler.ts`

- Subtitle cue lấy từ forced-aligned words, không chia đều theo số ký tự.
- Tách câu ở punctuation/phrase boundary; cấm dòng kết thúc bằng giới từ/mạo từ
  phổ biến của ngôn ngữ.
- Asset placement dùng `contentBox`, foot/hand/gaze anchors, facing và flip.
- Thêm layout collision pass cho subtitle, speech bubble, evidence card và focal
  object.
- Scene metadata ghi `sourceRange`, `register`, `semanticAssetIds`, `claimIds`,
  `heroVisual` để quality check không phải đoán từ event.

### Components

- `AnimatedAsset.tsx`: bỏ box vuông 200px cố định; dùng intrinsic aspect ratio,
  `contentBox`, ground anchor, facing và explicit z-plane.
- `SpeechBubble.tsx`: đo text thực, clamp canvas, tránh subtitle band.
- `PaperCard.tsx`: thêm claim/source/date/highlight hierarchy.
- `FrameBox.tsx`: hỗ trợ photo/footage caption, source và safe crop.
- Wire `ConceptCard` vào Scene DSL hoặc xóa dead component; không để component tồn
  tại nhưng prompt/compiler không thể tạo.
- Tạo shared typography/color/outline tokens theo `style-profile.json`.

## 7. Character và asset strategy

Bộ PNG teal hiện có trong `public/generated-assets/characters/` phải trở thành lead
identity thay vì tiếp tục dùng xen kẽ các mèo SVG cam/tím/trắng. Character bible:

- silhouette: thân squat, một tai gập.
- dominant color: teal.
- muzzle: cream lệch.
- signature: rust stripes và khăn mustard.
- outline/eye/mouth proportions cố định.

Đây là character nguyên bản, không sao chép mèo của refer. Mỗi video dài cần
20-30 biến thể có ý nghĩa, tính theo tổ hợp action/costume/prop chứ không chỉ đổi
file pose. Ưu tiên asset theo narration:

1. Tái sử dụng pose đúng nghĩa trong manifest.
2. Kết hợp lead + semantic prop.
3. Dùng stage/infographic/photo/evidence.
4. Generate asset mới có request cụ thể.

Tạo `scripts/build-asset-manifest.ts`. Sửa `scripts/list-assets.ts` và asset listing
trong prompt để scan manifest, cả PNG/JPG, và đọc `scenes[]` thay vì chỉ `events[]`.

Stage registry thêm `topics`, `settings`, `mood`, `allowedActions`,
`foregroundZones`. Prompt thấy mô tả semantic của stage thay vì chỉ path và tên
anchor.

## 8. Audio và timing

### TTS

- Không synthesize mỗi visual scene.
- Chia transcript thành paragraph/section tự nhiên, giữ punctuation.
- Xóa fixed `0.30s` gap trong `tts_kokoro.py` và `tts_edge.py`; chỉ thêm pause theo
  punctuation hoặc SSML/prosody policy.
- Synthesize section chunks, concatenate có crossfade rất ngắn nếu cần.
- Forced-align audio hoàn chỉnh rồi map stable transcript word index sang time.

`align_words.py` phải output:

```json
{
  "wordIndex": 123,
  "text": "example",
  "start": 12.34,
  "end": 12.61,
  "confidence": 0.94
}
```

Scene timing được suy ra từ `sourceRange`, không dùng tốc độ 2.5 words/second sau
khi audio thật đã tồn tại.

### Mastering

Tạo `scripts/master-audio.py`:

- loudness target mặc định `-17 LUFS`.
- acceptable range `-18` đến `-16 LUFS`.
- true peak tối đa `-1.5 dBTP`.
- giữ dynamic range hợp lý, không normalize peak đơn thuần.

Tạo `scripts/audio-audit.py`; render fail nếu loudness/true peak ngoài ngưỡng hoặc
có khoảng silence bất thường. Lưu report trong project reports directory.

## 9. Quality gate mới

### Pre-render semantic gate

Sửa `src/ai/qualityCheck.ts`:

| Rule | Severity |
|---|---|
| Transcript coverage/checksum không 100% | blocker |
| Scene không có focal point semantic | blocker |
| Generic two-character không action/relation | major |
| Unresolved/fallback asset | blocker |
| Solid-color scene >50% | major |
| Hero visual gap >45s | major |
| Một register >35% | major |
| Cùng register >2 scene liên tiếp | minor/major theo độ dài run |
| Factual claim thiếu evidence policy | major |
| Asset style-family conflict | major |
| Unique semantic variants dưới ngưỡng | major |
| Stage không phù hợp setting tag | major |

`hasAnchor` không được tính từ “có text” hoặc “có hai entities”. Focal point chỉ
được tính từ scene metadata đã compile và validator của grammar.

Ngưỡng unique variants:

- dưới 5 phút: tối thiểu 12.
- 5-10 phút: tối thiểu 16.
- trên 10 phút: tối thiểu 20; mục tiêu 25-30.

Visual register phải có ít nhất 5 loại. Phân phối mục tiêu, không phải quota cứng
cho mọi chủ đề:

- character action/full tableau: 25-40%.
- infographic/diagram: 15-25%.
- evidence/framebox: 10-20%.
- photo/B-roll: 8-15%.
- visual gag: 5-12%.
- không loại nào vượt 35% nếu tính riêng.

### Storyboard gate

`runStoryboardCheck()` hiện chỉ in report rồi tiếp tục. Trong production:

- blocker/major phải dừng trước compile.
- chỉ `--diagnostic` mới cho phép tiếp tục.
- report có scene ID, source quote, failed invariant và repair suggestion.

### Post-render visual audit

Sửa `scripts/visual-audit.py`:

- mask/crop subtitle band trước khi tính edge, saturation và pHash.
- đo flat-area ratio riêng; không đồng nhất “white dominant” với nền màu đơn.
- xuất mean, p10, p50 và longest low-motion run.
- map sample timestamp về scene ID.
- thêm optical-flow hoặc structural-change score giữa sample.
- mỗi threshold bắt buộc fail độc lập; bỏ logic “phải có hai lỗi mới fail”.

Ngưỡng production:

- content edge density mean `>=0.16`.
- content saturation mean `>=0.15`.
- near-duplicate `<=22%`.
- solid/flat scene `<=50%`, mục tiêu `<=45%`.
- hero gap `<=45s`.

### Encoding audit

`scripts/render.ts` cần render profile rõ ràng: codec, CRF/bitrate, pixel format,
audio codec/bitrate. Sau render chạy `ffprobe` kiểm tra resolution, duration,
frame rate, bitrate floor và audio stream. Tránh output 1080p chỉ khoảng 0.5 Mbps
nếu visual phức tạp.

## 10. Test strategy

Thêm test runner và các nhóm test:

### Unit

- transcript coverage: gap, overlap, checksum, Unicode.
- register scheduler và hero gap.
- asset resolver: exact, semantic, duplicate hash, unresolved.
- grammar validators: generic pair, empty focal point, evidence source.
- stage semantic matching và cooldown.
- word-aligned subtitle cue.
- character/style-family consistency.
- audio report threshold.

### Fixture failures

Tạo storyboard nhỏ cố ý có:

- hai mèo chung chung.
- pastel BEAT.
- evidence bịa.
- stage sai context.
- repeated register.
- missing source range.

Mỗi fixture phải fail đúng rule; đây là cách ngăn quality score A giả như v2.

### Golden projects

- Golden short: 60-90 giây, chạy trong CI thường xuyên.
- Golden long: bản rút gọn nhiều section, chạy nightly/manual.
- Regenerate `video-003-tai-sao-eng` bằng pipeline mới làm acceptance project đầu
  tiên, không dùng timeline từ `prepare-local.js`.

Snapshot cần lưu:

- story map/schema.
- timeline semantic metadata.
- quality report.
- 10-20 frame timestamps cố định.
- audio/visual audit JSON.

Không snapshot toàn MP4 vào git. Dùng checksum/report và explicit golden fixture.

## 11. Thay đổi theo file

| File hiện tại | Thay đổi chính |
|---|---|
| `scripts/generate-timeline.ts` | Orchestrate four passes, validate từng artifact, project manifest, block gate |
| `src/ai/storyboardPrompt.ts` | Tách thành prompt modules; giữ adapter v1 |
| `src/types/storyboard.ts` | Schema v2, source range, semantic visual, assets, provenance |
| `src/engine/storyboardCompiler.ts` | Bỏ pose/stage/pastel rotation; semantic resolve |
| `src/engine/visualGrammars.ts` | Registry + validators; không silent fallback |
| `src/engine/sceneCompiler.ts` | Word timing, semantic metadata, anchor/collision layout |
| `src/engine/liveliness.ts` | Motion theo action beat, không pose cycling |
| `src/engine/timelineEngine.ts` | Pre-index events theo asset/frame thay vì scan/sort mỗi frame |
| `src/components/AnimatedAsset.tsx` | Intrinsic bounds, anchors, facing |
| `src/components/SpeechBubble.tsx` | Text measurement, clamp/collision |
| `src/components/PaperCard.tsx` | Evidence hierarchy và source |
| `src/components/FrameBox.tsx` | Photo/video caption và crop |
| `src/ai/backgroundResolver.ts` | Manifest semantics + content hash |
| `src/ai/qualityCheck.ts` | Semantic rules, distribution, hero, fallback |
| `src/ai/validateTimeline.ts` | Versioned schema, semantic metadata |
| `scripts/visual-audit.py` | Subtitle mask, percentiles, motion, scene mapping |
| `scripts/tts_kokoro.py` | Section chunks; bỏ 0.30s/scene |
| `scripts/tts_edge.py` | Cùng timing policy với Kokoro |
| `scripts/align_words.py` | Stable word indices/confidence |
| `scripts/render.ts` | Render profile + visual/audio/encoding audit |
| `scripts/new-project.ts` | CLI thật sự dùng `--project`; ID không dựa directory count |
| `scripts/list-assets.ts` | Asset manifest, PNG/JPG và `scenes[]` |
| `src/Root.tsx` | Project-aware preview, không copy timeline về root |
| `.claude/commands/*.md` | Cập nhật Scene DSL/schema v2/CLI; bỏ hướng dẫn event legacy |
| `README.md`, `WORKFLOW.md` | Một source of truth, link architecture và quality profile |

## 12. Thứ tự triển khai và commit

### Commit 1 — Baseline và test harness

- Chốt `config/reference-quality.json` và `config/style-profile.json`.
- Thêm test runner, bad fixtures và baseline report của v2/refer.
- Không thay output production.

### Commit 2 — Project/schema v2

- Project manifest, storyboard v2, stable transcript indices/checksum.
- Coverage validator và v1 compatibility reader.

### Commit 3 — Grammar registry và prompt policy

- Grammar registry là source chung cho prompt/compiler/validator.
- Story map, scene plan, repair prompts.
- Unit tests cho JSON/schema và negative constraints.

### Commit 4 — Multipass generation

- Refactor `generate-timeline.ts`.
- Section calls, deterministic merge, targeted repair.
- Storyboard major/blocker thực sự dừng pipeline.

### Commit 5 — Asset manifest và character lock

- Build manifest, hash dedupe, semantic resolver.
- Wire bộ PNG teal làm lead.
- Stage semantic metadata và generation queue.

### Commit 6 — Compiler không fallback

- Bỏ modulo/pose cycle/arbitrary stage/pastel enrichment.
- Compile semantic assets, metadata, anchors và register continuity.

### Commit 7 — Grammar/component depth

- Evidence, infographic, photo/framebox, tableau action và visual gag.
- Intrinsic asset bounds, collision, typography/style tokens.

### Commit 8 — Natural TTS và mastering

- Section TTS, forced alignment, source-range timing.
- Loudness normalize và audio audit.

### Commit 9 — Production quality gates

- Semantic pre-render gates.
- Content-only visual audit, scene mapping và encoding audit.

### Commit 10 — Tooling/docs/golden regeneration

- Project-aware preview.
- Sửa commands/docs stale.
- Regenerate `video-003-tai-sao-eng`, so sánh report/frame với refer.

Mỗi commit phải pass typecheck, unit tests và fixture tests. Từ Commit 6 trở đi,
golden short phải render pass trước khi merge. Không trộn generated MP4/WAV/log/PID
vào commit code.

## 13. Definition of done

Một video production chỉ hoàn tất khi:

- transcript coverage/checksum 100%.
- không unresolved asset, empty focal point hoặc generic character pair.
- nền đơn không quá 50%, mục tiêu dưới 45%.
- ít nhất 5 visual registers, không register nào quá 35%.
- hero visual tối thiểu mỗi 45 giây.
- video dài có tối thiểu 20 semantic variants, mục tiêu 25-30.
- mọi factual claim quan trọng có evidence treatment hợp lệ.
- edge density `>=0.16`, saturation `>=0.15`, near-duplicate `<=22%`.
- audio từ `-18` đến `-16 LUFS`, true peak `<=-1.5 dBTP`.
- encoding audit pass.
- typecheck, unit, bad fixtures và golden render pass.

## 14. Ưu tiên thực hiện ngay

Không nên bắt đầu bằng generate thêm hàng loạt asset. Ba việc đầu tiên có hiệu quả
cao nhất là:

1. Thêm schema/source-range và bad fixture để quality gate không còn cho v2 điểm A.
2. Thay one-shot prompt bằng global map + section scene plan + targeted repair.
3. Bỏ mọi silent fallback/arbitrary stage/pastel rotation và nối asset manifest với
   bộ character PNG teal hiện có.

Sau ba bước này, asset mới được generate theo request có nghĩa; nếu generate asset
trước, pipeline hiện tại vẫn không biết chọn và đặt chúng đúng narration.
