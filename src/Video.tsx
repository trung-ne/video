import React from "react";
import {
  useCurrentFrame,
  useVideoConfig,
  Audio,
  staticFile,
  AbsoluteFill,
} from "remotion";
import { Timeline, EnterEvent } from "./types/timeline";
import { computeFrameState } from "./engine/timelineEngine";
import { AnimatedAsset } from "./components/AnimatedAsset";
import { AnimatedText } from "./components/AnimatedText";
import { BackgroundLayer } from "./components/BackgroundLayer";
import { SpeechBubble } from "./components/SpeechBubble";
import { ConceptCard } from "./components/ConceptCard";
import { TransitionOverlay } from "./components/TransitionOverlay";

interface Props {
  timeline: Timeline;
  [key: string]: unknown;
}

export const CatExplainerVideo: React.FC<Props> = ({ timeline }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const state = computeFrameState(timeline, frame);

  // Camera transform
  const camZoom = state.camera.zoom;
  const camX = state.camera.centerX * width;
  const camY = state.camera.centerY * height;
  const cameraStyle: React.CSSProperties = {
    transform: `scale(${camZoom}) translate(${(width / 2 - camX) / camZoom}px, ${(height / 2 - camY) / camZoom}px)`,
    transformOrigin: `${camX}px ${camY}px`,
    width: "100%",
    height: "100%",
    position: "absolute",
    top: 0,
    left: 0,
  };

  const defaultBg = timeline.background ?? "#FAFAF8";

  // Resolve background image paths
  const resolvedBackgrounds = state.backgrounds.map((bg) => ({
    ...bg,
    src: bg.src.startsWith("#") || bg.src.startsWith("rgb")
      ? bg.src
      : staticFile(bg.src),
  }));

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {/* Audio track */}
      {timeline.audio && (
        <Audio src={staticFile(timeline.audio)} />
      )}

      {/* Background layer (behind camera, not affected by zoom) */}
      <BackgroundLayer
        backgrounds={resolvedBackgrounds}
        defaultBackground={defaultBg}
        width={width}
        height={height}
      />

      {/* Camera layer */}
      <div style={cameraStyle}>
        {/* Concept cards (behind characters) */}
        {Array.from(state.cards.entries()).map(([cardId, card]) => (
          <ConceptCard
            key={cardId}
            card={card}
            canvasWidth={width}
            canvasHeight={height}
            staticFile={staticFile}
          />
        ))}

        {/* Active assets */}
        {Array.from(state.assets.entries()).map(([assetId, asset]) => {
          const enterFrame = state.assetEnterFrames.get(assetId) ?? 0;
          const exitInfo = state.assetExitFrames.get(assetId) ?? null;

          const enterEvent = timeline.events.find(
            (e) => e.type === "enter" && (e as EnterEvent).assetId === assetId
          ) as EnterEvent | undefined;

          const enterAnimation = enterEvent?.animation ?? "popIn";
          const enterDuration = enterEvent?.animationDuration ?? 18;

          return (
            <AnimatedAsset
              key={assetId}
              asset={asset}
              enterFrame={enterFrame}
              enterAnimation={enterAnimation}
              enterDuration={enterDuration}
              exitInfo={exitInfo}
              emphasizes={state.emphasizes}
              canvasWidth={width}
              canvasHeight={height}
              currentFrame={frame}
              fps={fps}
            />
          );
        })}

        {/* Speech bubbles (on top of characters) */}
        {Array.from(state.speechBubbles.entries()).map(([bubbleId, bubble]) => (
          <SpeechBubble
            key={bubbleId}
            bubble={bubble}
            anchor={state.assets.get(bubble.anchorAssetId)}
            canvasWidth={width}
            canvasHeight={height}
          />
        ))}

        {/* Text overlays */}
        {Array.from(state.texts.entries()).map(([textId, text]) => (
          <AnimatedText
            key={textId}
            text={text}
            currentFrame={frame}
            fps={fps}
            canvasWidth={width}
            canvasHeight={height}
          />
        ))}
      </div>

      {/* Transition overlay (above everything, not inside camera) */}
      {state.activeTransition && (
        <TransitionOverlay
          transition={state.activeTransition}
          width={width}
          height={height}
        />
      )}
    </AbsoluteFill>
  );
};
