import {
  SceneTimeline,
  Scene,
  SceneEntity,
  SceneText,
  ScenePaperCard,
  SceneFrameBox,
  LayoutPreset,
  SLOT_POSITIONS,
  TEXT_SLOT_POSITIONS,
  LAYOUT_ENTITY_SLOTS,
} from "../types/scene";
import {
  Timeline,
  TimelineEvent,
  EnterEvent,
  ExitEvent,
  EmphasizeEvent,
  CameraEvent,
  TextEvent,
  ClearEvent,
  TransitionEvent,
  BackgroundEvent,
  PaperCardEvent,
  FrameBoxEvent,
} from "../types/timeline";

// ============================================================
// SceneCompiler — translates SceneTimeline → Timeline (events)
// ============================================================

export function compileScenes(input: SceneTimeline): Timeline {
  const events: TimelineEvent[] = [];

  for (const scene of input.scenes) {
    compileScene(scene, events, input.durationInFrames);
  }

  // Sort all events by frame
  events.sort((a, b) => a.frame - b.frame);

  return {
    fps: input.fps,
    width: input.width,
    height: input.height,
    durationInFrames: input.durationInFrames,
    audio: input.audio,
    background: input.background ?? "#FAFAF8",
    events,
  };
}

function compileScene(
  scene: Scene,
  events: TimelineEvent[],
  totalFrames: number
): void {
  const start = scene.startFrame;
  const sceneEnd = start + scene.durationFrames;

  // Transition duration — used to offset clear + entity enter
  const transitionDur = scene.transition ? (scene.transition.duration ?? 15) : 0;

  // ── 1. Transition ─────────────────────────────────────────
  // Only emit flash/fadeBlack/fadeWhite — wipe is skipped because BackgroundEvent
  // already provides a crossfade that is visually equivalent and less jarring.
  // STAT_DRAMA scenes with flash/fadeBlack are the primary use case.
  const shouldEmitTransition =
    scene.transition &&
    scene.transition.style !== "wipe";

  if (shouldEmitTransition) {
    events.push({
      frame: start,
      type: "transition",
      style: scene.transition!.style,
      duration: transitionDur,
    } as TransitionEvent);
  }

  // ── 2. Background first (crossfade handles the visual transition) ──
  if (scene.backgroundSrc) {
    // Photo backgrounds (not a hex/gradient) get a gentle default blur + scrim so the
    // flat 2D characters pop and overlay text stays legible — matches the reference video.
    const isPhoto =
      !scene.backgroundSrc.startsWith("#") &&
      !scene.backgroundSrc.startsWith("rgb") &&
      !scene.backgroundSrc.startsWith("linear-gradient") &&
      !scene.backgroundSrc.startsWith("radial-gradient");
    events.push({
      frame: start,
      type: "background",
      src: scene.backgroundSrc,
      blur: scene.backgroundBlur ?? (isPhoto ? 10 : 0),
      overlay: scene.backgroundOverlay ?? (isPhoto ? "rgba(0,0,0,0.28)" : undefined),
      duration: 25,
    } as BackgroundEvent);
  }

  // ── 3. Clear AFTER transition completes ──────────────────
  // clearPrevious is an EXPLICIT signal from the AI — always honor it.
  //   true      → wipe the whole canvas for a clean slate (new scene context)
  //   string[]  → clear only the named assets (within-scene phase change)
  // Hold-state (assets persist across scenes) is the DEFAULT when clearPrevious
  // is omitted/false, so scenes that want continuity simply don't set it.
  if (scene.clearPrevious) {
    const clearFrame = start + transitionDur;
    if (scene.clearPrevious === true) {
      events.push({ frame: clearFrame, type: "clear", assetIds: [] } as ClearEvent);
    } else if (Array.isArray(scene.clearPrevious) && scene.clearPrevious.length > 0) {
      events.push({ frame: clearFrame, type: "clear", assetIds: scene.clearPrevious } as ClearEvent);
    }
  }

  // ── 4. Entities enter AFTER transition + small buffer ────
  // enterDelay is relative to scene start — add transition offset so
  // entities don't pop in while transition is still playing
  for (let i = 0; i < scene.entities.length; i++) {
    const entity = scene.entities[i];
    compileEntity(entity, scene, i, start, sceneEnd, events, transitionDur);
  }

  // ── 5. Texts ──────────────────────────────────────────────
  for (const text of scene.texts) {
    compileText(text, scene, start, sceneEnd, events, totalFrames, transitionDur);
  }

  // ── 5a. Auto subtitles from narration (the reference channel's signature) ──
  // Burned-in narration caption at the very bottom, chunked into short lines and
  // timed evenly across the scene. Disabled per-scene with subtitle:false.
  if (scene.narration && (scene as any).subtitle !== false) {
    compileSubtitles(scene, start, sceneEnd, events, totalFrames, transitionDur);
  }

  // ── 5b. Paper cards (evidence / survey) ──────────────────
  if (scene.paperCards) {
    for (const pc of scene.paperCards) {
      compilePaperCard(pc, start, sceneEnd, events, totalFrames, transitionDur);
    }
  }

  // ── 5c. TV/monitor data frames ───────────────────────────
  if (scene.frameBoxes) {
    for (const fb of scene.frameBoxes) {
      compileFrameBox(fb, start, sceneEnd, events, totalFrames, transitionDur);
    }
  }

  // ── 6. Camera ─────────────────────────────────────────────
  if (scene.camera) {
    compileCamera(scene.camera, scene, start, events);
  }
}

