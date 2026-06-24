import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { TransitionState } from "../engine/timelineEngine";

interface Props {
  transition: TransitionState;
  width: number;
  height: number;
}

export const TransitionOverlay: React.FC<Props> = ({ transition, width, height }) => {
  const frame = useCurrentFrame();
  const progress = Math.min(1, (frame - transition.startFrame) / transition.duration);

  // Flash: peak white at midpoint, fade out
  const flashOpacity = progress < 0.5
    ? interpolate(progress, [0, 0.5], [0, 1])
    : interpolate(progress, [0.5, 1], [1, 0]);

  const style: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    width,
    height,
    pointerEvents: "none",
    zIndex: 9999,
  };

  if (transition.style === "flash") {
    return (
      <div style={{ ...style, background: "white", opacity: flashOpacity }} />
    );
  }

  if (transition.style === "fadeBlack") {
    return (
      <div style={{ ...style, background: "black", opacity: flashOpacity }} />
    );
  }

  if (transition.style === "fadeWhite") {
    return (
      <div style={{ ...style, background: "white", opacity: flashOpacity }} />
    );
  }

  if (transition.style === "wipe") {
    const wipeX = interpolate(progress, [0, 0.5], [0, width], { extrapolateRight: "clamp" });
    const revealX = interpolate(progress, [0.5, 1], [0, width], { extrapolateLeft: "clamp" });
    return (
      <div style={{ ...style, overflow: "hidden" }}>
        {/* Yellow flash stripe sweeping across */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: wipeX - 80,
            width: 80,
            height,
            background: "linear-gradient(90deg, transparent, #FFE500, #00E5FF, transparent)",
            opacity: progress < 0.5 ? 1 : interpolate(progress, [0.5, 1], [1, 0]),
          }}
        />
      </div>
    );
  }

  if (transition.style === "zoom") {
    const scale = progress < 0.5
      ? interpolate(progress, [0, 0.5], [1, 1.3])
      : interpolate(progress, [0.5, 1], [0.7, 1]);
    return (
      <div
        style={{
          ...style,
          background: "black",
          opacity: flashOpacity * 0.7,
          transform: `scale(${scale})`,
        }}
      />
    );
  }

  return null;
};
