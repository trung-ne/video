import { Beat } from "../types/storyboard";

export const WORDS_PER_VISUAL_STATE = 28;
export const MAX_VISUAL_HOLD_FRAMES = 300;
export const MAX_AUTHORED_SCENE_WORDS = 60;

const PERSISTENT_ACTIONS = new Set<NonNullable<Beat["action"]>>([
  "swap_pose", "swap_asset", "focus_actor", "focus_asset", "reveal", "advance", "handoff",
]);

export function narrationWordCount(narration: string): number {
  return narration.trim().split(/\s+/u).filter(Boolean).length;
}

export function requiredAuthoredTransitions(narration: string): number {
  return Math.max(0, Math.ceil(narrationWordCount(narration) / WORDS_PER_VISUAL_STATE) - 1);
}

export function isPersistentBeat(beat: Beat): boolean {
  return Boolean(beat.action && beat.targetSlot && PERSISTENT_ACTIONS.has(beat.action));
}

export function authoredCadenceIssues(sceneId: string, narration: string, beats: Beat[] | undefined): string[] {
  const issues: string[] = [];
  const words = narrationWordCount(narration);
  if (words > MAX_AUTHORED_SCENE_WORDS) {
    issues.push(`contains ${words} words; hard maximum is ${MAX_AUTHORED_SCENE_WORDS}. Split at a semantic turn before adding beats`);
  }
  const required = requiredAuthoredTransitions(narration);
  const authored = (beats ?? []).filter(isPersistentBeat);
  if (authored.length < required) {
    issues.push(`needs ${required} persistent authored beat(s) for ${narrationWordCount(narration)} words; found ${authored.length}. Split the scene or author semantic pose/prop/card/focus transitions`);
  }
  for (const [index, beat] of (beats ?? []).entries()) {
    if (!narration.includes(beat.text)) issues.push(`beat ${index + 1} text is not a verbatim narration substring`);
    if (!Number.isFinite(beat.importance) || beat.importance < 0 || beat.importance > 1) issues.push(`beat ${index + 1} importance must be within 0..1`);
    if (!beat.action || !beat.targetSlot) issues.push(`beat ${index + 1} must name action and targetSlot`);
    else if (!PERSISTENT_ACTIONS.has(beat.action)) issues.push(`beat ${index + 1} action ${beat.action} is temporary/unsupported; author a persistent state change`);
  }
  return issues.map((issue) => `${sceneId}: ${issue}`);
}

function itemCount(value: unknown): number {
  return String(value ?? "").split("|").map((item) => item.trim()).filter(Boolean).length;
}

export function authoredTransitionCapabilityIssues(
  sceneId: string,
  grammar: string,
  slots: Record<string, unknown>,
  beats: Beat[] | undefined,
): string[] {
  const issues: string[] = [];
  if (grammar === "BEAT" && !/^backgrounds\/.+\.(jpg|jpeg|png|webp)$/i.test(String(slots.image ?? slots.background ?? ""))) {
    issues.push("BEAT requires an authored production photo under backgrounds/; an empty illustrated stage is not a beat");
  }
  let remainingAdvances = (() => {
    if (["COMPARE", "VISUAL_METAPHOR", "CAUSE_EFFECT"].includes(grammar)) return 1;
    if (grammar === "QA_REVEAL") return slots.q || slots.question ? 1 : 0;
    if (["DIAGRAM", "ICON_TRIPLE", "POLICY_LIST", "HISTORY_TIMELINE"].includes(grammar)) {
      return Math.max(0, itemCount(slots.items) - 1);
    }
    return 0;
  })();

  for (const [index, beat] of (beats ?? []).entries()) {
    const label = `beat ${index + 1} ${beat.action}:${beat.targetSlot}`;
    if (beat.action === "advance") {
      if (beat.targetSlot !== "next" || remainingAdvances-- <= 0) {
        issues.push(`${label} has no authored teaching layer to advance`);
      }
    } else if (beat.action === "handoff") {
      if (grammar !== "DIALOGUE_QA" || beat.targetSlot !== "answerer" || !slots.askerText || !slots.answererText) {
        issues.push(`${label} requires DIALOGUE_QA with both authored lines`);
      }
    } else if (beat.action === "swap_pose") {
      if (!["TABLEAU", "DIALOGUE_QA", "CHAR_PROP"].includes(grammar) || !beat.targetAssetId?.startsWith("characters/")) {
        issues.push(`${label} requires a rendered actor and a production character target`);
      }
    } else if (beat.action === "swap_asset") {
      if (!["TABLEAU", "CHAR_PROP"].includes(grammar) || beat.targetSlot !== "prop" || !slots.prop || !beat.targetAssetId || beat.targetAssetId.startsWith("characters/")) {
        issues.push(`${label} requires an authored prop and a non-character target`);
      }
    } else if (beat.action === "focus_actor") {
      if (!["TABLEAU", "DIALOGUE_QA"].includes(grammar)) issues.push(`${label} requires a rendered actor`);
    } else if (beat.action === "focus_asset") {
      if (!["TABLEAU", "CHAR_PROP"].includes(grammar) || !slots.prop) issues.push(`${label} requires a rendered prop`);
    } else if (beat.action === "reveal") {
      const caption = beat.targetSlot === "caption" && grammar === "TABLEAU" && Boolean(slots.caption ?? slots.keyword);
      const cutaway = beat.targetSlot === "cutaway" && Boolean(beat.targetAssetId) && Boolean(beat.targetLabel?.trim());
      if (!caption && !cutaway) issues.push(`${label} is not a renderable caption or fully authored cutaway`);
    }
  }
  return issues.map((issue) => `${sceneId}: ${issue}`);
}

function positiveDelay(value: unknown): number | undefined {
  const frame = Number(value);
  return Number.isFinite(frame) && frame > 0 ? frame : undefined;
}

export function sceneStateChangeFrames(scene: any): number[] {
  const frames = new Set<number>([0]);
  const collect = (items: any[] | undefined) => {
    for (const item of items ?? []) {
      // Timeline entities use enterDelay.  Some grammar results also retain a
      // legacy `delay` field; an authored beat replaces the entrance time but
      // intentionally keeps the geometry.  Prefer the actual entity entrance
      // timing so cadence measures the rendered state transition.
      const frame = positiveDelay(item.enterDelay ?? item.delay);
      if (frame !== undefined) frames.add(frame);
    }
  };
  collect(scene.entities);
  collect(scene.cards);
  collect(scene.paperCards);
  collect(scene.frameBoxes);
  collect(scene.speechBubbles);
  collect(scene.texts);
  return [...frames].sort((a, b) => a - b);
}

export function maximumVisualHold(scene: any): { frames: number; start: number } {
  const moments = sceneStateChangeFrames(scene).filter((frame) => frame < scene.durationFrames);
  let previous = 0;
  let longest = { frames: 0, start: 0 };
  for (const frame of moments) {
    if (frame - previous > longest.frames) longest = { frames: frame - previous, start: previous };
    previous = frame;
  }
  if (scene.durationFrames - previous > longest.frames) longest = { frames: scene.durationFrames - previous, start: previous };
  return longest;
}
