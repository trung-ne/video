import * as fs from "fs";
import * as path from "path";
import { backgroundImageExists, isCSSBackground } from "./backgroundResolver";
import { resolveAssetSrcStrict } from "../engine/assetPaths";
import { STAGE_ANCHORS } from "../engine/stageAnchors";
import { getGrammarDefinition } from "../engine/grammarRegistry";
import { stageMatchesSetting } from "../engine/stageRegistry";
import referenceQuality from "../../config/reference-quality.json";

const STAGE_ANCHORS_KEYS = new Set(Object.keys(STAGE_ANCHORS));

// ============================================================
// qualityCheck.ts — comprehensive quality gate for SceneTimeline
//
// Checks ALL 22 output rules + SHOW DON'T TELL principles from CLAUDE.md.
// Produces a scored report with:
//   BLOCKER  — must fix before render (breaks the video visually)
//   MAJOR    — degrades quality significantly
//   MINOR    — polish issues
//   PASS     — rule satisfied
//
// Usage:
//   import { runQualityCheck, printQualityReport } from "./qualityCheck";
//   const report = runQualityCheck(timeline);
//   printQualityReport(report);
// ============================================================

// ─── Types ───────────────────────────────────────────────────

export type IssueSeverity = "BLOCKER" | "MAJOR" | "MINOR";

export interface QualityIssue {
  severity: IssueSeverity;
  rule: string;      // short rule name, e.g. "BACKGROUND_REAL"
  scene?: string;    // scene id if scene-specific
  message: string;
  suggestion?: string;
}

export interface CheckResult {
  name: string;
  passed: boolean;
  issues: QualityIssue[];
}

export interface QualityReport {
  timelinePath: string;
  scorePercent: number;         // 0-100, weighted by severity
  grade: "A" | "B" | "C" | "D" | "F";
  blockers: number;
  majors: number;
  minors: number;
  checks: CheckResult[];
  summary: string[];            // top action items to fix
}

// ─── Constants ───────────────────────────────────────────────

// Scenes whose layout is intentionally abstract (gradient/white OK)
const ABSTRACT_LAYOUTS = new Set([
  "STAT_DRAMA", "STAT", "ICON_TRIPLE", "CLOSE_UP", "SIZE_HIERARCHY",
]);

// Solo-character layouts — a single cat centered. >40% of these = monotone.
const SOLO_LAYOUTS = new Set(["SOLO", "CLOSE_UP", "SINGLE", "INTRO"]);

// Neutral cat pose — valid only when truly no emotion cue in scene
const NEUTRAL_CAT_SRCS = new Set(["characters/cat"]);

// Cat pose variants that express emotion
const EXPRESSIVE_POSES = new Set([
  "characters/cat_explain", "characters/cat_talk", "characters/cat_think",
  "characters/cat_surprised", "characters/cat_happy", "characters/cat_sad",
  "characters/cat_shrug", "characters/cat_point_left", "characters/cat_business",
  "characters/cat_worker", "characters/cat_teacher", "characters/cat_dad",
  "characters/cat_mom", "characters/cat_child_boy", "characters/cat_child_girl",
  "characters/cat_police", "characters/cat_sunglasses",
]);

// Slots that live in the Y=0.08-0.30 "top band" — should not stack
const TOP_BAND_SLOTS = new Set(["TOP_TITLE", "SECTION_HEADER", "CALLOUT_LEFT", "CALLOUT_CENTER", "CALLOUT_RIGHT"]);
// Slots that live in the Y=0.80-0.93 "body band"
const BODY_BAND_SLOTS = new Set(["BODY", "CAPTION", "SUBTITLE"]);

// ─── Helpers ─────────────────────────────────────────────────

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function sceneLabel(s: any): string {
  return `[${s.id ?? "?"}]`;
}

function allEntitiesSrcs(scene: any): string[] {
  return (scene.entities ?? []).map((e: any) => e.src ?? "").filter(Boolean);
}

// Are texts in the same band active at the same time within a scene?
// A text is "active" from (delay) to (delay + duration), or until sceneEnd if no duration.
function detectTextOverlap(
  scene: any,
  band: Set<string>
): { a: string; b: string; startFrame: number }[] {
  const conflicts: { a: string; b: string; startFrame: number }[] = [];
  const texts: { id: string; slot?: string; pos?: number; start: number; end: number }[] = [];

  for (const t of (scene.texts ?? [])) {
    const inBand =
      (t.slot && band.has(t.slot)) ||
      (!t.slot && !t.position && band.has(styleToDefaultBand(t.style)));
    if (!inBand) continue;

    const start = t.delay ?? 0;
    const end = t.duration !== undefined ? start + t.duration : scene.durationFrames;
    texts.push({ id: t.id, slot: t.slot, start, end });
  }

  // CALLOUT_LEFT and CALLOUT_RIGHT sit in opposite horizontal thirds (the
  // COMPARE/rule-of-thirds device) — simultaneous is the intended reading,
  // not a collision. Only flag pairs that actually contend for the same
  // physical slot (both CENTER, or either side vs CENTER).
  const sideOf = (slot?: string): "left" | "right" | "other" =>
    slot === "CALLOUT_LEFT" ? "left" : slot === "CALLOUT_RIGHT" ? "right" : "other";

  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i], b = texts[j];
      const sideA = sideOf(a.slot), sideB = sideOf(b.slot);
      if ((sideA === "left" && sideB === "right") || (sideA === "right" && sideB === "left")) continue;
      const overlapStart = Math.max(a.start, b.start);
      const overlapEnd = Math.min(a.end, b.end);
      if (overlapStart < overlapEnd) {
        conflicts.push({ a: a.id ?? `text[${i}]`, b: b.id ?? `text[${j}]`, startFrame: overlapStart });
      }
    }
  }
  return conflicts;
}

function styleToDefaultBand(style: string): string {
  if (style === "TITLE" || style === "SECTION" || style === "CALLOUT") return "TOP_TITLE";
  if (style === "BODY" || style === "CAPTION") return "BODY";
  return "";
}

// Count total simultaneous words at peak moment (approximation):
// sum all text content that has overlapping active windows at any single frame
function peakSimultaneousWords(scene: any): { words: number; frame: number; texts: string[] } {
  const windows: { id: string; content: string; start: number; end: number }[] = [];
  for (const t of (scene.texts ?? [])) {
    const start = t.delay ?? 0;
    const end = t.duration !== undefined ? start + t.duration : scene.durationFrames;
    windows.push({ id: t.id ?? "?", content: t.content ?? "", start, end });
  }

  // Sample a few points and find the peak
  const sampleFrames = new Set<number>();
  for (const w of windows) {
    sampleFrames.add(w.start);
    sampleFrames.add(Math.floor((w.start + w.end) / 2));
  }

  let best = { words: 0, frame: 0, texts: [] as string[] };
  for (const f of sampleFrames) {
    const active = windows.filter((w) => f >= w.start && f < w.end);
    const words = active.reduce((sum, w) => sum + wordCount(w.content), 0);
    if (words > best.words) {
      best = { words, frame: f, texts: active.map((w) => w.id) };
    }
  }
  return best;
}

// ─── Individual checks ───────────────────────────────────────

// CHECK 1 (V4): Background usage. White/gradient is the DEFAULT good backdrop;
// a broken image path is the only hard failure. Missing backgroundSrc is minor.
function checkBackgroundReal(scenes: any[]): CheckResult {
  const issues: QualityIssue[] = [];

  const missingBg = scenes.filter((s) => !s.backgroundSrc);
  const brokenPath = scenes.filter(
    (s) => s.backgroundSrc && !isCSSBackground(s.backgroundSrc) && !backgroundImageExists(s.backgroundSrc)
  );

  for (const s of missingBg) {
    issues.push({
      severity: "MINOR",
      rule: "BACKGROUND_REAL",
      scene: s.id,
      message: `${sceneLabel(s)} không có backgroundSrc — mặc định về nền phẳng`,
      suggestion: `Đặt backgroundSrc rõ ràng: "#FFFFFF" cho scene trắng, hoặc backgrounds/*.jpg cho evidence/emotional beat`,
    });
  }

  for (const s of brokenPath) {
    issues.push({
      severity: "BLOCKER",
      rule: "BACKGROUND_REAL",
      scene: s.id,
      message: `${sceneLabel(s)} backgroundSrc trỏ tới file không tồn tại: ${s.backgroundSrc}`,
      suggestion: `Kiểm tra public/${s.backgroundSrc} có tồn tại không`,
    });
  }

  return { name: "Background: path hợp lệ (nền trắng là mặc định — V4)", passed: issues.length === 0, issues };
}

// CHECK 2 (V4): Photos are deliberate evidence/punches, but long reference-like
// videos need more than 2-4 frames. Keep them bounded by the shared profile.
function checkBackgroundVariety(scenes: any[]): CheckResult {
  const issues: QualityIssue[] = [];
  const isPhoto = (b: any) => b && backgroundImageExists(b) && !STAGE_ANCHORS_KEYS.has(b);
  const distinctImages = new Set(scenes.map((s) => s.backgroundSrc).filter(isPhoto));
  const photoScenes = scenes.filter((s) => isPhoto(s.backgroundSrc)).length;

  if (scenes.length >= 5 && distinctImages.size === 0) {
    issues.push({
      severity: "MINOR",
      rule: "BACKGROUND_VARIETY",
      message: `Không có ảnh thật nào — video bỏ lỡ các "cú đấm" hình ảnh (bằng chứng, khoảnh khắc cảm xúc)`,
      suggestion: "Thêm 1-2 ảnh full-bleed đúng lúc (evidence card / emotional beat) — vẫn giữ nền trắng làm mặc định",
    });
  }
  const maximumPhotoScenes = Math.max(5, Math.ceil(scenes.length * 0.35));
  if (photoScenes > maximumPhotoScenes) {
    issues.push({
      severity: "MAJOR",
      rule: "BACKGROUND_VARIETY",
      message: `${photoScenes} scene dùng ảnh nền — ảnh đang vượt giới hạn ${maximumPhotoScenes}`,
      suggestion: "Giữ ảnh cho evidence/photo punch; dùng stage hoặc infographic cho cảnh giải thích thường.",
    });
  }

  return { name: "Background: photo evidence có giới hạn (V4)", passed: issues.length === 0, issues };
}

// CHECK 3: Layout variety
function checkLayoutVariety(scenes: any[]): CheckResult {
  const issues: QualityIssue[] = [];
  const layouts = new Set(scenes.map((s) => s.layout).filter(Boolean));

  if (layouts.size < 3 && scenes.length >= 4) {
    issues.push({
      severity: "MAJOR",
      rule: "LAYOUT_VARIETY",
      message: `Chỉ ${layouts.size} layout khác nhau: ${[...layouts].join(", ")}. Video sẽ nhàm chán.`,
      suggestion: "Dùng ít nhất SOLO + DIALOGUE + DUAL_CONTRAST hoặc STAT_DRAMA để tạo nhịp điệu",
    });
  } else if (layouts.size < 5 && scenes.length >= 6) {
    issues.push({
      severity: "MINOR",
      rule: "LAYOUT_VARIETY",
      message: `${layouts.size} layouts cho ${scenes.length} scenes. Thêm đa dạng nếu có thể.`,
    });
  }

  // Check for consecutive same-layout runs (3+ in a row)
  for (let i = 0; i < scenes.length - 2; i++) {
    if (
      scenes[i].layout === scenes[i + 1].layout &&
      scenes[i + 1].layout === scenes[i + 2].layout
    ) {
      issues.push({
        severity: "MINOR",
        rule: "LAYOUT_VARIETY",
        scene: scenes[i + 2].id,
        message: `3 scene liên tiếp cùng layout "${scenes[i].layout}" (scene ${i}→${i + 2})`,
        suggestion: "Chèn một layout khác để phá vỡ sự đơn điệu",
      });
      i += 2; // skip past this run
    }
  }

  // SOLO_RATIO (V4): >40% solo-cat-center scenes = độc diễn đơn điệu.
  const soloCount = scenes.filter((s) => SOLO_LAYOUTS.has(s.layout)).length;
  if (scenes.length >= 5 && soloCount / scenes.length > 0.4) {
    issues.push({
      severity: "MAJOR",
      rule: "LAYOUT_VARIETY",
      message: `${soloCount}/${scenes.length} scene là solo-character (>40%) — thế đứng đơn điệu`,
      suggestion: "Trộn thêm DIALOGUE, ICON_TRIPLE/QA_REVEAL, STAT_DRAMA hoặc paperCards evidence",
    });
  }
  // A channel that teaches through dialogue should have at least one on a long video.
  if (scenes.length >= 6 && !scenes.some((s) => s.layout === "DIALOGUE")) {
    issues.push({
      severity: "MINOR",
      rule: "LAYOUT_VARIETY",
      message: `Không có scene DIALOGUE — kênh mẫu dạy chủ yếu qua nhân vật nói với nhau`,
      suggestion: "Thêm ít nhất 1 scene DIALOGUE (2 mèo hỏi–đáp)",
    });
  }

  return { name: "Layout: đa dạng, SOLO ≤40%, không lặp 3+ liên tiếp (V4)", passed: issues.length === 0, issues };
}

