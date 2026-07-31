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

import { Scene, SceneEntity, SceneText, SceneSpeechBubble, ScenePaperCard, SceneFrameBox, SceneConceptCard, LayoutPreset } from "../types/scene";
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
  strict?: boolean;
}

export interface GrammarResult {
  layout: LayoutPreset;
  backgroundSrc?: string;
  entities: SceneEntity[];
  texts: SceneText[];
  speechBubbles?: SceneSpeechBubble[];
  paperCards?: ScenePaperCard[];
  cards?: SceneConceptCard[];
  frameBoxes?: SceneFrameBox[];
  // The assetId the eye should land on — compiler anchors beat-emphasis here.
  focusAssetId?: string;
  // The text id that carries the key number/keyword, if any.
  focusTextId?: string;
}

const WHITE = "#FFFFFF";

// Resolve a cast role name → character src (falls back to a neutral cat).
function castSrc(ctx: GrammarContext, role: string | undefined, fallback: string): { src: string; badge?: string } {
  if (!role) return { src: fallback };
  if (role && ctx.cast && ctx.cast[role]) {
    const cast = ctx.cast[role];
    return cast.poseFamily === "narrator"
      ? { src: fallback, badge: cast.badge }
      : cast;
  }
  if (role && role.includes("/")) return { src: role };
  if (ctx.strict) {
    throw new Error(`Unresolved cast role or character asset "${role}"`);
  }
  return { src: fallback };
}

function shotToScale(shot: Shot | undefined, base: number): number {
  if (shot === "close") return base * 1.25;
  if (shot === "wide") return base * 0.8;
  return base;
}

function semanticAsset(ctx: GrammarContext, value: string | undefined, label: string, legacyFallback: string): string {
  if (value?.trim()) return value.trim();
  if (ctx.strict) throw new Error(`Missing semantic asset for slot "${label}"`);
  return legacyFallback;
}

// ── COMPARE ─────────────────────────────────────────────────
// Two concepts side by side (rule-of-thirds) + a host cat gesturing.
function grammarCompare(b: SceneBrief, ctx: GrammarContext): GrammarResult {
  const left = b.slots?.left ?? "A";
  const right = b.slots?.right ?? "B";
  const leftAsset = semanticAsset(ctx, b.slots?.leftAsset, "leftAsset", "characters/cat_explain");
  const rightAsset = semanticAsset(ctx, b.slots?.rightAsset, "rightAsset", "characters/cat_think");
  return {
    layout: "DUAL_CONTRAST",
    backgroundSrc: WHITE,
    entities: [],
    cards: [
      { id: `${b.id}-l`, position: { x: 0.25, y: 0.47 }, background: "#286F7A",
        iconSrc: leftAsset, label: left, width: 660, height: 540, delay: 8 },
      { id: `${b.id}-r`, position: { x: 0.75, y: 0.47 }, background: "#B54848",
        iconSrc: rightAsset, label: right, width: 660, height: 540, delay: 22 },
    ],
    texts: [],
  };
}

