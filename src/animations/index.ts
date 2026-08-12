import { interpolate, spring, SpringConfig } from "remotion";
import { normalizeEntranceAnimation } from "../engine/entrancePolicy";

const SPRING_CONFIG: SpringConfig = {
  damping: 14,
  mass: 0.8,
  stiffness: 120,
  // Entrance motion may settle at the authored size, but must never grow
  // beyond it. Overshooting reads as a repeated jump-scare on large assets.
  overshootClamping: true,
};

const SPRING_SNAPPY: SpringConfig = {
  damping: 18,
  mass: 0.6,
  stiffness: 200,
  overshootClamping: false,
};

// Returns { opacity, scale, translateX, translateY } at a given frame offset
// localFrame = current frame - event.frame
// duration = animation duration in frames

export interface AnimationValues {
  opacity: number;
  scale: number;
  translateX: number; // pixels
  translateY: number; // pixels
  clipPath?: string;
}

export const clampEntranceProgress = (progress: number): number =>
  Math.min(1, Math.max(0, progress));

export function getEnterAnimation(
  type: string,
  localFrame: number,
  duration: number,
  fps: number
): AnimationValues {
  const progress = clampEntranceProgress(spring({
    frame: localFrame,
    fps,
    config: SPRING_CONFIG,
    durationInFrames: duration,
  }));

  switch (normalizeEntranceAnimation(type)) {
    case "fadeIn":
      return { opacity: interpolate(progress, [0, 1], [0, 1]), scale: 1, translateX: 0, translateY: 0 };
    case "riseIn":
      return { opacity: interpolate(progress, [0, 0.65], [0, 1], { extrapolateRight: "clamp" }), scale: 1, translateX: 0, translateY: interpolate(progress, [0, 1], [28, 0]) };
    case "slideLeft":
      return { opacity: interpolate(progress, [0, 0.65], [0, 1], { extrapolateRight: "clamp" }), scale: 1, translateX: interpolate(progress, [0, 1], [56, 0]), translateY: 0 };
    case "slideRight":
      return { opacity: interpolate(progress, [0, 0.65], [0, 1], { extrapolateRight: "clamp" }), scale: 1, translateX: interpolate(progress, [0, 1], [-56, 0]), translateY: 0 };
    case "softScaleIn":
      return { opacity: interpolate(progress, [0, 0.65], [0, 1], { extrapolateRight: "clamp" }), scale: interpolate(progress, [0, 1], [0.94, 1]), translateX: 0, translateY: 0 };
    case "revealLeft":
      return { opacity: 1, scale: 1, translateX: 0, translateY: 0, clipPath: `inset(0 ${interpolate(progress, [0, 1], [100, 0])}% 0 0)` };
    case "revealRight":
      return { opacity: 1, scale: 1, translateX: 0, translateY: 0, clipPath: `inset(0 0 0 ${interpolate(progress, [0, 1], [100, 0])}%)` };
    case "cutIn":
    case "none":
    default:
      return { opacity: localFrame >= 0 ? 1 : 0, scale: 1, translateX: 0, translateY: 0 };
  }
}

export function getExitAnimation(
  type: string,
  localFrame: number,
  duration: number,
  fps: number
): AnimationValues {
  const progress = spring({
    frame: localFrame,
    fps,
    config: SPRING_SNAPPY,
    durationInFrames: duration,
  });

  switch (type) {
    case "fadeOut":
      return {
        opacity: interpolate(localFrame, [0, duration], [1, 0], { extrapolateRight: "clamp" }),
        scale: 1,
        translateX: 0,
        translateY: 0,
      };

    case "popOut":
      return {
        opacity: interpolate(progress, [0.7, 1], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        scale: interpolate(progress, [0, 1], [1, 0.5]),
        translateX: 0,
        translateY: 0,
      };

    case "slideLeft":
      return {
        opacity: interpolate(progress, [0.6, 1], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        scale: 1,
        translateX: interpolate(progress, [0, 1], [0, -120]),
        translateY: 0,
      };

    case "slideRight":
      return {
        opacity: interpolate(progress, [0.6, 1], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        scale: 1,
        translateX: interpolate(progress, [0, 1], [0, 120]),
        translateY: 0,
      };

    case "zoomOut":
      return {
        opacity: interpolate(progress, [0.6, 1], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        scale: interpolate(progress, [0, 1], [1, 1.5]),
        translateX: 0,
        translateY: 0,
      };

    default:
      return { opacity: 0, scale: 1, translateX: 0, translateY: 0 };
  }
}

export function getEmphasizeAnimation(
  type: string,
  localFrame: number,
  duration: number,
  fps: number
): { scale: number; translateX: number; translateY: number; filter?: string } {
  const t = localFrame / Math.max(duration, 1);

  switch (type) {
    case "pulse": {
      const s = spring({ frame: localFrame, fps, config: SPRING_SNAPPY, durationInFrames: duration });
      return {
        scale: localFrame < duration / 2 ? 1 + s * 0.18 : 1 + (1 - s) * 0.18,
        translateX: 0,
        translateY: 0,
      };
    }

    case "bounce": {
      const bounceY = Math.abs(Math.sin(t * Math.PI * 2)) * -20 * Math.max(0, 1 - t);
      return { scale: 1, translateX: 0, translateY: bounceY };
    }

    case "shake": {
      const amplitude = 8 * Math.max(0, 1 - t * 1.5);
      const shakeX = Math.sin(t * Math.PI * 10) * amplitude;
      return { scale: 1, translateX: shakeX, translateY: 0 };
    }

    case "highlight": {
      const glow = interpolate(t, [0, 0.4, 1], [0, 1, 0], { extrapolateRight: "clamp" });
      return {
        scale: 1,
        translateX: 0,
        translateY: 0,
        filter: `drop-shadow(0 0 ${glow * 20}px rgba(255, 200, 0, ${glow}))`,
      };
    }

    default:
      return { scale: 1, translateX: 0, translateY: 0 };
  }
}