// CHECK (V4): The opening must be bright — a dark/faded scene 1 buries the hook.
function checkOpeningBright(scenes: any[]): CheckResult {
  const issues: QualityIssue[] = [];
  const first = scenes[0];
  if (first) {
    if (first.transition && (first.transition.style === "fadeBlack" || first.transition.style === "fadeWhite")) {
      issues.push({
        severity: "MINOR",
        rule: "OPENING_DARK",
        scene: first.id,
        message: `${sceneLabel(first)} scene mở đầu dùng ${first.transition.style} — chôn vùi hook`,
        suggestion: "Bỏ transition ở scene 1; 3 giây đầu phải thấy rõ nhân vật + tiêu đề (compiler cũng tự drop)",
      });
    }
    const fb: string = first.backgroundSrc ?? "";
    const darkHexes = fb.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
    const looksDark = darkHexes.length > 0 && darkHexes.every((h) => {
      const r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16);
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.35;
    });
    if (looksDark) {
      issues.push({
        severity: "MAJOR",
        rule: "OPENING_DARK",
        scene: first.id,
        message: `${sceneLabel(first)} nền scene mở đầu tối ("${fb.slice(0, 40)}")`,
        suggestion: "Mở đầu sáng — người xem quyết định ở lại/rời đi trong 3 giây đầu",
      });
    }
  }
  return { name: "Opening: mở màn sáng, không fadeBlack (V4)", passed: issues.length === 0, issues };
}

// CHECK: Story arc & focal anchor (V4.8) — a video is boring when every scene
// is "cat reads the next sentence" with nothing on screen to hold the eye and
// no dramatic peak. Flags two concrete failure modes seen in flat output:
//   1. EMPTY_FRAME  — scene has no visual anchor beyond the bottom subtitle
//                     (texts empty AND no speechBubble/card/frameBox) → eye drifts.
//   2. NO_CLIMAX    — no STAT_DRAMA/CLOSE_UP peak in the 55-80% region → no arc.
function checkStoryArc(scenes: any[]): CheckResult {
  const issues: QualityIssue[] = [];
  if (scenes.length < 5) {
    return { name: "Story arc: có điểm neo thị giác + cao trào (V4.8)", passed: true, issues };
  }

  const hasAnchor = (s: any): boolean => {
    if ((s.semanticTakeaway ?? "").trim().length > 0 && (s.semanticAssetIds?.length ?? 0) > 0) return true;
    if (Array.isArray(s.speechBubbles) && s.speechBubbles.length > 0) return true;
    if (Array.isArray(s.paperCards) && s.paperCards.length > 0) return true;
    if (Array.isArray(s.frameBoxes) && s.frameBoxes.length > 0) return true;
    const props = (s.entities ?? []).filter((e: any) => !String(e.src ?? "").includes("cat"));
    if (props.length > 0) return true;
    return false;
  };

  const emptyScenes = scenes.filter((s) => !hasAnchor(s));
  const emptyRatio = emptyScenes.length / scenes.length;
  if (emptyRatio > 0.4) {
    issues.push({
      severity: "MAJOR",
      rule: "EMPTY_FRAME",
      scene: emptyScenes[0]?.id,
      message: `${emptyScenes.length}/${scenes.length} scene (${Math.round(emptyRatio * 100)}%) không có điểm neo thị giác — chỉ có mèo + phụ đề, mắt người xem trôi`,
      suggestion: "Mỗi scene kể-chuyện cần ≥1: speechBubble, CALLOUT/CAPTION ngắn, prop mèo nhìn vào, hoặc nhân vật thứ 2 (V4.8.10)",
    });
  }

  // Climax: at least one dramatic peak in the back half (55-80%).
  const climaxLayouts = new Set(["STAT_DRAMA", "STAT", "CLOSE_UP"]);
  const lo = Math.floor(scenes.length * 0.55);
  const hi = Math.ceil(scenes.length * 0.8);
  const hasClimax = scenes.slice(lo, hi + 1).some((s) => climaxLayouts.has(s.layout));
  if (!hasClimax) {
    issues.push({
      severity: "MINOR",
      rule: "NO_CLIMAX",
      message: `Không có cao trào (STAT_DRAMA/CLOSE_UP) ở vùng 55-80% thời lượng — câu chuyện phẳng, thiếu đỉnh`,
      suggestion: "Đặt beat số-liệu-sốc hoặc cận cảnh cảm xúc ở ~2/3 video làm climax (V4.8.2)",
    });
  }

  return { name: "Story arc: có điểm neo thị giác + cao trào (V4.8)", passed: issues.length === 0, issues };
}

// Shared: does a background string read as dark?
function bgLooksDark(bg: string): boolean {
  const darkHexes = bg.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
  return (
    darkHexes.length > 0 &&
    darkHexes.every((h) => {
      const r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16);
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.35;
    })
  );
}

// CHECK (V5): Ending must be bright — symmetric to OPENING_DARK. video-003
// closed on consecutive near-black STAT scenes, so the video *ends* on a
// black screen instead of a bright CTA.
function checkEndingBright(scenes: any[]): CheckResult {
  const issues: QualityIssue[] = [];
  for (const s of scenes.slice(-2)) {
    const bg: string = s.backgroundSrc ?? "";
    if (bgLooksDark(bg)) {
      issues.push({
        severity: "MAJOR",
        rule: "ENDING_DARK",
        scene: s.id,
        message: `${sceneLabel(s)} scene kết dùng nền tối ("${bg.slice(0, 40)}") — video kết thúc trong bóng đen thay vì CTA sáng`,
        suggestion: "2 scene cuối phải nền sáng: chốt insight + CTA với mèo biểu cảm tích cực",
      });
    }
  }
  return { name: "Ending: kết sáng với CTA, không chìm trong nền tối (V5)", passed: issues.length === 0, issues };
}

// CHECK (V5): Direction hygiene — three concrete authoring defects found by
// frame-comparing video-003 against the reference:
//   TEXT_TRUNCATED — the AI wrote sentences cut off with "…" (156 in video-003);
//   SCALE_ABUSE    — hand-written tiny scales on characters (compiler clamps,
//                    but the source should stop emitting them);
//   KEYWORD_MISSING— scenes quoting big numbers with no STAT/CALLOUT anchor
//                    (the reference nails every number with big colored type).
function checkV5Hygiene(scenes: any[]): CheckResult {
  const issues: QualityIssue[] = [];

  const truncated: string[] = [];
  const tinyScales: string[] = [];
  let numberScenes = 0;
  let numberScenesWithoutKeyword = 0;

  const numberRe = /\d[\d.,]*\s*(%|percent|triệu|tỷ|nghìn|million|billion|thousand|won|usd|đồng)|\b\d{4,}\b/i;

  for (const s of scenes) {
    for (const t of s.texts ?? []) {
      const c: string = t.content ?? "";
      if (/(\.\.\.|…)\s*$/.test(c)) truncated.push(s.id);
    }
    for (const e of s.entities ?? []) {
      if (typeof e.scale === "number" && e.scale < 1.4 && String(e.src ?? "").startsWith("characters/")) {
        tinyScales.push(s.id);
      }
    }
    if (numberRe.test(s.narration ?? "")) {
      numberScenes++;
      const hasAnchor =
        (s.texts ?? []).some((t: any) => t.style === "STAT" || t.style === "CALLOUT") ||
        (s.paperCards?.length ?? 0) > 0 ||
        (s.frameBoxes?.length ?? 0) > 0;
      if (!hasAnchor) numberScenesWithoutKeyword++;
    }
  }

  if (truncated.length > 0) {
    issues.push({
      severity: "MAJOR",
      rule: "TEXT_TRUNCATED",
      scene: truncated[0],
      message: `${truncated.length} text kết thúc bằng "…" — câu bị cắt cụt hiển thị như lỗi (vd scene ${truncated.slice(0, 3).join(", ")})`,
      suggestion: "Viết lại text NGẮN TRỌN Ý (≤12 từ), không bao giờ chấm lửng do tràn",
    });
  }
  if (tinyScales.length > 0) {
    issues.push({
      severity: "MINOR",
      rule: "SCALE_ABUSE",
      scene: tinyScales[0],
      message: `${tinyScales.length} nhân vật bị set scale < 1.4 (mèo tí hon) — compiler sẽ clamp nhưng nguồn nên bỏ field scale`,
      suggestion: "KHÔNG ghi field scale cho characters/* — để compiler auto-scale theo layout",
    });
  }
  if (numberScenes >= 3 && numberScenesWithoutKeyword / numberScenes > 0.6) {
    issues.push({
      severity: "MAJOR",
      rule: "KEYWORD_MISSING",
      message: `${numberScenesWithoutKeyword}/${numberScenes} scene nêu số liệu nhưng không có STAT/CALLOUT/paperCard đóng đinh con số — số chỉ được đọc, không được thấy`,
      suggestion: "Mỗi con số quan trọng → 1 STAT/CALLOUT ≤4 từ chữ to có màu, hoặc paperCard highlight",
    });
  }

  return { name: "V5 hygiene: không text cụt, không mèo tí hon, số liệu có anchor", passed: issues.length === 0, issues };
}

// CHECK (V5): Register variety — the reference rotates 5 visual registers
// (tableau / evidence / diagram / beat / solo). Video-003 ran 100% slot-template
// scenes: zero bubbles, zero paperCards, zero frameBoxes across 112 scenes.
function checkV5Registers(scenes: any[]): CheckResult {
  const issues: QualityIssue[] = [];
  if (scenes.length < 8) {
    return { name: "V5 registers: bubble/evidence/beat có mặt đủ quota", passed: true, issues };
  }

  const bubbleScenes = scenes.filter((s) => (s.speechBubbles?.length ?? 0) > 0).length;
  const evidenceScenes = scenes.filter(
    (s) => (s.paperCards?.length ?? 0) > 0 || (s.frameBoxes?.length ?? 0) > 0
  ).length;
  const dialogueScenes = scenes.filter((s) => s.layout === "DIALOGUE").length;

  // Dialogue without a single bubble anywhere = talking heads with no lines.
  if (dialogueScenes >= 2 && bubbleScenes === 0) {
    issues.push({
      severity: "MAJOR",
      rule: "BUBBLE_MISSING",
      message: `${dialogueScenes} scene DIALOGUE nhưng 0 speechBubble toàn video — hội thoại câm, mất thiết bị dạy chính của kênh mẫu`,
      suggestion: "Mỗi scene DIALOGUE ≥1 speechBubbles[] với câu thoại thật ≤8 từ",
    });
  }

  const expectedEvidence = Math.max(1, Math.floor(scenes.length / 12));
  if (evidenceScenes < expectedEvidence) {
    issues.push({
      severity: "MAJOR",
      rule: "EVIDENCE_MISSING",
      message: `${evidenceScenes} scene evidence (paperCard/frameBox) — cần ≥${expectedEvidence} cho ${scenes.length} scene. Video mẫu chiếu bằng chứng (bài báo highlight, TV frame) thay vì chỉ đọc`,
      suggestion: "Số liệu/trích dẫn quan trọng → paperCard variant evidence; ảnh thật/stat → frameBox",
    });
  }

  return { name: "V5 registers: bubble/evidence/beat có mặt đủ quota", passed: issues.length === 0, issues };
}

// ── Storyboard-level gates (run BEFORE compile, on the storyboard) ──
// Intent lives in the storyboard; once compiled to scenes[] the grammar/beat
// info is baked away. So these two gates operate on the Storyboard object.

// Required slot keys per visual grammar (at least one of each group).
const GRAMMAR_REQUIRED_SLOTS: Record<string, string[][]> = {
  COMPARE: [["left"], ["right"]],
  STAT_REVEAL: [["stat", "number"]],
  POLICY_LIST: [["items"]],
  DIALOGUE_QA: [["askerText", "answererText"]],
  TABLEAU: [["stage"]],
  EVIDENCE: [], // body falls back to narration
  FRAMEBOX: [["content", "image"]],
  CHAR_PROP: [["prop"]],
  DIAGRAM: [["items"]],
  CAUSE_EFFECT: [["cause"], ["effect"]],
  QA_REVEAL: [["question", "q"]],
  ICON_TRIPLE: [["items"]],
  BEAT: [],     // image falls back
  SOLO: [],
  MAP_FLOW: [["map"], ["items"], ["icons"]],
  DATA_CHART: [["chart"]],
  SURVEY_CARD: [["body"]],
  PHOTO_EVIDENCE: [["photo"]],
  SCREEN_CAPTURE: [["content"]],
  FULL_SCENE_ACTION: [["stage"], ["who"], ["anchorA"], ["prop"]],
  HISTORY_TIMELINE: [["items"], ["icons"]],
  VISUAL_METAPHOR: [["setup"], ["payoff"], ["leftAsset"], ["rightAsset"]],
  FREEFORM: [],
};
const GRAMMARS_WITHOUT_FOCAL = new Set(["BEAT"]); // no entity → beats can't anchor

