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

import { Scene, SceneEntity, SceneText, SceneSpeechBubble, ScenePaperCard, LayoutPreset } from "../types/scene";
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

type GrammarFn = (b: SceneBrief, ctx: GrammarContext) => GrammarResult;

export const VISUAL_GRAMMARS: Record<string, GrammarFn> = {
  COMPARE: grammarCompare,
  STAT_REVEAL: grammarStatReveal,
  POLICY_LIST: grammarPolicyList,
  DIALOGUE_QA: grammarDialogueQA,
  TABLEAU: grammarTableau,
  EVIDENCE: grammarEvidence,
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
