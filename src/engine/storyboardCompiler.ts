// ============================================================
// storyboardCompiler — deterministic Storyboard → SceneTimeline.
//
// This is the "compiler" half of the authoring/compile split: it takes
// the LLM's storyboard (intent + grammar + slots + beats) and produces a
// SceneTimeline (scenes[]) — the exact format the existing pipeline
// (loadTimeline → sceneCompiler → motion engine → Remotion) already
// consumes. No creativity here: grammar functions place entities, timing
// comes from TTS durations, beat-emphasis is anchored by word alignment.
//
// Browser-safe: no fs / Date / random.
// ============================================================

import { Scene, SceneTimeline, SceneEntity, SceneBeatTimingSource, TimingProvenance } from "../types/scene";
import { Storyboard, SceneBrief, AlignedWord } from "../types/storyboard";
import { VISUAL_GRAMMARS, applyShot, GrammarContext, GrammarResult } from "./visualGrammars";
import { STAGE_ANCHORS } from "./stageAnchors";
import { selectEntranceStyle } from "./entrancePolicy";
import {
  SceneTimingSource,
  checkCompiledTimings,
  formatTimingIssues,
  hasBlocker,
} from "./timingIntegrity";

export interface SceneTiming {
  id: string;
  startFrame: number;
  frames: number;
}

export interface CompileStoryboardOpts {
  durations?: SceneTiming[]; // from projects/<id>/durations.json
  words?: AlignedWord[];     // from projects/<id>/words.json (whisper)
  background?: string;
  fallbackFramesPerWord?: number; // when no TTS timing (default 8)
  /**
   * Permit scenes timed by word-count estimate instead of measured audio.
   * Defaults to false: estimated timing desyncs the whole video against the
   * voice track (see src/engine/timingIntegrity.ts for the incident this
   * prevents), so production must opt out explicitly and visibly. A boolean
   * rather than a mode string — it cannot be typo'd into a permissive value.
   */
  allowEstimatedTiming?: boolean;
  /**
   * Hashes and measurements the compiler cannot obtain itself (it stays
   * browser-safe: no fs). Callers that read the wav / durations / words files
   * pass their digests so the emitted timeline records what it was built from.
   */
  provenance?: {
    audioSeconds?: number;
    audioSha256?: string;
    storyboardChecksum?: string;
    durationsChecksum?: string;
    wordsChecksum?: string;
  };
}

function isCssBackground(value: string | undefined): boolean {
  return !value || /^#|^rgba?\(|gradient\(/i.test(value);
}

/**
 * clearPrevious removes the old shot at the cut. On a CSS background, delaying
 * every focal layer creates a genuinely empty flash. Keep later staging, but
 * make the earliest layer land on the cut frame. Photos and illustrated stages
 * already carry meaning at frame zero and do not need normalization.
 */
function ensureImmediateFocal(result: GrammarResult): void {
  if (!isCssBackground(result.backgroundSrc)) return;
  const layers: Array<{ delay?: number; enterDelay?: number }> = [
    ...(result.entities ?? []),
    ...(result.texts ?? []),
    ...(result.cards ?? []),
    ...(result.paperCards ?? []),
    ...(result.frameBoxes ?? []),
    ...(result.speechBubbles ?? []),
  ];
  if (!layers.length) return;
  const delayOf = (layer: { delay?: number; enterDelay?: number }) =>
    layer.enterDelay ?? layer.delay ?? 0;
  const earliest = Math.min(...layers.map(delayOf));
  if (earliest <= 0) return;
  for (const layer of layers.filter((item) => delayOf(item) === earliest)) {
    if (layer.enterDelay !== undefined) layer.enterDelay = 0;
    else layer.delay = 0;
  }
}

function buildAlignedSceneTimings(
  storyboard: Storyboard,
  words: AlignedWord[] | undefined,
  fps: number,
): Map<string, SceneTiming> {
  const result = new Map<string, SceneTiming>();
  if (!words?.some((word) => Number.isInteger(word.wordIndex))) return result;
  const bounds = storyboard.scenes.map((scene) => {
    if (!scene.sourceRange) return undefined;
    const matched = words.filter((word) =>
      Number.isInteger(word.wordIndex) &&
      word.wordIndex! >= scene.sourceRange!.startWord &&
      word.wordIndex! <= scene.sourceRange!.endWord
    );
    if (matched.length === 0) return undefined;
    return {
      startFrame: Math.round(matched[0].startSec * fps),
      endFrame: Math.round(matched[matched.length - 1].endSec * fps),
    };
  });
  if (bounds.some((bound) => !bound)) return result;
  const starts = bounds.map((bound) => bound!.startFrame);
  starts[0] = 0;
  for (let index = 0; index < storyboard.scenes.length; index++) {
    const startFrame = starts[index];
    const endFrame = index + 1 < starts.length
      ? starts[index + 1]
      : bounds[index]!.endFrame;
    result.set(storyboard.scenes[index].id, {
      id: storyboard.scenes[index].id,
      startFrame,
      frames: Math.max(1, endFrame - startFrame),
    });
  }
  return result;
}