function checkSemanticStoryboard(storyboard: any): CheckResult[] {
  if (storyboard?.schemaVersion !== 2) return [];
  const briefs: any[] = Array.isArray(storyboard?.scenes) ? storyboard.scenes : [];
  const semanticIssues: QualityIssue[] = [];
  const registerIssues: QualityIssue[] = [];

  for (const brief of briefs) {
    const definition = getGrammarDefinition(brief.visualGrammar);
    if (!definition && brief.visualGrammar !== "FREEFORM") continue;
    if (!brief.sourceRange || !Number.isInteger(brief.sourceRange.startWord) || !Number.isInteger(brief.sourceRange.endWord)) {
      semanticIssues.push({
        severity: "BLOCKER", rule: "SOURCE_RANGE", scene: brief.id,
        message: `${brief.id}: missing stable transcript sourceRange`,
      });
    }
    if (!brief.semanticVisual?.subject || !brief.semanticVisual?.action || !brief.semanticVisual?.takeaway) {
      semanticIssues.push({
        severity: "MAJOR", rule: "SEMANTIC_VISUAL", scene: brief.id,
        message: `${brief.id}: semanticVisual needs subject, action, and silent-viewer takeaway`,
        suggestion: "Describe what visibly happens; a pose or layout name is not an action.",
      });
    }
    if (!brief.focalType || !brief.silentFrameTakeaway || !brief.visualFingerprint ||
        !Array.isArray(brief.noveltyFromPrevious) ||
        Number(brief.focalOccupancyTarget ?? 0) < referenceQuality.composition.minimumFocalOccupancy) {
      semanticIssues.push({
        severity: "MAJOR", rule: "VISUAL_TREATMENT", scene: brief.id,
        message: `${brief.id}: missing focal type, silent-frame takeaway, fingerprint, novelty, or focal occupancy target.`,
      });
    }
    if (!Array.isArray(brief.assetRequests) || brief.assetRequests.length === 0) {
      semanticIssues.push({
        severity: "MAJOR", rule: "ASSET_REQUEST", scene: brief.id,
        message: `${brief.id}: no semantic asset request; compiler would have to guess`,
      });
    }
    if ((brief.unresolvedAssetRequests?.length ?? 0) > 0) {
      semanticIssues.push({
        severity: "BLOCKER", rule: "UNRESOLVED_ASSET", scene: brief.id,
        message: `${brief.id}: unresolved assets: ${brief.unresolvedAssetRequests.join("; ")}`,
        suggestion: "Generate or add the requested semantic asset, rebuild the manifest, then retry.",
      });
    }
    if (definition) {
      for (const slot of definition.requiredSlots) {
        if (!String(brief.slots?.[slot] ?? "").trim()) {
          semanticIssues.push({
            severity: "MAJOR", rule: "SEMANTIC_SLOT", scene: brief.id,
            message: `${brief.id} (${brief.visualGrammar}) is missing required semantic slot "${slot}"`,
          });
        }
      }
      if (!brief.visualRegister) {
        registerIssues.push({
          severity: "MAJOR", rule: "VISUAL_REGISTER", scene: brief.id,
          message: `${brief.id}: missing visualRegister`,
        });
      } else if (!definition.supportedRegisters.includes(brief.visualRegister)) {
        registerIssues.push({
          severity: "MAJOR", rule: "VISUAL_REGISTER", scene: brief.id,
          message: `${brief.id}: ${brief.visualGrammar} does not support ${brief.visualRegister}`,
        });
      }
    }
    if (brief.visualGrammar === "TABLEAU" &&
        !stageMatchesSetting(String(brief.slots?.stage ?? ""), brief.semanticVisual?.setting)) {
      semanticIssues.push({
        severity: "MAJOR", rule: "STAGE_SETTING_MISMATCH", scene: brief.id,
        message: `${brief.id}: stage "${brief.slots?.stage}" does not match setting "${brief.semanticVisual?.setting}".`,
      });
    }
    if ((brief.continuity?.castIds?.length ?? 0) >= 2 &&
        !brief.semanticVisual?.relation &&
        !brief.semanticVisual?.object) {
      semanticIssues.push({
        severity: "MAJOR", rule: "GENERIC_CHARACTER_PAIR", scene: brief.id,
        message: `${brief.id}: multiple cast members require a visible relation or shared object.`,
      });
    }
    const beatImage = String(brief.slots?.image ?? brief.slots?.background ?? "");
    if (brief.visualGrammar === "BEAT" && (/^#|^rgba?\(|gradient\(/i.test(beatImage) || !beatImage)) {
      semanticIssues.push({
        severity: "MAJOR", rule: "BEAT_COLOR_ONLY", scene: brief.id,
        message: `${brief.id}: BEAT needs a real full-frame asset, not a CSS fill`,
      });
    }
  }

  const counts = new Map<string, number>();
  for (const brief of briefs) {
    if (brief.visualRegister) counts.set(brief.visualRegister, (counts.get(brief.visualRegister) ?? 0) + 1);
  }
  if (briefs.length >= 8 && counts.size < referenceQuality.registers.minimumDistinct) {
    registerIssues.push({
      severity: "MAJOR", rule: "REGISTER_DIVERSITY",
      message: `Storyboard uses ${counts.size} visual registers; minimum is ${referenceQuality.registers.minimumDistinct}.`,
    });
  }
  for (const [register, count] of counts) {
    if (briefs.length >= 8 && count / briefs.length > referenceQuality.registers.maximumSingleRatio) {
      registerIssues.push({
        severity: "MAJOR", rule: "REGISTER_DOMINANCE",
        message: `${register} occupies ${Math.round(count / briefs.length * 100)}% of scenes; maximum is ${Math.round(referenceQuality.registers.maximumSingleRatio * 100)}%.`,
      });
    }
  }
  for (let index = 2; index < briefs.length; index++) {
    if (briefs[index].visualRegister &&
        briefs[index].visualRegister === briefs[index - 1].visualRegister &&
        briefs[index].visualRegister === briefs[index - 2].visualRegister) {
      registerIssues.push({
        severity: "MAJOR", rule: "REGISTER_STREAK", scene: briefs[index].id,
        message: `${briefs[index].id}: third consecutive ${briefs[index].visualRegister} scene.`,
      });
    }
  }
  if (briefs.length >= 8 && !storyboard.visualTreatmentPlan) {
    registerIssues.push({
      severity: "MAJOR", rule: "VISUAL_TREATMENT_PLAN",
      message: "Storyboard is missing a video-level visualTreatmentPlan and usage budgets.",
    });
  }
  const characterFree = briefs.filter((brief) => brief.characterRequired === false).length;
  if (briefs.length >= 20 && characterFree / briefs.length < referenceQuality.composition.minimumCharacterFreeRatio) {
    registerIssues.push({
      severity: "MAJOR", rule: "CHARACTER_FREE_QUOTA",
      message: `${characterFree}/${briefs.length} briefs intentionally omit characters; minimum is ${Math.round(referenceQuality.composition.minimumCharacterFreeRatio * 100)}%.`,
    });
  }
  for (const claim of storyboard.claims ?? []) {
    if (claim.evidencePolicy === "none") continue;
    const supporting = briefs.filter((brief) => (brief.claimIds ?? []).includes(claim.id));
    if (supporting.length === 0) {
      semanticIssues.push({
        severity: "MAJOR", rule: "CLAIM_WITHOUT_SCENE",
        message: `Claim ${claim.id} has evidencePolicy=${claim.evidencePolicy} but no supporting scene.`,
      });
      continue;
    }
    if (!supporting.some((brief) => ["EVIDENCE", "FRAMEBOX", "STAT_REVEAL"].includes(brief.visualGrammar))) {
      semanticIssues.push({
        severity: "MAJOR", rule: "CLAIM_WITHOUT_EVIDENCE",
        scene: supporting[0].id,
        message: `Claim ${claim.id} is not rendered as evidence, framebox, or stat reveal.`,
      });
    }
    if (claim.evidencePolicy === "source_card" &&
        !supporting.some((brief) => String(brief.slots?.source ?? "").trim())) {
      semanticIssues.push({
        severity: "MAJOR", rule: "EVIDENCE_SOURCE_MISSING",
        scene: supporting[0].id,
        message: `Claim ${claim.id} requires a source card but no source is supplied.`,
      });
    }
  }
  const finalWord = Math.max(-1, ...briefs.map((brief) => brief.sourceRange?.endWord ?? -1));
  if (finalWord >= 112) {
    const heroWords = briefs
      .filter((brief) => brief.heroVisual)
      .map((brief) => brief.sourceRange?.startWord)
      .filter((word): word is number => Number.isInteger(word));
    const boundaries = [0, ...heroWords, finalWord + 1].sort((a, b) => a - b);
    const longestGapWords = boundaries.slice(1)
      .reduce((maximum, word, index) => Math.max(maximum, word - boundaries[index]), 0);
    if (longestGapWords / 2.5 > 45) {
      registerIssues.push({
        severity: "MAJOR", rule: "HERO_VISUAL_GAP",
        message: `Estimated hero-visual gap is ${(longestGapWords / 2.5).toFixed(1)}s; maximum is 45s.`,
      });
    }
  }
  return [
    { name: "Storyboard: semantic visual and asset requests", passed: semanticIssues.length === 0, issues: semanticIssues },
    { name: "Storyboard: visual register scheduling", passed: registerIssues.length === 0, issues: registerIssues },
  ];
}

export function runStoryboardCheck(storyboard: any): QualityReport {
  const briefs: any[] = Array.isArray(storyboard?.scenes) ? storyboard.scenes : [];
  const intentIssues: QualityIssue[] = [];
  const beatIssues: QualityIssue[] = [];

  for (const b of briefs) {
    const g = b.visualGrammar;
    // INTENT_REALIZED — grammar known + required slots filled.
    if (!g || !(g in GRAMMAR_REQUIRED_SLOTS)) {
      intentIssues.push({
        severity: "BLOCKER", rule: "INTENT_REALIZED", scene: b.id,
        message: `${b.id}: visualGrammar "${g}" không hợp lệ`,
        suggestion: `Dùng 1 trong: ${Object.keys(GRAMMAR_REQUIRED_SLOTS).join(", ")}`,
      });
      continue;
    }
    const slots = b.slots ?? {};
    for (const group of GRAMMAR_REQUIRED_SLOTS[g]) {
      if (!group.some((k) => (slots[k] ?? "").toString().trim().length > 0)) {
        intentIssues.push({
          severity: "MAJOR", rule: "INTENT_REALIZED", scene: b.id,
          message: `${b.id} (${g}): thiếu slot bắt buộc "${group.join("|")}"`,
          suggestion: `Grammar ${g} cần slot ${group.join(" hoặc ")} để bung đúng`,
        });
      }
    }
    // TABLEAU stage must be a known stage set.
    if (g === "TABLEAU" && slots.stage && !STAGE_ANCHORS_KEYS.has(slots.stage)) {
      intentIssues.push({
        severity: "MAJOR", rule: "INTENT_REALIZED", scene: b.id,
        message: `${b.id}: stage "${slots.stage}" không tồn tại`,
        suggestion: `Stage hợp lệ: ${[...STAGE_ANCHORS_KEYS].join(", ")}`,
      });
    }

    // BEAT_UNANCHORED — a strong beat that can't land an emphasis.
    for (const beat of b.beats ?? []) {
      if ((beat.importance ?? 0) < 0.8) continue;
      const inNarration = (b.narration ?? "").toLowerCase().includes((beat.text ?? "").toLowerCase().trim());
      if (!inNarration) {
        beatIssues.push({
          severity: "MAJOR", rule: "BEAT_UNANCHORED", scene: b.id,
          message: `${b.id}: beat "${beat.text}" (importance ${beat.importance}) KHÔNG phải substring của narration → không định vị được frame`,
          suggestion: "beat.text phải là đoạn chữ CHÍNH XÁC trong narration",
        });
      } else if (GRAMMARS_WITHOUT_FOCAL.has(g)) {
        beatIssues.push({
          severity: "MINOR", rule: "BEAT_UNANCHORED", scene: b.id,
          message: `${b.id}: grammar ${g} không có nhân vật/tiêu điểm để nhấn beat "${beat.text}"`,
          suggestion: "Beat quan trọng nên đặt ở grammar có focal (STAT_REVEAL/SOLO/DIALOGUE...) chứ không phải BEAT",
        });
      }
    }
  }

  const checks: CheckResult[] = [
    ...checkSemanticStoryboard(storyboard),
    { name: "Storyboard: intent realized (grammar + slots hợp lệ)", passed: intentIssues.length === 0, issues: intentIssues },
    { name: "Storyboard: beat quan trọng có thể nhấn đúng chỗ", passed: beatIssues.length === 0, issues: beatIssues },
  ];
  return assembleReport(checks, "(storyboard)");
}

// CHECK 4: Scene duration
// Ideal: 5-12s. Very short (<1.8s) is a BLOCKER (flickering); 1.8-2.5s is a
// fast-cut MINOR because the reference uses occasional rapid reaction shots.
// Very long (>120s)
// is a MINOR — for long videos with narration audio, long scenes can be intentional.
function checkSceneDuration(scenes: any[]): CheckResult {
  const issues: QualityIssue[] = [];
  const totalFrames = scenes.reduce((s, sc) => s + (sc.durationFrames ?? 0), 0);
  const avgFrames = scenes.length > 0 ? totalFrames / scenes.length : 0;

  for (const s of scenes) {
    if (typeof s.durationFrames !== "number") continue;
    const secs = s.durationFrames / 30;

    if (secs < 1.8) {
      issues.push({
        severity: "BLOCKER",
        rule: "SCENE_DURATION",
        scene: s.id,
        message: `${sceneLabel(s)} ${secs.toFixed(1)}s — quá ngắn, sẽ chớp nháy`,
        suggestion: "Scene nên tối thiểu 4-5 giây (120-150 frames)",
      });
    } else if (secs < 2.5) {
      issues.push({
        severity: "MINOR",
        rule: "SCENE_DURATION",
        scene: s.id,
        message: `${sceneLabel(s)} ${secs.toFixed(1)}s — hơi ngắn (khuyến nghị ≥8s)`,
        suggestion: "Cân nhắc kéo dài để người xem có thời gian xử lý",
      });
    } else if (secs > 120 && avgFrames < 3600) {
      // Only flag if this is an outlier compared to other scenes (not just a long video)
      issues.push({
        severity: "MINOR",
        rule: "SCENE_DURATION",
        scene: s.id,
        message: `${sceneLabel(s)} ${secs.toFixed(1)}s — rất dài cho một scene`,
        suggestion: "Cân nhắc tách thành 2-3 scenes với visual events để giữ nhịp",
      });
    }
  }

  return { name: "Scene duration: không quá ngắn (<3s) hoặc quá dài (>120s)", passed: issues.length === 0, issues };
}

// CHECK 5: startFrame continuity (no gaps, no overlaps)
function checkFrameContinuity(scenes: any[]): CheckResult {
  const issues: QualityIssue[] = [];
  let cursor = 0;

  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    if (typeof s.startFrame !== "number" || typeof s.durationFrames !== "number") continue;

    const gap = s.startFrame - cursor;
    if (gap > 1) {
      issues.push({
        severity: "MAJOR",
        rule: "FRAME_CONTINUITY",
        scene: s.id,
        message: `${sceneLabel(s)} startFrame=${s.startFrame} nhưng prev scene kết thúc ở ${cursor} (gap=${gap} frames)`,
        suggestion: `Sửa startFrame thành ${cursor}`,
      });
    } else if (gap < 0) {
      issues.push({
        severity: "BLOCKER",
        rule: "FRAME_CONTINUITY",
        scene: s.id,
        message: `${sceneLabel(s)} startFrame=${s.startFrame} chồng lên scene trước (overlap=${-gap} frames)`,
        suggestion: `Sửa startFrame thành ${cursor}`,
      });
    }
    cursor = s.startFrame + s.durationFrames;
  }

  return { name: "Frame continuity: scenes nối liền không gap/overlap", passed: issues.length === 0, issues };
}

