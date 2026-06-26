import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { FrameBoxState } from "../engine/timelineEngine";

interface Props {
  frameBox: FrameBoxState;
  canvasWidth: number;
  canvasHeight: number;
  staticFile: (path: string) => string;
}

// Hand-drawn TV/monitor frame containing a data image (map, chart).
// Matches the real channel's TV-with-world-map shot (t700s).
export const FrameBox: React.FC<Props> = ({
  frameBox,
  canvasWidth,
  canvasHeight,
  staticFile,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const progress = spring({
    frame: frame - frameBox.enterFrame,
    fps,
    config: { damping: 14, stiffness: 160 },
  });

  const x = frameBox.position.x * canvasWidth;
  const y = frameBox.position.y * canvasHeight;
  const w = frameBox.width * frameBox.scale;
  const h = w * 0.62; // monitor aspect

  // Resolve content image: hex/css stays, otherwise treat as public/ path
  const src =
    frameBox.contentSrc.startsWith("#") || frameBox.contentSrc.startsWith("rgb")
      ? frameBox.contentSrc
      : staticFile(frameBox.contentSrc);

  return (
    <div
      style={{
        position: "absolute",
        left: x - w / 2,
        top: y - h / 2,
        width: w,
        transform: `scale(${progress})`,
        transformOrigin: "center center",
        zIndex: 11,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      {/* TV body */}
      <div
        style={{
          width: "100%",
          height: h,
          background: "#2B2B2B",
          border: "10px solid #1a1a1a",
          borderRadius: 24,
          padding: 22,
          boxSizing: "border-box",
          boxShadow: "10px 12px 0 rgba(0,0,0,0.25)",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            background: "#FFFFFF",
            borderRadius: 10,
            overflow: "hidden",
          }}
        >
          <img
            src={src}
            style={{ width: "100%", height: "100%", objectFit: "contain", background: "#FFFFFF" }}
          />
        </div>
      </div>
      {/* Stand */}
      <div style={{ width: w * 0.18, height: h * 0.16, background: "#1a1a1a" }} />
      <div style={{ width: w * 0.42, height: h * 0.05, background: "#1a1a1a", borderRadius: 6 }} />

      {frameBox.caption && (
        <div
          style={{
            marginTop: 18,
            fontSize: w * 0.032,
            fontWeight: 700,
            color: "#1a1a1a",
            fontFamily: "'Segoe UI', Arial, sans-serif",
            textAlign: "center",
          }}
        >
          {frameBox.caption}
        </div>
      )}
    </div>
  );
};