// Resolve frame offset (from scene start) where a beat's word is spoken.
// Prefers word-alignment; falls back to char-proportion within the scene.
function resolveBeatOffset(
  beatText: string,
  narration: string,
  sceneId: string,
  sceneStartFrame: number,
  sceneFrames: number,
  fps: number,
  words: AlignedWord[] | undefined
): { offset: number; source: SceneBeatTimingSource } {
  const firstWord = canonicalNarrationTokens(beatText)[0]?.toLowerCase();
  if (words && firstWord) {
    // Search only canonical words spoken by this scene when that identity is
    // available. Source transcript ranges may differ from narrationOverride.
    const startSec = sceneStartFrame / fps;
    const endSec = (sceneStartFrame + sceneFrames) / fps;
    for (const w of words) {
      if (w.scene && w.scene !== sceneId) continue;
      if (w.startSec < startSec - 0.05 || w.startSec > endSec) continue;
      if (w.word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "") === firstWord) {
        return {
          offset: Math.max(0, Math.round(w.startSec * fps) - sceneStartFrame),
          source: "aligned-words",
        };
      }
    }
  }
  // Fallback: proportional by character position in the narration.
  const idx = narration.toLowerCase().indexOf(beatText.trim().toLowerCase());
  const frac = idx >= 0 && narration.length > 0 ? idx / narration.length : 0.4;
  return {
    offset: Math.round(frac * sceneFrames),
    source: idx >= 0 ? "authored-beat" : "source-range-proportional",
  };
}

// Keep this intentionally in sync with align_words.py::transcript_words().
// Whitespace splitting counts punctuation-only fragments (for example an em
// dash) that Whisper never emits, which would corrupt sceneWordIndex coverage.
function canonicalNarrationTokens(value: string): string[] {
  return value.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) ?? [];
}

// Per-emotion pose cycle for sentence-level re-posing. Only registers with ≥2
// poses swap; sad/surprise/urgent keep a single pose to preserve the emotion.
const POSE_CYCLE: Record<string, string[]> = {
  neutral:   ["characters/cat_explain", "characters/cat_point_left"],
  curious:   ["characters/cat_think", "characters/cat_shrug"],
  sarcastic: ["characters/cat_sunglasses", "characters/cat_explain"],
  happy:     ["characters/cat_happy", "characters/cat_explain"],
  hopeful:   ["characters/cat_happy", "characters/cat_explain"],
  concern:   ["characters/cat_think", "characters/cat_sad"],
  sad:       [],
  surprise:  [],
  urgent:    [],
};

const DEFAULT_FOCAL_OCCUPANCY: Record<string, number> = {
  // The audit measures the largest connected focal component, not the union
  // of multiple cards. Targets therefore describe one component's footprint.
  STAT_REVEAL: 0.22,
  SOLO: 0.18,
  CAUSE_EFFECT: 0.22,
  COMPARE: 0.20,
  POLICY_LIST: 0.18,
  ICON_TRIPLE: 0.18,
  DIAGRAM: 0.20,
  QA_REVEAL: 0.22,
  DIALOGUE_QA: 0.20,
  FRAMEBOX: 0.28,
  TABLEAU: 0.18,
  CHAR_PROP: 0.20,
  EVIDENCE: 0.15,
  VISUAL_METAPHOR: 0.18,
  HISTORY_TIMELINE: 0.18,
  SURVEY_CARD: 0.15,
  MAP_FLOW: 0.15,
  DATA_CHART: 0.15,
  SCREEN_CAPTURE: 0.15,
  FULL_SCENE_ACTION: 0.20,
  // Deliberately character-free registers (V4.1: full-bleed photo/quiet beat,
  // the image tells the story on its own) — a 0.25 default target treats an
  // intentional empty-of-character frame as a defect it isn't.
  PHOTO_EVIDENCE: 0.05,
  BEAT: 0.05,
};

function importanceToEmphasis(imp: number): { animation: "pulse" | "shake" | "bounce"; duration: number; value?: number } {
  if (imp >= 0.85) return { animation: "shake", duration: 24 };
  if (imp >= 0.6) return { animation: "pulse", duration: 22 };
  return { animation: "bounce", duration: 20 };
}

