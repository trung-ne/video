// ============================================================
// Visual grammar registry — deterministic expansion of an authoring
// intent (SceneBrief) into concrete scene content. Each grammar is a
// PURE function so the LLM never has to place entities, pick animations
// or compute frames; it only chooses a grammar + fills concept slots.
//
// A grammar returns the *content* of a scene (layout + entities + texts
// + bubbles + cards). storyboardCompiler.ts wraps that with id/timing and
// layers beat-emphasis on top. Browser-safe: no fs, no Date/random.
// ============================================================

import { Scene, SceneEntity, SceneText, SceneSpeechBubble, ScenePaperCard, SceneFrameBox, LayoutPreset } from "../types/scene";
import { SceneBrief, Storyboard, Shot, Emotion } from "../types/storyboard";
import { STAGE_ANCHORS } from "./stageAnchors";

// Emotion → cat pose. The storyboard authors an emotion per scene; without
// this the compiler ignored it and every narrator cat used the same hardcoded
// pose (flat expression on every video — a system-wide defect, breaks V4.3).
// Only poses that exist under public/assets/characters are referenced.
const EMOTION_POSE: Record<Emotion, string> = {
  neutral: "characters/cat_explain",
  surprise: "characters/cat_surprised",
  concern: "characters/cat_think",
  sad: "characters/cat_sad",
  hopeful: "characters/cat_happy",
  sarcastic: "characters/cat_explain",
  curious: "characters/cat_think",
  urgent: "characters/cat_surprised",
  happy: "characters/cat_happy",
};

function emotionPose(emotion: Emotion | undefined): string {
  return (emotion && EMOTION_POSE[emotion]) || "characters/cat_explain";
}

export interface GrammarContext {
  cast: Storyboard["cast"];
  index: number; // scene index (for A/B side stability across a video)
}

export interface GrammarResult {
  layout: LayoutPreset;
  backgroundSrc?: string;
  entities: SceneEntity[];
  texts: SceneText[];
  speechBubbles?: SceneSpeechBubble[];
  paperCards?: ScenePaperCard[];
  frameBoxes?: SceneFrameBox[];
  // The assetId the eye should land on — compiler anchors beat-emphasis here.
  focusAssetId?: string;
  // The text id that carries the key number/keyword, if any.
  focusTextId?: string;
}

const WHITE = "#FFFFFF";

// Resolve a cast role name → character src (falls back to a neutral cat).
function castSrc(ctx: GrammarContext, role: string | undefined, fallback: string): { src: string; badge?: string } {
  if (role && ctx.cast && ctx.cast[role]) return ctx.cast[role];
  return { src: fallback };
}

function shotToScale(shot: Shot | undefined, base: number): number {
  if (shot === "close") return base * 1.25;
  if (shot === "wide") return base * 0.8;
  return base;
}

// ── COMPARE ─────────────────────────────────────────────────
// Two concepts side by side (rule-of-thirds) + a host cat gesturing.
function grammarCompare(b: SceneBrief, ctx: GrammarContext): GrammarResult {
  const left = b.slots?.left ?? "A";
  const right = b.slots?.right ?? "B";
  return {
    layout: "DUAL_CONTRAST",
    backgroundSrc: WHITE,
    entities: [
      { assetId: `${b.id}-l`, src: "characters/cat_explain", slot: "LEFT_MID", enterAnimation: "slideLeft", enterDelay: 8 },
      { assetId: `${b.id}-r`, src: "characters/cat_think", slot: "RIGHT_MID", enterAnimation: "slideRight", enterDelay: 20 },
    ],
    texts: [
      { id: `${b.id}-lt`, content: left, style: "CALLOUT", slot: "CALLOUT_LEFT", delay: 12, duration: 120 },
      { id: `${b.id}-rt`, content: right, style: "CALLOUT", slot: "CALLOUT_RIGHT", delay: 24, duration: 120 },
    ],
    focusAssetId: `${b.id}-r`,
  };
}

