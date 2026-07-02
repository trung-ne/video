import React from "react";
import { useCurrentFrame, useVideoConfig, Img, staticFile } from "remotion";
import { AssetState, EnterEvent, ExitEvent } from "../types/timeline";
import {
  getEnterAnimation,
  getExitAnimation,
  getEmphasizeAnimation,
  AnimationValues,
} from "../animations";
import { ActiveEmphasize } from "../engine/timelineEngine";

interface Props {
  asset: AssetState;
  enterFrame: number;
  enterAnimation: string;
  enterDuration: number;
  exitInfo?: { frame: number; animation: string; duration: number } | null;
  emphasizes: ActiveEmphasize[];
  canvasWidth: number;
  canvasHeight: number;
  currentFrame: number;
  fps: number;
}

const BASE_ASSET_SIZE = 200; // px at scale 1.0 (raised so characters fill the frame like the reference)

export const AnimatedAsset: React.FC<Props> = ({
  asset,
  enterFrame,
  enterAnimation,
  enterDuration,
  exitInfo,
  emphasizes,
  canvasWidth,
  canvasHeight,
  currentFrame,
  fps,
}) => {
  // --- Enter animation ---
  const enterLocalFrame = currentFrame - enterFrame;
  const enterAnim = getEnterAnimation(enterAnimation, enterLocalFrame, enterDuration, fps);

  // --- Exit animation ---
  let exitAnim: AnimationValues | null = null;
  if (exitInfo && currentFrame >= exitInfo.frame) {
    const exitLocalFrame = currentFrame - exitInfo.frame;
    exitAnim = getExitAnimation(exitInfo.animation, exitLocalFrame, exitInfo.duration, fps);
  }

  // --- Emphasize animation ---
  let emphasisScale = 1;
  let emphasisTranslateX = 0;
  let emphasisTranslateY = 0;
  let emphasisFilter = "";
  for (const em of emphasizes) {
    if (em.assetId === asset.assetId) {
      const localFrame = currentFrame - em.startFrame;
      const emAnim = getEmphasizeAnimation(em.animation, localFrame, em.duration, fps);
      emphasisScale *= emAnim.scale;
      emphasisTranslateX += emAnim.translateX;
      emphasisTranslateY += emAnim.translateY;
      if (emAnim.filter) emphasisFilter = emAnim.filter;
    }
  }

  // Resolved values: exit overrides enter if both active
  const resolved = exitAnim ?? enterAnim;

  const pixelX = asset.position.x * canvasWidth;
  const pixelY = asset.position.y * canvasHeight;
  const size = BASE_ASSET_SIZE * asset.scale;

  const totalScale = resolved.scale * emphasisScale;
  const totalTX = resolved.translateX + emphasisTranslateX;
  const totalTY = resolved.translateY + emphasisTranslateY;

  return (
    <div
      style={{
        position: "absolute",
        left: pixelX - size / 2,
        top: pixelY - size / 2,
        width: size,
        height: size,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        opacity: resolved.opacity * asset.opacity,
        transform: `translate(${totalTX}px, ${totalTY}px) scale(${totalScale})`,
        filter: emphasisFilter || undefined,
        zIndex: asset.zIndex,
        pointerEvents: "none",
      }}
    >
      {asset.circle && (
        <div
          style={{
            position: "absolute",
            width: size * 1.5,
            height: size * 1.5,
            borderRadius: "50%",
            background: asset.circle,
            zIndex: -1,
          }}
        />
      )}
      <Img
        src={staticFile(`assets/${asset.src}.svg`)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
        }}
      />
      {asset.label && (
        <div
          style={{
            position: "absolute",
            bottom: -32,
            left: "50%",
            transform: "translateX(-50%)",
            whiteSpace: "nowrap",
            fontSize: 24,
            fontWeight: 600,
            color: "#333",
            fontFamily: "'Segoe UI', sans-serif",
            background: "rgba(255,255,255,0.85)",
            borderRadius: 8,
            padding: "2px 10px",
          }}
        >
          {asset.label}
        </div>
      )}
      {asset.badge && (
        <div
          style={{
            position: "absolute",
            bottom: size * 0.06,
            left: "50%",
            transform: "translateX(-50%)",
            fontSize: size * 0.3,
            fontWeight: 900,
            color: "#FFFFFF",
            fontFamily: "'Segoe UI', Arial, sans-serif",
            textShadow: "3px 3px 0 rgba(0,0,0,0.45)",
            pointerEvents: "none",
          }}
        >
          {asset.badge}
        </div>
      )}
    </div>
  );
};