function buildSubtitleCues(
  brief: SceneBrief,
  timing: SceneTiming,
  words: AlignedWord[] | undefined,
  fps: number,
): Array<{ text: string; startFrame: number; endFrame: number }> | undefined {
  const narrationWords = canonicalNarrationTokens(brief.narration);
  if (!narrationWords.length || !words) return undefined;
  const aligned = words
    .filter((word) => word.scene === brief.id && Number.isInteger(word.sceneWordIndex))
    .sort((a, b) => (a.sceneWordIndex! - b.sceneWordIndex!));
  const byIndex = new Map(aligned.map((word) => [word.sceneWordIndex!, word]));

  // Do not quietly map extra narrationOverride tokens onto the final source
  // word. Returning undefined makes the fallback subtitle compiler safe, while
  // the production alignment gate explains the canonical-data defect.
  if (narrationWords.some((_, index) => !byIndex.has(index))) return undefined;

  const raw: Array<{ text: string; startFrame: number; endFrame: number }> = [];
  for (let offset = 0; offset < narrationWords.length;) {
    const chunk: string[] = [];
    const start = offset;
    while (offset < narrationWords.length && chunk.length < 9) {
      const candidate = [...chunk, narrationWords[offset]].join(" ");
      if (chunk.length && candidate.length > 84) break;
      chunk.push(narrationWords[offset++]);
    }
    const first = byIndex.get(start)!;
    const last = byIndex.get(offset - 1)!;
    raw.push({
      text: chunk.join(" "),
      startFrame: Math.max(0, Math.round(first.startSec * fps) - timing.startFrame),
      endFrame: Math.min(timing.frames, Math.max(1, Math.round(last.endSec * fps) - timing.startFrame)),
    });
  }

  // Reflow the canonical chunks over the whole scene. Raw word timestamps set
  // the phrase boundaries, but a spoken burst may exceed the 22-CPS reading
  // limit. A contiguous reading track is preferable to overlapping subtitles:
  // allocate every cue its required reading time, then distribute remaining
  // scene time by text weight. This never clamps later chunks onto one word.
  const required = raw.map((cue) => Math.max(fps, Math.ceil(cue.text.replace(/\s+/g, " ").trim().length / 22 * fps)));
  const requiredTotal = required.reduce((sum, frames) => sum + frames, 0);
  if (requiredTotal > timing.frames) return undefined;
  const slack = timing.frames - requiredTotal;
  const totalChars = raw.reduce((sum, cue) => sum + cue.text.length, 0) || 1;
  let cursor = 0;
  let assignedSlack = 0;
  for (let index = 0; index < raw.length; index++) {
    const extra = index + 1 === raw.length
      ? slack - assignedSlack
      : Math.floor(slack * raw[index].text.length / totalChars);
    assignedSlack += extra;
    raw[index].startFrame = cursor;
    raw[index].endFrame = cursor + required[index] + extra;
    cursor = raw[index].endFrame;
  }
  return raw;
}

// A structural fingerprint measures what the viewer sees, not what the author
// wrote. Semantic prose/captions must never manufacture fake uniqueness.
function compositionFingerprint(result: GrammarResult, brief: SceneBrief): string {
  const entities = result.entities ?? [];
  const actors = entities.filter((entity) => entity.src.startsWith("characters/")).length;
  const props = entities.length - actors;
  const components = [
    ...(result.cards ?? []).map((card) => {
      // A concept card's icon is a visible part of its composition. Ignoring it
      // made semantically distinct comparisons (house vs. loan, bank vs.
      // investor, etc.) look identical to the reuse audit.
      const icon = String(card.iconSrc ?? "none").split("/").pop()?.replace(/\.[^.]+$/, "") ?? "none";
      return `card:${icon}:${Math.round(card.position.x * 3)}:${Math.round(card.position.y * 3)}`;
    }),
    ...(result.paperCards ?? []).map((card) => `paper:${Math.round(card.position.x * 3)}:${Math.round(card.position.y * 3)}`),
    ...(result.frameBoxes ?? []).map((frame) => `frame:${Math.round(frame.position.x * 3)}:${Math.round(frame.position.y * 3)}`),
    ...(result.speechBubbles ?? []).map(() => "bubble"),
  ].sort().join(",") || "none";
  const background = String(result.backgroundSrc ?? "");
  const stage = background.startsWith("assets/scenes/") ? `stage:${background.split("/").pop()?.replace(/\.[^.]+$/, "")}` :
    /\.(jpg|jpeg|png|webp)$/i.test(String(result.backgroundSrc ?? "")) ? "photo" : "graphic";
  const quadrants = entities.map((entity) => entity.anchor ?? entity.slot ?? "free").sort().join(",") || "none";
  return [brief.visualGrammar, brief.visualRegister ?? "unknown", stage, `${actors}a:${props}p`,
    quadrants, components, brief.captionTreatment ?? "none", brief.photoTreatment ?? "none"].join("|");
}

