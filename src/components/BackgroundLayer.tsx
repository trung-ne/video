import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { BackgroundState } from "../engine/timelineEngine";

interface Props {
  backgrounds: Array<BackgroundState & { saturationScale?: number }>;
  defaultBackground: string;
  width: number;
  height: number;
}

export const BackgroundLayer: React.FC<Props> = ({
  backgrounds,
  defaultBackground,
  width,
  height,
}) => {
  const frame = useCurrentFrame();

  // Solid color: starts with # or rgb
  // CSS gradient: starts with linear-gradient or radial-gradient
  // Image path: everything else
  const isCSS = (s: string) =>
    s.startsWith("#") ||
    s.startsWith("rgb") ||
    s.startsWith("linear-gradient") ||
    s.startsWith("radial-gradient");

  if (backgrounds.length === 0) {
    const isDefaultCSS = isCSS(defaultBackground);
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: defaultBackground,
          width,
          height,
        }}
      />
    );
  }

  return (
    <>
      {backgrounds.map((bg, i) => {
        const isLast = i === backgrounds.length - 1;
        // A one-frame background event is a hard cut, not a one-frame fade.
        // Starting it at opacity 0 produced a completely empty first frame for
        // every cleared scene and could create a false cross-scene duplicate.
        const crossfadeProgress = bg.duration <= 1
          ? 1
          : Math.min(1, (frame - bg.enterFrame) / bg.duration);
        const opacity = isLast
          ? interpolate(crossfadeProgress, [0, 1], [0, bg.opacity])
          : bg.opacity;
        const isPhoto = /(?:^|\/)backgrounds\//.test(bg.src) && !bg.src.includes("generated-backgrounds/");
        const age = Math.max(0, frame - bg.enterFrame);
        const photoPan = Math.min(1, age / 300);

        if (isCSS(bg.src)) {
          return (
            <div
              key={bg.src + bg.enterFrame}
              style={{
                position: "absolute",
                inset: 0,
                background: bg.src,
                opacity,
                width,
                height,
              }}
            />
          );
        }

        return (
          <div
            key={bg.src + bg.enterFrame}
            style={{
              position: "absolute",
              inset: 0,
              opacity,
              overflow: "hidden",
              width,
              height,
            }}
          >
            <img
              src={bg.src}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                filter: [
                  bg.blur > 0 ? `blur(${bg.blur}px)` : "",
                  isPhoto && bg.saturationScale !== undefined
                    ? `saturate(${bg.saturationScale}) contrast(${isPhoto ? 0.98 : 1})`
                    : "",
                ].filter(Boolean).join(" ") || undefined,
                // Photo treatment gets a fixed safe overscan plus a slow pan;
                // there is no automatic scene-wide zoom or camera event.
                transform: isPhoto
                  ? `scale(1.035) translateX(${(photoPan - 0.5) * 1.8}%)`
                  : bg.blur > 0 ? "scale(1.06)" : undefined,
              }}
            />
            {bg.overlay && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: bg.overlay,
                }}
              />
            )}
          </div>
        );
      })}
    </>
  );
};
