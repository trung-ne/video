import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { CardState } from "../engine/timelineEngine";
import { resolveAssetSrc } from "../engine/assetPaths";

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
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          {/* Icon */}
          {card.iconSrc && (
            <img
              src={staticFile(iconPath)}
              style={{
                width: h * 0.45,
                height: h * 0.45,
                objectFit: "contain",
              }}
            />
          )}
          {/* Label */}
          {card.label && (
            <div
              style={{
                fontSize: w * 0.1,
                fontWeight: 800,
                color: "white",
                fontFamily: "'Segoe UI', Arial, sans-serif",
                textShadow: "2px 2px 0 rgba(0,0,0,0.3)",
                textAlign: "center",
                padding: "0 10px",
                letterSpacing: 1,
              }}
            >
              {card.label}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