/**
 * Apply only transitions that the storyboard explicitly directs.  `Beat` has
 * always carried an action/target contract, but the compiler previously used
 * it only for a short focal pulse.  That left long dialogue/tableau scenes
 * visually frozen after their first second and encouraged the old unsafe
 * post-compile liveliness injector.
 *
 * These transitions change a semantic state and hold it: a dialogue genuinely
 * hands the floor to its answerer; a tableau's authored takeaway arrives when
 * its narration reaches the marked phrase.  No fallback timing, camera move,
 * positional nudge, or synthetic content is introduced here.
 */
function applyAuthoredBeatTransitions(
  brief: SceneBrief,
  result: GrammarResult,
  timing: SceneTiming,
  fps: number,
  words: AlignedWord[] | undefined,
): SceneBeatTimingSource | undefined {
  if (!brief.beats?.length) return undefined;

  // The narration phrase is authored; the grammar owns component IDs/layout.
  // This makes staging semantic instead of moving every card on a global clock.
  const advanceCandidates = [
    ...(result.cards ?? []),
    ...(result.paperCards ?? []),
    ...(result.frameBoxes ?? []),
  ]
    .filter((layer) => (layer.delay ?? 0) > 0)
    .sort((a, b) => (a.delay ?? 0) - (b.delay ?? 0));
  let advanceIndex = 0;

  const appendPoseSwap = (targetSlot: string, targetAssetId: string | undefined, delay: number) => {
    if (!targetAssetId?.startsWith("characters/")) {
      throw new Error(
        `${brief.id} marks a pose swap but does not name a production character pose.`,
      );
    }
    // Keep the grammar-authored geometry and replace only the acting state.
    // This is a persistent semantic change, not automatic liveliness motion.
    const assetSuffix = brief.visualGrammar === "CHAR_PROP"
      ? "cat"
      : ["TABLEAU", "DIALOGUE_QA"].includes(brief.visualGrammar)
        ? (targetSlot === "answerer" || targetSlot === "seatB" ? "b" : "a")
        : "";
    const actor = assetSuffix
      ? result.entities.find((entity) => entity.assetId === `${brief.id}-${assetSuffix}`)
      : undefined;
    if (!actor) {
      throw new Error(
        `${brief.id} marks a pose swap for ${targetSlot}, but ${brief.visualGrammar} does not render that actor.`,
      );
    }
    result.entities.push({
      ...actor,
      src: targetAssetId,
      enterAnimation: "none",
      enterDelay: delay,
      clearPrevious: [actor.assetId],
    });
  };

  const appendAssetSwap = (targetSlot: string, targetAssetId: string | undefined, delay: number) => {
    if (targetSlot !== "prop" || !targetAssetId || targetAssetId.startsWith("characters/")) {
      throw new Error(
        `${brief.id} marks an asset swap but does not name a non-character prop target.`,
      );
    }
    if (!["TABLEAU", "CHAR_PROP"].includes(brief.visualGrammar)) {
      throw new Error(
        `${brief.id} marks a prop swap, but ${brief.visualGrammar} does not support a persistent prop state.`,
      );
    }
    const prop = result.entities.find((entity) => entity.assetId === `${brief.id}-prop`);
    if (!prop) {
      throw new Error(
        `${brief.id} marks a prop swap, but its grammar did not render an authored prop.`,
      );
    }
    result.entities.push({
      ...prop,
      src: targetAssetId,
      enterAnimation: "none",
      enterDelay: delay,
      emphasize: undefined,
      clearPrevious: [prop.assetId],
    });
  };

  const appendFocusCut = (
    action: "focus_actor" | "focus_asset",
    targetSlot: string,
    targetAssetId: string | undefined,
    delay: number,
  ) => {
    const actorTarget = action === "focus_actor";
    if (actorTarget && !["TABLEAU", "DIALOGUE_QA"].includes(brief.visualGrammar)) {
      throw new Error(`${brief.id} cannot focus an actor from ${brief.visualGrammar}.`);
    }
    if (!actorTarget && !["TABLEAU", "CHAR_PROP"].includes(brief.visualGrammar)) {
      throw new Error(`${brief.id} cannot focus an asset from ${brief.visualGrammar}.`);
    }
    const suffix = actorTarget
      ? (targetSlot === "answerer" || targetSlot === "seatB" ? "b" : "a")
      : "prop";
    const target = result.entities.find((entity) => entity.assetId === `${brief.id}-${suffix}`);
    if (!target) {
      throw new Error(
        `${brief.id} marks ${action}:${targetSlot}, but its grammar did not render that target.`,
      );
    }
    if (targetAssetId && actorTarget !== targetAssetId.startsWith("characters/")) {
      throw new Error(`${brief.id} ${action} target asset has the wrong semantic kind.`);
    }
    const visibleIds = [...new Set(result.entities.map((entity) => entity.assetId))];
    result.entities.push({
      ...target,
      src: targetAssetId ?? target.src,
      anchor: undefined,
      slot: undefined,
      position: actorTarget
        ? { x: targetSlot === "answerer" || targetSlot === "seatB" ? 0.64 : 0.36, y: 0.58 }
        : { x: 0.5, y: 0.47 },
      scale: actorTarget ? 2.75 : 3.2,
      enterAnimation: "none",
      enterDelay: delay,
      emphasize: undefined,
      motionPolicy: "fixed",
      allowOverlapWith: undefined,
      clearPrevious: visibleIds,
    });
  };

  const sources: SceneBeatTimingSource[] = [];
  for (const beat of brief.beats) {
    if (!beat.action || !beat.targetSlot) continue;
    const resolved = resolveBeatOffset(
      beat.text, brief.narration, brief.id, timing.startFrame, timing.frames, fps, words,
    );
    sources.push(resolved.source);
    const delay = Math.max(2, Math.min(timing.frames - 20, resolved.offset));

    if (beat.action === "advance" && beat.targetSlot === "next") {
      const layer = advanceCandidates[advanceIndex++];
      if (!layer) {
        throw new Error(
          `${brief.id} marks advance:next, but ${brief.visualGrammar} has no unrevealed teaching layer. Split the scene or author a pose/prop/focus transition.`,
        );
      }
      layer.delay = delay;
      continue;
    }

    if (beat.action === "reveal" && beat.targetSlot === "cutaway") {
      if (!beat.targetAssetId) {
        throw new Error(
          `${brief.id} marks a cutaway reveal but does not name a production asset.`,
        );
      }
      if (!beat.targetLabel?.trim()) {
        throw new Error(
          `${brief.id} marks a cutaway reveal without an authored on-screen label.`,
        );
      }
      result.frameBoxes = result.frameBoxes ?? [];
      result.frameBoxes.push({
        id: `${brief.id}-cutaway`,
        contentSrc: beat.targetAssetId,
        caption: beat.targetLabel.trim(),
        position: { x: 0.5, y: 0.40 },
        width: 1550,
        objectFit: "cover",
        delay,
      });
      continue;
    }

    if (beat.action === "reveal" && beat.targetSlot === "caption") {
      const caption = result.texts.find((text) => text.id === `${brief.id}-cap`);
      if (!caption) {
        throw new Error(
          `${brief.id} marks a caption reveal beat but does not author a chapter-pill caption.`,
        );
      }
      caption.delay = delay;
      caption.hold = "scene-end";
      continue;
    }

    if (beat.action === "handoff" && beat.targetSlot === "answerer") {
      const question = result.speechBubbles?.find((bubble) => bubble.id === `${brief.id}-qa`);
      const answer = result.speechBubbles?.find((bubble) => bubble.id === `${brief.id}-qb`);
      if (!question || !answer) {
        throw new Error(
          `${brief.id} marks an answerer handoff beat but does not author both dialogue bubbles.`,
        );
      }
      // The question exits before the answer enters.  The answer then remains
      // visible as the scene's conclusion instead of disappearing after 2s.
      question.duration = Math.max(18, delay - (question.delay ?? 0) - 6);
      answer.delay = delay;
      answer.duration = undefined;
      if (beat.targetAssetId) {
        appendPoseSwap(beat.targetSlot, beat.targetAssetId, delay);
      }
      continue;
    }

    if (beat.action === "swap_pose") {
      appendPoseSwap(beat.targetSlot, beat.targetAssetId, delay);
      continue;
    }

    if (beat.action === "swap_asset") {
      appendAssetSwap(beat.targetSlot, beat.targetAssetId, delay);
      continue;
    }

    if (beat.action === "focus_actor" || beat.action === "focus_asset") {
      appendFocusCut(beat.action, beat.targetSlot, beat.targetAssetId, delay);
      continue;
    }

    throw new Error(
      `${brief.id} uses unsupported authored beat transition ${beat.action}:${beat.targetSlot}.`,
    );
  }

  if (!sources.length) return undefined;
  return sources.every((source) => source === "aligned-words")
    ? "aligned-words"
    : sources[0];
}

