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
import { VISUAL_GRAMMARS, applyShot, GrammarContext } from "./visualGrammars";
import { STAGE_ANCHORS } from "./stageAnchors";
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
  sceneStartFrame: number,
  sceneFrames: number,
  fps: number,
  words: AlignedWord[] | undefined
): { offset: number; source: SceneBeatTimingSource } {
  const firstWord = beatText.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  if (words && firstWord) {
    // Search words that fall within this scene's frame window.
    const startSec = sceneStartFrame / fps;
    const endSec = (sceneStartFrame + sceneFrames) / fps;
    for (const w of words) {
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

// Per-emotion pose cycle for sentence-level re-posing. Only registers with ≥2
// poses swap; sad/surprise/urgent keep a single pose to preserve the emotion.
const POSE_CYCLE: Record<string, string[]> = {
  neutral:   ["characters/cat_explain", "characters/cat_talk"],
  curious:   ["characters/cat_think", "characters/cat_talk"],
  sarcastic: ["characters/cat_explain", "characters/cat_talk"],
  happy:     ["characters/cat_happy", "characters/cat_talk"],
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
  if (!brief.sourceRange || !words?.some((word) => Number.isInteger(word.wordIndex))) return undefined;
  const aligned = words.filter((word) =>
    Number.isInteger(word.wordIndex) &&
    word.wordIndex! >= brief.sourceRange!.startWord &&
    word.wordIndex! <= brief.sourceRange!.endWord
  );
  if (aligned.length === 0) return undefined;
  const narrationWords = brief.narration.replace(/\s+/g, " ").trim().split(/\s+/);
  const cues: Array<{ text: string; startFrame: number; endFrame: number }> = [];
  for (let offset = 0; offset < narrationWords.length; offset += 9) {
    const chunk = narrationWords.slice(offset, offset + 9);
    const first = aligned[Math.min(offset, aligned.length - 1)];
    const last = aligned[Math.min(offset + chunk.length - 1, aligned.length - 1)];
    cues.push({
      text: chunk.join(" "),
      startFrame: Math.max(0, Math.round(first.startSec * fps) - timing.startFrame),
      endFrame: Math.min(timing.frames, Math.max(1, Math.round(last.endSec * fps) - timing.startFrame)),
    });
  }
  return cues;
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
  if (timing.frames >= fps * 8 && result.cards?.length) {
    if (result.cards.length > 1) {
      result.cards.forEach((card, index) => {
        card.delay = index === 0
          ? Math.min(card.delay ?? 8, 12)
          : Math.min(timing.frames - 45, index * fps * 4);
      });
    } else if (brief.visualGrammar === "SOLO") {
      result.cards[0].delay = Math.min(timing.frames - 45, fps * 4);
    }
  }

  // Layer beat-emphasis onto the focal entity at the aligned frame.
  const entities: SceneEntity[] = result.entities.map((e) => ({ ...e }));
  const focal = entities.find((e) => e.assetId === result.focusAssetId);
  let beatTimingSource: SceneBeatTimingSource = /[.!?]/.test(brief.narration)
    ? "sentence-boundary"
    : "source-range-proportional";
  if (focal && brief.beats && brief.beats.length) {
    // Use the single highest-importance beat for the focal pulse.
    const beat = [...brief.beats].sort((a, b) => b.importance - a.importance)[0];
    const resolvedBeat = resolveBeatOffset(beat.text, brief.narration, timing.startFrame, timing.frames, fps, words);
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
  if (!ctx.strict && focal && charEntities.length === 1 && focal === charEntities[0]) {
    const cycle = POSE_CYCLE[brief.emotion ?? "neutral"] ?? [];
    if (cycle.length >= 2) {
      const sentences = brief.narration.split(/(?<=[.?!])\s+/).map((s) => s.trim()).filter((s) => s.length > 8);
      const swaps: SceneEntity[] = [];
      for (let si = 1; si < sentences.length; si++) {
        const offset = resolveBeatOffset(
          sentences[si], brief.narration, timing.startFrame, timing.frames, fps, words
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
    narration: brief.narration,
    sourceRange: brief.sourceRange,
    visualRegister: brief.visualRegister,
    visualGrammar: brief.visualGrammar,
    beatTimingSource,
    semanticTakeaway: brief.semanticVisual?.takeaway,
    semanticAction: brief.semanticVisual?.action,
    semanticSetting: brief.semanticVisual?.setting,
    semanticAssetIds: Object.values(brief.resolvedAssets ?? {}),
    claimIds: brief.claimIds,
    heroVisual: brief.heroVisual,
    focalType: brief.focalType,
    characterRequired: brief.characterRequired,
    visualFingerprint: brief.visualFingerprint,
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

// Soft, high-luminance tints (dark text + orange cat both stay legible). No two
// are close, so rotating them makes consecutive "talking" scenes visibly differ
// instead of a stack of identical white voids — the #1 scale defect.
const SOFT_BGS = [
  "#FBF3E9", // cream
  "#EAF2F8", // light blue
  "#F0F7EC", // light green
  "#FBEFF3", // light pink
  "#F4EFFA", // light lavender
  "#FEF6E7", // light amber
  "#EAF6F5", // light teal
  "#F3ECF7", // light violet
];

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
    let ai = 0;
    for (const e of s.entities) {
      if (e.anchor) {
        e.anchor = newAnchors[Math.min(ai, newAnchors.length - 1)];
        ai++;
      }
    }
  }
}

// Background-variety pass (fix a): plain-white grammar scenes get a rotating
// soft tint; illustrated stages, photos, BEAT images, and dark STAT_DRAMA
// gradients are left untouched. Applies to EVERY video via the storyboard route
// (which — unlike the classic generate path — never ran autoFixBackgrounds).
function enrichBackgrounds(scenes: Scene[]): void {
  let tint = 0;
  for (const s of scenes) {
    const bg = s.backgroundSrc ?? "";
    const isPlainWhite = bg === "" || bg === "#FFFFFF" || bg === "#FAFAF8";
    if (isPlainWhite) {
      s.backgroundSrc = SOFT_BGS[tint % SOFT_BGS.length];
      tint++;
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

  const ctx: GrammarContext = { cast: sb.cast, index: 0, strict: sb.schemaVersion === 2 };
  const scenes: Scene[] = sb.scenes.map((brief, i) =>
    compileBrief(brief, timings[i], { ...ctx, index: i }, fps, opts.words)
  );

  if (sb.schemaVersion !== 2) {
    enforceDistinctStages(scenes);
    enrichBackgrounds(scenes);
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
    beatTimingSource: opts.words?.some((w) => Number.isInteger(w.wordIndex))
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
    scenes,
  } as SceneTimeline;
}