// ── STAT_REVEAL ─────────────────────────────────────────────
// One shock number lands big centre; a cat reacts. Beat-emphasis (added by
// compiler) pulses the STAT on the number's word.
function grammarStatReveal(b: SceneBrief, ctx: GrammarContext): GrammarResult {
  const stat = b.slots?.stat ?? b.slots?.number ?? "";
  const cat = castSrc(ctx, b.slots?.who, emotionPose(b.emotion));
  return {
    layout: "STAT_DRAMA",
    backgroundSrc: "linear-gradient(160deg, #0d0d1a 0%, #1a0a0a 100%)",
    entities: [
      { assetId: `${b.id}-cat`, src: cat.src, badge: cat.badge, slot: "RIGHT_MID", enterAnimation: "popIn", enterDelay: 10 },
    ],
    texts: stat
      ? [{ id: `${b.id}-stat`, content: stat, style: "STAT", slot: "STAT_CENTER", delay: 6, duration: 150 }]
      : [],
    focusAssetId: `${b.id}-cat`,
    focusTextId: stat ? `${b.id}-stat` : undefined,
  };
}

// ── POLICY_LIST ─────────────────────────────────────────────
// A lineup of numbered actors/items. slots.items = "A|B|C".
function grammarPolicyList(b: SceneBrief, ctx: GrammarContext): GrammarResult {
  const items = (b.slots?.items ?? "").split("|").map((s) => s.trim()).filter(Boolean).slice(0, 4);
  const slots = ["FAR_LEFT", "LEFT", "RIGHT", "FAR_RIGHT"] as const;
  const entities: SceneEntity[] = items.map((_, i) => ({
    assetId: `${b.id}-i${i}`,
    src: "characters/cat",
    slot: slots[i],
    badge: String(i + 1),
    enterAnimation: "popIn",
    enterDelay: 8 + i * 8,
  }));
  const texts: SceneText[] = items.map((label, i) => ({
    id: `${b.id}-t${i}`,
    content: label,
    style: "CAPTION",
    position: { x: [0.15, 0.38, 0.62, 0.85][i], y: 0.7 },
    delay: 12 + i * 8,
    duration: 120,
  }));
  return { layout: "LINEUP", backgroundSrc: WHITE, entities, texts, focusAssetId: entities[0]?.assetId };
}

// ── DIALOGUE_QA ─────────────────────────────────────────────
// Two cats trade lines. 180°-rule: A left→right, B right→left.
function grammarDialogueQA(b: SceneBrief, ctx: GrammarContext): GrammarResult {
  const a = castSrc(ctx, b.slots?.asker, "characters/cat_talk");
  const c = castSrc(ctx, b.slots?.answerer, "characters/cat_think");
  const bubbles: SceneSpeechBubble[] = [];
  if (b.slots?.askerText)
    bubbles.push({ id: `${b.id}-qa`, anchorAssetId: `${b.id}-a`, text: b.slots.askerText, direction: "right", delay: 12, duration: 70 });
  if (b.slots?.answererText)
    bubbles.push({ id: `${b.id}-qb`, anchorAssetId: `${b.id}-b`, text: b.slots.answererText, direction: "left", delay: 90, duration: 70 });
  return {
    layout: "DIALOGUE",
    backgroundSrc: WHITE,
    entities: [
      { assetId: `${b.id}-a`, src: a.src, badge: a.badge, slot: "LEFT", enterAnimation: "slideLeft", enterDelay: 8 },
      { assetId: `${b.id}-b`, src: c.src, badge: c.badge, slot: "RIGHT", enterAnimation: "slideRight", enterDelay: 18 },
    ],
    texts: [],
    speechBubbles: bubbles,
    focusAssetId: `${b.id}-a`,
  };
}

