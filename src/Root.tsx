import React from "react";
import { Composition } from "remotion";
import { CatExplainerVideo } from "./Video";
import { Timeline } from "./types/timeline";
import { loadTimeline } from "./engine/loadTimeline";
import timelineJson from "../timeline.json";

// Preview goes through the SAME single compile point as scripts/render.ts.
// timeline.json is a SceneTimeline (`scenes[]`) — loadTimeline compiles it to
// events so Studio previews exactly what render produces. (No availablePoses in
// the browser — liveliness allows any pose there.)
const DEFAULT_TIMELINE: Timeline = loadTimeline(timelineJson).timeline;

export const RemotionRoot: React.FC = () => {
  return (
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
  );
};
