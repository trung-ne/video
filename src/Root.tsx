import React from "react";
import { Composition } from "remotion";
import { CatExplainerVideo } from "./Video";
import { EntranceAnimationDemo } from "./EntranceAnimationDemo";
import { Timeline } from "./types/timeline";
import { loadTimeline } from "./engine/loadTimeline";
import timelineJson from "../timeline.json";

// Preview goes through the SAME single compile point as scripts/render.ts.
// timeline.json is a SceneTimeline (`scenes[]`) — loadTimeline compiles it to
// events so Studio previews exactly what render produces. (No availablePoses in
// the browser — liveliness allows any pose there.)
const DEFAULT_TIMELINE: Timeline = loadTimeline(timelineJson).timeline;

// `npm start` renders whatever sits at the repo root, which is a scratch artifact
// and bypasses every production gate. Say so, so a preview here is never mistaken
// for the real build. Use `npm run preview:project -- --project <id>` for a project.
{
  const provenance = (timelineJson as { timingProvenance?: { mode?: string; sceneTimingSource?: string } })
    .timingProvenance;
  if (!provenance) {
    console.warn(
      "[preview] Root timeline.json carries no timing provenance — scratch artifact, not a production build."
    );
  } else if (provenance.mode !== "measured") {
    console.warn(`[preview] Root timeline.json timing is "${provenance.mode}" (${provenance.sceneTimingSource}).`);
  }
}

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="CatExplainer"
        component={CatExplainerVideo}
        durationInFrames={DEFAULT_TIMELINE.durationInFrames}
        fps={DEFAULT_TIMELINE.fps}
        width={DEFAULT_TIMELINE.width}
        height={DEFAULT_TIMELINE.height}
        defaultProps={{ timeline: DEFAULT_TIMELINE }}
        calculateMetadata={async ({ props }) => {
          const tl = props.timeline as Timeline;
          return {
            durationInFrames: tl.durationInFrames,
            fps: tl.fps,
            width: tl.width,
            height: tl.height,
          };
        }}
      />
      <Composition
        id="AnimationEntranceDemo"
        component={EntranceAnimationDemo}
        durationInFrames={450}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