// CHECK 6: Text word cap — max 12 words simultaneously
function checkTextWordCap(scenes: any[]): CheckResult {
  const issues: QualityIssue[] = [];

  for (const s of scenes) {
    const peak = peakSimultaneousWords(s);
    if (peak.words > 16) {
      issues.push({
        severity: "MAJOR",
        rule: "TEXT_WORD_CAP",
        scene: s.id,
        message: `${sceneLabel(s)} ${peak.words} từ hiện đồng thời (texts: ${peak.texts.join(", ")}) — quá nhiều (max 12)`,
        suggestion: "Xóa BODY nếu CALLOUT đã nói được ý. Không dùng TITLE+CALLOUT+BODY cùng lúc.",
      });
    } else if (peak.words > 12) {
      issues.push({
        severity: "MINOR",
        rule: "TEXT_WORD_CAP",
        scene: s.id,
        message: `${sceneLabel(s)} ${peak.words} từ hiện đồng thời (max 12 theo rule)`,
        suggestion: "Rút gọn hoặc stagger texts để không overlap",
      });
    }

    // Also check individual CALLOUT <= 6 words, BODY <= 10 words
    for (const t of (s.texts ?? [])) {
      if (!t.content) continue;
      const wc = wordCount(t.content);
      if (t.style === "CALLOUT" && wc > 8) {
        issues.push({
          severity: "MINOR",
          rule: "TEXT_WORD_CAP",
          scene: s.id,
          message: `${sceneLabel(s)} CALLOUT "${t.id}" có ${wc} từ (khuyến nghị ≤6): "${t.content}"`,
          suggestion: "Rút gọn CALLOUT xuống 4-6 từ",
        });
      }
      if (t.style === "BODY" && wc > 14) {
        issues.push({
          severity: "MINOR",
          rule: "TEXT_WORD_CAP",
          scene: s.id,
          message: `${sceneLabel(s)} BODY "${t.id}" có ${wc} từ (khuyến nghị ≤10): "${t.content}"`,
          suggestion: "Rút gọn BODY hoặc dùng nhiều BODY text stagger thay vì 1 dòng dài",
        });
      }
    }
  }

  return { name: "Text: max 12 từ đồng thời, CALLOUT≤6, BODY≤10", passed: issues.length === 0, issues };
}

// CHECK 7: Text overlap — no two texts in same Y-band at same time
function checkTextOverlap(scenes: any[]): CheckResult {
  const issues: QualityIssue[] = [];

  for (const s of scenes) {
    const topConflicts = detectTextOverlap(s, TOP_BAND_SLOTS);
    const bodyConflicts = detectTextOverlap(s, BODY_BAND_SLOTS);

    for (const c of topConflicts) {
      issues.push({
        severity: "MAJOR",
        rule: "TEXT_OVERLAP",
        scene: s.id,
        message: `${sceneLabel(s)} texts "${c.a}" và "${c.b}" đè nhau ở dải TOP (y≈0.12-0.25) từ frame ${c.startFrame}`,
        suggestion: "Set duration cho text cũ = delay của text mới, hoặc stagger bằng delay",
      });
    }
    for (const c of bodyConflicts) {
      issues.push({
        severity: "MAJOR",
        rule: "TEXT_OVERLAP",
        scene: s.id,
        message: `${sceneLabel(s)} texts "${c.a}" và "${c.b}" đè nhau ở dải BODY (y≈0.82-0.93) từ frame ${c.startFrame}`,
        suggestion: "Set duration cho BODY cũ = delay của BODY mới",
      });
    }
  }

  return { name: "Text: không chồng cùng dải Y cùng lúc", passed: issues.length === 0, issues };
}

// CHECK 8: Cat pose diversity — not all neutral `cat`
function checkCatPoseDiversity(scenes: any[]): CheckResult {
  const issues: QualityIssue[] = [];
  const allEntities = scenes.flatMap((s) => (s.entities ?? []).map((e: any) => ({ ...e, sceneId: s.id })));
  const catEntities = allEntities.filter((e) => e.src?.startsWith("characters/"));

  if (catEntities.length === 0) return { name: "Cat pose: đa dạng tư thế", passed: true, issues: [] };

  const neutralCount = catEntities.filter((e) => e.src === "characters/cat").length;
  const neutralRatio = neutralCount / catEntities.length;

  if (neutralRatio === 1) {
    issues.push({
      severity: "MAJOR",
      rule: "CAT_POSE",
      message: `Tất cả ${catEntities.length} cat entities đều dùng pose trung tính "characters/cat"`,
      suggestion: "Thay bằng pose phù hợp: cat_explain, cat_think, cat_sad, cat_surprised, cat_happy... (xem CLAUDE.md pose guide)",
    });
  } else if (neutralRatio > 0.6) {
    issues.push({
      severity: "MINOR",
      rule: "CAT_POSE",
      message: `${neutralCount}/${catEntities.length} cat entities dùng pose trung tính (>${Math.round(neutralRatio * 100)}%)`,
      suggestion: "Dùng pose theo cảm xúc của từng scene để video sinh động hơn",
    });
  }

  // Check STAT_DRAMA scenes specifically
  for (const s of scenes) {
    if (s.layout === "STAT_DRAMA" || s.layout === "STAT") {
      const sEntities = (s.entities ?? []).filter((e: any) => e.src?.startsWith("characters/"));
      if (sEntities.some((e: any) => e.src === "characters/cat")) {
        issues.push({
          severity: "MINOR",
          rule: "CAT_POSE",
          scene: s.id,
          message: `${sceneLabel(s)} STAT_DRAMA dùng pose trung tính thay vì cat_surprised/cat_sad`,
          suggestion: "STAT_DRAMA phải dùng cat_surprised hoặc cat_sad để match cảm xúc shock",
        });
      }
    }
  }

  // POSE_MONOTONY (V4): cat_happy giơ tay cười cho mọi cảm xúc là lỗi diễn xuất
  // nặng nhất của video gen. Chỉ dùng cho beat thực sự tích cực.
  const happyScenes = scenes.filter((s) =>
    (s.entities ?? []).some((e: any) => typeof e.src === "string" && e.src.includes("cat_happy"))
  ).length;
  if (scenes.length >= 5 && happyScenes / scenes.length > 0.3) {
    issues.push({
      severity: "MAJOR",
      rule: "CAT_POSE",
      message: `cat_happy xuất hiện ở ${happyScenes}/${scenes.length} scene (>30%) — cười giơ tay cho cả nội dung tiêu cực/trung tính`,
      suggestion: "Chỉ dùng cat_happy cho beat tích cực thật sự; mặc định cat/cat_explain; đổi pose khớp từng câu narration",
    });
  }

  return { name: "Cat pose: đa dạng theo cảm xúc, không toàn neutral/happy (V4)", passed: issues.length === 0, issues };
}

// CHECK 9: Narration present on every scene
function checkNarration(scenes: any[]): CheckResult {
  const issues: QualityIssue[] = [];
  const missing = scenes.filter((s) => !s.narration || s.narration.trim().length < 5);

  if (missing.length > 0) {
    for (const s of missing) {
      issues.push({
        severity: "MAJOR",
        rule: "NARRATION",
        scene: s.id,
        message: `${sceneLabel(s)} thiếu trường narration — TTS pipeline không có gì để đọc`,
        suggestion: "Thêm narration: lời voice-over đầy đủ, không phải mô tả visual",
      });
    }
  }

  return { name: "Narration: mọi scene có lời thoại cho TTS", passed: issues.length === 0, issues };
}

// CHECK 10: ICON_TRIPLE must have circle and LABEL_UNDER slots
function checkIconTriple(scenes: any[]): CheckResult {
  const issues: QualityIssue[] = [];

  for (const s of scenes.filter((s) => s.layout === "ICON_TRIPLE")) {
    const entities = s.entities ?? [];
    const texts = s.texts ?? [];

    // Check circle field
    const missingCircle = entities.filter((e: any) => !e.circle);
    if (missingCircle.length > 0) {
      issues.push({
        severity: "MAJOR",
        rule: "ICON_TRIPLE",
        scene: s.id,
        message: `${sceneLabel(s)} ICON_TRIPLE: ${missingCircle.length} icon thiếu field "circle" (vòng tròn màu sau icon)`,
        suggestion: 'Thêm circle: "#FFFFFF" hoặc màu phù hợp cho mỗi icon',
      });
    }

    // Check LABEL_UNDER slots instead of CALLOUT_LEFT/CENTER/RIGHT
    const wrongSlotTexts = texts.filter((t: any) =>
      ["CALLOUT_LEFT", "CALLOUT_CENTER", "CALLOUT_RIGHT"].includes(t.slot ?? "")
    );
    if (wrongSlotTexts.length > 0) {
      issues.push({
        severity: "MAJOR",
        rule: "ICON_TRIPLE",
        scene: s.id,
        message: `${sceneLabel(s)} ICON_TRIPLE: ${wrongSlotTexts.length} text dùng CALLOUT_LEFT/CENTER/RIGHT — sẽ hiện ở đỉnh màn hình, không dưới icon`,
        suggestion: "Đổi sang LABEL_UNDER_LEFT / LABEL_UNDER_CENTER / LABEL_UNDER_RIGHT (y=0.62)",
      });
    }

    // entity.label + circle pill = double label
    const doubleLabelEntities = entities.filter((e: any) => e.circle && e.label);
    if (doubleLabelEntities.length > 0) {
      issues.push({
        severity: "MINOR",
        rule: "ICON_TRIPLE",
        scene: s.id,
        message: `${sceneLabel(s)} ICON_TRIPLE: ${doubleLabelEntities.length} entity có cả "circle" và "label" — chữ sẽ đè nhau`,
        suggestion: "Khi đã dùng circle + pill text → bỏ entity.label đi",
      });
    }
  }

  return { name: "ICON_TRIPLE: circle field, LABEL_UNDER slots, không double-label", passed: issues.length === 0, issues };
}

