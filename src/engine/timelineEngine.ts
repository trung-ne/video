import {
  Timeline,
  TimelineEvent,
  AssetState,
  EnterEvent,
  ExitEvent,
  MoveEvent,
  EmphasizeEvent,
  CameraEvent,
  TextEvent,
  ClearEvent,
  TextStyle,
  BackgroundEvent,
  SpeechBubbleEvent,
  CardEvent,
  PaperCardEvent,
  FrameBoxEvent,
  TransitionEvent,
} from "../types/timeline";
import { interpolate, spring } from "remotion";

export interface BackgroundState {
  src: string;
  blur: number;
  opacity: number;
  overlay?: string;
  enterFrame: number;
  duration: number;
}

export interface SpeechBubbleState {
  bubbleId: string;
  anchorAssetId: string;
  text: string;
  style: "speech" | "thought" | "shout";
  direction: "left" | "right" | "top";
  exitFrame: number | null;
  enterFrame: number;
  fontSize: number;
  background: string;
  textColor: string;
}

export interface CardState {
  cardId: string;
  position: { x: number; y: number };
  scale: number;
  background: string;
  iconSrc?: string;
  label?: string;
  animation: string;
  enterFrame: number;
  exitFrame: number | null;
  width: number;
  height: number;
}

export interface PaperCardState {
  cardId: string;
  variant: "evidence" | "survey";
  position: { x: number; y: number };
  scale: number;
  title?: string;
  body: string;
  choices?: string[];
  rotation: number;
  animation: string;
  enterFrame: number;
  exitFrame: number | null;
  width: number;
}

export interface FrameBoxState {
  frameId: string;
  position: { x: number; y: number };
  scale: number;
  contentSrc: string;
  caption?: string;
  animation: string;
  enterFrame: number;
  exitFrame: number | null;
  width: number;
}

export interface TransitionState {
  style: string;
  startFrame: number;
  duration: number;
}

export interface TextState {
  textId: string;
  content: string;
  position: { x: number; y: number };
  fontSize: number;
  color: string;
  style?: TextStyle;
  background?: string;
  align?: "left" | "center" | "right";
  fontWeight?: number;
  enterFrame: number;
  exitFrame: number | null;
  animation: string;
}

export interface CameraState {
  zoom: number;
  centerX: number;
  centerY: number;
}

export interface ActiveEmphasize {
  assetId: string;
  animation: string;
  startFrame: number;
  duration: number;
}

export interface FrameState {
  assets: Map<string, AssetState>;
  assetEnterFrames: Map<string, number>;
  assetExitFrames: Map<string, { frame: number; animation: string; duration: number }>;
  texts: Map<string, TextState>;
  camera: CameraState;
  emphasizes: ActiveEmphasize[];
  backgrounds: BackgroundState[];
  speechBubbles: Map<string, SpeechBubbleState>;
  cards: Map<string, CardState>;
  paperCards: Map<string, PaperCardState>;
  frameBoxes: Map<string, FrameBoxState>;
  activeTransition: TransitionState | null;
}