function compileEntity(
  entity: SceneEntity,
  scene: Scene,
  entityIndex: number,
  sceneStart: number,
  sceneEnd: number,
  events: TimelineEvent[],
  transitionDur: number = 0
): void {
  // Resolve position
  let position: { x: number; y: number };
  if (entity.position) {
    position = entity.position;
  } else if (entity.slot) {
    position = SLOT_POSITIONS[entity.slot];
  } else {
    // Auto-assign slot from layout
    const layoutSlots = LAYOUT_ENTITY_SLOTS[scene.layout];
    const slot = layoutSlots[entityIndex] ?? "CENTER";
    position = SLOT_POSITIONS[slot];
  }

  // Enter after transition finishes so entities don't pop in mid-wipe
  const enterFrame = sceneStart + transitionDur + (entity.enterDelay ?? 0);

  // Entity-level clearPrevious (phase transition within a scene)
  if (entity.clearPrevious && entity.clearPrevious.length > 0) {
    events.push({ frame: enterFrame, type: "clear", assetIds: entity.clearPrevious } as ClearEvent);
  }

  // Enter event
  events.push({
    frame: enterFrame,
    type: "enter",
    assetId: entity.assetId,
    src: entity.src,
    position,
    scale: entity.scale ?? defaultScaleForLayout(scene.layout, entityIndex),
    animation: entity.enterAnimation ?? defaultEnterAnimation(entity.role),
    animationDuration: entity.animationDuration ?? 20,
    label: entity.label,
    badge: entity.badge,
    circle: entity.circle,
    zIndex: entity.zIndex ?? (entity.role === "host" ? 1 : 2),
  } as EnterEvent);

  // Emphasize event
  if (entity.emphasize) {
    const emphDelay = (entity.emphasize.delay ?? 30);
    events.push({
      frame: enterFrame + emphDelay,
      type: "emphasize",
      assetId: entity.assetId,
      animation: entity.emphasize.animation,
      duration: entity.emphasize.duration ?? 25,
      value: entity.emphasize.value,
    } as EmphasizeEvent);
  }

  // Exit event (if explicitly requested)
  if (entity.exitFrame !== undefined) {
    events.push({
      frame: entity.exitFrame,
      type: "exit",
      assetId: entity.assetId,
      animation: entity.exitAnimation ?? "fadeOut",
      animationDuration: 15,
    } as ExitEvent);
  }
}