// CHECK (V4): evidence paperCard là nội dung chính của scene — mèo to đứng
// giữa scene sẽ bị card dài đè lên (đã gặp trong test_copy_video: card 3 câu
// đè xuống ngang chân mèo). Card evidence nên đứng RIÊNG, không cat entity.
function checkPaperCardCollision(scenes: any[]): CheckResult {
  const issues: QualityIssue[] = [];
  for (const s of scenes) {
    const cards = s.paperCards ?? [];
    const longEvidence = cards.filter((c: any) => c.variant === "evidence" && (c.body ?? "").length > 160);
    if (longEvidence.length === 0) continue;

    const catEntities = (s.entities ?? []).filter((e: any) => e.src?.startsWith("characters/"));
    if (catEntities.length > 0) {
      issues.push({
        severity: "MAJOR",
        rule: "PAPER_CARD_COLLISION",
        scene: s.id,
        message: `${sceneLabel(s)} evidence card dài (${longEvidence[0].body.length} ký tự) + ${catEntities.length} mèo cùng scene — card sẽ đè lên nhân vật`,
        suggestion: "Tách card evidence thành scene riêng không có cat entity, hoặc rút ngắn body xuống ≤160 ký tự",
      });
    }
  }
  return { name: "PaperCard: evidence dài không đè lên nhân vật (V4)", passed: issues.length === 0, issues };
}

// CHECK 11: STAT_DRAMA must have dark background + clearPrevious
function checkStatDrama(scenes: any[]): CheckResult {
  const issues: QualityIssue[] = [];
  const CENTER_SLOTS = new Set(["CENTER_MID", "CENTER"]);

  for (const s of scenes.filter((s) => s.layout === "STAT_DRAMA" || s.layout === "STAT")) {
    const bg = s.backgroundSrc ?? "";
    const isDark =
      bg.includes("0d0d") || bg.includes("1a0a") || bg.includes("1a1a") ||
      bg.includes("0a0e") || bg.includes("000") || bg === "#000000";

    if (!isDark && isCSSBackground(bg)) {
      issues.push({
        severity: "MAJOR",
        rule: "STAT_DRAMA",
        scene: s.id,
        message: `${sceneLabel(s)} STAT_DRAMA không dùng nền tối — con số sẽ không nổi bật`,
        suggestion: 'backgroundSrc: "linear-gradient(160deg, #0d0d1a 0%, #1a0a0a 100%)"',
      });
    }

    if (!s.clearPrevious) {
      issues.push({
        severity: "MINOR",
        rule: "STAT_DRAMA",
        scene: s.id,
        message: `${sceneLabel(s)} STAT_DRAMA thiếu clearPrevious:true — assets cũ có thể che con số`,
        suggestion: "Thêm clearPrevious: true để màn hình sạch trước khi hiện stat",
      });
    }

    // STAT text must exist
    const statTexts = (s.texts ?? []).filter((t: any) => t.style === "STAT");
    if (statTexts.length === 0) {
      issues.push({
        severity: "MAJOR",
        rule: "STAT_DRAMA",
        scene: s.id,
        message: `${sceneLabel(s)} STAT_DRAMA không có text style=STAT`,
        suggestion: "Thêm text với style: \"STAT\" chứa con số drama vào scene",
      });
    }

    // STAT is for a short number/phrase, not a full sentence — long content
    // at 120px overflows and collides with whatever else is on screen (the
    // "Hungary: đẻ 4 con, miễn thuế TNCN cả đời" defect over the cat's face).
    for (const t of statTexts) {
      const words = wordCount(t.content ?? "");
      if (words > 6) {
        issues.push({
          severity: "MAJOR",
          rule: "STAT_DRAMA",
          scene: s.id,
          message: `${sceneLabel(s)} STAT text "${t.id}" dài ${words} từ — STAT chỉ dành cho số/cụm từ ngắn (≤6 từ), câu dài sẽ tràn và đè lên nhân vật`,
          suggestion: 'Rút ngắn còn 1 con số hoặc cụm ngắn (vd "100 năm"); phần diễn giải đưa vào CAPTION hoặc narration',
        });
      }
    }

    // A character standing dead-center at the same time as a centered STAT
    // number is the other half of the collision — the two occupy the same
    // pixels. STAT_CENTER wants the frame to itself (compiler forces
    // clearPrevious for this reason, but the AI still often re-adds a cat).
    const centerCats = (s.entities ?? []).filter(
      (e: any) => e.src?.startsWith("characters/") && CENTER_SLOTS.has(e.slot ?? "")
    );
    const centerStat = statTexts.some((t: any) => (t.slot ?? "") === "STAT_CENTER" || !t.slot);
    if (centerCats.length > 0 && centerStat) {
      issues.push({
        severity: "MAJOR",
        rule: "STAT_DRAMA",
        scene: s.id,
        message: `${sceneLabel(s)} mèo ở slot CENTER cùng lúc với STAT_CENTER text — hai thứ chồng lên nhau giữa màn hình`,
        suggestion: "Đặt mèo ở LEFT_MID/RIGHT_MID (không phải CENTER_MID) khi scene có STAT_CENTER text",
      });
    }
  }

  return { name: "STAT_DRAMA: dark bg + clearPrevious + STAT ngắn + không đè nhân vật", passed: issues.length === 0, issues };
}

