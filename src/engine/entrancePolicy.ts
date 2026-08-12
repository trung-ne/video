import type { EntranceStyle, AnimationType } from "../types/timeline";
import type { Emotion, VisualGrammar } from "../types/storyboard";

export interface EntranceIntent {
  requested?: EntranceStyle;
  grammar?: VisualGrammar | string;
  emotion?: Emotion;
  heroVisual?: boolean;
  visualRegister?: string;
}

const REVEAL_GRAMMARS = new Set<VisualGrammar>([
  "EVIDENCE", "FRAMEBOX", "MAP_FLOW", "DATA_CHART", "SURVEY_CARD",
  "PHOTO_EVIDENCE", "SCREEN_CAPTURE",
]);
const SLIDE_GRAMMARS = new Set<VisualGrammar>(["DIALOGUE_QA", "COMPARE", "CAUSE_EFFECT"]);
const CUT_GRAMMARS = new Set<VisualGrammar>(["BEAT", "FULL_SCENE_ACTION"]);
export const ENTRANCE_STYLES: EntranceStyle[] = ["fade", "rise", "slide", "softScale", "reveal", "cut"];

/**
 * Semantic, deterministic fallback for legacy storyboard scenes. It uses the
 * director's authored meaning (grammar/emotion), never scene index or keywords.
 */
export function selectEntranceStyle(intent: EntranceIntent): EntranceStyle {
  if (intent.requested && ENTRANCE_STYLES.includes(intent.requested)) return intent.requested;
  const grammar = intent.grammar as VisualGrammar | undefined;
  if (grammar && REVEAL_GRAMMARS.has(grammar)) return "reveal";
  if (grammar && SLIDE_GRAMMARS.has(grammar)) return "slide";
  if (grammar && CUT_GRAMMARS.has(grammar)) return "cut";
  if (intent.emotion === "surprise" || intent.emotion === "urgent" || intent.heroVisual) return "softScale";
  if (intent.emotion === "hopeful" || intent.emotion === "happy") return "rise";
  if (intent.emotion === "sarcastic" || intent.emotion === "curious") return "slide";
  return "fade";
}

export function animationForEntranceStyle(
  style: EntranceStyle,
  position?: { x: number; y: number },
): AnimationType {
  const fromLeft = (position?.x ?? 0.5) <= 0.5;
  switch (style) {
    case "fade": return "fadeIn";
    case "rise": return "riseIn";
    case "slide": return fromLeft ? "slideRight" : "slideLeft";
    case "softScale": return "softScaleIn";
    case "reveal": return fromLeft ? "revealLeft" : "revealRight";
    case "cut": return "cutIn";
  }
}

/** Legacy artifacts remain viewable, but no compiler or prompt may emit these. */
export function normalizeEntranceAnimation(animation: string | undefined): AnimationType {
  switch (animation) {
    case "popIn":
    case "zoomIn": return "softScaleIn";
    case "slideUp": return "riseIn";
    case "slideDown": return "fadeIn";
    case "drawSVG": return "revealLeft";
    case "fadeIn": case "riseIn": case "slideLeft": case "slideRight":
    case "softScaleIn": case "revealLeft": case "revealRight": case "cutIn": case "none":
      return animation;
    default: return "fadeIn";
  }
}