function compileText(
  text: SceneText,
  scene: Scene,
  sceneStart: number,
  sceneEnd: number,
  events: TimelineEvent[],
  totalFrames: number,
  transitionDur: number = 0
): void {
  // Resolve position
  let position: { x: number; y: number };
  if (text.position) {
    position = text.position;
  } else if (text.slot) {
    position = TEXT_SLOT_POSITIONS[text.slot];
  } else {
    position = defaultTextPosition(text.style);
  }

  const textFrame = sceneStart + transitionDur + (text.delay ?? 0);

  // Compute exitFrame
  let exitFrame: number | undefined;
  if (text.duration !== undefined) {
    exitFrame = Math.min(textFrame + text.duration, totalFrames - 1);
  } else {
    // Default: text lasts until end of scene
    exitFrame = Math.min(sceneEnd - 5, totalFrames - 1);
  }

  // Auto-adjust text color on dark backgrounds.
  // Photo backgrounds get a dark scrim by default → treat as dark (light text).
  const bgIsPhoto = scene.backgroundSrc
    ? !scene.backgroundSrc.startsWith("#") &&
      !scene.backgroundSrc.startsWith("rgb") &&
      !scene.backgroundSrc.startsWith("linear-gradient") &&
      !scene.backgroundSrc.startsWith("radial-gradient")
    : false;
  const isDarkBg = scene.backgroundSrc
    ? isDarkBackground(scene.backgroundSrc) || bgIsPhoto
    : false;
  const autoColor = isDarkBg && text.style !== "STAT"
    ? (text.style === "BODY" ? "#E0E0E0" : text.style === "CAPTION" ? "#B0BEC5" : "#FFFFFF")
    : undefined;

  events.push({
    frame: textFrame,
    type: "text",
    textId: text.id,
    content: text.content,
    position,
    style: text.style,
    color: autoColor,
    background: text.background,
    align: text.align ?? "center",
    fontWeight: text.fontWeight,
    animation: "fadeIn",
    exitFrame,
  } as TextEvent);
}

// Split narration into subtitle chunks of ~7-9 words, respecting sentence
// boundaries where possible, then time them evenly across the scene.
function chunkNarration(narration: string, maxWords = 9): string[] {
  const clean = narration.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  // Prefer splitting on sentence/clause punctuation first
  const clauses = clean.split(/(?<=[.!?…])\s+|(?<=[,;:])\s+/);
  const chunks: string[] = [];
  let buf: string[] = [];
  for (const clause of clauses) {
    const words = clause.split(" ");
    for (const w of words) {
      buf.push(w);
      if (buf.length >= maxWords) {
        chunks.push(buf.join(" "));
        buf = [];
      }
    }
    // flush at clause boundary if we have a reasonable amount
    if (buf.length >= Math.ceil(maxWords * 0.6)) {
      chunks.push(buf.join(" "));
      buf = [];
    }
  }
  if (buf.length) chunks.push(buf.join(" "));
  return chunks;
}

function compileSubtitles(
  scene: Scene,
  sceneStart: number,
  sceneEnd: number,
  events: TimelineEvent[],
  totalFrames: number,
  transitionDur: number
): void {
  const chunks = chunkNarration(scene.narration!);
  if (chunks.length === 0) return;

  const spanStart = sceneStart + transitionDur;
  const spanFrames = Math.max(1, sceneEnd - spanStart);
  const per = spanFrames / chunks.length;

  for (let i = 0; i < chunks.length; i++) {
    const frame = Math.round(spanStart + i * per);
    const exitFrame = Math.min(Math.round(spanStart + (i + 1) * per), totalFrames - 1);
    events.push({
      frame,
      type: "text",
      textId: `${scene.id}__sub_${i}`,
      content: chunks[i],
      position: { x: 0.5, y: 0.9 },
      style: "SUBTITLE",
      align: "center",
      animation: "fadeIn",
      exitFrame,
    } as TextEvent);
  }
}

