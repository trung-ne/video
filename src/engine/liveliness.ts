import { Timeline } from "../types/timeline";

// Liveliness is deliberately a verification seam now, not a source of motion.
// A previous version injected periodic moves, camera resets and a white overlay
// at the visual-audit cadence. Those transforms made a static scene score as if
// it changed while also breaking authored composition. Motion belongs to the
// storyboard compiler's explicit narration beats (swap/reveal/emphasize), where
// it has a semantic reason and can be reviewed before render.

export interface LivelinessOptions {
  availablePoses?: Set<string>;
  beatInterval?: number;
  minWindow?: number;
  fps?: number;
  sceneSpans?: Array<{ start: number; end: number; narrationBeatFrames?: number[] }>;
}

export interface LivelinessReport {
  emphasizesAdded: number;
  swapsAdded: number;
  movesAdded: number;
  cameraMovesAdded: number;
  backgroundBeatsAdded: number;
  charactersTouched: number;
}

/**
 * Preserve the authored event stream exactly. The compiler has already added
 * narration-anchored beats; this function remains idempotent for callers and
 * reports zero synthetic transforms explicitly for production evidence.
 */
export function injectLiveliness(_timeline: Timeline, _opts: LivelinessOptions = {}): LivelinessReport {
  return {
    emphasizesAdded: 0,
    swapsAdded: 0,
    movesAdded: 0,
    cameraMovesAdded: 0,
    backgroundBeatsAdded: 0,
    charactersTouched: 0,
  };
}

export function printLivelinessReport(report: LivelinessReport): void {
  console.log(
    "\n✨ Liveliness: no synthetic motion added; only storyboard-authored narration beats are rendered " +
    `(moves ${report.movesAdded}, background beats ${report.backgroundBeatsAdded}, camera ${report.cameraMovesAdded}).`,
  );
}
