# Reference-quality production plan

> **HISTORICAL (2026-07-28):** Baseline và một số lệnh trong tài liệu này đã cũ.
> Dùng `AGENTS.md` + `CLAUDE.md` cho workflow production hiện hành.

Mục tiêu: mọi video mới đạt nhịp kể chuyện và độ đa dạng thị giác gần
`refer/meo.mp4`, nhưng dùng character/art nguyên bản của project. Không sao chép
nhân vật mèo tím, frame cụ thể, logo, quảng cáo hoặc footage của bản refer.

## 1. Khoảng cách hiện tại

`video-003-tai-sao-eng-v2` đã đúng pipeline và đạt chất lượng kỹ thuật cơ bản,
nhưng quality gate hiện chưa phản ánh đúng chất lượng hình ảnh:

- 143/180 scene dùng nền màu đơn, tương đương 79,4%.
- 22 scene không có entity; 90 scene không có text visual.
- Entity chủ yếu lặp các pose mèo mặc định và `ui/arrow_right`.
- Pixel audit: edge density `0.1136`, saturation `0.1223`,
  near-duplicate `24.92%`.
- Loudness tích hợp `-25.56 LUFS`, thấp hơn mức xuất bản mục tiêu.
- Prompt yêu cầu `TABLEAU ≥35%`, nhưng quality gate hiện chỉ fail dưới 20%.
- Visual audit hiện chỉ fail khi có ít nhất hai triệu chứng, nên một video thiếu
  visual density rõ rệt vẫn có thể pass.

Nguyên nhân gốc:

1. Storyboard chỉ chọn grammar và điền slot; chưa lập kế hoạch asset theo ý nghĩa.
2. Compiler fallback sang pose mèo chung chung khi slot không đủ cụ thể.
3. Asset hiện có không có manifest semantic để tìm theo hành động/đạo cụ/chủ đề.
4. Gate đếm layout/component nhưng chưa kiểm tra visual có truyền đạt narration.
5. Audio được đưa thẳng vào Remotion, chưa có bước mastering và đo loudness.

## 2. Definition of done cho mọi video mới

### 2.1. Chỉ số storyboard/timeline

| Chỉ số | Ngưỡng bắt buộc | Mục tiêu |
|---|---:|---:|
| Nền màu đơn | ≤50% scene | ≤45% |
| Khoảng cách giữa hai hero visual | ≤45 giây | 30-40 giây |
| Scene không có visual focal point | 0 | 0 |
| Generic two-cat scene không có quan hệ/hành động | 0 | 0 |
| Evidence/FrameBox cho claim factual | 100% claim quan trọng | 100% |
| Số visual register có mặt | ≥5 | 6-7 |
| Một register chiếm toàn video | ≤35% | ≤30% |
| Cùng register liên tiếp | Không quá 2 shot | Luân phiên từng shot |
| Shot trung bình | 5-9 giây | 6-8 giây |
| Unique pose/costume/prop dùng trong video dài | ≥20 | 25-30 |
| Topic-specific hero asset | ≥1 mỗi 60 giây | ≥1 mỗi 45 giây |

Một scene có `visual focal point` khi có ít nhất một thành phần truyền tải ý:
character action có chủ đích, semantic prop, infographic, evidence card,
frame box, ảnh/B-roll, stage tableau hoặc visual gag. Phụ đề không được tính là
visual focal point.

`Generic two-cat scene` là scene có từ hai character trở lên nhưng không có
prop, action, speech bubble, evidence, diagram, stage relation hoặc contrast
label giải thích vì sao hai nhân vật xuất hiện.

### 2.2. Chỉ số MP4 sau render

| Chỉ số | Ngưỡng pass |
|---|---:|
| Mean edge density | ≥0.16 |
| Mean saturation | ≥0.15 |
| Near-duplicate ratio, sample 5 giây | ≤22% |
| Loudness tích hợp | -18 đến -16 LUFS |
| True peak | ≤-1.5 dBTP |

Không dùng cơ chế “hai lỗi mới fail”. Mỗi chỉ số bắt buộc vượt ngưỡng đều làm
production render fail; escape hatch chỉ dành cho chẩn đoán.

## 3. Pipeline mục tiêu

