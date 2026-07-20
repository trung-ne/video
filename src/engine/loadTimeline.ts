import { compileScenes } from "./sceneCompiler";
import { injectLiveliness, LivelinessReport } from "./liveliness";
import { Timeline } from "../types/timeline";
import { SceneTimeline } from "../types/scene";

export interface LoadedTimeline {
  timeline: Timeline;
  liveliness: LivelinessReport;
}

/**
 * THE single entry point that turns whatever JSON is on disk into a renderable
 * event Timeline. This is the ONE place scenes → events compilation happens.
 *
 * The project has exactly one authored format — SceneTimeline (`scenes[]`).
 * Events are a transient render target, never persisted. Both the preview
 * (Root.tsx / Remotion Studio) and the CLI render (scripts/render.ts) call
 * this so the pipeline is a single consistent flow:
 *
 *     [AI gen / edit] → scenes.json → loadTimeline() → events → Remotion
 *
 * A raw events file (no `scenes`) is still accepted as-is for backward
 * compatibility, but nothing in the pipeline should be producing one anymore.
 *
 * @param raw            Parsed JSON — a SceneTimeline (has `scenes`) or a raw Timeline.
 * @param availablePoses Set of pose srcs known to exist on disk. Node callers
 *                       (render.ts) scan the asset dir and pass this so pose
 *                       swaps never reference a missing file. The browser
 *                       preview omits it (no fs) — liveliness then allows any pose.
 */
export function loadTimeline(raw: any, availablePoses?: Set<string>): LoadedTimeline {
  const timeline: Timeline =
    raw && Array.isArray(raw.scenes)
      ? compileScenes(raw as SceneTimeline)
      : (raw as Timeline);

  const liveliness = injectLiveliness(timeline, { availablePoses });
  return { timeline, liveliness };
}