// Compute canvas state at a given frame from the timeline
export function computeFrameState(timeline: Timeline, currentFrame: number): FrameState {
  const state: FrameState = {
    assets: new Map(),
    assetEnterFrames: new Map(),
    assetExitFrames: new Map(),
    texts: new Map(),
    camera: { zoom: 1, centerX: 0.5, centerY: 0.5 },
    emphasizes: [],
    backgrounds: [],
    speechBubbles: new Map(),
    cards: new Map(),
    paperCards: new Map(),
    frameBoxes: new Map(),
    activeTransition: null,
  };

  // Process all events up to and including current frame (for state)
  // But we need to know future exits too, so process all events
  const sortedEvents = [...timeline.events].sort((a, b) => a.frame - b.frame);

  // First pass: collect all enter/exit frames
  for (const event of sortedEvents) {
    if (event.type === "enter") {
      const e = event as EnterEvent;
      if (e.frame <= currentFrame) {
        const existing = state.assets.get(e.assetId);
        state.assets.set(e.assetId, {
          assetId: e.assetId,
          src: e.src,
          position: e.position,
          scale: e.scale ?? 1,
          opacity: 1,
          zIndex: e.zIndex ?? 1,
          label: e.label,
          badge: e.badge,
          circle: e.circle,
          visible: true,
        });
        state.assetEnterFrames.set(e.assetId, e.frame);
      }
    }

    if (event.type === "exit") {
      const e = event as ExitEvent;
      const duration = e.animationDuration ?? 18;
      state.assetExitFrames.set(e.assetId, {
        frame: e.frame,
        animation: e.animation ?? "fadeOut",
        duration,
      });
      // Remove from canvas after exit animation completes
      if (currentFrame >= e.frame + duration) {
        state.assets.delete(e.assetId);
        state.assetEnterFrames.delete(e.assetId);
      }
    }

    if (event.type === "move" && event.frame <= currentFrame) {
      const e = event as MoveEvent;
      const asset = state.assets.get(e.assetId);
      if (asset) {
        const moveProgress = Math.min(1, (currentFrame - e.frame) / e.duration);
        const eased = easeInOut(moveProgress);
        // We need previous position - store it before move
        asset.position = {
          x: interpolate(eased, [0, 1], [asset.position.x, e.position.x]),
          y: interpolate(eased, [0, 1], [asset.position.y, e.position.y]),
        };
        if (e.scale !== undefined) {
          asset.scale = interpolate(eased, [0, 1], [asset.scale, e.scale]);
        }
      }
    }

    if (event.type === "swap" && event.frame <= currentFrame) {
      const e = event as any;
      const asset = state.assets.get(e.assetId);
      if (asset) asset.src = e.src; // pose/costume change in place
    }

    if (event.type === "text") {
      const e = event as TextEvent;
      if (e.frame <= currentFrame) {
        state.texts.set(e.textId, {
          textId: e.textId,
          content: e.content,
          position: e.position,
          fontSize: e.fontSize ?? 48,
          // Per-style default when the compiler didn't set an explicit color.
          // A blanket #1a1a1a here silently overrode the component's own style
          // defaults: SUBTITLE was invisible on its dark band, and STAT (meant
          // to be a bright #FF3B3B number) rendered dark-gray on STAT_DRAMA's
          // near-black background. Give those two their intended bright colors.
          color: e.color ?? (e.style === "SUBTITLE" ? "#FFFFFF" : e.style === "STAT" ? "#FF3B3B" : "#1a1a1a"),
          style: e.style,
          background: e.background,
          align: e.align,
          fontWeight: e.fontWeight,
          enterFrame: e.frame,
          exitFrame: e.exitFrame ?? null,
          animation: e.animation ?? "fadeIn",
        });
        if (e.exitFrame !== null && currentFrame >= (e.exitFrame ?? 0)) {
          state.texts.delete(e.textId);
        }
      }
    }

    if (event.type === "clear" && event.frame <= currentFrame) {
      const e = event as ClearEvent;
      if (!e.assetIds || e.assetIds.length === 0) {
        state.assets.clear();
        state.assetEnterFrames.clear();
        state.texts.clear();
      } else {
        for (const id of e.assetIds) {
          state.assets.delete(id);
          state.assetEnterFrames.delete(id);
        }
      }
    }

    if (event.type === "camera" && event.frame <= currentFrame) {
      const e = event as CameraEvent;
      const cameraProgress = Math.min(1, (currentFrame - e.frame) / Math.max(e.duration, 1));
      const eased = easeInOut(cameraProgress);
      state.camera.zoom = interpolate(eased, [0, 1], [state.camera.zoom, e.zoom]);
      state.camera.centerX = interpolate(eased, [0, 1], [state.camera.centerX, e.centerX]);
      state.camera.centerY = interpolate(eased, [0, 1], [state.camera.centerY, e.centerY]);
    }

    if (event.type === "background" && event.frame <= currentFrame) {
      const e = event as BackgroundEvent;
      state.backgrounds.push({
        src: e.src,
        blur: e.blur ?? 0,
        opacity: e.opacity ?? 1,
        overlay: e.overlay,
        enterFrame: e.frame,
        duration: e.duration ?? 20,
      });
      // Keep only the last 2 for crossfade
      if (state.backgrounds.length > 2) state.backgrounds.shift();
    }

    if (event.type === "speechBubble" && event.frame <= currentFrame) {
      const e = event as SpeechBubbleEvent;
      state.speechBubbles.set(e.bubbleId, {
        bubbleId: e.bubbleId,
        anchorAssetId: e.anchorAssetId,
        text: e.text,
        style: e.style ?? "speech",
        direction: e.direction ?? "right",
        exitFrame: e.exitFrame ?? null,
        enterFrame: e.frame,
        fontSize: e.fontSize ?? 22,
        background: e.background ?? "white",
        textColor: e.textColor ?? "#1a1a1a",
      });
      if (e.exitFrame !== null && currentFrame >= (e.exitFrame ?? 0)) {
        state.speechBubbles.delete(e.bubbleId);
      }
    }

    if (event.type === "card" && event.frame <= currentFrame) {
      const e = event as CardEvent;
      state.cards.set(e.cardId, {
        cardId: e.cardId,
        position: e.position,
        scale: e.scale ?? 1,
        background: e.background,
        iconSrc: e.iconSrc,
        label: e.label,
        animation: e.animation ?? "popIn",
        enterFrame: e.frame,
        exitFrame: e.exitFrame ?? null,
        width: e.width ?? 280,
        height: e.height ?? 200,
      });
      if (e.exitFrame !== null && currentFrame >= (e.exitFrame ?? 0)) {
        state.cards.delete(e.cardId);
      }
    }

    if (event.type === "paperCard" && event.frame <= currentFrame) {
      const e = event as PaperCardEvent;
      state.paperCards.set(e.cardId, {
        cardId: e.cardId,
        variant: e.variant,
        position: e.position,
        scale: e.scale ?? 1,
        title: e.title,
        body: e.body,
        choices: e.choices,
        rotation: e.rotation ?? (e.variant === "evidence" ? -2 : 0),
        animation: e.animation ?? "popIn",
        enterFrame: e.frame,
        exitFrame: e.exitFrame ?? null,
        width: e.width ?? 1100,
      });
      if (e.exitFrame !== null && currentFrame >= (e.exitFrame ?? 0)) {
        state.paperCards.delete(e.cardId);
      }
    }

    if (event.type === "frameBox" && event.frame <= currentFrame) {
      const e = event as FrameBoxEvent;
      state.frameBoxes.set(e.frameId, {
        frameId: e.frameId,
        position: e.position,
        scale: e.scale ?? 1,
        contentSrc: e.contentSrc,
        caption: e.caption,
        animation: e.animation ?? "popIn",
        enterFrame: e.frame,
        exitFrame: e.exitFrame ?? null,
        width: e.width ?? 1000,
      });
      if (e.exitFrame !== null && currentFrame >= (e.exitFrame ?? 0)) {
        state.frameBoxes.delete(e.frameId);
      }
    }

    if (event.type === "transition" && event.frame <= currentFrame) {
      const e = event as TransitionEvent;
      const dur = e.duration ?? 15;
      if (currentFrame < e.frame + dur) {
        state.activeTransition = { style: e.style, startFrame: e.frame, duration: dur };
      }
    }

    if (event.type === "emphasize" && event.frame <= currentFrame) {
      const e = event as EmphasizeEvent;
      const duration = e.duration ?? 30;
      if (currentFrame <= e.frame + duration) {
        state.emphasizes.push({
          assetId: e.assetId,
          animation: e.animation,
          startFrame: e.frame,
          duration,
        });
      }
    }
  }

  // ── Anti-overlap safety net ───────────────────────────────────────────────
  // When two text overlays occupy overlapping screen boxes at the same frame,
  // keep only the most-recently-entered one. This prevents stale text from a
  // previous beat from colliding with fresh text — a common generation mistake
  // that the slot system alone can't catch (e.g. a wide CALLOUT spilling into
  // a neighbour, or two BODY lines stacked at the same y). Fixes overlap at
  // RENDER time so both existing and future timelines render clean.
  dedupeOverlappingTexts(state.texts, timeline.width ?? 1920, timeline.height ?? 1080);

  return state;
}

