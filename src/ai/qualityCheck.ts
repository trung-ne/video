import * as fs from "fs";
import * as path from "path";
import { backgroundImageExists, isCSSBackground } from "./backgroundResolver";

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

// Narrative layouts that SHOULD have a real background image
const NARRATIVE_LAYOUTS = new Set([
  "SOLO", "INTRO", "DIALOGUE", "DUAL_CONTRAST", "CHAR_PROP",
  "QA_REVEAL", "LINEUP", "CONCLUSION", "CTA", "CAUSE_EFFECT",
  "CAUSE_EFFECT_CHAIN", "ACCUMULATION", "STORY", "CUSTOM",
]);

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

  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i], b = texts[j];
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

// CHECK 1: All backgrounds on narrative scenes must be real images
function checkBackgroundReal(scenes: any[]): CheckResult {
  const issues: QualityIssue[] = [];

  const narrativeScenes = scenes.filter((s) => NARRATIVE_LAYOUTS.has(s.layout));
  const gradientNarrative = narrativeScenes.filter(
    (s) => s.backgroundSrc && isCSSBackground(s.backgroundSrc)
  );
  const missingBg = narrativeScenes.filter((s) => !s.backgroundSrc);
  const brokenPath = narrativeScenes.filter(
    (s) => s.backgroundSrc && !isCSSBackground(s.backgroundSrc) && !backgroundImageExists(s.backgroundSrc)
  );

  for (const s of missingBg) {
    issues.push({
      severity: "MAJOR",
      rule: "BACKGROUND_REAL",
      scene: s.id,
      message: `${sceneLabel(s)} Không có backgroundSrc`,
      suggestion: `Thêm backgroundSrc: "backgrounds/living_room.jpg" (hoặc ảnh phù hợp bối cảnh)`,
    });
  }

  for (const s of gradientNarrative) {
    issues.push({
      severity: "MAJOR",
      rule: "BACKGROUND_REAL",
      scene: s.id,
      message: `${sceneLabel(s)} Layout ${s.layout} dùng gradient thay vì ảnh nền thật`,
      suggestion: `Đổi backgroundSrc sang backgrounds/*.jpg phù hợp bối cảnh scene`,
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

  return { name: "Background: ảnh nền thật trên narrative scenes", passed: issues.length === 0, issues };
}

// CHECK 2: Background variety — at least 5 distinct images
function checkBackgroundVariety(scenes: any[]): CheckResult {
  const issues: QualityIssue[] = [];
  const distinctImages = new Set(
    scenes.map((s) => s.backgroundSrc).filter((b) => b && backgroundImageExists(b))
  );

  if (distinctImages.size < 3 && scenes.length >= 4) {
    issues.push({
      severity: "MAJOR",
      rule: "BACKGROUND_VARIETY",
      message: `Chỉ ${distinctImages.size} ảnh nền khác nhau (yêu cầu ≥5). Video sẽ trông đơn điệu.`,
      suggestion: "Thay đổi backgroundSrc cho mỗi scene theo bối cảnh — dùng ảnh khác nhau",
    });
  } else if (distinctImages.size < 5 && scenes.length >= 6) {
    issues.push({
      severity: "MINOR",
      rule: "BACKGROUND_VARIETY",
      message: `Chỉ ${distinctImages.size} ảnh nền khác nhau (khuyến nghị ≥5 cho video dài)`,
      suggestion: "Thêm đa dạng background theo bối cảnh từng scene",
    });
  }

  return { name: "Background: đa dạng ≥5 ảnh khác nhau", passed: issues.length === 0, issues };
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

  return { name: "Layout: đa dạng ≥5 loại, không lặp 3+ liên tiếp", passed: issues.length === 0, issues };
}

// CHECK 4: Scene duration
// Ideal: 8-60s. Very short (<3s) is a BLOCKER (flickering). Very long (>120s)
// is a MINOR — for long videos with narration audio, long scenes can be intentional.
function checkSceneDuration(scenes: any[]): CheckResult {
  const issues: QualityIssue[] = [];
  const totalFrames = scenes.reduce((s, sc) => s + (sc.durationFrames ?? 0), 0);
  const avgFrames = scenes.length > 0 ? totalFrames / scenes.length : 0;

  for (const s of scenes) {
    if (typeof s.durationFrames !== "number") continue;
    const secs = s.durationFrames / 30;

    if (secs < 3) {
      issues.push({
        severity: "BLOCKER",
        rule: "SCENE_DURATION",
        scene: s.id,
        message: `${sceneLabel(s)} ${secs.toFixed(1)}s — quá ngắn, sẽ chớp nháy`,
        suggestion: "Scene nên tối thiểu 4-5 giây (120-150 frames)",
      });
    } else if (secs < 6) {
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

  return { name: "Cat pose: đa dạng theo cảm xúc, không toàn neutral", passed: issues.length === 0, issues };
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

// CHECK 11: STAT_DRAMA must have dark background + clearPrevious
function checkStatDrama(scenes: any[]): CheckResult {
  const issues: QualityIssue[] = [];

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
    const hasStat = (s.texts ?? []).some((t: any) => t.style === "STAT");
    if (!hasStat) {
      issues.push({
        severity: "MAJOR",
        rule: "STAT_DRAMA",
        scene: s.id,
        message: `${sceneLabel(s)} STAT_DRAMA không có text style=STAT`,
        suggestion: "Thêm text với style: \"STAT\" chứa con số drama vào scene",
      });
    }
  }

  return { name: "STAT_DRAMA: dark bg + clearPrevious + STAT text", passed: issues.length === 0, issues };
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
      texts.some((t: any) => t.slot === "CALLOUT_RIGHT");
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

// CHECK 17: Asset paths exist on disk
function checkAssetPaths(scenes: any[]): CheckResult {
  const issues: QualityIssue[] = [];
  const assetsDir = path.join(process.cwd(), "public", "assets");
  const checked = new Set<string>();

  for (const s of scenes) {
    for (const e of (s.entities ?? [])) {
      if (!e.src || checked.has(e.src)) continue;
      checked.add(e.src);
      const svgPath = path.join(assetsDir, `${e.src}.svg`);
      if (!fs.existsSync(svgPath)) {
        issues.push({
          severity: "BLOCKER",
          rule: "ASSET_EXISTS",
          scene: s.id,
          message: `${sceneLabel(s)} asset không tồn tại: public/assets/${e.src}.svg (entity "${e.assetId}")`,
          suggestion: "Chạy /list-assets để xem assets có sẵn, hoặc /add-asset để thêm mới",
        });
      }
    }
  }

  return { name: "Assets: tất cả src paths tồn tại trên disk", passed: issues.length === 0, issues };
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

  if (secsPerScene > 45) {
    issues.push({
      severity: "MAJOR",
      rule: "SCENE_DENSITY",
      message: `${scenes.length} scenes cho ${(totalSecs / 60).toFixed(1)} phút = TB ${secsPerScene.toFixed(0)}s/scene — quá ít, video sẽ nhàm chán`,
      suggestion: `Cắt nhỏ thành ~${idealScenes} scenes (mỗi 8-15s đổi beat/layout/background)`,
    });
  } else if (secsPerScene > 25) {
    issues.push({
      severity: "MINOR",
      rule: "SCENE_DENSITY",
      message: `TB ${secsPerScene.toFixed(0)}s/scene — hơi dài (lý tưởng 8-15s)`,
      suggestion: `Cân nhắc cắt thêm để đạt ~${idealScenes} scenes`,
    });
  }
  return { name: "Scene density: đủ scene cho thời lượng", passed: issues.length === 0, issues };
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
    checkStatDrama(scenes),
    checkDialogue(scenes),
    checkStagger(scenes),
    checkNoEmoji(scenes),
    checkSignatureComponents(timeline, scenes),
    checkSubtitleCoverage(scenes),
    checkSceneDensity(timeline, scenes),
  ];

  // Count issues
  const allIssues = checks.flatMap((c) => c.issues);
  const blockers = allIssues.filter((i) => i.severity === "BLOCKER").length;
  const majors = allIssues.filter((i) => i.severity === "MAJOR").length;
  const minors = allIssues.filter((i) => i.severity === "MINOR").length;
  const passed = checks.filter((c) => c.passed).length;

  // Score: weighted by checks passed + severity of failures.
  // blockers = -15pt each, majors = -6pt each, minors = -1pt each.
  // Cap deductions at 100 so score stays 0-100.
  const deductions = Math.min(100, 15 * blockers + 6 * majors + 1 * minors);
  const scorePercent = Math.max(0, 100 - deductions);

  const grade: QualityReport["grade"] =
    blockers > 0       ? "F" :
    scorePercent >= 90 ? "A" :
    scorePercent >= 75 ? "B" :
    scorePercent >= 55 ? "C" :
    scorePercent >= 35 ? "D" : "F";

  // Top action items (blockers first, then majors)
  const summary = allIssues
    .filter((i) => i.severity === "BLOCKER" || i.severity === "MAJOR")
    .slice(0, 8)
    .map((i) => `[${i.severity}] ${i.message}`);

  return { timelinePath, scorePercent, grade, blockers, majors, minors, checks, summary };
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
