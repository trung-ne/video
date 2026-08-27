const CONTENT_BAND_RATIO = 0.76;

function isWhiteBackground(value: unknown): boolean {
  const source = String(value ?? "").replace(/\s+/g, "").toLowerCase();
  return source === "#fff" || source === "#ffffff" || source === "white" || source === "rgb(255,255,255)";
}

/**
 * Conservative lower-bound for stable, intentionally painted geometry above
 * the subtitle band. It counts compiler-owned rectangles and authored colour
 * discs, never `focalOccupancyTarget` and never a temporary animation.
 *
 * This is not a replacement for the pixel audit. It is an earlier contract:
 * a white-register scene must compile enough real geometry that it has a
 * plausible chance of matching the reference before Remotion renders it.
 */
export function estimateStablePaintedRatio(
  scene: any,
  width = 1920,
  height = 1080,
): number | undefined {
  if (!isWhiteBackground(scene.backgroundSrc)) return undefined;
  const contentArea = width * height * CONTENT_BAND_RATIO;
  let area = 0;

  for (const card of scene.cards ?? []) {
    area += Number(card.width ?? 280) * Number(card.height ?? 200) * Math.pow(Number(card.scale ?? 1), 2);
  }
  for (const card of scene.paperCards ?? []) {
    const scale = Number(card.scale ?? 1);
    const cardWidth = Number(card.width ?? 1100) * scale;
    const cardHeight = (card.variant === "survey" ? 680 : 700) * scale;
    area += cardWidth * cardHeight;
  }
  for (const box of scene.frameBoxes ?? []) {
    const boxWidth = Number(box.width ?? 1000) * Number(box.scale ?? 1);
    area += boxWidth * boxWidth * 0.72;
  }
  for (const entity of scene.entities ?? []) {
    if (!entity.circle) continue;
    const diameter = 200 * Number(entity.scale ?? 2.2) * 1.5;
    area += Math.PI * Math.pow(diameter / 2, 2);
  }

  return Math.min(1, area / contentArea);
}