// ── STAT_REVEAL ─────────────────────────────────────────────
// One shock number lands big centre; a cat reacts. Beat-emphasis (added by
// compiler) pulses the STAT on the number's word.
function grammarStatReveal(b: SceneBrief, ctx: GrammarContext): GrammarResult {
  const stat = b.slots?.stat ?? b.slots?.number ?? "";
  const caption = b.slots?.caption;
  const dramatic = b.slots?.tone === "dramatic";
  const cat = castSrc(ctx, b.slots?.who, emotionPose(b.emotion));
  const texts: GrammarResult["texts"] = [];
  if (stat) {
    texts.push({
      id: `${b.id}-stat`, content: stat, style: "STAT",
      position: { x: 0.53, y: 0.45 }, fontSize: 210, delay: 10,
      color: dramatic ? "#F04444" : "#B3262E", hold: "scene-end",
    });
  }
  return {
    layout: "STAT_DRAMA",
    // White is the production default. Dark is an authored climax treatment,
    // not an automatic property of every number in the transcript.
    backgroundSrc: dramatic
      ? "linear-gradient(160deg, #0d0d1a 0%, #1a0a0a 100%)"
      : WHITE,
    entities: [
      { assetId: `${b.id}-cat`, src: cat.src, badge: cat.badge, slot: "RIGHT_BOTTOM", scale: 1.45, enterAnimation: "popIn", enterDelay: 22 },
    ],
    cards: [{
      // Caption and icon are one semantic component on the left; the large
      // number owns the centre. This prevents the old icon-under-text collision
      // while keeping one authored text overlay plus the subtitle.
      id: `${b.id}-measure`,
      position: { x: 0.20, y: 0.43 },
      background: dramatic ? "#351A2B" : "#547A80",
      iconSrc: b.slots?.anchor,
      label: caption,
      width: 430,
      height: 520,
      delay: 4,
    }],
    texts,
    focusAssetId: `${b.id}-cat`,
    focusTextId: stat ? `${b.id}-stat` : undefined,
  };
}

// ── POLICY_LIST ─────────────────────────────────────────────
// A lineup of numbered actors/items. slots.items = "A|B|C".
function grammarPolicyList(b: SceneBrief, ctx: GrammarContext): GrammarResult {
  const items = (b.slots?.items ?? "").split("|").map((s) => s.trim()).filter(Boolean).slice(0, 4);
  const icons = (b.slots?.icons ?? "").split("|").map((s) => s.trim()).filter(Boolean);
  const slots = ["FAR_LEFT", "LEFT", "RIGHT", "FAR_RIGHT"] as const;
  const xs = items.length === 4 ? [0.14, 0.38, 0.62, 0.86] : [0.2, 0.5, 0.8];
  // Cards used to be 480 tall centered at y:0.47 — only 58% of the content band
  // (the top 76% of frame, above the subtitle strip), leaving a large empty gap
  // above them that measured 62% flat. Taller cards centered in the band itself
  // (y:0.38) leave roughly symmetric 5-6% margins top and bottom instead.
  const cards: SceneConceptCard[] = items.map((label, i) => ({
    id: `${b.id}-i${i}`,
    position: { x: xs[i], y: 0.38 },
    background: ["#286F7A", "#7B5AA6", "#B56B35", "#B54848"][i],
    iconSrc: semanticAsset(ctx, icons[i], `icons[${i}]`, "characters/cat"),
    label: `${i + 1}. ${label}`,
    width: items.length === 4 ? 430 : 540,
    height: 700,
    delay: 8 + i * 12,
  }));
  return { layout: "LINEUP", backgroundSrc: WHITE, entities: [], texts: [], cards };
}

