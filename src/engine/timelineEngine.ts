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
  TransitionEvent,
} from "../types/timeline";
import { interpolate, spring } from "remotion";

export interface BackgroundState {
  src: string;
  blur: number;
  opacity: number;
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

    if (event.type === "text") {
      const e = event as TextEvent;
      if (e.frame <= currentFrame) {
        state.texts.set(e.textId, {
          textId: e.textId,
          content: e.content,
          position: e.position,
          fontSize: e.fontSize ?? 48,
          color: e.color ?? "#1a1a1a",
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

  return state;
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
