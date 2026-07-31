import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { CardState } from "../engine/timelineEngine";
import { resolveAssetSrc } from "../engine/assetPaths";
import { fitTextToBox } from "../engine/textLayout";

interface Props {
  card: CardState;
  canvasWidth: number;
  canvasHeight: number;
  staticFile: (path: string) => string;
}

export const ConceptCard: React.FC<Props> = ({
  card,
  canvasWidth,
  canvasHeight,
  staticFile,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const progress = spring({
    frame: frame - card.enterFrame,
    fps,
    config: { damping: 12, stiffness: 180 },
  });

  const x = card.position.x * canvasWidth;
  const y = card.position.y * canvasHeight;
  const w = card.width * card.scale;
  const h = card.height * card.scale;
  const iconPath = card.iconSrc ? resolveAssetSrc(card.iconSrc) : "";
  const labelFit = card.label
    ? fitTextToBox(card.label, Math.min(52, w * 0.1), 24, w - 44,
        h * (card.iconSrc ? 0.30 : 0.72), card.iconSrc ? 3 : 5)
    : undefined;

  return (
    <div
      style={{
        position: "absolute",
        left: x - w / 2,
        top: y - h / 2,
        width: w,
        height: h,
        transform: `scale(${progress})`,
        transformOrigin: "center center",
        zIndex: 10,
      }}
    >
      {/* Card border (dark gray, hand-drawn feel) */}
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 20,
          background: "#3A3A3A",
          border: "4px solid #1a1a1a",
          padding: 8,
          boxSizing: "border-box",
          boxShadow: "6px 6px 0px #1a1a1a",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Colored inner area */}
        <div
          style={{
            width: "100%",
            height: "100%",
            borderRadius: 14,
            background: card.background,
            display: "flex",
            flexDirection: "column",
            alignItems: card.iconSrc && !card.label ? "flex-start" : "center",
            justifyContent: "center",
            gap: 8,
            paddingLeft: card.iconSrc && !card.label ? 54 : 0,
            boxSizing: "border-box",
          }}
        >
          {/* Icon */}
          {card.iconSrc && (
            <img
              src={staticFile(iconPath)}
              style={{
                width: h * (card.label ? 0.45 : 0.36),
                height: h * (card.label ? 0.45 : 0.36),
                objectFit: "contain",
              }}
            />
          )}
          {/* Label */}
          {card.label && (
            <div
              style={{
                fontSize: labelFit?.fontSize ?? w * 0.1,
                fontWeight: 800,
                color: "white",
                fontFamily: "'Segoe UI', Arial, sans-serif",
                textShadow: "2px 2px 0 rgba(0,0,0,0.3)",
                textAlign: "center",
                padding: "0 10px",
                letterSpacing: 0.3,
                lineHeight: 1.18,
                overflow: "hidden",
              }}
            >
              {labelFit?.lines.map((line, index) => (
                <React.Fragment key={line + index}>{index > 0 && <br />}{line}</React.Fragment>
              )) ?? card.label}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