```text
Transcript
  → claim/concept extraction
  → semantic storyboard
  → register scheduler + hero-visual planner
  → asset manifest/resolver
  → generate/reuse missing assets
  → TTS + audio mastering
  → deterministic timeline compiler
  → pre-render semantic/structural gate
  → Remotion render
  → pixel + loudness audit
  → contact sheet/golden comparison
```

## 4. Giải pháp theo lớp

### P0 — Baseline và cấu hình quality dùng chung

Tạo `config/reference-quality.json` làm single source of truth:

```json
{
  "maxSolidBackgroundRatio": 0.5,
  "targetSolidBackgroundRatio": 0.45,
  "maxHeroGapSeconds": 45,
  "minVisualRegisters": 5,
  "maxRegisterRatio": 0.35,
  "maxRegisterStreak": 2,
  "minUniqueSemanticAssetsLongVideo": 20,
  "minEdgeDensity": 0.16,
  "minSaturation": 0.15,
  "maxNearDuplicateRatio": 0.22,
  "targetLufs": -17,
  "lufsTolerance": 1,
  "maxTruePeakDbtp": -1.5
}
```

Mọi prompt, quality check, visual audit và tài liệu phải đọc cùng cấu hình này;
không để prompt yêu cầu 35% nhưng gate chỉ kiểm tra 20%.

### P1 — Semantic storyboard thay cho template storyboard

Mở rộng `SceneBrief` trong `src/types/storyboard.ts`:

```ts
type VisualRegister =
  | "character_action"
  | "tableau"
  | "infographic"
  | "evidence"
  | "framebox"
  | "photo_broll"
  | "visual_gag";

interface SemanticVisual {
  subject: string;
  action?: string;
  relation?: string;
  setting?: string;
  props?: string[];
  dataShape?: "stat" | "compare" | "timeline" | "map" | "ranking" | "flow";
}

interface HeroVisualPlan {
  enabled: boolean;
  type?: "infographic" | "evidence" | "photo" | "tableau" | "gag";
  reason?: string;
}
```

Thêm vào mỗi `SceneBrief`:

- `visualRegister`
- `semanticVisual`
- `heroVisual`
- `claimId` nếu scene chứa claim factual
- `assetStrategy`: `reuse | generate | photo | diagram`

Thay đổi `src/ai/storyboardPrompt.ts`:

- Bắt buộc mô tả `subject + action/relation + prop/setting`.
- Cấm dùng hai mèo chỉ để lấp hai bên khung hình.
- Mỗi cửa sổ 45 giây phải có hero visual.
- Claim số liệu/chính sách phải sinh `claimId` và register evidence/framebox.
- Chọn visual theo ý nghĩa narration trước, grammar chỉ là cách trình bày.
- Lập register sequence toàn video rồi mới điền từng scene.

Thêm `src/ai/registerScheduler.ts` để kiểm tra và sửa lịch register theo cửa sổ
thời gian, không dựa vào modulo scene.

### P2 — Asset manifest và semantic resolver

Tạo `public/assets/manifest.json` hoặc manifest TypeScript được validate, mỗi
asset có metadata:

```json
{
  "src": "characters/lead_point_money",
  "kind": "character_pose",
  "character": "lead",
  "emotions": ["concern"],
  "actions": ["point", "inspect"],
  "topics": ["money", "policy"],
  "props": ["finance/money"],
  "facing": "right",
  "anchors": ["left_hand", "gaze"],
  "transparent": true
}
```

Tạo `src/engine/assetResolver.ts`:

1. Tìm asset khớp character + action + emotion + topic + facing.
2. Nếu không khớp đủ, trả về `missingAssetRequest`; không âm thầm fallback sang
   `cat_explain`.
3. Chỉ cho phép pose chung ở SOLO transition ngắn, không dùng cho semantic shot.
4. Ghi `projects/<id>/asset-plan.json` gồm asset reuse, asset cần sinh và lý do.

#### Character lock

Mỗi nhân vật chính phải có `character-lock.json` chứa:

- silhouette và tỷ lệ đầu/thân;
- màu chính/phụ/accent chính xác;
- cấu trúc mắt, mõm, tai, đuôi;
- signature mark và phụ kiện;
- độ dày/độ rung nét;
- expression range;
- hand/prop/gaze anchors.