function compileBrief(
  brief: SceneBrief,
  timing: SceneTiming,
  ctx: GrammarContext,
  fps: number,
  words: AlignedWord[] | undefined
): Scene {
  // FREEFORM: pass the authored Scene through, only enforcing id/timing.
  if (brief.visualGrammar === "FREEFORM" && brief.freeform && typeof brief.freeform === "object") {
    return {
      ...(brief.freeform as Scene),
      id: brief.id,
      startFrame: timing.startFrame,
      durationFrames: timing.frames,
      narration: brief.narration,
    };
  }

  const grammarFn = VISUAL_GRAMMARS[brief.visualGrammar];
  if (!grammarFn) {
    throw new Error(`Unknown or unsupported visual grammar "${brief.visualGrammar}" in ${brief.id}`);
  }
  const result = grammarFn(brief, ctx);
  applyShot(result, brief.shot);
  ensureImmediateFocal(result);
  const authoredTransitionTiming = applyAuthoredBeatTransitions(brief, result, timing, fps, words);
  // Layer beat-emphasis onto the focal entity at the aligned frame.
  const entities: SceneEntity[] = result.entities.map((e) => ({ ...e }));
  const focal = entities.find((e) => e.assetId === result.focusAssetId);
  let beatTimingSource: SceneBeatTimingSource = authoredTransitionTiming ?? (/[.!?]/.test(brief.narration)
    ? "sentence-boundary"
    : "source-range-proportional");
  if (focal && brief.beats && brief.beats.length) {
    // Use the single highest-importance beat for the focal pulse.
    const beat = [...brief.beats].sort((a, b) => b.importance - a.importance)[0];
    const resolvedBeat = resolveBeatOffset(beat.text, brief.narration, brief.id, timing.startFrame, timing.frames, fps, words);
    const offset = resolvedBeat.offset;
    beatTimingSource = resolvedBeat.source;
    const enterDelay = focal.enterDelay ?? 0;
    const emph = importanceToEmphasis(beat.importance);
    focal.emphasize = { animation: emph.animation, delay: Math.max(0, offset - enterDelay), duration: emph.duration };
  }

  // Per-sentence pose swaps (V4.3) — the narrator cat should re-pose on each
  // sentence instead of freezing. Only for a single-character narrator scene;
  // poses stay inside the scene's EMOTION register so a sad cat never suddenly
  // grins. Each swap re-enters the same assetId (sceneCompiler treats a repeat
  // assetId as an in-place pose change).
  const charEntities = entities.filter((e) => e.src.startsWith("characters/"));
  if (focal && charEntities.length === 1 && focal === charEntities[0]) {
    const cycle = POSE_CYCLE[brief.emotion ?? "neutral"] ?? [];
    if (cycle.length >= 2) {
      const sentences = brief.narration.split(/(?<=[.?!])\s+/).map((s) => s.trim()).filter((s) => s.length > 8);
      const swaps: SceneEntity[] = [];
      for (let si = 1; si < sentences.length; si++) {
        const offset = resolveBeatOffset(
          sentences[si], brief.narration, brief.id, timing.startFrame, timing.frames, fps, words
        ).offset;
        if (offset < 20 || offset > timing.frames - 20) continue;
        swaps.push({
          assetId: focal.assetId,
          src: cycle[si % cycle.length],
          slot: focal.slot, position: focal.position, anchor: focal.anchor, scale: focal.scale,
          badge: focal.badge, enterAnimation: "none", enterDelay: offset,
          clearPrevious: [focal.assetId],
        });
      }
      entities.push(...swaps);
    }
  }

  return {
    id: brief.id,
    label: brief.purpose,
    startFrame: timing.startFrame,
    durationFrames: timing.frames,
    layout: result.layout,
    entranceStyle: selectEntranceStyle({
      requested: brief.entranceStyle,
      grammar: brief.visualGrammar,
      emotion: brief.emotion,
      heroVisual: brief.heroVisual,
      visualRegister: brief.visualRegister,
    }),
    narration: brief.narration,
    sourceRange: brief.sourceRange,
    visualRegister: brief.visualRegister,
    visualGrammar: brief.visualGrammar,
    beatTimingSource,
    semanticTakeaway: brief.semanticVisual?.takeaway,
    semanticAction: brief.semanticVisual?.action,
    semanticObject: brief.semanticVisual?.object,
    semanticRelation: brief.semanticVisual?.relation,
    semanticSetting: brief.semanticVisual?.setting,
    photoTreatment: brief.photoTreatment,
    assetResolutionNotes: brief.assetResolutionNotes,
    // Record what the compiler actually put on screen. Authored role tokens and
    // stage anchors are not assets; conversely, component grammars may render a
    // deliberate built-in character without an authored asset request.
    semanticAssetIds: [...new Set([
      ...entities.map((entity) => entity.src),
      ...(result.cards ?? []).map((card) => card.iconSrc).filter((src): src is string => !!src),
      ...(result.frameBoxes ?? []).map((box) => box.contentSrc).filter(Boolean),
      ...(!/^#|^rgba?\(|gradient\(/i.test(result.backgroundSrc ?? "") && result.backgroundSrc
        ? [result.backgroundSrc] : []),
    ])],
    sectionId: brief.sectionId,
    claimIds: brief.claimIds,
    captionTreatment: brief.captionTreatment,
    evidenceTreatment: brief.evidenceTreatment,
    heroVisual: brief.heroVisual,
    focalType: brief.focalType,
    characterRequired: brief.characterRequired,
    visualFingerprint: compositionFingerprint(result, brief),
    silentFrameTakeaway: brief.silentFrameTakeaway,
    focalOccupancyTarget: brief.focalOccupancyTarget
      ?? DEFAULT_FOCAL_OCCUPANCY[brief.visualGrammar]
      ?? 0.25,
    noveltyFromPrevious: brief.noveltyFromPrevious,
    unresolvedAssets: brief.unresolvedAssetRequests,
    subtitleCues: buildSubtitleCues(brief, timing, words, fps),
    backgroundSrc: result.backgroundSrc,
    clearPrevious: true,
    entities,
    texts: result.texts,
    speechBubbles: result.speechBubbles,
    paperCards: result.paperCards,
    cards: result.cards,
    frameBoxes: result.frameBoxes,
  };
}

