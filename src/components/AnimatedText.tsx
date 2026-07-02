import React from "react";
import { interpolate, spring } from "remotion";
import { TextState } from "../engine/timelineEngine";

interface Props {
  text: TextState;
  currentFrame: number;
  fps: number;
  canvasWidth: number;
  canvasHeight: number;
}

const SPRING_CFG = { damping: 16, mass: 0.7, stiffness: 150, overshootClamping: false };

export const AnimatedText: React.FC<Props> = ({
  text,
  currentFrame,
  fps,
  canvasWidth,
  canvasHeight,
}) => {
  const localFrame = currentFrame - text.enterFrame;

  // Style defaults per text style
  const style = text.style ?? "BODY";

  const defaults: Record<string, { fontSize: number; color: string; fontWeight: number }> = {
    TITLE:   { fontSize: 72,  color: "#1a1a2e", fontWeight: 800 },
    STAT:    { fontSize: 120, color: "#EB5757", fontWeight: 900 },
    CALLOUT: { fontSize: 44,  color: "#ffffff", fontWeight: 700 },
    SECTION: { fontSize: 54,  color: "#2D3748", fontWeight: 700 },
    BODY:    { fontSize: 44,  color: "#1a1a1a", fontWeight: 600 },
    CAPTION: { fontSize: 30,  color: "#888888", fontWeight: 500 },
    SUBTITLE:{ fontSize: 40,  color: "#FFFFFF", fontWeight: 600 },
  };

  const d = defaults[style];
  const fontSize = text.fontSize ?? d.fontSize;
  const color = text.color ?? d.color;
  const fontWeight = text.fontWeight ?? d.fontWeight;
  const align = text.align ?? "center";

  // Animation per style
  let opacity = 1;
  let scale = 1;
  let translateY = 0;
  let translateX = 0;

  if (style === "STAT") {
    // Dramatic scale-in for statistics
    const sp = spring({ frame: localFrame, fps, config: SPRING_CFG, durationInFrames: 18 });
    opacity = interpolate(localFrame, [0, 8], [0, 1], { extrapolateRight: "clamp" });
    scale = interpolate(sp, [0, 1], [0.4, 1]);
  } else if (style === "CALLOUT") {
    // Pop in from below
    const sp = spring({ frame: localFrame, fps, config: SPRING_CFG, durationInFrames: 14 });
    opacity = interpolate(localFrame, [0, 6], [0, 1], { extrapolateRight: "clamp" });
    translateY = interpolate(sp, [0, 1], [30, 0]);
  } else if (style === "SECTION") {
    // Slide up + fade
    opacity = interpolate(localFrame, [0, 12], [0, 1], { extrapolateRight: "clamp" });
    translateY = interpolate(localFrame, [0, 16], [24, 0], { extrapolateRight: "clamp" });
  } else if (style === "TITLE") {
    // Gentle fade up
    opacity = interpolate(localFrame, [0, 15], [0, 1], { extrapolateRight: "clamp" });
    translateY = interpolate(localFrame, [0, 20], [18, 0], { extrapolateRight: "clamp" });
  } else {
    // BODY / CAPTION: standard fade up
    const fadeDuration = style === "CAPTION" ? 10 : 12;
    opacity = interpolate(localFrame, [0, fadeDuration], [0, 1], { extrapolateRight: "clamp" });
    translateY = interpolate(localFrame, [0, fadeDuration * 1.5], [20, 0], { extrapolateRight: "clamp" });
  }

  const pixelX = text.position.x * canvasWidth;
  const pixelY = text.position.y * canvasHeight;

  // CALLOUT: pill with background
  if (style === "CALLOUT") {
    const bg = text.background ?? "#FF6B35";
    return (
      <div
        style={{
          position: "absolute",
          left: pixelX,
          top: pixelY,
          transform: `translate(-50%, -50%) translateY(${translateY}px) scale(${scale})`,
          opacity,
          zIndex: 60,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            background: bg,
            borderRadius: 40,
            padding: "14px 36px",
            fontSize,
            color,
            fontWeight,
            fontFamily: "'Segoe UI', 'Arial Rounded MT Bold', sans-serif",
            whiteSpace: "nowrap",
            boxShadow: "0 4px 20px rgba(0,0,0,0.18)",
            letterSpacing: "-0.5px",
          }}
        >
          {text.content}
        </div>
      </div>
    );
  }

  // STAT: massive number with accent glow
  if (style === "STAT") {
    return (
      <div
        style={{
          position: "absolute",
          left: pixelX,
          top: pixelY,
          transform: `translate(-50%, -50%) scale(${scale})`,
          opacity,
          fontSize,
          color,
          fontWeight,
          fontFamily: "'Segoe UI', 'Arial Rounded MT Bold', sans-serif",
          textAlign: "center",
          zIndex: 60,
          pointerEvents: "none",
          textShadow: `0 0 40px ${color}55, 0 4px 16px rgba(0,0,0,0.15)`,
          lineHeight: 1.1,
          letterSpacing: "-2px",
        }}
      >
        {text.content}
      </div>
    );
  }

  // SECTION: with decorative left accent bar
  if (style === "SECTION") {
    return (
      <div
        style={{
          position: "absolute",
          left: pixelX,
          top: pixelY,
          transform: `translate(-50%, -50%) translateY(${translateY}px)`,
          opacity,
          zIndex: 55,
          pointerEvents: "none",
          display: "flex",
          alignItems: "center",
          gap: 18,
        }}
      >
        <div
          style={{
            width: 6,
            height: fontSize * 1.2,
            background: "#FF6B35",
            borderRadius: 3,
            flexShrink: 0,
          }}
        />
        <div
          style={{
            fontSize,
            color,
            fontWeight,
            fontFamily: "'Segoe UI', 'Arial Rounded MT Bold', sans-serif",
            textAlign: "left",
            lineHeight: 1.25,
            maxWidth: canvasWidth * 0.7,
          }}
        >
          {text.content}
        </div>
      </div>
    );
  }

  // SUBTITLE: burned-in narration caption — dark translucent box, white text,
  // 2-line wrap at the very bottom. Matches the reference channel's signature look.
  if (style === "SUBTITLE") {
    return (
      <div
        style={{
          position: "absolute",
          left: pixelX,
          top: pixelY,
          transform: `translate(-50%, -50%)`,
          opacity,
          zIndex: 80,
          pointerEvents: "none",
          maxWidth: canvasWidth * 0.62,
          textAlign: "center",
        }}
      >
        <span
          style={{
            background: "rgba(30,30,30,0.78)",
            color,
            fontSize,
            fontWeight,
            fontFamily: "'Segoe UI', 'Arial Rounded MT Bold', sans-serif",
            lineHeight: 1.5,
            padding: "6px 14px",
            borderRadius: 6,
            boxDecorationBreak: "clone",
            WebkitBoxDecorationBreak: "clone",
          }}
        >
          {text.content}
        </span>
      </div>
    );
  }

  // TITLE, BODY, CAPTION: standard render
  const shadowMap: Record<string, string> = {
    TITLE:   "0 3px 16px rgba(0,0,0,0.10)",
    BODY:    "0 2px 8px rgba(0,0,0,0.06)",
    CAPTION: "none",
  };

  return (
    <div
      style={{
        position: "absolute",
        left: pixelX,
        top: pixelY,
        transform: `translate(-50%, -50%) translateY(${translateY}px) translateX(${translateX}px) scale(${scale})`,
        opacity,
        fontSize,
        color,
        fontWeight,
        fontFamily: "'Segoe UI', 'Arial Rounded MT Bold', sans-serif",
        textAlign: align,
        maxWidth: canvasWidth * (style === "TITLE" ? 0.75 : 0.72),
        lineHeight: 1.3,
        zIndex: style === "TITLE" ? 70 : 50,
        pointerEvents: "none",
        textShadow: shadowMap[style] ?? "0 2px 8px rgba(0,0,0,0.06)",
        letterSpacing: style === "TITLE" ? "-1px" : "normal",
      }}
    >
      {text.content}
    </div>
  );
};