// Estimate a text overlay's on-screen bounding box (pixels), mirroring the
// sizing rules in AnimatedText.tsx as closely as is practical.
function estimateTextBox(
  t: TextState,
  W: number,
  H: number
): { x0: number; x1: number; y0: number; y1: number } {
  const FS_DEFAULT: Record<string, number> = {
    TITLE: 72, STAT: 120, CALLOUT: 44, SECTION: 54, BODY: 44, CAPTION: 30,
  };
  const style = t.style ?? "BODY";
  const fontSize = t.fontSize ?? FS_DEFAULT[style] ?? 44;
  const chars = t.content.replace(/\n/g, " ").length;
  const charW = fontSize * 0.55;

  let boxW: number;
  let boxH: number;

  if (style === "CALLOUT") {
    // Pill, whiteSpace: nowrap → width grows with content + 36px padding each side
    boxW = chars * charW + 72;
    boxH = fontSize * 1.6;
  } else if (style === "STAT") {
    boxW = chars * fontSize * 0.6;
    boxH = fontSize * 1.3;
  } else {
    // TITLE / SECTION / BODY / CAPTION wrap at a maxWidth
    const maxW = W * (style === "TITLE" ? 0.75 : style === "SECTION" ? 0.7 : 0.72);
    const unwrapped = chars * charW;
    boxW = Math.min(unwrapped, maxW);
    const lines = Math.max(1, Math.ceil(unwrapped / maxW));
    boxH = fontSize * 1.35 * lines;
  }

  // Honour explicit line breaks
  const explicitLines = t.content.split("\n").length;
  if (explicitLines > 1 && style !== "CALLOUT") {
    boxH = Math.max(boxH, fontSize * 1.35 * explicitLines);
  }

  const cx = t.position.x * W;
  const cy = t.position.y * H;
  return { x0: cx - boxW / 2, x1: cx + boxW / 2, y0: cy - boxH / 2, y1: cy + boxH / 2 };
}