// ── DIALOGUE_QA ─────────────────────────────────────────────
// Two cats trade lines. 180°-rule: A left→right, B right→left.
function grammarDialogueQA(b: SceneBrief, ctx: GrammarContext): GrammarResult {
  const responsePose: Record<Emotion, string> = {
    neutral: "characters/cat_talk",
    surprise: "characters/cat_surprised",
    concern: "characters/cat_sad",
    sad: "characters/cat_shrug",
    hopeful: "characters/cat_talk",
    sarcastic: "characters/cat_explain",
    curious: "characters/cat_talk",
    urgent: "characters/cat_talk",
    happy: "characters/cat_happy",
  };
  const a = castSrc(ctx, b.slots?.asker, emotionPose(b.emotion));
  const c = castSrc(
    ctx,
    b.slots?.answerer,
    responsePose[b.emotion ?? "neutral"],
  );
  const stage = b.slots?.stage;
  const stageAnchors = stage ? (STAGE_ANCHORS[stage] ?? {}) : {};
  const anchorKeys = Object.keys(stageAnchors);
  const anchorA = b.slots?.anchorA ?? anchorKeys[0];
  const anchorB = b.slots?.anchorB ?? anchorKeys[1] ?? anchorKeys[0];
  // The dialogue itself carries this scene. Two content-free backdrop panels used
  // to sit behind the cats purely to occupy frame area; they rendered as bordered
  // empty boxes, and because qualityCheck counted any card as a teaching-text
  // layer they also silenced the teaching-lifetime gate. Occupancy has to come
  // from the spoken lines, so the bubbles are sized to hold them instead.
  const bubbles: SceneSpeechBubble[] = [];
  if (b.slots?.askerText)
    bubbles.push({
      id: `${b.id}-qa`, anchorAssetId: `${b.id}-a`, text: b.slots.askerText,
      direction: "right", delay: 12, duration: 48, fontSize: 46, widthRatio: 0.50,
    });
  if (b.slots?.answererText)
    bubbles.push({
      id: `${b.id}-qb`, anchorAssetId: `${b.id}-b`, text: b.slots.answererText,
      direction: "left", delay: 72, fontSize: 46, widthRatio: 0.50,
    });
  return {
    layout: "DIALOGUE",
    backgroundSrc: stage ?? WHITE,
    entities: [
      {
        assetId: `${b.id}-a`, src: a.src, badge: a.badge,
        ...(stage && anchorA ? { anchor: anchorA } : { slot: "LEFT" as const }),
        enterAnimation: "slideLeft", enterDelay: 8,
      },
      {
        assetId: `${b.id}-b`, src: c.src, badge: c.badge,
        ...(stage && anchorB ? { anchor: anchorB } : { slot: "RIGHT" as const }),
        enterAnimation: "slideRight", enterDelay: 18,
      },
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
  if (b.slots?.prop) {
    entities.push({
      assetId: `${b.id}-prop`,
      src: b.slots.prop,
      position: { x: 0.55, y: 0.58 },
      scale: 1.35,
      enterAnimation: "popIn",
      enterDelay: 24,
      emphasize: { animation: "pulse", delay: 24, duration: 20 },
    });
  }
  if (b.slots?.lineA && entities[0])
    bubbles.push({ id: `${b.id}-la`, anchorAssetId: `${b.id}-a`, text: b.slots.lineA, direction: "right", delay: 14, duration: 70 });
  if (b.slots?.lineB && entities[1])
    bubbles.push({ id: `${b.id}-lb`, anchorAssetId: `${b.id}-b`, text: b.slots.lineB, direction: "left", delay: 90, duration: 60 });

  // Optional keyword/caption pill (lets a staged narrator scene still punch a
  // keyword, like SOLO does) — sits in the top band, clear of the subtitle.
  const caption = b.slots?.caption ?? b.slots?.keyword;
  const texts: SceneText[] = caption
    ? [{ id: `${b.id}-cap`, content: caption, style: "CALLOUT", slot: "CALLOUT_CENTER", delay: 12, hold: "title" }]
    : [];

  return { layout: "TABLEAU", backgroundSrc: stage, entities, texts, speechBubbles: bubbles, focusAssetId: entities[0]?.assetId };
}

// ── EVIDENCE ────────────────────────────────────────────────
// A paper card (quote / data) — the reference's "show, don't tell" device.
function grammarEvidence(b: SceneBrief, ctx: GrammarContext): GrammarResult {
  const body = b.slots?.body ?? b.narration;
  const title = b.slots?.title;
  const choices = (b.slots?.choices ?? "").split("|").map((s) => s.trim()).filter(Boolean);
  const isSurvey = !!title || choices.length > 0;
  // Legacy evidence reserved the left third for a presenter cat. Strict Route
  // A intentionally removes that decorative presenter, so keeping the card at
  // x=.66 left most of the frame empty. Let the authored evidence itself own
  // the stage.
  const evidencePosition = ctx.strict ? { x: 0.5, y: 0.4 } : { x: 0.66, y: 0.4 };
  const evidenceWidth = ctx.strict ? 1450 : 1100;
  return {
    layout: "SOLO",
    backgroundSrc: WHITE,
    entities: ctx.strict ? [] : [
      { assetId: `${b.id}-cat`, src: emotionPose(b.emotion), slot: "LEFT_MID", enterAnimation: "popIn", enterDelay: 8 },
    ],
    texts: [],
    paperCards: [
      { id: `${b.id}-ev`, variant: isSurvey ? "survey" : "evidence", title, body,
        source: b.slots?.source, date: b.slots?.date, highlight: b.slots?.highlight,
        choices: choices.length ? choices : undefined, position: evidencePosition,
        width: evidenceWidth, delay: 2 },
    ],
    focusAssetId: ctx.strict ? undefined : `${b.id}-cat`,
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
  const prop = b.slots?.prop;
  return {
    layout: "SOLO",
    backgroundSrc: WHITE,
    entities: [{ assetId: `${b.id}-cat`, src: cat.src, badge: cat.badge, slot: "LEFT_MID", scale: 1.6, enterAnimation: "popIn", enterDelay: 8 }],
    // A 760×570 card beside one character left ~65% of the content band as bare
    // background, so every SOLO sample measured flat. The keyword IS the scene's
    // teaching point, so it becomes the focal element at the size STAT_REVEAL
    // already proves (1080×650) — the card's border, shadow and large type carry
    // the contours too. Without a keyword there is nothing to enlarge, and the
    // scene stays a bare reaction beat by design.
    cards: kw ? [{
      id: `${b.id}-concept`,
      position: { x: 0.62, y: 0.45 },
      background: "#237A8B",
      iconSrc: prop,
      label: kw,
      width: 1080,
      height: 650,
      delay: 12,
    }] : undefined,
    texts: [],
    focusAssetId: `${b.id}-cat`,
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
    entities: ctx.strict && !b.slots?.who ? [] : [
      { assetId: `${b.id}-cat`, src: b.slots?.who ? castSrc(ctx, b.slots.who, emotionPose(b.emotion)).src : emotionPose(b.emotion), slot: "RIGHT_BOTTOM", scale: 1.4, enterAnimation: "popIn", enterDelay: 14 },
    ],
    texts: [],
    focusAssetId: ctx.strict && !b.slots?.who ? undefined : `${b.id}-cat`,
    frameBoxes: [{ id: `${b.id}-tv`, contentSrc: content, caption, source: b.slots?.source,
      objectFit: b.slots?.objectFit === "cover" ? "cover" : "contain",
      position: { x: 0.42, y: 0.42 }, delay: 8 }],
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
      { assetId: `${b.id}-cat`, src: b.slots?.who ? castSrc(ctx, b.slots.who, emotionPose(b.emotion)).src : emotionPose(b.emotion), slot: "LEFT", scale: 2.8, enterAnimation: "slideLeft", enterDelay: 8 },
      { assetId: `${b.id}-prop`, src: prop, slot: "RIGHT", scale: 2.2, label, enterAnimation: "popIn", enterDelay: 24,
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
  const icons = (b.slots?.icons ?? "").split("|").map((s) => s.trim()).filter(Boolean);
  const n = items.length || 2;
  const xs = n === 3 ? [0.2, 0.5, 0.8] : [0.28, 0.72];
  const entities: SceneEntity[] = [];
  const cards: SceneConceptCard[] = [];
  items.forEach((label, i) => {
    cards.push({ id: `${b.id}-n${i}`, position: { x: xs[i], y: 0.48 },
      background: ["#286F7A", "#7B5AA6", "#B54848"][i],
      iconSrc: semanticAsset(ctx, icons[i], `icons[${i}]`, "characters/cat"),
      label, width: n === 3 ? 450 : 620, height: 470, delay: 8 + i * 16 });
    if (i < items.length - 1) {
      entities.push({ assetId: `${b.id}-a${i}`, src: "ui/arrow_right", position: { x: (xs[i] + xs[i + 1]) / 2, y: 0.5 }, scale: 1.4, zIndex: 15, enterAnimation: "fadeIn", enterDelay: 16 + i * 16 });
    }
  });
  return { layout: "CUSTOM", backgroundSrc: WHITE, entities, texts: [], cards };
}

// ── CAUSE_EFFECT (cause → arrow → effect) ───────────────────
function grammarCauseEffect(b: SceneBrief, ctx: GrammarContext): GrammarResult {
  const cause = b.slots?.cause ?? "Cause";
  const effect = b.slots?.effect ?? "Effect";
  const causeIcon = b.slots?.causeIcon;
  const effectIcon = b.slots?.effectIcon;
  const resolvedCauseIcon = semanticAsset(ctx, causeIcon, "causeIcon", "characters/cat_think");
  const resolvedEffectIcon = semanticAsset(ctx, effectIcon, "effectIcon", "characters/cat_surprised");
  const entities: SceneEntity[] = [
    { assetId: `${b.id}-arrow`, src: "ui/arrow_right", position: { x: 0.5, y: 0.48 }, scale: 1.8, enterAnimation: "fadeIn", enterDelay: 28 },
  ];
  return {
    layout: "CAUSE_EFFECT", backgroundSrc: WHITE, entities,
    cards: [
      { id: `${b.id}-cause`, position: { x: 0.24, y: 0.47 }, background: "#286F7A",
        iconSrc: resolvedCauseIcon, label: cause, width: 650, height: 540, delay: 8 },
      { id: `${b.id}-effect`, position: { x: 0.76, y: 0.47 }, background: "#B54848",
        iconSrc: resolvedEffectIcon, label: effect, width: 650, height: 540, delay: 38 },
    ],
    texts: [],
    focusAssetId: `${b.id}-arrow`,
  };
}

// ── QA_REVEAL (question → answer later) ─────────────────────
function grammarQaReveal(b: SceneBrief, ctx: GrammarContext): GrammarResult {
  const q = b.slots?.question ?? b.slots?.q ?? "";
  const a = b.slots?.answer ?? b.slots?.a ?? "";
  const cat = castSrc(ctx, b.slots?.who, emotionPose(b.emotion));
  return {
    layout: "QA_REVEAL",
    backgroundSrc: WHITE,
    entities: [
      { assetId: `${b.id}-cat`, src: cat.src, badge: cat.badge, slot: "RIGHT_BOTTOM", scale: 1.45, enterAnimation: "popIn", enterDelay: 8,
        emphasize: { animation: "bounce", delay: 60, duration: 20 } },
    ],
    cards: [
      ...(q ? [{ id: `${b.id}-q`, position: { x: 0.43, y: 0.46 }, background: "#286F7A",
        label: q, width: 1050, height: 580, delay: 10, duration: 70 }] : []),
      ...(a ? [{ id: `${b.id}-a`, position: { x: 0.43, y: 0.46 }, background: "#B54848",
        iconSrc: b.slots?.answerAsset, label: a, width: 1050, height: 580, delay: 80 }] : []),
    ],
    texts: [],
    focusAssetId: `${b.id}-cat`,
    focusTextId: a ? `${b.id}-a` : undefined,
  };
}

// ── ICON_TRIPLE (3 concepts in colored circles) ─────────────
function grammarIconTriple(b: SceneBrief, ctx: GrammarContext): GrammarResult {
  const items = (b.slots?.items ?? "").split("|").map((s) => s.trim()).filter(Boolean).slice(0, 3);
  const icons = (b.slots?.icons ?? "").split("|").map((s) => s.trim()).filter(Boolean);
  const circles = ["#7B5AA6", "#286F7A", "#B56B35"];
  const xs = [0.2, 0.5, 0.8];
  const cards: SceneConceptCard[] = [];
  items.forEach((label, i) => {
    cards.push({ id: `${b.id}-i${i}`, position: { x: xs[i], y: 0.47 }, background: circles[i],
      iconSrc: semanticAsset(ctx, icons[i], `icons[${i}]`, "props/concept_card"),
      label, width: 500, height: 500, delay: 8 + i * 14 });
  });
  return { layout: "ICON_TRIPLE", backgroundSrc: WHITE, entities: [], texts: [], cards };
}

function grammarMapFlow(b: SceneBrief, ctx: GrammarContext): GrammarResult {
  const map = semanticAsset(ctx, b.slots?.map, "map", "");
  const base = grammarDiagram(b, ctx);
  return {
    ...base,
    layout: "CUSTOM",
    backgroundSrc: map,
    entities: base.entities.map((entity) => ({ ...entity, scale: (entity.scale ?? 1) * 0.9 })),
  };
}

function grammarDataChart(b: SceneBrief, ctx: GrammarContext): GrammarResult {
  const chart = semanticAsset(ctx, b.slots?.chart, "chart", "");
  return {
    layout: "SOLO",
    backgroundSrc: WHITE,
    entities: [],
    texts: [],
    frameBoxes: [{
      id: `${b.id}-chart`,
      contentSrc: chart,
      caption: b.slots?.caption,
      source: b.slots?.source,
      position: { x: 0.5, y: 0.42 },
      width: 1350,
      objectFit: "contain",
      delay: 6,
    }],
  };
}

function grammarSurveyCard(b: SceneBrief, ctx: GrammarContext): GrammarResult {
  return grammarEvidence({ ...b, slots: { ...(b.slots ?? {}), title: b.slots?.title ?? "Survey" } }, ctx);
}

function grammarPhotoEvidence(b: SceneBrief, ctx: GrammarContext): GrammarResult {
  const photo = semanticAsset(ctx, b.slots?.photo, "photo", "");
  return {
    layout: "CLOSE_UP",
    backgroundSrc: photo,
    entities: [],
    texts: [],
    frameBoxes: b.slots?.caption ? [{
      id: `${b.id}-photo`,
      contentSrc: photo,
      caption: b.slots.caption,
      source: b.slots?.source,
      position: { x: 0.5, y: 0.42 },
      width: 1450,
      objectFit: "cover",
      delay: 6,
    }] : undefined,
  };
}

function grammarScreenCapture(b: SceneBrief, ctx: GrammarContext): GrammarResult {
  return grammarFrameBox({ ...b, slots: { ...(b.slots ?? {}), who: undefined } }, { ...ctx, strict: true });
}

function grammarFullSceneAction(b: SceneBrief, ctx: GrammarContext): GrammarResult {
  return grammarTableau(b, ctx);
}

function grammarHistoryTimeline(b: SceneBrief, ctx: GrammarContext): GrammarResult {
  const result = grammarDiagram(b, ctx);
  const dates = (b.slots?.dates ?? "").split("|").map((value) => value.trim()).filter(Boolean);
  result.texts.push(...dates.slice(0, 3).map((date, index) => ({
    id: `${b.id}-date-${index}`,
    content: date,
    style: "CALLOUT" as const,
    position: { x: [0.2, 0.5, 0.8][index], y: 0.22 },
    delay: 8 + index * 16,
    duration: 120,
  })));
  return result;
}

function grammarVisualMetaphor(b: SceneBrief, ctx: GrammarContext): GrammarResult {
  return grammarCompare({
    ...b,
    slots: {
      ...(b.slots ?? {}),
      left: b.slots?.setup ?? "",
      right: b.slots?.payoff ?? "",
    },
  }, ctx);
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
  MAP_FLOW: grammarMapFlow,
  DATA_CHART: grammarDataChart,
  SURVEY_CARD: grammarSurveyCard,
  PHOTO_EVIDENCE: grammarPhotoEvidence,
  SCREEN_CAPTURE: grammarScreenCapture,
  FULL_SCENE_ACTION: grammarFullSceneAction,
  HISTORY_TIMELINE: grammarHistoryTimeline,
  VISUAL_METAPHOR: grammarVisualMetaphor,
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
