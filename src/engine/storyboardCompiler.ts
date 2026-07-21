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

import { Scene, SceneTimeline, SceneEntity } from "../types/scene";
import { Storyboard, SceneBrief, AlignedWord } from "../types/storyboard";
import { VISUAL_GRAMMARS, applyShot, GrammarContext } from "./visualGrammars";

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
): number {
  const firstWord = beatText.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  if (words && firstWord) {
    // Search words that fall within this scene's frame window.
    const startSec = sceneStartFrame / fps;
    const endSec = (sceneStartFrame + sceneFrames) / fps;
    for (const w of words) {
      if (w.startSec < startSec - 0.05 || w.startSec > endSec) continue;
      if (w.word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "") === firstWord) {
        return Math.max(0, Math.round(w.startSec * fps) - sceneStartFrame);
      }
    }
  }
  // Fallback: proportional by character position in the narration.
  const idx = narration.toLowerCase().indexOf(beatText.trim().toLowerCase());
  const frac = idx >= 0 && narration.length > 0 ? idx / narration.length : 0.4;
  return Math.round(frac * sceneFrames);
}

function importanceToEmphasis(imp: number): { animation: "pulse" | "shake" | "bounce"; duration: number; value?: number } {
  if (imp >= 0.85) return { animation: "shake", duration: 24 };
  if (imp >= 0.6) return { animation: "pulse", duration: 22 };
  return { animation: "bounce", duration: 20 };
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

  const grammarFn = VISUAL_GRAMMARS[brief.visualGrammar] ?? VISUAL_GRAMMARS.SOLO;
  const result = grammarFn(brief, ctx);
  applyShot(result, brief.shot);

  // Layer beat-emphasis onto the focal entity at the aligned frame.
  const entities: SceneEntity[] = result.entities.map((e) => ({ ...e }));
  const focal = entities.find((e) => e.assetId === result.focusAssetId);
  if (focal && brief.beats && brief.beats.length) {
    // Use the single highest-importance beat for the focal pulse.
    const beat = [...brief.beats].sort((a, b) => b.importance - a.importance)[0];
    const offset = resolveBeatOffset(beat.text, brief.narration, timing.startFrame, timing.frames, fps, words);
    const enterDelay = focal.enterDelay ?? 0;
    const emph = importanceToEmphasis(beat.importance);
    focal.emphasize = { animation: emph.animation, delay: Math.max(0, offset - enterDelay), duration: emph.duration };
  }

  return {
    id: brief.id,
    label: brief.purpose,
    startFrame: timing.startFrame,
    durationFrames: timing.frames,
    layout: result.layout,
    narration: brief.narration,
    backgroundSrc: result.backgroundSrc,
    clearPrevious: true,
    entities,
    texts: result.texts,
    speechBubbles: result.speechBubbles,
    paperCards: result.paperCards,
  };
}

export function compileStoryboard(sb: Storyboard, opts: CompileStoryboardOpts = {}): SceneTimeline {
  const fps = sb.fps || 30;
  const fpw = opts.fallbackFramesPerWord ?? 8;
  const timingById = new Map((opts.durations ?? []).map((d) => [d.id, d]));

  // Build per-scene timing: prefer TTS durations; else estimate from word count.
  let cursor = 0;
  const timings: SceneTiming[] = sb.scenes.map((brief) => {
    const known = timingById.get(brief.id);
    if (known) {
      cursor = known.startFrame + known.frames;
      return known;
    }
    const wordCount = brief.narration.trim().split(/\s+/).length;
    const frames = Math.max(90, wordCount * fpw);
    const t = { id: brief.id, startFrame: cursor, frames };
    cursor += frames;
    return t;
  });

  const ctx: GrammarContext = { cast: sb.cast, index: 0 };
  const scenes: Scene[] = sb.scenes.map((brief, i) =>
    compileBrief(brief, timings[i], { ...ctx, index: i }, fps, opts.words)
  );

  const totalFrames = scenes.length ? scenes[scenes.length - 1].startFrame + scenes[scenes.length - 1].durationFrames : 0;

  // SceneTimeline pins fps/width/height to literal types (30/1920/1080); this
  // project only ever renders at that spec, so assert rather than widen.
  return {
    fps: 30,
    width: 1920,
    height: 1080,
    durationInFrames: totalFrames,
    audio: sb.audio,
    background: opts.background ?? "#FAFAF8",
    scenes,
  } as SceneTimeline;
}