// CHECK (V4): background "mood" churn. Every scene changing white ↔ dark ↔
// photo back-to-back reads as flicker even if each individual background is
// valid — the reference video holds white for stretches and only cuts to
// dark/photo for a deliberate beat. Alternating every single scene is the
// literal complaint "màu nền thay đổi quá nhiều".
function bgMood(bg: string): "white" | "dark" | "photo" | "other" {
  if (!bg) return "other";
  const isPhoto = !isCSSBackground(bg);
  if (isPhoto) return "photo";
  if (/^#(fff|ffffff|fafaf8|f5f5f5)$/i.test(bg.trim())) return "white";
  const hexes = bg.match(/#[0-9a-fA-F]{3,6}\b/g) ?? [];
  const lums = hexes
    .map((h) => {
      let s = h.replace("#", "");
      if (s.length === 3) s = s.split("").map((c) => c + c).join("");
      const r = parseInt(s.slice(0, 2), 16), g = parseInt(s.slice(2, 4), 16), b = parseInt(s.slice(4, 6), 16);
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    })
    .filter((n) => !isNaN(n));
  const avg = lums.length ? lums.reduce((a, b) => a + b, 0) / lums.length : 0.5;
  return avg < 0.35 ? "dark" : "other";
}

function checkBackgroundChurn(scenes: any[]): CheckResult {
  const issues: QualityIssue[] = [];
  if (scenes.length < 4) return { name: "Background: không đổi mood liên tục", passed: true, issues };

  const moods = scenes.map((s) => bgMood(s.backgroundSrc ?? ""));
  let churnCount = 0;
  for (let i = 1; i < moods.length; i++) {
    if (moods[i] !== moods[i - 1] && moods[i] !== "other" && moods[i - 1] !== "other") churnCount++;
  }
  const churnRatio = churnCount / (moods.length - 1);

  if (churnRatio > 0.6) {
    issues.push({
      severity: "MAJOR",
      rule: "BACKGROUND_CHURN",
      message: `Nền đổi mood (trắng/tối/ảnh) ở ${churnCount}/${moods.length - 1} lần chuyển scene — nhấp nháy liên tục`,
      suggestion: "Giữ nền trắng cho các scene giải thích liên tiếp; chỉ chuyển dark/photo cho 1 beat có chủ đích (climax, evidence, cảm xúc), không đổi mood mỗi scene",
    });
  }

  // STAT_DRAMA (dark) used for something that is really just an evidence/fact
  // scene (no drama climax) is the root cause seen in practice: scene 1 opens
  // on a dark STAT_DRAMA reciting policy numbers, not a shock reveal.
  const darkNonClimax = scenes.filter((s, i) => {
    if (bgMood(s.backgroundSrc ?? "") !== "dark") return false;
    if (s.layout !== "STAT_DRAMA" && s.layout !== "STAT") return false;
    const statTexts = (s.texts ?? []).filter((t: any) => t.style === "STAT");
    // A real climax has ONE short stat; multiple facts/policies read as evidence.
    return statTexts.length === 0 || statTexts.some((t: any) => wordCount(t.content ?? "") > 6);
  });
  if (darkNonClimax.length > 0) {
    issues.push({
      severity: "MAJOR",
      rule: "BACKGROUND_CHURN",
      message: `${darkNonClimax.length} scene STAT_DRAMA (nền tối) chứa nội dung liệt kê/evidence dài thay vì 1 con số climax`,
      suggestion: 'Đổi các scene này sang layout SOLO/CHAR_PROP nền trắng + paperCards variant "evidence" — STAT_DRAMA nền tối chỉ dành cho climax 1 con số ngắn',
    });
  }

  return { name: "Background: không đổi mood liên tục, STAT_DRAMA không lạm dụng", passed: issues.length === 0, issues };
}

// CHECK 12: DIALOGUE scenes have 2 entities, CALLOUT_LEFT/RIGHT
function checkDialogue(scenes: any[]): CheckResult {
  const issues: QualityIssue[] = [];

  for (const s of scenes.filter((s) => s.layout === "DIALOGUE")) {
    const entities = s.entities ?? [];
    const texts = s.texts ?? [];

    if (entities.length < 2) {
      issues.push({
        severity: "MAJOR",
        rule: "DIALOGUE",
        scene: s.id,
        message: `${sceneLabel(s)} DIALOGUE chỉ có ${entities.length} entity — cần 2 nhân vật`,
        suggestion: "Thêm 2 cat entities ở LEFT (x=0.28) và RIGHT (x=0.72)",
      });
    }

    const hasCalloutSpeech =
      texts.some((t: any) => t.slot === "CALLOUT_LEFT") ||
      texts.some((t: any) => t.slot === "CALLOUT_RIGHT") ||
      (s.speechBubbles ?? []).length > 0;
    if (!hasCalloutSpeech) {
      issues.push({
        severity: "MINOR",
        rule: "DIALOGUE",
        scene: s.id,
        message: `${sceneLabel(s)} DIALOGUE không có CALLOUT_LEFT/RIGHT — không có lời thoại trực quan`,
        suggestion: "Thêm CALLOUT_LEFT + CALLOUT_RIGHT làm speech bubble cho 2 nhân vật",
      });
    }

    // Warn about BODY text in DIALOGUE (lecture mode)
    const hasBody = texts.some((t: any) => t.style === "BODY");
    const bodyCount = texts.filter((t: any) => t.style === "BODY").length;
    if (bodyCount > 1) {
      issues.push({
        severity: "MINOR",
        rule: "DIALOGUE",
        scene: s.id,
        message: `${sceneLabel(s)} DIALOGUE có ${bodyCount} BODY texts — chuyển sang lecture mode`,
        suggestion: "DIALOGUE nên dùng CALLOUT speech bubbles, không phải nhiều dòng BODY giải thích",
      });
    }
  }

  return { name: "DIALOGUE: 2 entities, CALLOUT speech bubbles", passed: issues.length === 0, issues };
}

// CHECK 13: Asset scale — main characters must be large enough
// LINEUP/ICON_TRIPLE are exempt — small scale is intentional (0.85-1.4 is correct for those).
function checkAssetScale(scenes: any[]): CheckResult {
  const issues: QualityIssue[] = [];
  const SMALL_SCALE_OK = new Set(["ICON_TRIPLE", "ACCUMULATION", "LINEUP", "CAUSE_EFFECT_CHAIN"]);

  for (const s of scenes) {
    if (SMALL_SCALE_OK.has(s.layout)) continue;
    for (const e of (s.entities ?? [])) {
      if (!e.src?.startsWith("characters/")) continue;
      if (e.scale === undefined || e.scale === null) continue; // auto-scale handled by compiler
      // Solo/Dialogue/STAT main character should be visible
      const minScale = ["SOLO", "INTRO", "CLOSE_UP", "STAT_DRAMA", "STAT"].includes(s.layout) ? 1.4 : 1.1;
      if (e.scale < minScale) {
        issues.push({
          severity: "MINOR",
          rule: "ASSET_SCALE",
          scene: s.id,
          message: `${sceneLabel(s)} character "${e.assetId}" scale=${e.scale} trong ${s.layout} — hơi nhỏ (khuyến nghị ≥${minScale})`,
          suggestion: "Xóa field scale để SceneCompiler tự áp auto-scale, hoặc tăng lên",
        });
      }
    }
  }

  return { name: "Asset scale: nhân vật chính đủ lớn theo layout", passed: issues.length === 0, issues };
}

// CHECK 14: Visual rhythm — something happens every 360 frames max
function checkVisualRhythm(scenes: any[]): CheckResult {
  const issues: QualityIssue[] = [];

  for (const s of scenes) {
    if (s.durationFrames < 360) continue;

    const events: number[] = [];
    // Collect all "event moments" within scene (relative to scene start)
    for (const e of (s.entities ?? [])) {
      events.push(e.enterDelay ?? 0);
      if (e.emphasize) events.push((e.enterDelay ?? 0) + (e.emphasize.delay ?? 30));
    }
    for (const t of (s.texts ?? [])) {
      events.push(t.delay ?? 0);
    }

    events.sort((a, b) => a - b);

    // Find largest gap between events
    let maxGap = 0;
    let gapStart = 0;
    let prev = 0;
    for (const f of events) {
      const gap = f - prev;
      if (gap > maxGap) { maxGap = gap; gapStart = prev; }
      prev = f;
    }
    // Also check gap from last event to end
    const tailGap = s.durationFrames - prev;
    if (tailGap > maxGap) { maxGap = tailGap; gapStart = prev; }

    if (maxGap > 450) {
      issues.push({
        severity: "MINOR",
        rule: "VISUAL_RHYTHM",
        scene: s.id,
        message: `${sceneLabel(s)} gap ${maxGap} frames (${(maxGap / 30).toFixed(1)}s) không có visual event (frame ${gapStart}–${gapStart + maxGap})`,
        suggestion: "Thêm emphasize hoặc text mới mỗi 8-12s để duy trì visual rhythm",
      });
    }
  }

  return { name: "Visual rhythm: event mỗi ≤360 frames (12s)", passed: issues.length === 0, issues };
}

// CHECK 15: Camera overuse — max 1 ZOOM_IN per video
function checkCameraUsage(scenes: any[]): CheckResult {
  const issues: QualityIssue[] = [];
  const zoomScenes = scenes.filter(
    (s) => s.camera && (s.camera.action === "ZOOM_IN" || s.camera.action === "FOCUS_ON")
  );

  if (zoomScenes.length > 1) {
    issues.push({
      severity: "MINOR",
      rule: "CAMERA_MINIMAL",
      message: `${zoomScenes.length} scenes dùng ZOOM_IN/FOCUS_ON (max 1/video): ${zoomScenes.map((s) => s.id).join(", ")}`,
      suggestion: "Giữ camera gần như tĩnh — assets di chuyển thay vì camera zoom",
    });
  }

  // Check zoom level
  for (const s of scenes) {
    if (!s.camera) continue;
    const zoom = s.camera.zoom ?? 1;
    if (zoom > 1.2) {
      issues.push({
        severity: "MINOR",
        rule: "CAMERA_MINIMAL",
        scene: s.id,
        message: `${sceneLabel(s)} camera zoom=${zoom} — quá mạnh (max 1.15)`,
        suggestion: "Giảm zoom xuống ≤1.15",
      });
    }
  }

  return { name: "Camera: tối thiểu zoom, max 1 ZOOM_IN/video", passed: issues.length === 0, issues };
}

// CHECK 16: clearPrevious usage — scene thay đổi bối cảnh phải có clearPrevious:true
function checkClearPrevious(scenes: any[]): CheckResult {
  const issues: QualityIssue[] = [];

  for (let i = 1; i < scenes.length; i++) {
    const prev = scenes[i - 1];
    const curr = scenes[i];

    // If layout changes significantly and clearPrevious not set → assets from prev scene bleed in
    const layoutChanges = prev.layout !== curr.layout;
    const bgChanges = prev.backgroundSrc !== curr.backgroundSrc;
    const hasClear = curr.clearPrevious === true ||
      (Array.isArray(curr.clearPrevious) && curr.clearPrevious.length > 0);

    if (layoutChanges && bgChanges && !hasClear) {
      issues.push({
        severity: "MINOR",
        rule: "CLEAR_PREVIOUS",
        scene: curr.id,
        message: `${sceneLabel(curr)} layout+background đổi nhưng clearPrevious không set — assets cũ có thể đè lên scene mới`,
        suggestion: "Thêm clearPrevious: true nếu muốn canvas sạch khi bắt đầu scene mới",
      });
    }
  }

  return { name: "clearPrevious: set khi layout+background thay đổi", passed: issues.length === 0, issues };
}

// CHECK 17: Asset paths resolve to real production art.
// Two distinct failures, deliberately different severities:
//   ASSET_EXISTS  (BLOCKER) — nothing on disk at all → renders a broken image.
//   LEGACY_ASSET  (MAJOR)   — resolves only to the retired public/assets/*.svg
//                             set, i.e. no production art exists for that ref
//                             yet. Renderable, but off-style; the fix is to
//                             add the asset (see /add-asset) and rebuild the
//                             manifest so the alias picks it up.
function checkAssetPaths(scenes: any[]): CheckResult {
  const issues: QualityIssue[] = [];
  const checked = new Set<string>();

  const inspect = (src: string, sceneId: string, sceneObj: any, label: string) => {
    if (!src || checked.has(src)) return;
    checked.add(src);
    const resolution = resolveAssetSrcStrict(src);
    const full = path.join(process.cwd(), "public", resolution.path);
    if (!fs.existsSync(full)) {
      issues.push({
        severity: "BLOCKER",
        rule: "ASSET_EXISTS",
        scene: sceneId,
        message: `${sceneLabel(sceneObj)} asset không tồn tại: ${resolution.path} (${label} "${src}")`,
        suggestion: "Chạy /list-assets để xem asset khả dụng, hoặc /add-asset để bổ sung rồi npm run build-assets",
      });
      return;
    }
    if (resolution.isLegacy) {
      issues.push({
        severity: "MAJOR",
        rule: "LEGACY_ASSET",
        scene: sceneId,
        message: `${sceneLabel(sceneObj)} "${src}" chỉ còn art legacy (${resolution.path}) — chưa có bản production`,
        suggestion: "Thêm art vào generated-assets/ (xem /add-asset) rồi npm run build-assets để alias trỏ sang bản mới",
      });
    }
  };

  for (const s of scenes) {
    for (const e of (s.entities ?? [])) inspect(e.src, s.id, s, `entity ${e.assetId}`);
    const bg: string = s.backgroundSrc ?? "";
    if (bg && !isCSSBackground(bg)) inspect(bg, s.id, s, "backgroundSrc");
  }

  return { name: "Assets: resolve về art production, không còn legacy", passed: issues.length === 0, issues };
}

// CHECK 18: Duration sum matches durationInFrames
function checkDurationSum(timeline: any): CheckResult {
  const issues: QualityIssue[] = [];
  const scenes = timeline.scenes ?? [];
  const total = scenes.reduce((sum: number, s: any) => sum + (s.durationFrames ?? 0), 0);
  const declared = timeline.durationInFrames ?? 0;

  if (Math.abs(total - declared) > 30) {
    issues.push({
      severity: "MAJOR",
      rule: "DURATION_SUM",
      message: `Tổng durationFrames=${total} nhưng durationInFrames=${declared} (lệch ${Math.abs(total - declared)} frames)`,
      suggestion: "Sửa durationInFrames = tổng tất cả scene.durationFrames, hoặc chạy lại TTS để patch tự động",
    });
  }

  return { name: "Duration: tổng scene frames khớp durationInFrames", passed: issues.length === 0, issues };
}

// CHECK 19: Text duration set (no infinite texts)
function checkTextDuration(scenes: any[]): CheckResult {
  const issues: QualityIssue[] = [];

  for (const s of scenes) {
    const infiniteTexts = (s.texts ?? []).filter((t: any) => t.duration === undefined || t.duration === null);
    if (infiniteTexts.length > 2) {
      issues.push({
        severity: "MINOR",
        rule: "TEXT_DURATION",
        scene: s.id,
        message: `${sceneLabel(s)} ${infiniteTexts.length} texts không có duration (tồn tại đến hết scene)`,
        suggestion: "Set duration cho texts — tránh màn hình bị lấp đầy text từ đầu đến cuối scene",
      });
    }
  }

  return { name: "Text duration: texts có duration set, không tồn tại mãi", passed: issues.length === 0, issues };
}

// CHECK 20: Audio path exists (if set)
function checkAudioPath(timeline: any): CheckResult {
  const issues: QualityIssue[] = [];

  if (timeline.audio) {
    const audioPath = path.join(process.cwd(), "public", timeline.audio);
    if (!fs.existsSync(audioPath)) {
      issues.push({
        severity: "BLOCKER",
        rule: "AUDIO_EXISTS",
        message: `Audio file không tồn tại: public/${timeline.audio}`,
        suggestion: "Chạy lại với --tts để generate audio, hoặc sửa đường dẫn audio",
      });
    }
  } else {
    issues.push({
      severity: "MINOR",
      rule: "AUDIO_EXISTS",
      message: "Không có audio track — video sẽ không có tiếng",
      suggestion: "Chạy pipeline với --tts để tự động generate TTS audio",
    });
  }

  return { name: "Audio: file tồn tại và được set", passed: issues.length === 0, issues };
}

// CHECK 21: Unique IDs (scene, text, entity)
function checkUniqueIds(scenes: any[]): CheckResult {
  const issues: QualityIssue[] = [];
  const sceneIds = new Set<string>();
  const textIds = new Set<string>();
  const entityIds = new Set<string>();

  for (const s of scenes) {
    if (s.id) {
      if (sceneIds.has(s.id)) {
        issues.push({
          severity: "BLOCKER",
          rule: "UNIQUE_IDS",
          scene: s.id,
          message: `Duplicate scene id "${s.id}"`,
        });
      } else sceneIds.add(s.id);
    }
    for (const t of (s.texts ?? [])) {
      if (t.id) {
        if (textIds.has(t.id)) {
          issues.push({ severity: "MAJOR", rule: "UNIQUE_IDS", scene: s.id, message: `Duplicate text id "${t.id}"` });
        } else textIds.add(t.id);
      }
    }
    for (const e of (s.entities ?? [])) {
      if (e.assetId) {
        // assetIds CAN repeat (same asset in different scenes is fine — hold-state)
        // but within a scene they should be unique
      }
    }
  }

  return { name: "IDs: scene id và text id unique toàn timeline", passed: issues.length === 0, issues };
}

// CHECK 22: Stagger — entities should not all enter at frame 0
function checkStagger(scenes: any[]): CheckResult {
  const issues: QualityIssue[] = [];

  for (const s of scenes) {
    const entities = s.entities ?? [];
    if (entities.length < 2) continue;
    const allAtZero = entities.every((e: any) => (e.enterDelay ?? 0) === 0);
    if (allAtZero) {
      issues.push({
        severity: "MINOR",
        rule: "STAGGER",
        scene: s.id,
        message: `${sceneLabel(s)} ${entities.length} entities đều enterDelay=0 — xuất hiện đồng loạt`,
        suggestion: "Stagger enterDelay 12-20 frames giữa các entities để tạo nhịp điệu",
      });
    }
  }

  return { name: "Stagger: entities không xuất hiện đồng loạt", passed: issues.length === 0, issues };
}

// CHECK 23: No emoji in text content
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}️]/u;
function checkNoEmoji(scenes: any[]): CheckResult {
  const issues: QualityIssue[] = [];
  for (const s of scenes) {
    for (const t of (s.texts ?? [])) {
      if (t.content && EMOJI_RE.test(t.content)) {
        issues.push({
          severity: "MINOR",
          rule: "NO_EMOJI",
          scene: s.id,
          message: `${sceneLabel(s)} text "${t.id}" chứa emoji: "${t.content}"`,
          suggestion: "Xóa emoji — dùng chữ hoặc icon SVG thật. Emoji render không nhất quán.",
        });
      }
    }
  }
  return { name: "Text: không dùng emoji", passed: issues.length === 0, issues };
}

// CHECK 24: Long videos should use signature components (paper cards / TV frames)
function checkSignatureComponents(timeline: any, scenes: any[]): CheckResult {
  const issues: QualityIssue[] = [];
  const totalSecs = (timeline.durationInFrames ?? 0) / 30;
  if (totalSecs < 180) return { name: "Signature components: paper card / TV frame (video dài)", passed: true, issues: [] };

  const paperCards = scenes.reduce((n, s) => n + (s.paperCards?.length ?? 0), 0);
  const frameBoxes = scenes.reduce((n, s) => n + (s.frameBoxes?.length ?? 0), 0);

  if (paperCards === 0 && frameBoxes === 0) {
    issues.push({
      severity: "MAJOR",
      rule: "SIGNATURE_COMPONENTS",
      message: `Video ${(totalSecs / 60).toFixed(0)} phút không dùng paperCards (evidence/survey) hoặc frameBoxes (TV data) — thiếu device đặc trưng của kênh`,
      suggestion: "Thêm ≥1 paperCard evidence (dẫn chứng chính sách) hoặc survey (câu hỏi khán giả), và frameBox nếu có bản đồ/biểu đồ",
    });
  }
  return { name: "Signature components: paper card / TV frame (video dài)", passed: issues.length === 0, issues };
}