function compilePaperCard(
  pc: ScenePaperCard,
  sceneStart: number,
  sceneEnd: number,
  events: TimelineEvent[],
  totalFrames: number,
  transitionDur: number
): void {
  const frame = sceneStart + transitionDur + (pc.delay ?? 0);
  const exitFrame =
    pc.duration !== undefined
      ? Math.min(frame + pc.duration, totalFrames - 1)
      : Math.min(sceneEnd - 5, totalFrames - 1);

  events.push({
    frame,
    type: "paperCard",
    cardId: pc.id,
    variant: pc.variant,
    position: pc.position ?? { x: 0.5, y: 0.42 },
    scale: pc.scale,
    title: pc.title,
    body: pc.body,
    choices: pc.choices,
    rotation: pc.rotation,
    animation: "popIn",
    exitFrame,
    width: pc.width,
  } as PaperCardEvent);
}

function compileFrameBox(
  fb: SceneFrameBox,
  sceneStart: number,
  sceneEnd: number,
  events: TimelineEvent[],
  totalFrames: number,
  transitionDur: number
): void {
  const frame = sceneStart + transitionDur + (fb.delay ?? 0);
  const exitFrame =
    fb.duration !== undefined
      ? Math.min(frame + fb.duration, totalFrames - 1)
      : Math.min(sceneEnd - 5, totalFrames - 1);

  events.push({
    frame,
    type: "frameBox",
    frameId: fb.id,
    position: fb.position ?? { x: 0.5, y: 0.42 },
    scale: fb.scale,
    contentSrc: fb.contentSrc,
    caption: fb.caption,
    animation: "popIn",
    exitFrame,
    width: fb.width,
  } as FrameBoxEvent);
}