Asset mới giữ nguyên lock này. Nhân vật lead phải khác refer ít nhất ở silhouette,
màu chủ đạo, cấu trúc mõm và signature mark. Không dùng mèo tím, bean body và
white oval muzzle giống refer.

#### Pose matrix

Xây bộ nền 24 pose cho lead:

- 8 emotion/reaction: neutral, skeptical, happy, sad, shocked, worried, angry,
  embarrassed;
- 8 action: point left/right, hold, inspect, compare, carry, work, walk;
- 4 dialogue relation: ask, answer, agree, disagree;
- 4 costume/context: office, teacher, worker, authority.

Mỗi video sinh thêm 6-10 topic-specific cutout/scene asset. Như vậy video dài
dùng được 20-30 pose/costume/prop có ý nghĩa mà không cần sinh lại toàn bộ cast.

### P3 — Grammar và hero visual systems

Giữ các grammar đang có, nhưng thêm grammar semantic:

- `MAP_HIGHLIGHT`: quốc gia/khu vực + highlight + label.
- `TIMELINE_HISTORY`: các mốc lịch sử có nhân vật/đạo cụ.
- `POPULATION_PYRAMID`: tuổi/giới/dân số.
- `RANKING_LINEUP`: xếp hạng có scale và medal.
- `POLICY_COMPARE`: quốc gia → chính sách → tác động.
- `BUDGET_BREAKDOWN`: tiền/thuế/trợ cấp.
- `THRESHOLD_SCALE`: trước/sau một ngưỡng.
- `MATCHING_GRAPH`: người/nhóm và quan hệ.
- `NEWS_EVIDENCE`: headline, source, date, highlight.
- `SURVEY_CARD`: câu hỏi + lựa chọn + kết quả.
- `VISUAL_GAG`: setup → reveal bằng action/prop.

Sửa grammar hiện tại:

- `COMPARE` không mặc định hai mèo; dùng concept icon/prop hoặc cast đúng vai.
- `POLICY_LIST` không mặc định clone `characters/cat`; mỗi item dùng icon,
  costume hoặc semantic asset riêng.
- `DIALOGUE_QA` bắt buộc `relation` và ít nhất một bubble/action.
- `CHAR_PROP` đặt prop theo hand/gaze anchor thực, không chỉ đặt cạnh nhân vật.
- `SOLO` không được dùng khi narration nói về quan hệ, dữ liệu hoặc địa điểm.
- `BEAT` phải có image/scene asset thật; không fallback về nền màu.

Hero visual planner chọn tối thiểu một trong các dạng sau mỗi 30-45 giây:

1. full tableau có action;
2. infographic/data visual;
3. evidence/news/survey;
4. ảnh/B-roll có khung hoặc annotation;
5. visual gag có setup/reveal.

Không áp quota ảnh thật cố định “tối đa 5 scene”. Thay bằng:

- ảnh phải có mục đích và semantic tag;
- không lặp cùng ảnh;
- không để ảnh full-bleed quá hai shot liên tiếp;
- nguồn/giấy phép được ghi trong asset manifest.

### P4 — Pre-render quality gate

Thêm các check vào `src/ai/qualityCheck.ts`:

- `SOLID_BACKGROUND_RATIO`: MAJOR khi >50%, BLOCKER khi >65%.
- `HERO_VISUAL_GAP`: BLOCKER nếu bất kỳ khoảng nào >45 giây.
- `EMPTY_VISUAL_FOCUS`: BLOCKER nếu scene không có focal point ngoài subtitle.
- `GENERIC_CHARACTER_PAIR`: MAJOR cho scene hai mèo không có relation/action.
- `SEMANTIC_ASSET_COVERAGE`: MAJOR nếu semantic scene dùng generic fallback.
- `UNIQUE_ASSET_DENSITY`: video ≥10 phút phải dùng ≥20 semantic asset độc nhất.
- `REGISTER_DIVERSITY`: ≥5 register, không register nào >35%.
- `REGISTER_STREAK`: không quá hai scene cùng register.
- `CLAIM_EVIDENCE_COVERAGE`: claim quan trọng phải có evidence/framebox/data visual.
- `HERO_ASSET_DENSITY`: ≥1 topic-specific hero asset mỗi 60 giây.