// No-repeat stage enforcement: every TABLEAU in a video must use a DISTINCT
// stage set (user rule: tuyệt đối không lặp stage). If a stage was already used,
// reassign the scene to an unused stage and remap its anchors; if the whole
// pool is exhausted, drop the stage (character falls back onto a tint) rather
// than repeat. All stages from STAGE_ANCHORS participate — including any added
// on-demand via the gen-stage skill.
function enforceDistinctStages(scenes: Scene[]): void {
  const pool = Object.keys(STAGE_ANCHORS);
  const uses = new Map<string, number>();
  let previous = "";
  for (const s of scenes) {
    const bg = s.backgroundSrc ?? "";
    if (!STAGE_ANCHORS[bg]) continue; // not a stage
    let selected = bg;
    if ((uses.get(bg) ?? 0) > 0) {
      selected = pool.find((candidate) => !uses.has(candidate)) ?? bg;
      if (selected === previous) {
        selected = pool
          .filter((candidate) => candidate !== previous)
          .sort((a, b) => (uses.get(a) ?? 0) - (uses.get(b) ?? 0))[0] ?? bg;
      }
    }
    uses.set(selected, (uses.get(selected) ?? 0) + 1);
    previous = selected;
    if (selected === bg) continue;
    const newAnchors = Object.keys(STAGE_ANCHORS[selected]);
    s.backgroundSrc = selected;
    // The stage reassignment changes the rendered composition. Keep the
    // fingerprint truthful instead of retaining the pre-enforcement stage.
    const fingerprint = String(s.visualFingerprint ?? "").split("|");
    if (fingerprint.length >= 3) {
      fingerprint[2] = `stage:${selected.split("/").pop()?.replace(/\.[^.]+$/, "")}`;
      s.visualFingerprint = fingerprint.join("|");
    }
    let ai = 0;
    for (const e of s.entities) {
      if (e.anchor) {
        e.anchor = newAnchors[Math.min(ai, newAnchors.length - 1)];
        ai++;
      }
    }
  }
}