function compileCamera(
  camera: { action: string; target?: string; zoom?: number; delay?: number; duration?: number },
  scene: Scene,
  sceneStart: number,
  events: TimelineEvent[]
): void {
  const camFrame = sceneStart + (camera.delay ?? 40);
  const duration = camera.duration ?? 30;

  switch (camera.action) {
    case "ZOOM_IN": {
      const zoom = camera.zoom ?? 1.25;
      // Find target entity position for center
      const targetEntity = camera.target
        ? scene.entities.find((e) => e.assetId === camera.target)
        : scene.entities[0];
      const pos = resolveEntityPosition(targetEntity, scene, 0);
      events.push({
        frame: camFrame,
        type: "camera",
        zoom,
        centerX: pos?.x ?? 0.5,
        centerY: pos?.y ?? 0.4,
        duration,
      } as CameraEvent);
      break;
    }

    case "ZOOM_OUT": {
      events.push({
        frame: camFrame,
        type: "camera",
        zoom: camera.zoom ?? 0.9,
        centerX: 0.5,
        centerY: 0.5,
        duration,
      } as CameraEvent);
      break;
    }

    case "FOCUS_ON": {
      const targetEntity = camera.target
        ? scene.entities.find((e) => e.assetId === camera.target)
        : scene.entities[0];
      const pos = resolveEntityPosition(targetEntity, scene, 0);
      events.push({
        frame: camFrame,
        type: "camera",
        zoom: camera.zoom ?? 1.3,
        centerX: pos?.x ?? 0.5,
        centerY: pos?.y ?? 0.35,
        duration,
      } as CameraEvent);
      break;
    }

    case "RESET": {
      events.push({
        frame: camFrame,
        type: "camera",
        zoom: 1.0,
        centerX: 0.5,
        centerY: 0.5,
        duration,
      } as CameraEvent);
      break;
    }

    case "PAN_LR": {
      // Pan left first then right
      events.push({
        frame: camFrame,
        type: "camera",
        zoom: camera.zoom ?? 1.15,
        centerX: 0.25,
        centerY: 0.4,
        duration,
      } as CameraEvent);
      events.push({
        frame: camFrame + duration + 30,
        type: "camera",
        zoom: camera.zoom ?? 1.15,
        centerX: 0.75,
        centerY: 0.4,
        duration,
      } as CameraEvent);
      break;
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────

function defaultEnterAnimation(
  role?: SceneEntity["role"]
): string {
  switch (role) {
    case "host": return "popIn";
    case "hero": return "popIn";
    case "cause": return "slideLeft";
    case "effect": return "slideRight";
    default: return "popIn";
  }
}

function defaultTextPosition(style: string): { x: number; y: number } {
  switch (style) {
    case "TITLE": return TEXT_SLOT_POSITIONS.TOP_TITLE;
    case "SECTION": return TEXT_SLOT_POSITIONS.SECTION_HEADER;
    case "CALLOUT": return TEXT_SLOT_POSITIONS.CALLOUT_CENTER;
    case "STAT": return TEXT_SLOT_POSITIONS.STAT_CENTER;
    case "BODY": return TEXT_SLOT_POSITIONS.BODY;
    case "CAPTION": return TEXT_SLOT_POSITIONS.CAPTION;
    default: return TEXT_SLOT_POSITIONS.BODY;
  }
}

function resolveEntityPosition(
  entity: SceneEntity | undefined,
  scene: Scene,
  index: number
): { x: number; y: number } | undefined {
  if (!entity) return undefined;
  if (entity.position) return entity.position;
  if (entity.slot) return SLOT_POSITIONS[entity.slot];
  const layoutSlots = LAYOUT_ENTITY_SLOTS[scene.layout];
  const slot = layoutSlots[index];
  return slot ? SLOT_POSITIONS[slot] : undefined;
}

// Default scale per layout — ensures characters FILL the screen like the reference
// video (cats are ~40-50% of frame height, not tiny icons floating in whitespace).
function defaultScaleForLayout(layout: LayoutPreset, entityIndex: number): number {
  switch (layout) {
    case "SOLO":
    case "INTRO":
    case "CLOSE_UP":
      return 3.0;
    case "DIALOGUE":
    case "DUAL_CONTRAST":
    case "COMPARE":
      return 2.3;
    case "SIZE_HIERARCHY":
      return entityIndex === 0 ? 3.2 : 1.6; // big entity first, small second
    case "CHAR_PROP":
    case "CAUSE_EFFECT":
      return entityIndex === 0 ? 2.6 : 2.0; // character slightly bigger than prop
    case "ICON_TRIPLE":
    case "ACCUMULATION":
      return 1.4;
    case "LINEUP":
      return 1.5;
    case "STAT_DRAMA":
    case "STAT":
    case "CONCLUSION":
    case "CTA":
      return 2.4;
    case "QA_REVEAL":
    case "SINGLE":
      return 2.8;
    default:
      return 1.8;
  }
}

// Parse a hex color (#rgb or #rrggbb) → relative luminance 0..1, or null.
function hexLuminance(hex: string): number | null {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return null;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  // Perceived luminance (Rec. 709)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Detect if a backgroundSrc is dark (needs light text).
// Works for any hex or gradient by averaging the luminance of ALL hex stops —
// no fragile hardcoded value list (which previously missed e.g. #0f172a).
function isDarkBackground(src: string): boolean {
  if (!src) return false;
  const hexes = src.match(/#[0-9a-fA-F]{3,6}\b/g);
  if (!hexes || hexes.length === 0) return false;
  const lums = hexes.map(hexLuminance).filter((l): l is number => l !== null);
  if (lums.length === 0) return false;
  const avg = lums.reduce((a, b) => a + b, 0) / lums.length;
  return avg < 0.5; // below mid-luminance → treat as dark, use light text
}
