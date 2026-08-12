import React from "react";
import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { getEnterAnimation } from "./animations";
import { animationForEntranceStyle } from "./engine/entrancePolicy";

type DemoKind = "fade" | "rise" | "slide" | "softScale" | "reveal" | "cut";

const DEMOS: Array<{ kind: DemoKind; title: string; detail: string }> = [
  { kind: "fade", title: "Fade", detail: "Hiện dần — không đổi kích thước" },
  { kind: "rise", title: "Rise", detail: "Nâng nhẹ 28px + fade" },
  { kind: "slide", title: "Slide", detail: "Trượt ngang 56px + fade" },
  { kind: "softScale", title: "Soft scale", detail: "94% → 100%, không overshoot" },
  { kind: "reveal", title: "Reveal", detail: "Mở màn từ trái sang phải" },
  { kind: "cut", title: "Cut", detail: "Xuất hiện ngay — cho nhịp nhanh" },
];

const FRAMES_PER_DEMO = 75;

export const EntranceAnimationDemo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const index = Math.min(DEMOS.length - 1, Math.floor(frame / FRAMES_PER_DEMO));
  const localFrame = frame - index * FRAMES_PER_DEMO;
  const demo = DEMOS[index];
  const entrance = getEnterAnimation(animationForEntranceStyle(demo.kind, { x: 0.75, y: 0.5 }), localFrame, 18, fps);
  const style: React.CSSProperties = {
    opacity: entrance.opacity,
    transform: `translate(${entrance.translateX}px, ${entrance.translateY}px) scale(${entrance.scale})`,
    clipPath: entrance.clipPath,
  };

  return (
    <AbsoluteFill style={{ background: "#FAFAF8", fontFamily: "Segoe UI, Arial, sans-serif", color: "#17212B" }}>
      <div style={{ position: "absolute", top: 64, left: 96, right: 96, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 32, fontWeight: 800 }}>ENTRANCE OPTIONS</div>
        <div style={{ fontSize: 24, color: "#62707D", fontWeight: 700 }}>{index + 1} / {DEMOS.length}</div>
      </div>

      <div style={{ position: "absolute", top: 122, left: 96, width: 1728, height: 4, background: "#DDE4E7", borderRadius: 99 }}>
        <div style={{ width: `${((index + 1) / DEMOS.length) * 100}%`, height: "100%", background: "#286F7A", borderRadius: 99 }} />
      </div>

      <div style={{ position: "absolute", left: 260, top: 240, width: 1400, height: 600, borderRadius: 44, border: "4px solid #1A2A33", background: "#E8F3F1", boxShadow: "16px 18px 0 rgba(23,33,43,0.16)", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 82% 18%, #FFFFFF 0 8%, transparent 32%)" }} />
        <div style={{ position: "absolute", left: 96, top: 90, zIndex: 2 }}>
          <div style={{ fontSize: 70, fontWeight: 900, color: "#286F7A", letterSpacing: -2 }}>{demo.title}</div>
          <div style={{ marginTop: 18, fontSize: 34, fontWeight: 650, color: "#42515C" }}>{demo.detail}</div>
          <div style={{ marginTop: 44, display: "inline-flex", alignItems: "center", gap: 14, background: "#FFF1CF", border: "3px solid #1A2A33", borderRadius: 99, padding: "14px 26px", fontSize: 25, fontWeight: 800 }}>
            Tối đa 100% kích thước đích
          </div>
        </div>

        <div style={{ position: "absolute", right: 128, bottom: 50, width: 440, height: 440, display: "flex", alignItems: "center", justifyContent: "center", ...style }}>
          <div style={{ position: "absolute", width: 400, height: 400, borderRadius: "50%", background: "#FFCE76", border: "4px solid #1A2A33" }} />
          <Img src={staticFile("generated-assets/characters/cat_explain.png")} style={{ position: "relative", width: 410, height: 410, objectFit: "contain" }} />
        </div>
      </div>

      <div style={{ position: "absolute", bottom: 76, left: 0, right: 0, textAlign: "center", fontSize: 27, color: "#62707D", fontWeight: 650 }}>
        Cùng một asset, cùng kích thước — chỉ thay cách xuất hiện
      </div>
    </AbsoluteFill>
  );
};