Gate phải tính theo duration/time window, không chỉ theo tổng số scene. Một video
có đủ quota tổng nhưng dồn toàn bộ evidence vào cuối vẫn phải fail.

### P5 — Post-render visual audit

Sửa `scripts/visual-audit.py`:

- đọc ngưỡng từ `config/reference-quality.json`;
- fail ngay khi một metric bắt buộc không đạt;
- giữ sample 5 giây cho full render, thêm sample 2 giây cho golden fixture;
- báo percentile, không chỉ mean;
- đo longest near-duplicate run và timestamp của các đoạn phẳng;
- xuất danh sách timestamp có edge/saturation thấp để sửa đúng scene;
- sinh contact sheet theo register/hero window.

Visual audit không thể tự hiểu hoàn toàn semantic alignment. Vì vậy report cần
join với timeline để chỉ ra scene ID tại timestamp lỗi.

### P6 — Audio mastering

Thêm `scripts/master-audio.ts` hoặc `scripts/master-audio.py` chạy sau TTS:

1. Đo loudness đầu vào.
2. Normalize hai pass về `-17 LUFS`, true peak `-1.5 dBTP`.
3. Giữ file raw để chẩn đoán; Remotion dùng file mastered.
4. Ghi `projects/<id>/audio-audit.json`.
5. Fail nếu output nằm ngoài `-18..-16 LUFS`, clipping hoặc có silence run bất thường.

`generate-timeline.ts` chỉ copy audio mastered sang `public/audio/<id>/voice.wav`.
Với v2 hiện tại, cần tăng khoảng 8,5 dB theo loudness tích hợp đo được; không dùng
gain cố định cho mọi video.

### P7 — Golden regression

Tạo hai fixture:

- `golden-short`: 60-90 giây, có stat, dialogue, evidence, tableau và gag.
- `golden-long`: 8-12 phút, kiểm tra hero window và asset diversity.

Lưu baseline:

- storyboard/timeline;
- asset plan;
- quality JSON;
- contact sheet;
- visual audit;
- audio audit.

Sau thay đổi prompt/compiler/grammar:

1. compile cả hai fixture;
2. chạy pre-render gate;
3. render short fixture;
4. chạy pixel/audio audit;
5. so metric với baseline;
6. chỉ merge khi không regression.

## 5. Thứ tự triển khai và commit

### Commit 1 — `feat(quality): centralize reference targets`

- Thêm `config/reference-quality.json`.
- Đồng bộ prompt, timeline gate và pixel audit với cùng ngưỡng.
- Siết solid background, hero gap và pixel thresholds.

### Commit 2 — `feat(storyboard): add semantic visual planning`

- Mở rộng schema `SceneBrief`.
- Cập nhật storyboard prompt.
- Thêm register scheduler và claim/hero window checks.

### Commit 3 — `feat(assets): add character lock and semantic manifest`

- Character lock cho lead/cast.
- Asset manifest và resolver.
- Xuất `asset-plan.json`; bỏ silent fallback cho semantic scene.

### Commit 4 — `feat(visuals): add semantic hero grammars`

- Thêm map, timeline, population, ranking, policy, evidence và gag grammar.
- Sửa COMPARE/POLICY_LIST/DIALOGUE/CHAR_PROP fallback.
- Thêm hand/prop/gaze anchors.

### Commit 5 — `feat(audio): master narration to publish loudness`

- Hai-pass loudness normalize.
- Audio audit và production gate.

### Commit 6 — `test(golden): add visual regression fixtures`

- Golden short/long.
- Baseline metric và contact sheet.
- Script regression chạy trước merge.

## 6. Tiêu chí nghiệm thu cuối

Một video mới chỉ được coi là production-ready khi:

- 0 blocker, 0 major;
- đạt toàn bộ metric ở mục 2;
- asset plan không còn unresolved semantic request;
- không có generic two-cat scene;
- mọi khoảng 45 giây đều có hero visual;
- mọi claim quan trọng đều được “thấy”, không chỉ được đọc;
- visual audit và audio audit đều pass;
- contact sheet cho thấy register thay đổi đều từ đầu đến cuối.

## Escape hatches

Các flag sau chỉ dùng cho chẩn đoán, không dùng để xuất bản:

- `--legacy-direct`
- `--skip-quality`
- `--skip-visual-audit`
- `--skip-validate`
