import React from "react";
import { Composition } from "remotion";
import { CatExplainerVideo } from "./Video";
import { Timeline } from "./types/timeline";
import timelineJson from "../timeline.json";

const DEFAULT_TIMELINE: Timeline = timelineJson as unknown as Timeline;

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