// CHECK 26: Scene density — enough scenes for the duration (anti-boredom)
function checkSceneDensity(timeline: any, scenes: any[]): CheckResult {
  const issues: QualityIssue[] = [];
  const totalSecs = (timeline.durationInFrames ?? 0) / 30;
  if (totalSecs < 30) return { name: "Scene density: đủ scene cho thời lượng", passed: true, issues: [] };

  const secsPerScene = scenes.length > 0 ? totalSecs / scenes.length : Infinity;
  const idealScenes = Math.round(totalSecs / 11);

  if (secsPerScene > 18) {
    issues.push({
      severity: "MAJOR",
      rule: "SCENE_DENSITY",
      message: `${scenes.length} scenes cho ${(totalSecs / 60).toFixed(1)} phút = TB ${secsPerScene.toFixed(1)}s/scene — quá ít visual shot`,
      suggestion: `Cắt narration thành visual shot 5-9s; mục tiêu tối thiểu ~${Math.round(totalSecs / 9)} scenes`,
    });
  } else if (secsPerScene > 12) {
    issues.push({
      severity: "MINOR",
      rule: "SCENE_DENSITY",
      message: `TB ${secsPerScene.toFixed(1)}s/scene — nhịp hình còn chậm (mục tiêu 5-9s)`,
      suggestion: `Cân nhắc cắt thêm visual shot; không cần tạo TTS gap dài giữa các shot`,
    });
  }
  return { name: "Scene density: đủ scene cho thời lượng", passed: issues.length === 0, issues };
}

// Production-composition gates derived from refer/meo.mp4 contact-sheet audits.
// These catch quota-gaming timelines that are schema-perfect but still render as
// a repeated sticker on a near-empty background.
function checkReferenceComposition(timeline: any, scenes: any[]): CheckResult {
  const issues: QualityIssue[] = [];
  if (scenes.length < 8) {
    return { name: "Reference composition: stage/evidence/register đủ dày", passed: true, issues };
  }

  const totalSecs = (timeline.durationInFrames ?? 0) / 30;
  const tableaux = scenes.filter((s) => s.layout === "TABLEAU" || STAGE_ANCHORS_KEYS.has(s.backgroundSrc)).length;
  const beats = scenes.filter((s) => {
    const bg = s.backgroundSrc ?? "";
    return s.layout === "BEAT" || (!isCSSBackground(bg) && !STAGE_ANCHORS_KEYS.has(bg) && (s.entities?.length ?? 0) === 0);
  }).length;
  const evidence = scenes.filter((s) => (s.paperCards?.length ?? 0) > 0 || (s.frameBoxes?.length ?? 0) > 0).length;
  const frameBoxes = scenes.reduce((n, s) => n + (s.frameBoxes?.length ?? 0), 0);
  const scenicRatio = (tableaux + beats) / scenes.length;

  if (tableaux / scenes.length < 0.2) {
    issues.push({
      severity: "MAJOR",
      rule: "TABLEAU_DENSITY",
      message: `Chỉ ${tableaux}/${scenes.length} scene có illustrated stage — nhân vật dễ thành sticker nổi trên nền`,
      suggestion: "Dùng TABLEAU cho mọi không gian vật lý; mục tiêu ≥35% scene",
    });
  }
  if (scenicRatio < 0.35) {
    issues.push({
      severity: "MAJOR",
      rule: "SCENIC_REGISTER",
      message: `TABLEAU + BEAT chỉ chiếm ${(scenicRatio * 100).toFixed(0)}% — thiếu cảnh sống và emotional/real anchor`,
      suggestion: "Mục tiêu TABLEAU + BEAT ≥45%, xen kẽ evidence/diagram thay vì nền phẳng liên tục",
    });
  }
  if (evidence / scenes.length < 0.08) {
    issues.push({
      severity: "MAJOR",
      rule: "EVIDENCE_DENSITY",
      message: `Chỉ ${evidence}/${scenes.length} scene chiếu evidence/data — claim chủ yếu đang được đọc thay vì được thấy`,
      suggestion: "Mỗi claim số liệu/chính sách/khảo sát → paperCard hoặc frameBox; mục tiêu ≥10%",
    });
  }
  if (totalSecs >= 300 && frameBoxes === 0) {
    issues.push({
      severity: "MAJOR",
      rule: "FRAMEBOX_MISSING",
      message: `Video ${(totalSecs / 60).toFixed(1)} phút không có frameBox/TV data nào`,
      suggestion: "Dùng frameBox cho bản đồ, chart, screenshot hoặc data panel ít nhất 1 lần",
    });
  }

  let streak = 1;
  for (let i = 1; i < scenes.length; i++) {
    streak = scenes[i].layout === scenes[i - 1].layout ? streak + 1 : 1;
    if (streak === 3) {
      issues.push({
        severity: "MAJOR",
        rule: "REGISTER_STREAK",
        scene: scenes[i].id,
        message: `${sceneLabel(scenes[i])} là layout ${scenes[i].layout} thứ 3 liên tiếp`,
        suggestion: "Đổi register: tableau → evidence → diagram/dialogue/beat",
      });
    }
  }

  return { name: "Reference composition: stage/evidence/register đủ dày", passed: issues.length === 0, issues };
}

