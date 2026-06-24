import {
  SceneTimeline,
  Scene,
  SceneEntity,
  SceneText,
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

  // ── 1. Transition ─────────────────────────────────────────
  if (scene.transition) {
    events.push({
      frame: start,
      type: "transition",
      style: scene.transition.style,
      duration: scene.transition.duration ?? 15,
    } as TransitionEvent);
  }

  // ── 2. Clear previous assets ─────────────────────────────
  if (scene.clearPrevious) {
    const clearFrame = start + (scene.transition ? (scene.transition.duration ?? 15) : 0);
    if (scene.clearPrevious === true) {
      events.push({ frame: clearFrame, type: "clear", assetIds: [] } as ClearEvent);
    } else if (Array.isArray(scene.clearPrevious) && scene.clearPrevious.length > 0) {
      events.push({ frame: clearFrame, type: "clear", assetIds: scene.clearPrevious } as ClearEvent);
    }
  }

  // ── 2b. Background event from scene.backgroundSrc ────────
  if (scene.backgroundSrc) {
    events.push({
      frame: start,
      type: "background",
      src: scene.backgroundSrc,
      duration: 25,
    } as BackgroundEvent);
  }

  // ── 3. Entities ───────────────────────────────────────────
  for (let i = 0; i < scene.entities.length; i++) {
    const entity = scene.entities[i];
    compileEntity(entity, scene, i, start, sceneEnd, events);
  }

  // ── 4. Texts ──────────────────────────────────────────────
  for (const text of scene.texts) {
    compileText(text, scene, start, sceneEnd, events, totalFrames);
  }

  // ── 5. Camera ─────────────────────────────────────────────
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
  events: TimelineEvent[]
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

  const enterFrame = sceneStart + (entity.enterDelay ?? 0);

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
  totalFrames: number
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

  const textFrame = sceneStart + (text.delay ?? 0);

  // Compute exitFrame
  let exitFrame: number | undefined;
  if (text.duration !== undefined) {
    exitFrame = Math.min(textFrame + text.duration, totalFrames - 1);
  } else {
    // Default: text lasts until end of scene
    exitFrame = Math.min(sceneEnd - 5, totalFrames - 1);
  }

  // Auto-adjust text color on dark backgrounds
  const isDarkBg = scene.backgroundSrc ? isDarkBackground(scene.backgroundSrc) : false;
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

// Default scale per layout — ensures characters fill the screen appropriately
function defaultScaleForLayout(layout: LayoutPreset, entityIndex: number): number {
  switch (layout) {
    case "SOLO":
    case "INTRO":
    case "CLOSE_UP":
      return 1.9;
    case "DIALOGUE":
    case "DUAL_CONTRAST":
    case "COMPARE":
      return 1.65;
    case "SIZE_HIERARCHY":
      return entityIndex === 0 ? 2.0 : 1.0; // big entity first, small second
    case "CHAR_PROP":
    case "CAUSE_EFFECT":
      return entityIndex === 0 ? 1.7 : 1.4; // character slightly bigger than prop
    case "ICON_TRIPLE":
    case "ACCUMULATION":
      return 1.0;
    case "LINEUP":
      return 0.95;
    case "STAT_DRAMA":
    case "STAT":
    case "CONCLUSION":
    case "CTA":
      return 1.6;
    case "QA_REVEAL":
    case "SINGLE":
      return 1.8;
    default:
      return 1.2;
  }
}

// Detect if a backgroundSrc is dark (needs light text)
function isDarkBackground(src: string): boolean {
  if (!src) return false;
  // Dark named colors and specific dark values
  if (src === "#000" || src === "#000000" || src === "#1a1a1a") return true;
  // Dark gradients: look for dark start colors
  const darkGradientPatterns = [
    "#0d0d", "#1a0a", "#1a1a", "#0A0E", "#2C18", "#1A23",
    "0d0d1a", "1a0a0a", "1a1a2e", "0A0E27", "2C1810", "1A237E", "16213e",
    "0a0e27", "2c1810", "1a237e",
  ];
  return darkGradientPatterns.some(p => src.toLowerCase().includes(p.toLowerCase()));
}