// ── TABLEAU ─────────────────────────────────────────────────
// Characters seated inside an illustrated stage set at named anchors.
function grammarTableau(b: SceneBrief, ctx: GrammarContext): GrammarResult {
  const stage = b.slots?.stage ?? "assets/scenes/living_room.svg";
  const anchors = STAGE_ANCHORS[stage] ?? {};
  const anchorKeys = Object.keys(anchors);
  const entities: SceneEntity[] = [];
  const bubbles: SceneSpeechBubble[] = [];

  const a = castSrc(ctx, b.slots?.who ?? b.slots?.seatA, emotionPose(b.emotion));
  const anchorA = b.slots?.anchorA ?? anchorKeys[0];
  if (anchorA) entities.push({ assetId: `${b.id}-a`, src: a.src, badge: a.badge, anchor: anchorA, enterAnimation: "fadeIn", enterDelay: 6 });

  if (b.slots?.seatB) {
    const c = castSrc(ctx, b.slots.seatB, "characters/cat_mom");
    const anchorB = b.slots?.anchorB ?? anchorKeys[1] ?? anchorKeys[0];
    entities.push({ assetId: `${b.id}-b`, src: c.src, badge: c.badge, anchor: anchorB, enterAnimation: "fadeIn", enterDelay: 12 });
  }
  if (b.slots?.lineA && entities[0])
    bubbles.push({ id: `${b.id}-la`, anchorAssetId: `${b.id}-a`, text: b.slots.lineA, direction: "right", delay: 14, duration: 70 });
  if (b.slots?.lineB && entities[1])
    bubbles.push({ id: `${b.id}-lb`, anchorAssetId: `${b.id}-b`, text: b.slots.lineB, direction: "left", delay: 90, duration: 60 });

  return { layout: "TABLEAU", backgroundSrc: stage, entities, texts: [], speechBubbles: bubbles, focusAssetId: entities[0]?.assetId };
}

// ── EVIDENCE ────────────────────────────────────────────────
// A paper card (quote / data) — the reference's "show, don't tell" device.
function grammarEvidence(b: SceneBrief, ctx: GrammarContext): GrammarResult {
  const body = b.slots?.body ?? b.narration;
  const title = b.slots?.title;
  const choices = (b.slots?.choices ?? "").split("|").map((s) => s.trim()).filter(Boolean);
  const isSurvey = !!title || choices.length > 0;
  return {
    layout: "SOLO",
    backgroundSrc: WHITE,
    entities: [
      { assetId: `${b.id}-cat`, src: emotionPose(b.emotion), slot: "LEFT_MID", enterAnimation: "popIn", enterDelay: 8 },
    ],
    texts: [],
    paperCards: [
      { id: `${b.id}-ev`, variant: isSurvey ? "survey" : "evidence", title, body,
        choices: choices.length ? choices : undefined, position: { x: 0.66, y: 0.4 }, delay: 12 },
    ],
    focusAssetId: `${b.id}-cat`,
  };
}

// ── BEAT ────────────────────────────────────────────────────
// Full-bleed emotional image, no character, no overlay (subtitle only).
function grammarBeat(b: SceneBrief, ctx: GrammarContext): GrammarResult {
  const img = b.slots?.image ?? b.slots?.background ?? "#111111";
  return { layout: "CLOSE_UP", backgroundSrc: img, entities: [], texts: [] };
}

// ── SOLO ────────────────────────────────────────────────────
// One expressive cat addressing the viewer + a single keyword.
function grammarSolo(b: SceneBrief, ctx: GrammarContext): GrammarResult {
  const cat = castSrc(ctx, b.slots?.who, emotionPose(b.emotion));
  const kw = b.slots?.keyword;
  return {
    layout: "SOLO",
    backgroundSrc: WHITE,
    entities: [{ assetId: `${b.id}-cat`, src: cat.src, badge: cat.badge, slot: "CENTER_MID", enterAnimation: "popIn", enterDelay: 8 }],
    texts: kw ? [{ id: `${b.id}-kw`, content: kw, style: "CALLOUT", slot: "CALLOUT_CENTER", delay: 12, duration: 110 }] : [],
    focusAssetId: `${b.id}-cat`,
    focusTextId: kw ? `${b.id}-kw` : undefined,
  };
}

// ── FRAMEBOX (TV/screen device) ─────────────────────────────
// An image or data panel inside a drawn TV frame + a cat reacting beside it.
// The reference channel's signature "show it on a screen" device.
function grammarFrameBox(b: SceneBrief, ctx: GrammarContext): GrammarResult {
  const content = b.slots?.content ?? b.slots?.image ?? "#1b2a3a";
  const caption = b.slots?.caption;
  return {
    layout: "SOLO",
    backgroundSrc: WHITE,
    entities: [
      { assetId: `${b.id}-cat`, src: emotionPose(b.emotion), slot: "RIGHT_BOTTOM", scale: 1.2, enterAnimation: "popIn", enterDelay: 14 },
    ],
    texts: [],
    focusAssetId: `${b.id}-cat`,
    frameBoxes: [{ id: `${b.id}-tv`, contentSrc: content, caption, position: { x: 0.42, y: 0.42 }, delay: 8 }],
  };
}