function boxesOverlap(
  a: { x0: number; x1: number; y0: number; y1: number },
  b: { x0: number; x1: number; y0: number; y1: number }
): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}

// Remove older texts that collide with a newer one (newer = higher enterFrame).
function dedupeOverlappingTexts(texts: Map<string, TextState>, W: number, H: number): void {
  const entries = [...texts.values()].sort((a, b) => a.enterFrame - b.enterFrame);
  const boxes = entries.map((t) => ({ t, box: estimateTextBox(t, W, H) }));
  const removed = new Set<string>();

  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      // i is always older (or equal) than j due to the ascending sort
      if (boxesOverlap(boxes[i].box, boxes[j].box)) {
        removed.add(boxes[i].t.textId);
        break; // i is gone; no need to compare it further
      }
    }
  }

  for (const id of removed) texts.delete(id);
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

// Get the move-from position for smooth transitions
// This is a simplified version - tracks position before most recent move
export function getPreviousPosition(
  timeline: Timeline,
  assetId: string,
  beforeFrame: number
): { x: number; y: number } | null {
  let pos: { x: number; y: number } | null = null;
  for (const event of timeline.events) {
    if (event.frame >= beforeFrame) break;
    if (event.type === "enter" && (event as EnterEvent).assetId === assetId) {
      pos = (event as EnterEvent).position;
    }
    if (event.type === "move" && (event as MoveEvent).assetId === assetId) {
      pos = (event as MoveEvent).position;
    }
  }
  return pos;
}