export function compileStoryboard(sb: Storyboard, opts: CompileStoryboardOpts = {}): SceneTimeline {
  const fps = sb.fps || 30;
  const fpw = opts.fallbackFramesPerWord ?? 8;
  const timingById = new Map((opts.durations ?? []).map((d) => [d.id, d]));
  const alignedTimingById = buildAlignedSceneTimings(sb, opts.words, fps);

  // Build per-scene timing, recording WHICH source set each boundary. The source
  // is the thing production cares about: measured audio vs a guess.
  let cursor = 0;
  const sources: SceneTimingSource[] = [];
  const timings: SceneTiming[] = sb.scenes.map((brief) => {
    const measured = timingById.get(brief.id);
    if (measured) {
      sources.push("durations");
      cursor = measured.startFrame + measured.frames;
      return measured;
    }
    const aligned = alignedTimingById.get(brief.id);
    if (aligned) {
      sources.push("aligned-words");
      cursor = aligned.startFrame + aligned.frames;
      return aligned;
    }
    sources.push("estimated");
    const wordCount = brief.narration.trim().split(/\s+/).length;
    const frames = Math.max(90, wordCount * fpw);
    const t = { id: brief.id, startFrame: cursor, frames };
    cursor += frames;
    return t;
  });

  // `durations` supplies absolute start frames from the TTS concat; aligned words
  // supply them from whisper. Two systems of absolute frames cannot be
  // interleaved — the boundary between them gaps or overlaps while per-scene
  // numbers each look fine. (Supplying `words` *alongside* `durations` is normal:
  // durations set boundaries, words anchor beats. That is not this case.)
  const measuredSources = [...new Set(sources.filter((s) => s !== "estimated"))];
  if (measuredSources.length > 1) {
    throw new Error(
      `Mixed scene-boundary timing sources (${measuredSources.join(" + ")}). ` +
      `A video must take every scene boundary from one source.`
    );
  }

  const estimatedIds = sb.scenes.filter((_, i) => sources[i] === "estimated").map((s) => s.id);
  if (estimatedIds.length && !opts.allowEstimatedTiming) {
    const shown = estimatedIds.slice(0, 3).join(", ");
    throw new Error(
      `${estimatedIds.length}/${sb.scenes.length} scenes have no measured audio timing ` +
      `(${shown}${estimatedIds.length > 3 ? `, … (+${estimatedIds.length - 3})` : ""}). ` +
      `Compiling from word-count estimates desyncs the video against the voice track. ` +
      `Run TTS first, or pass allowEstimatedTiming for a diagnostic/preview build.`
    );
  }

  // Strict on every route. Non-strict compiling substituted a generic cat or
  // icon for a missing semantic asset, so an under-authored storyboard still
  // produced a plausible-looking timeline instead of an error.
  const ctx: GrammarContext = { cast: sb.cast, index: 0, strict: true };
  const scenes: Scene[] = sb.scenes.map((brief, i) =>
    compileBrief(brief, timings[i], { ...ctx, index: i }, fps, opts.words)
  );

  // Legacy schema v1 keeps only its stage de-duplication compatibility pass.
  // Plain white is never rewritten: authored background intent survives compile.
  if (sb.schemaVersion !== 2) {
    enforceDistinctStages(scenes);
  }

  // Max end, not the last array element: reordering scenes after TTS would
  // otherwise yield a plausible total while every scene sits at its old
  // absolute start frame.
  const totalFrames = scenes.reduce((max, s) => Math.max(max, s.startFrame + s.durationFrames), 0);
  const beatTimingSummary = scenes.reduce<Partial<Record<SceneBeatTimingSource, number>>>((summary, scene) => {
    const source = scene.beatTimingSource ?? "source-range-proportional";
    summary[source] = (summary[source] ?? 0) + 1;
    return summary;
  }, {});

  // Structural invariants enforced in the engine, not left to whoever remembers
  // to run the quality gate.
  const structural = checkCompiledTimings(
    scenes.map((s) => ({ id: s.id, startFrame: s.startFrame, frames: s.durationFrames })),
    sb.scenes.map((brief) => brief.id),
    totalFrames,
  );
  if (hasBlocker(structural)) {
    throw new Error(`Compiled scene timing is inconsistent:\n${formatTimingIssues(structural)}`);
  }

  // Record how this timeline was timed, in the artifact itself, so no downstream
  // consumer has to guess whether the numbers came from audio or from a word count.
  const sceneTimingSource: SceneTimingSource = estimatedIds.length
    ? "estimated"
    : (measuredSources[0] ?? "estimated");
  const timingProvenance: TimingProvenance = {
    mode: estimatedIds.length ? "estimated" : "measured",
    sceneTimingSource,
    // This field describes the branch actually used by scene beats, not merely
    // whether words.json exists. A transcript-aligned file with no authored
    // beats must not advertise word-anchored timing.
    beatTimingSource: Object.keys(beatTimingSummary).length > 0 &&
      Object.keys(beatTimingSummary).every((source) => source === "aligned-words")
      ? "aligned-words"
      : "proportional",
    beatTimingSummary,
    measuredSceneCount: sb.scenes.length - estimatedIds.length,
    ...opts.provenance,
  };

  // SceneTimeline pins fps/width/height to literal types (30/1920/1080); this
  // project only ever renders at that spec, so assert rather than widen.
  return {
    schemaVersion: sb.schemaVersion ?? 1,
    fps: 30,
    width: 1920,
    height: 1080,
    durationInFrames: totalFrames,
    audio: sb.audio,
    background: opts.background ?? "#FAFAF8",
    timingProvenance,
    visualTreatmentPlan: sb.visualTreatmentPlan,
    scenes,
  } as SceneTimeline;
}
