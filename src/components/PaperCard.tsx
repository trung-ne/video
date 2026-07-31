import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { PaperCardState } from "../engine/timelineEngine";

interface Props {
  card: PaperCardState;
  canvasWidth: number;
  canvasHeight: number;
}

// Torn-paper document / survey card.
// variant "evidence": white paper, tilted, body text (a quote/document).
// variant "survey":   red title + question + checkbox choices.
export const PaperCard: React.FC<Props> = ({ card, canvasWidth, canvasHeight }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const entranceProgress = spring({
    frame: frame - card.enterFrame,
    fps,
    config: { damping: 14, stiffness: 160 },
  });
  // A paper card is the focal evidence, so it must already read as a card on
  // its first sampled beat. Starting from scale 0 made white paper disappear
  // into the white stage even though the semantic component was present.
  const progress = Math.max(0.82, entranceProgress);
  // Evidence should unfold with the narration instead of landing as one
  // frozen slide. Survey cards have a meaningful title to hold the first
  // beat, then reveal the finding and keep it on screen.
  const bodyProgress = card.variant === "survey" && card.title
    ? spring({
        frame: frame - card.enterFrame - Math.round(fps * 2.4),
        fps,
        config: { damping: 18, stiffness: 130 },
      })
    : 1;

  const x = card.position.x * canvasWidth;
  const y = card.position.y * canvasHeight;
  const w = card.width * card.scale;

  // Jagged torn-paper edge via clip-path (subtle irregular border)
  const tornClip =
    "polygon(0% 3%, 3% 1%, 8% 4%, 14% 1%, 22% 3%, 30% 0%, 40% 3%, 50% 1%, 60% 3%, 70% 0%, 80% 3%, 88% 1%, 95% 4%, 99% 1%, 100% 5%, 99% 95%, 100% 99%, 92% 97%, 84% 100%, 75% 97%, 66% 100%, 56% 97%, 47% 100%, 38% 97%, 28% 100%, 19% 97%, 10% 100%, 4% 97%, 1% 99%, 0% 95%)";

  const isSurvey = card.variant === "survey";
  const evidenceAge = Math.max(0, frame - card.enterFrame);
  const evidencePhase = Math.floor(evidenceAge / (fps * 4)) % 3;
  const evidenceX = evidencePhase === 0 ? 0 : evidencePhase === 1 ? -88 : 88;
  const evidenceScale = evidencePhase === 0 ? 1 : evidencePhase === 1 ? 1.05 : 0.95;
  const paperBackground = isSurvey
    ? ["#FFF1CF", "#F7E3AF", "#E8F3F1"][evidencePhase]
    : ["#FFFFFF", "#FFF4C7", "#E8F3F1"][evidencePhase];

  return (
    <div
      style={{
        position: "absolute",
        left: x - w / 2,
        top: y,
        width: w,
        transform: `translate(${evidenceX}px, -50%) rotate(${card.rotation}deg) scale(${progress * evidenceScale})`,
        transformOrigin: "center center",
        zIndex: 12,
        // Shadow is a separate offset silhouette below; no per-frame blur.
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: "translate(12px, 16px)",
          background: "rgba(0,0,0,0.24)",
          clipPath: tornClip,
          zIndex: -1,
        }}
      />
      <div
        style={{
          width: "100%",
          background: paperBackground,
          clipPath: tornClip,
          padding: isSurvey ? "56px 64px" : "48px 56px",
          boxSizing: "border-box",
          fontFamily: "'Segoe UI', Arial, sans-serif",
        }}
      >
        {isSurvey && card.title && (
          <div
            style={{
              fontSize: w * 0.072,
              fontWeight: 900,
              color: "#E03131",
              textAlign: "center",
              textShadow: "2px 2px 0 rgba(0,0,0,0.12)",
              marginBottom: 24,
              letterSpacing: 1,
            }}
          >
            {card.title}
          </div>
        )}

        {card.highlight && (
          <div
            style={{
              display: "inline-block",
              marginBottom: 22,
              padding: "8px 14px",
              background: "#FFE08A",
              border: "3px solid #1a1a1a",
              borderRadius: 8,
              fontSize: w * 0.028,
              fontWeight: 900,
              color: "#1a1a1a",
            }}
          >
            {card.highlight}
          </div>
        )}

        <div
          style={{
            fontSize: isSurvey ? w * 0.042 : w * 0.036,
            fontWeight: isSurvey ? 700 : 500,
            color: "#1a1a1a",
            lineHeight: 1.45,
            textAlign: isSurvey ? "left" : "center",
            fontStyle: isSurvey ? "normal" : "italic",
            opacity: bodyProgress,
            transform: `translateY(${(1 - bodyProgress) * 18}px)`,
            background: isSurvey ? "rgba(255, 214, 102, 0.34)" : evidencePhase > 0 ? "rgba(255,255,255,0.62)" : undefined,
            borderLeft: isSurvey || evidencePhase > 0 ? `${Math.max(5, w * 0.008)}px solid ${isSurvey ? "#E03131" : "#286F7A"}` : undefined,
            borderRadius: isSurvey ? 10 : undefined,
            padding: isSurvey ? "18px 22px" : undefined,
          }}
        >
          {card.body}
        </div>

        {isSurvey && card.choices && card.choices.length > 0 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "28px 40px",
              marginTop: 36,
              justifyContent: "flex-start",
              opacity: bodyProgress,
              transform: `translateY(${(1 - bodyProgress) * 18}px)`,
            }}
          >
            {card.choices.map((choice, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  fontSize: w * 0.04,
                  fontWeight: 700,
                  color: "#1a1a1a",
                }}
              >
                <span
                  style={{
                    display: "inline-block",
                    width: w * 0.045,
                    height: w * 0.045,
                    border: "4px solid #1a1a1a",
                    borderRadius: 6,
                    flexShrink: 0,
                  }}
                />
                {choice}
              </div>
            ))}
          </div>
        )}

        {(card.source || card.date) && (
          <div
            style={{
              marginTop: 26,
              paddingTop: 16,
              borderTop: "2px solid #D8D2C8",
              fontSize: w * 0.022,
              fontWeight: 700,
              color: "#625B52",
              textAlign: "left",
              fontStyle: "normal",
            }}
          >
            {[card.source, card.date].filter(Boolean).join(" · ")}
          </div>
        )}
      </div>
    </div>
  );
};