// ── CHAR_PROP (Kuleshov: cat + object) ──────────────────────
// Cat on the left looking right at a prop on the right; optional label.
function grammarCharProp(b: SceneBrief, ctx: GrammarContext): GrammarResult {
  const prop = b.slots?.prop ?? "finance/money";
  const label = b.slots?.label;
  return {
    layout: "CHAR_PROP",
    backgroundSrc: WHITE,
    entities: [
      { assetId: `${b.id}-cat`, src: b.slots?.who ? castSrc(ctx, b.slots.who, "characters/cat_explain").src : "characters/cat_explain", slot: "LEFT", enterAnimation: "slideLeft", enterDelay: 8 },
      { assetId: `${b.id}-prop`, src: prop, slot: "RIGHT", scale: 1.3, label, enterAnimation: "popIn", enterDelay: 24,
        emphasize: { animation: "pulse", delay: 30, duration: 20 } },
    ],
    texts: [],
    focusAssetId: `${b.id}-prop`,
  };
}

// ── DIAGRAM (left→right flow) ───────────────────────────────
// items "A|B|C" laid across, connected by right-arrows: A → B → C.
function grammarDiagram(b: SceneBrief, ctx: GrammarContext): GrammarResult {
  const items = (b.slots?.items ?? "").split("|").map((s) => s.trim()).filter(Boolean).slice(0, 3);
  const n = items.length || 2;
  const xs = n === 3 ? [0.2, 0.5, 0.8] : [0.28, 0.72];
  const entities: SceneEntity[] = [];
  const texts: SceneText[] = [];
  items.forEach((label, i) => {
    entities.push({ assetId: `${b.id}-n${i}`, src: "characters/cat", position: { x: xs[i], y: 0.5 }, badge: String(i + 1), scale: 1.3, enterAnimation: "popIn", enterDelay: 8 + i * 16 });
    texts.push({ id: `${b.id}-t${i}`, content: label, style: "CAPTION", position: { x: xs[i], y: 0.68 }, delay: 12 + i * 16, duration: 120 });
    if (i < items.length - 1) {
      entities.push({ assetId: `${b.id}-a${i}`, src: "ui/arrow_right", position: { x: (xs[i] + xs[i + 1]) / 2, y: 0.5 }, scale: 0.9, enterAnimation: "fadeIn", enterDelay: 16 + i * 16 });
    }
  });
  return { layout: "CUSTOM", backgroundSrc: WHITE, entities, texts, focusAssetId: `${b.id}-n0` };
}

// ── CAUSE_EFFECT (cause → arrow → effect) ───────────────────
function grammarCauseEffect(b: SceneBrief, ctx: GrammarContext): GrammarResult {
  const cause = b.slots?.cause ?? "Cause";
  const effect = b.slots?.effect ?? "Effect";
  const causeIcon = b.slots?.causeIcon;
  const effectIcon = b.slots?.effectIcon;
  const entities: SceneEntity[] = [
    { assetId: `${b.id}-c`, src: causeIcon ?? "characters/cat_think", position: { x: 0.22, y: 0.48 }, scale: causeIcon ? 1.4 : 1.6, enterAnimation: "slideLeft", enterDelay: 8 },
    { assetId: `${b.id}-arrow`, src: "ui/arrow_right", position: { x: 0.5, y: 0.48 }, scale: 1.1, enterAnimation: "fadeIn", enterDelay: 26 },
    { assetId: `${b.id}-e`, src: effectIcon ?? "characters/cat_surprised", position: { x: 0.78, y: 0.48 }, scale: effectIcon ? 1.4 : 1.6, enterAnimation: "slideRight", enterDelay: 40,
      emphasize: { animation: "pulse", delay: 20, duration: 20 } },
  ];
  return {
    layout: "CUSTOM", backgroundSrc: WHITE, entities,
    texts: [
      { id: `${b.id}-ct`, content: cause, style: "CAPTION", position: { x: 0.22, y: 0.7 }, delay: 12, duration: 130 },
      { id: `${b.id}-et`, content: effect, style: "CAPTION", position: { x: 0.78, y: 0.7 }, delay: 44, duration: 120 },
    ],
    focusAssetId: `${b.id}-e`,
  };
}

