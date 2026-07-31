import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { FrameBoxState } from "../engine/timelineEngine";
import { getPaletteSaturationScale, resolveAssetSrc } from "../engine/assetPaths";

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

  const entranceProgress = spring({
    frame: frame - frameBox.enterFrame,
    fps,
    config: { damping: 14, stiffness: 160 },
  });
  // A FrameBox is the evidence focal, so the scene must never open on only
  // its blurred/dimmed background while the monitor scales up from zero.
  const progress = Math.max(0.82, entranceProgress);

  const x = frameBox.position.x * canvasWidth;
  const y = frameBox.position.y * canvasHeight;
  const w = frameBox.width * frameBox.scale;
  const h = w * 0.62; // monitor aspect

  // A hex/rgb content = a "screen panel" (no real image) → show the caption
  // large ON the screen. Otherwise it's an image path to display.
  const isColor = frameBox.contentSrc.startsWith("#") || frameBox.contentSrc.startsWith("rgb");
  const src = isColor ? frameBox.contentSrc : staticFile(resolveAssetSrc(frameBox.contentSrc));
  const saturationScale = isColor ? 1 : getPaletteSaturationScale(frameBox.contentSrc);
  const contentAge = Math.max(0, frame - frameBox.enterFrame);
  const panPhase = Math.min(1, contentAge / (fps * 10));
  const focusPhase = Math.floor(contentAge / (fps * 4)) % 3;
  const focusX = focusPhase === 0 ? 0 : focusPhase === 1 ? -76 : 76;
  const focusScale = focusPhase === 0 ? 1 : focusPhase === 1 ? 1.04 : 0.96;
  const photoScale = 1 + panPhase * 0.24;
  const photoX = 38 + panPhase * 24;

  return (
    <div
      style={{
        position: "absolute",
        left: x - w / 2,
        top: y - h / 2,
        width: w,
        transform: `translateX(${focusX}px) scale(${progress * focusScale})`,
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
            background: isColor ? src : "#FFFFFF",
            borderRadius: 10,
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: isColor ? "6% 8%" : 0,
            boxSizing: "border-box",
          }}
        >
          {isColor ? (
            frameBox.caption && (
              <div
                style={{
                  color: "#FFFFFF",
                  fontSize: w * 0.06,
                  fontWeight: 800,
                  textAlign: "center",
                  lineHeight: 1.2,
                  fontFamily: "'Segoe UI', 'Arial Rounded MT Bold', sans-serif",
                  textShadow: "0 2px 10px rgba(0,0,0,0.4)",
                }}
              >
                {frameBox.caption}
              </div>
            )
          ) : (
            <img src={src} style={{
              width: "100%", height: "100%", objectFit: frameBox.objectFit, background: "#FFFFFF",
              transform: `scale(${photoScale})`, transformOrigin: `${photoX}% 50%`,
              filter: `saturate(${saturationScale}) contrast(0.98)`,
            }} />
          )}
        </div>
      </div>
      {/* Stand */}
      <div style={{ width: w * 0.18, height: h * 0.16, background: "#1a1a1a" }} />
      <div style={{ width: w * 0.42, height: h * 0.05, background: "#1a1a1a", borderRadius: 6 }} />

      {/* Caption below only for real-image screens (color screens caption inside) */}
      {frameBox.caption && !isColor && (
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
      {frameBox.source && (
        <div
          style={{
            marginTop: 8,
            fontSize: w * 0.02,
            fontWeight: 600,
            color: "#5A5A5A",
            fontFamily: "'Segoe UI', Arial, sans-serif",
            textAlign: "center",
          }}
        >
          {frameBox.source}
        </div>
      )}
    </div>
  );
};