function normalizeWords(value: string): string[] {
  return (value ?? "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
}

function checkOverlayNarrationDuplication(scenes: any[]): CheckResult {
  const issues: QualityIssue[] = [];
  for (const s of scenes) {
    const narration = normalizeWords(s.narration ?? "");
    if (narration.length < 6) continue;
    const prefix = narration.slice(0, 6).join(" ");
    for (const t of (s.texts ?? [])) {
      const overlay = normalizeWords(t.content ?? "");
      if (overlay.length >= 6 && overlay.slice(0, 6).join(" ") === prefix) {
        issues.push({
          severity: "MINOR",
          rule: "TEXT_NARRATION_DUPLICATE",
          scene: s.id,
          message: `${sceneLabel(s)} overlay "${t.id}" lặp nguyên phần đầu narration`,
          suggestion: "Overlay chỉ giữ keyword/con số/đối lập; phụ đề đã mang lời nói",
        });
        break;
      }
    }
  }
  return { name: "Text: overlay không lặp phụ đề", passed: issues.length === 0, issues };
}

function checkSemanticTimeline(timeline: any, scenes: any[]): CheckResult {
  const issues: QualityIssue[] = [];
  if (timeline?.schemaVersion !== 2 || scenes.length === 0) {
    return { name: "Semantic production gates (schema v2)", passed: true, issues };
  }
  const isCharacter = (source: string): boolean =>
    source.startsWith("characters/") || source.startsWith("generated-assets/characters/");
  const genericPairs = scenes.filter((scene) => {
    const entities = scene.entities ?? [];
    const characters = entities.filter((entity: any) => isCharacter(String(entity.src ?? "")));
    const semanticProps = entities.filter((entity: any) => !isCharacter(String(entity.src ?? "")));
    const relation = String(scene.semanticTakeaway ?? "");
    return characters.length >= 2 &&
      semanticProps.length === 0 &&
      (scene.speechBubbles?.length ?? 0) === 0 &&
      (scene.paperCards?.length ?? 0) === 0 &&
      (scene.frameBoxes?.length ?? 0) === 0 &&
      !/\b(versus|vs|gives|takes|asks|answers|helps|blocks|follows|chases|hands|compares)\b/i.test(relation);
  });
  if (genericPairs.length) {
    issues.push({
      severity: "MAJOR", rule: "GENERIC_CHARACTER_PAIR", scene: genericPairs[0].id,
      message: `${genericPairs.length}/${scenes.length} scenes contain generic character pairs without a visible relation.`,
    });
  }

  const flatScenes = scenes.filter((scene) => {
    const background = String(scene.backgroundSrc ?? "");
    return !background || /^#|^rgba?\(|gradient\(/i.test(background);
  });
  if (flatScenes.length / scenes.length > 0.50) {
    issues.push({
      severity: "MAJOR", rule: "SOLID_BACKGROUND_RATIO", scene: flatScenes[0]?.id,
      message: `${flatScenes.length}/${scenes.length} scenes use a flat CSS background; maximum is 50%.`,
    });
  }

  const emptyFocal = scenes.filter((scene) =>
    !String(scene.semanticTakeaway ?? "").trim() ||
    ((scene.semanticAssetIds?.length ?? 0) === 0 &&
      (scene.paperCards?.length ?? 0) === 0 &&
      (scene.frameBoxes?.length ?? 0) === 0)
  );
  if (emptyFocal.length) {
    issues.push({
      severity: "BLOCKER", rule: "EMPTY_SEMANTIC_FOCAL", scene: emptyFocal[0].id,
      message: `${emptyFocal.length}/${scenes.length} scenes have no compiled semantic focal point.`,
    });
  }

  const unresolved = scenes.filter((scene) => (scene.unresolvedAssets?.length ?? 0) > 0);
  if (unresolved.length) {
    issues.push({
      severity: "BLOCKER", rule: "UNRESOLVED_ASSET", scene: unresolved[0].id,
      message: `${unresolved.length} scenes contain unresolved semantic assets.`,
    });
  }

  const registerCounts = new Map<string, number>();
  for (const scene of scenes) {
    if (scene.visualRegister) registerCounts.set(scene.visualRegister, (registerCounts.get(scene.visualRegister) ?? 0) + 1);
  }
  if (scenes.length >= 8 && registerCounts.size < referenceQuality.registers.minimumDistinct) {
    issues.push({
      severity: "MAJOR", rule: "REGISTER_DIVERSITY",
      message: `Timeline uses ${registerCounts.size} visual registers; minimum is ${referenceQuality.registers.minimumDistinct}.`,
    });
  }
  for (const [register, count] of registerCounts) {
    if (scenes.length >= 8 && count / scenes.length > referenceQuality.registers.maximumSingleRatio) {
      issues.push({
        severity: "MAJOR", rule: "REGISTER_DOMINANCE",
        message: `${register} occupies ${Math.round(count / scenes.length * 100)}% of the timeline.`,
      });
    }
  }

  const durationSeconds = Number(timeline.durationInFrames ?? 0) / Number(timeline.fps ?? 30);
  const heroFrames = scenes.filter((scene) => scene.heroVisual).map((scene) => scene.startFrame);
  const boundaries = [0, ...heroFrames, timeline.durationInFrames ?? 0].sort((a, b) => a - b);
  const longestHeroGap = boundaries.slice(1).reduce((max, frame, index) => Math.max(max, frame - boundaries[index]), 0);
  if (durationSeconds >= 45 && longestHeroGap / 30 > 45) {
    issues.push({
      severity: "MAJOR", rule: "HERO_VISUAL_GAP",
      message: `Longest hero-visual gap is ${(longestHeroGap / 30).toFixed(1)}s; maximum is 45s.`,
    });
  }

  const uniqueAssets = new Set<string>(scenes.flatMap((scene) => scene.semanticAssetIds ?? []));
  const minimumVariants = durationSeconds > 600 ? 20 : durationSeconds >= 300 ? 16 : 12;
  if (durationSeconds >= 60 && uniqueAssets.size < minimumVariants) {
    issues.push({
      severity: "MAJOR", rule: "SEMANTIC_ASSET_DIVERSITY",
      message: `${uniqueAssets.size} unique semantic assets; minimum for this duration is ${minimumVariants}.`,
    });
  }

  return { name: "Semantic production gates (schema v2)", passed: issues.length === 0, issues };
}

function checkRenderedIntentProxies(timeline: any, scenes: any[]): CheckResult {
  const issues: QualityIssue[] = [];
  if (timeline?.schemaVersion !== 2 || scenes.length < 8) {
    return { name: "Rendered-intent proxies", passed: true, issues };
  }
  const cfg = referenceQuality.composition;
  const isCharacter = (source: string): boolean =>
    /(^|\/)(characters|character)\//.test(source) || source.includes("generated-assets/characters/");
  const characters = scenes.map((scene) =>
    (scene.entities ?? []).filter((entity: any) => isCharacter(String(entity.src ?? "")))
  );
  const characterSceneCount = characters.filter((items) => items.length > 0).length;
  if (scenes.length >= 20 && characterSceneCount / scenes.length > cfg.maximumCharacterPresenceRatio) {
    issues.push({
      severity: "MAJOR", rule: "CHARACTER_ALWAYS_PRESENT",
      message: `${characterSceneCount}/${scenes.length} scenes contain a character; maximum is ${Math.round(cfg.maximumCharacterPresenceRatio * 100)}%.`,
      suggestion: "Let charts, maps, evidence, photos, and diagrams carry scenes without a narrator cat.",
    });
  }

  const signatures = new Map<string, any[]>();
  for (const [index, scene] of scenes.entries()) {
    const entities = scene.entities ?? [];
    const charCount = characters[index].length;
    const propCount = entities.length - charCount;
    const componentCount = (scene.paperCards?.length ?? 0) + (scene.frameBoxes?.length ?? 0) +
      (scene.speechBubbles?.length ?? 0);
    const signature = `${charCount}c:${propCount}p:${scene.texts?.length ?? 0}t:${componentCount}x`;
    signatures.set(signature, [...(signatures.get(signature) ?? []), scene]);
  }
  for (const [signature, matching] of signatures) {
    if (scenes.length >= 20 && matching.length / scenes.length > cfg.maximumTemplateShapeRatio) {
      issues.push({
        severity: "MAJOR", rule: "TEMPLATE_SHAPE_DOMINANCE", scene: matching[0].id,
        message: `${matching.length}/${scenes.length} scenes reuse entity shape ${signature}; maximum is ${Math.round(cfg.maximumTemplateShapeRatio * 100)}%.`,
      });
    }
  }

  const countSources = (sources: string[]) => sources.reduce((map, source) => {
    map.set(source, (map.get(source) ?? 0) + 1);
    return map;
  }, new Map<string, number>());
  const poseCounts = countSources(characters.flat().map((entity: any) => String(entity.src ?? "")));
  const poseLimit = Math.max(3, Math.floor(scenes.length * cfg.maximumPoseRatio));
  for (const [pose, count] of poseCounts) {
    if (scenes.length >= 20 && count > poseLimit) {
      issues.push({
        severity: "MAJOR", rule: "POSE_REUSE",
        message: `${pose} appears ${count} times; maximum is ${poseLimit}.`,
      });
    }
  }
  if ((timeline.durationInFrames ?? 0) / (timeline.fps ?? 30) > 600 &&
      poseCounts.size < cfg.minimumLongVideoPoseVariants) {
    issues.push({
      severity: "MAJOR", rule: "POSE_VARIANT_SHORTAGE",
      message: `${poseCounts.size} character pose/costume variants; long videos require ${cfg.minimumLongVideoPoseVariants}.`,
    });
  }

  const stageCounts = countSources(scenes.map((scene) => String(scene.backgroundSrc ?? ""))
    .filter((source) => source.startsWith("assets/scenes/")));
  const stageLimit = Math.max(3, Math.floor(scenes.length * cfg.maximumStageRatio));
  for (const [stage, count] of stageCounts) {
    if (count > stageLimit) {
      issues.push({
        severity: "MAJOR", rule: "STAGE_REUSE",
        message: `${stage} appears in ${count} scenes; maximum is ${stageLimit}.`,
      });
    }
  }
  const sparseStages = scenes.filter((scene) =>
    String(scene.backgroundSrc ?? "").startsWith("assets/scenes/") &&
    (!scene.semanticAction || !scene.semanticSetting ||
      ((scene.entities?.length ?? 0) < 2 && (scene.paperCards?.length ?? 0) + (scene.frameBoxes?.length ?? 0) === 0))
  );
  if (sparseStages.length) {
    issues.push({
      severity: "MAJOR", rule: "SPARSE_STAGE", scene: sparseStages[0].id,
      message: `${sparseStages.length} stage scenes lack a visible action, setting, or sufficient focal composition.`,
    });
  }

  const headingCounts = new Map<string, any[]>();
  for (const scene of scenes) {
    for (const overlay of scene.texts ?? []) {
      const value = String(overlay.content ?? overlay.text ?? "").trim().toLowerCase();
      if (!value) continue;
      headingCounts.set(value, [...(headingCounts.get(value) ?? []), scene]);
    }
  }
  for (const [label, matching] of headingCounts) {
    if (matching.length > cfg.maximumLabelUses &&
        /^(the big picture|money|children|population|dating game|evidence|overview)$/.test(label)) {
      issues.push({
        severity: "MAJOR", rule: "GENERIC_LABEL_REUSE", scene: matching[0].id,
        message: `Generic heading "${label}" appears ${matching.length} times.`,
      });
    }
  }

  const qualifiesHero = (scene: any): boolean => {
    const background = String(scene.backgroundSrc ?? "");
    const hasPhoto = /\.(jpg|jpeg|png|webp)$/i.test(background);
    const cards = (scene.paperCards?.length ?? 0) + (scene.frameBoxes?.length ?? 0);
    const nodes = scene.entities?.length ?? 0;
    const fullScene = background.startsWith("assets/scenes/") && nodes >= 2 && !!scene.semanticAction;
    const gag = (scene.speechBubbles?.length ?? 0) >= 1 && nodes >= 2;
    return hasPhoto || cards > 0 || nodes >= 3 || fullScene || gag;
  };
  const fakeHeroes = scenes.filter((scene) => scene.heroVisual && !qualifiesHero(scene));
  if (fakeHeroes.length) {
    issues.push({
      severity: "MAJOR", rule: "HERO_METADATA_ONLY", scene: fakeHeroes[0].id,
      message: `${fakeHeroes.length} hero scenes have no qualifying rendered component.`,
    });
  }

  const componentMismatch = scenes.filter((scene) => {
    switch (scene.visualRegister) {
      case "evidence":
        return (scene.paperCards?.length ?? 0) + (scene.frameBoxes?.length ?? 0) === 0;
      case "framebox":
      case "photo_broll":
        return (scene.frameBoxes?.length ?? 0) === 0 &&
          !/\.(jpg|jpeg|png|webp)$/i.test(String(scene.backgroundSrc ?? ""));
      case "full_tableau":
        return !String(scene.backgroundSrc ?? "").startsWith("assets/scenes/") || !scene.semanticAction;
      case "infographic":
        return (scene.entities?.length ?? 0) < 2;
      case "visual_gag":
        return (scene.speechBubbles?.length ?? 0) === 0 && (scene.entities?.length ?? 0) < 3;
      default:
        return false;
    }
  });
  if (componentMismatch.length) {
    issues.push({
      severity: "MAJOR", rule: "REGISTER_COMPONENT_MISMATCH", scene: componentMismatch[0].id,
      message: `${componentMismatch.length} scenes declare a register without its rendered component.`,
    });
  }

  const fingerprints = scenes.map((scene) => String(scene.visualFingerprint ?? "")).filter(Boolean);
  const fingerprintCounts = countSources(fingerprints);
  const repeated = [...fingerprintCounts].filter(([, count]) => count > Math.max(2, scenes.length * 0.08));
  if (repeated.length) {
    issues.push({
      severity: "MAJOR", rule: "VISUAL_FINGERPRINT_REUSE",
      message: `${repeated.length} visual fingerprints exceed the reuse budget.`,
    });
  }
  const missingFingerprint = scenes.filter((scene) => !String(scene.visualFingerprint ?? "").trim());
  if (missingFingerprint.length) {
    issues.push({
      severity: "MAJOR", rule: "MISSING_VISUAL_FINGERPRINT", scene: missingFingerprint[0].id,
      message: `${missingFingerprint.length}/${scenes.length} schema-v2 scenes have no visual fingerprint.`,
    });
  }

  return { name: "Rendered-intent proxies", passed: issues.length === 0, issues };
}

// CHECK 25: Narration coverage → subtitle track exists
function checkSubtitleCoverage(scenes: any[]): CheckResult {
  const issues: QualityIssue[] = [];
  const withNarration = scenes.filter((s) => s.narration && s.narration.trim().length >= 5).length;
  const ratio = scenes.length > 0 ? withNarration / scenes.length : 0;

  if (ratio < 0.5 && scenes.length >= 2) {
    issues.push({
      severity: "MAJOR",
      rule: "SUBTITLE_COVERAGE",
      message: `Chỉ ${withNarration}/${scenes.length} scenes có narration — phần lớn video sẽ KHÔNG có phụ đề (signature look của kênh)`,
      suggestion: "Viết narration đầy đủ cho mọi scene — compiler tự tạo phụ đề burned-in từ đó",
    });
  }
  return { name: "Subtitle: đủ narration để tạo phụ đề mọi scene", passed: issues.length === 0, issues };
}

// ─── Main runner ─────────────────────────────────────────────

export function runQualityCheck(timeline: any, timelinePath = "(unknown)"): QualityReport {
  const scenes: any[] = Array.isArray(timeline?.scenes) ? timeline.scenes : [];

  const checks: CheckResult[] = [
    checkAssetPaths(scenes),
    checkUniqueIds(scenes),
    checkFrameContinuity(scenes),
    checkDurationSum(timeline),
    checkAudioPath(timeline),
    checkBackgroundReal(scenes),
    checkBackgroundVariety(scenes),
    checkLayoutVariety(scenes),
    checkOpeningBright(scenes),
    checkEndingBright(scenes),
    checkStoryArc(scenes),
    checkV5Hygiene(scenes),
    checkV5Registers(scenes),
    checkSceneDuration(scenes),
    checkTextWordCap(scenes),
    checkTextOverlap(scenes),
    checkTextDuration(scenes),
    checkNarration(scenes),
    checkCatPoseDiversity(scenes),
    checkAssetScale(scenes),
    checkVisualRhythm(scenes),
    checkCameraUsage(scenes),
    checkClearPrevious(scenes),
    checkIconTriple(scenes),
    checkPaperCardCollision(scenes),
    checkStatDrama(scenes),
    checkBackgroundChurn(scenes),
    checkDialogue(scenes),
    checkStagger(scenes),
    checkNoEmoji(scenes),
    checkSignatureComponents(timeline, scenes),
    checkSubtitleCoverage(scenes),
    checkSceneDensity(timeline, scenes),
    checkReferenceComposition(timeline, scenes),
    checkSemanticTimeline(timeline, scenes),
    checkRenderedIntentProxies(timeline, scenes),
    checkOverlayNarrationDuplication(scenes),
  ];

  return assembleReport(checks, timelinePath);
}

// Score + grade a set of checks (shared by timeline + storyboard reports).
// blockers = -15pt, majors = -6pt, minors = -1pt; capped at 100.
function assembleReport(checks: CheckResult[], label: string): QualityReport {
  const allIssues = checks.flatMap((c) => c.issues);
  const blockers = allIssues.filter((i) => i.severity === "BLOCKER").length;
  const majors = allIssues.filter((i) => i.severity === "MAJOR").length;
  const minors = allIssues.filter((i) => i.severity === "MINOR").length;

  const deductions = Math.min(100, 15 * blockers + 6 * majors + 1 * minors);
  const scorePercent = Math.max(0, 100 - deductions);

  const grade: QualityReport["grade"] =
    blockers > 0       ? "F" :
    scorePercent >= 90 ? "A" :
    scorePercent >= 75 ? "B" :
    scorePercent >= 55 ? "C" :
    scorePercent >= 35 ? "D" : "F";

  const summary = allIssues
    .filter((i) => i.severity === "BLOCKER" || i.severity === "MAJOR")
    .slice(0, 8)
    .map((i) => `[${i.severity}] ${i.message}`);

  return { timelinePath: label, scorePercent, grade, blockers, majors, minors, checks, summary };
}

// ─── Pretty printer ───────────────────────────────────────────

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  white: "\x1b[97m",
  bgRed: "\x1b[41m",
  bgYellow: "\x1b[43m",
  bgGreen: "\x1b[42m",
};

function severityIcon(s: IssueSeverity): string {
  if (s === "BLOCKER") return `${C.bgRed}${C.white} BLOCKER ${C.reset}`;
  if (s === "MAJOR")   return `${C.red}  MAJOR  ${C.reset}`;
  return                      `${C.yellow}  minor  ${C.reset}`;
}

function gradeColor(g: string): string {
  if (g === "A") return C.green;
  if (g === "B") return C.cyan;
  if (g === "C") return C.yellow;
  return C.red;
}

export function printQualityReport(report: QualityReport): void {
  const divider = "─".repeat(72);
  const { scorePercent, grade, blockers, majors, minors, checks, summary } = report;

  console.log(`\n${C.bold}${divider}${C.reset}`);
  console.log(`${C.bold}  🎬 QUALITY REPORT: ${report.timelinePath}${C.reset}`);
  console.log(`${C.bold}${divider}${C.reset}`);

  const gc = gradeColor(grade);
  console.log(
    `\n  Score: ${gc}${C.bold}${scorePercent}/100  Grade: ${grade}${C.reset}` +
    `   │  ${C.red}${blockers} blocker(s)${C.reset}  ${C.yellow}${majors} major(s)${C.reset}  ${C.gray}${minors} minor(s)${C.reset}`
  );

  const passedCount = checks.filter((c) => c.passed).length;
  console.log(`  Checks passed: ${passedCount}/${checks.length}\n`);

  // Per-check summary
  console.log(`${C.bold}  CHECKLIST${C.reset}`);
  for (const check of checks) {
    const icon = check.passed ? `${C.green}✅${C.reset}` : `${C.red}❌${C.reset}`;
    const issueCount = check.issues.length > 0 ? ` ${C.gray}(${check.issues.length} issue(s))${C.reset}` : "";
    console.log(`  ${icon} ${check.name}${issueCount}`);
  }

  // Detailed issues
  const failed = checks.filter((c) => !c.passed);
  if (failed.length > 0) {
    console.log(`\n${C.bold}  ISSUES${C.reset}`);
    for (const check of failed) {
      if (check.issues.length === 0) continue;
      console.log(`\n  ${C.bold}${check.name}${C.reset}`);
      for (const issue of check.issues) {
        console.log(`    ${severityIcon(issue.severity)} ${issue.message}`);
        if (issue.suggestion) {
          console.log(`    ${C.gray}  → ${issue.suggestion}${C.reset}`);
        }
      }
    }
  }

  // Action items
  if (summary.length > 0) {
    console.log(`\n${C.bold}  TOP ACTION ITEMS${C.reset}`);
    for (let i = 0; i < summary.length; i++) {
      console.log(`  ${i + 1}. ${summary[i]}`);
    }
  }

  console.log(`\n${C.bold}${divider}${C.reset}\n`);
}