// ── QA_REVEAL (question → answer later) ─────────────────────
function grammarQaReveal(b: SceneBrief, ctx: GrammarContext): GrammarResult {
  const q = b.slots?.question ?? b.slots?.q ?? "";
  const a = b.slots?.answer ?? b.slots?.a ?? "";
  return {
    layout: "QA_REVEAL",
    backgroundSrc: WHITE,
    entities: [
      { assetId: `${b.id}-cat`, src: "characters/cat_think", slot: "CENTER_MID", enterAnimation: "popIn", enterDelay: 8,
        emphasize: { animation: "bounce", delay: 60, duration: 20 } },
    ],
    texts: [
      ...(q ? [{ id: `${b.id}-q`, content: q, style: "CALLOUT" as const, slot: "CALLOUT_CENTER" as const, delay: 10, duration: 70 }] : []),
      ...(a ? [{ id: `${b.id}-a`, content: a, style: "STAT" as const, slot: "STAT_CENTER" as const, delay: 80, duration: 100 }] : []),
    ],
    focusAssetId: `${b.id}-cat`,
    focusTextId: a ? `${b.id}-a` : undefined,
  };
}

// ── ICON_TRIPLE (3 concepts in colored circles) ─────────────
function grammarIconTriple(b: SceneBrief, ctx: GrammarContext): GrammarResult {
  const items = (b.slots?.items ?? "").split("|").map((s) => s.trim()).filter(Boolean).slice(0, 3);
  const icons = (b.slots?.icons ?? "").split("|").map((s) => s.trim()).filter(Boolean);
  const circles = ["#8E44AD", "#2E86C1", "#E67E22"];
  const xs = [0.2, 0.5, 0.8];
  const entities: SceneEntity[] = [];
  const texts: SceneText[] = [];
  items.forEach((label, i) => {
    entities.push({ assetId: `${b.id}-i${i}`, src: icons[i] ?? "props/concept_card", position: { x: xs[i], y: 0.45 }, scale: 1.1, circle: circles[i], enterAnimation: "popIn", enterDelay: 8 + i * 14 });
    texts.push({ id: `${b.id}-t${i}`, content: label, style: "CAPTION", position: { x: xs[i], y: 0.66 }, delay: 12 + i * 14, duration: 120 });
  });
  return { layout: "ICON_TRIPLE", backgroundSrc: WHITE, entities, texts, focusAssetId: `${b.id}-i0` };
}

type GrammarFn = (b: SceneBrief, ctx: GrammarContext) => GrammarResult;

export const VISUAL_GRAMMARS: Record<string, GrammarFn> = {
  COMPARE: grammarCompare,
  STAT_REVEAL: grammarStatReveal,
  POLICY_LIST: grammarPolicyList,
  DIALOGUE_QA: grammarDialogueQA,
  TABLEAU: grammarTableau,
  EVIDENCE: grammarEvidence,
  FRAMEBOX: grammarFrameBox,
  CHAR_PROP: grammarCharProp,
  DIAGRAM: grammarDiagram,
  CAUSE_EFFECT: grammarCauseEffect,
  QA_REVEAL: grammarQaReveal,
  ICON_TRIPLE: grammarIconTriple,
  BEAT: grammarBeat,
  SOLO: grammarSolo,
};

// Apply shot sizing to a grammar's character entities (skip anchored ones —
// their scale is furniture-tuned).
export function applyShot(result: GrammarResult, shot: Shot | undefined): void {
  if (!shot || shot === "medium") return;
  for (const e of result.entities) {
    if (e.anchor) continue;
    if (!e.src.startsWith("characters/")) continue;
    e.scale = shotToScale(shot, e.scale ?? 1.8);
  }
}
