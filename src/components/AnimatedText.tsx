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
    STAT:    { fontSize: 120, color: "#FF3B3B", fontWeight: 900 },
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

  // STAT: massive number with accent glow. This style is meant for a SHORT
  // number/phrase ("100 năm", "0.78") at fontSize 120 — a full sentence at
  // that size overflows the frame and covers whatever else is on screen (the
  // exact "assets đè lên nhau" defect). Long content auto-shrinks so it never
  // grows past ~85% of the canvas width regardless of what the AI wrote.
  if (style === "STAT") {
    const wordCount = text.content.trim().split(/\s+/).length;
    const statFontSize = wordCount > 6 ? fontSize * 0.4 : wordCount > 3 ? fontSize * 0.6 : fontSize;
    return (
      <div
        style={{
          position: "absolute",
          left: pixelX,
          top: pixelY,
          transform: `translate(-50%, -50%) scale(${scale})`,
          opacity,
          fontSize: statFontSize,
          color,
          fontWeight,
          fontFamily: "'Segoe UI', 'Arial Rounded MT Bold', sans-serif",
          textAlign: "center",
          zIndex: 60,
          pointerEvents: "none",
          maxWidth: canvasWidth * 0.85,
          // Glow is white-hot + colored, not a plain drop shadow — a dark
          // shadow does nothing on STAT_DRAMA's near-black gradient, where the
          // number needs to visually "burn" against the backdrop to read.
          textShadow: `0 0 50px ${color}, 0 0 90px ${color}88, 0 2px 4px rgba(0,0,0,0.4)`,
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
  // max 2-line wrap at the very bottom. Anchored by its BOTTOM edge so the
  // baseline never jumps when a chunk wraps to a second line.
  if (style === "SUBTITLE") {
    return (
      <div
        style={{
          position: "absolute",
          left: "50%",
          // Anchor the band by its BOTTOM edge so the baseline never jumps
          // when a chunk wraps from one line to two.
          bottom: canvasHeight - (text.position.y * canvasHeight + 40),
          transform: `translateX(-50%)`,
          opacity,
          zIndex: 80,
          pointerEvents: "none",
          // Wide enough to hold ~42 chars/line without wrapping to 3 lines,
          // narrow enough to stay clear of the frame edges (no clipped text).
          maxWidth: canvasWidth * 0.8,
          display: "flex",
          justifyContent: "center",
        }}
      >
        {/* Single continuous band (block, not inline) → one solid rectangle
            behind both lines instead of two mismatched per-line boxes. */}
        <div
          style={{
            // Solid near-black (not translucent) so the band stays legible even
            // on STAT_DRAMA's dark gradient backgrounds.
            background: "rgba(15,15,15,0.92)",
            boxShadow: "0 0 0 1px rgba(255,255,255,0.12)",
            // Hard-locked white: the band is always near-black, so any inherited
            // color (engine defaults, auto-color) would risk invisible captions.
            color: "#FFFFFF",
            fontSize,
            fontWeight,
            fontFamily: "'Segoe UI', 'Arial Rounded MT Bold', sans-serif",
            lineHeight: 1.35,
            padding: "10px 28px",
            borderRadius: 10,
            textAlign: "center",
            // Cap at 2 lines; extra content is ellipsised rather than
            // spilling into a third line or off-frame.
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            wordBreak: "normal",
            overflowWrap: "break-word",
          }}
        >
          {text.content}
        </div>
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
