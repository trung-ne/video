import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { SpeechBubbleState } from "../engine/timelineEngine";
import { AssetState } from "../types/timeline";
import { fitTextToBox } from "../engine/textLayout";
import { getEnterAnimation } from "../animations";

interface Props {
  bubble: SpeechBubbleState;
  anchor: AssetState | undefined;
  canvasWidth: number;
  canvasHeight: number;
}

export const SpeechBubble: React.FC<Props> = ({
  bubble,
  anchor,
  canvasWidth,
  canvasHeight,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const entrance = getEnterAnimation(bubble.animation, frame - bubble.enterFrame, 18, fps);
  const bubbleAge = Math.max(0, frame - bubble.enterFrame);
  const focusPhase = Math.floor(bubbleAge / (fps * 4)) % 3;
  const focusOffset = focusPhase === 0 ? 0 : focusPhase === 1 ? -36 : 36;
  const focusX = focusPhase === 0 ? 0 : focusPhase === 1 ? -64 : 64;
  const focusRotate = focusPhase === 0 ? 0 : focusPhase === 1 ? -1.2 : 1.2;

  if (!anchor) return null;

  const anchorX = anchor.position.x * canvasWidth;
  const anchorY = anchor.position.y * canvasHeight;
  // Must match AnimatedAsset's BASE_ASSET_SIZE, or the bubble is offset from the
  // character it points at — this was left at the old 160 when assets moved to 200.
  const assetSize = 200 * anchor.scale;

  // Position bubble relative to anchor character
  const bubbleWidth = Math.min(canvasWidth * bubble.widthRatio, Math.max(420, bubble.text.length * (bubble.fontSize * 0.55) + 56));
  const textFit = fitTextToBox(bubble.text, bubble.fontSize, 28, bubbleWidth - 44, canvasHeight * 0.23, 3, 1.28);
  const bubbleHeight = Math.max(132, textFit.lines.length * textFit.fontSize * 1.28 + 52);

  let bubbleX = anchorX + assetSize * 0.3;
  let bubbleY = anchorY - assetSize * 0.6 - bubbleHeight;

  if (bubble.direction === "left") {
    bubbleX = anchorX - assetSize * 0.3 - bubbleWidth;
  } else if (bubble.direction === "top") {
    bubbleX = anchorX - bubbleWidth / 2;
    bubbleY = anchorY - assetSize * 0.8 - bubbleHeight;
  }
  bubbleX = Math.max(24, Math.min(canvasWidth - bubbleWidth - 24, bubbleX));
  bubbleY = Math.max(24, Math.min(canvasHeight * 0.72 - bubbleHeight, bubbleY));

  const isThought = bubble.style === "thought";

  return (
    <div
      style={{
        position: "absolute",
        left: bubbleX,
        top: bubbleY,
        width: bubbleWidth,
        transform: `translate(${focusX + entrance.translateX}px, ${focusOffset + entrance.translateY}px) rotate(${focusRotate}deg) scale(${entrance.scale})`,
        opacity: entrance.opacity,
        clipPath: entrance.clipPath,
        transformOrigin: bubble.direction === "left" ? "right bottom" : "left bottom",
        zIndex: 100,
      }}
    >
      {isThought ? (
        // Cloud-style thought bubble
        <div style={{ position: "relative" }}>
          <div
            style={{
              background: bubble.background,
              borderRadius: "50%",
              padding: "16px 20px",
              border: "3px solid #1a1a1a",
              fontSize: textFit.fontSize,
              color: bubble.textColor,
              fontFamily: "'Segoe UI', Arial, sans-serif",
              fontWeight: 600,
              lineHeight: 1.4,
              textAlign: "center",
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            }}
          >
            {textFit.lines.map((line, index) => <React.Fragment key={line + index}>{index > 0 && <br />}{line}</React.Fragment>)}
          </div>
          {/* Thought dots */}
          <div style={{
            position: "absolute",
            bottom: -12,
            left: bubble.direction === "left" ? "auto" : "20%",
            right: bubble.direction === "left" ? "20%" : "auto",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 3
          }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: bubble.background, border: "2px solid #1a1a1a" }} />
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: bubble.background, border: "2px solid #1a1a1a" }} />
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: bubble.background, border: "2px solid #1a1a1a" }} />
          </div>
        </div>
      ) : (
        // Speech bubble with tail
        <div style={{ position: "relative" }}>
          <div
            style={{
              background: bubble.background,
              borderRadius: 16,
              padding: "14px 18px",
              border: "3px solid #1a1a1a",
              fontSize: textFit.fontSize,
              color: bubble.textColor,
              fontFamily: "'Segoe UI', Arial, sans-serif",
              fontWeight: 600,
              lineHeight: 1.4,
              textAlign: "center",
              boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
            }}
          >
            {textFit.lines.map((line, index) => <React.Fragment key={line + index}>{index > 0 && <br />}{line}</React.Fragment>)}
          </div>
          {/* Tail */}
          <svg
            style={{
              position: "absolute",
              bottom: -18,
              left: bubble.direction === "left" ? "auto" : "20%",
              right: bubble.direction === "left" ? "20%" : "auto",
            }}
            width="28"
            height="20"
            viewBox="0 0 28 20"
          >
            <path
              d={bubble.direction === "left"
                ? "M28,0 L0,20 L18,0 Z"
                : "M0,0 L28,20 L10,0 Z"}
              fill={bubble.background}
              stroke="#1a1a1a"
              strokeWidth="3"
              strokeLinejoin="round"
            />
            <path
              d={bubble.direction === "left"
                ? "M28,0 L0,20 L18,0 Z"
                : "M0,0 L28,20 L10,0 Z"}
              fill={bubble.background}
            />
          </svg>
        </div>
      )}
    </div>
  );
};
