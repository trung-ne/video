import { getEmphasizeAnimation, getEnterAnimation, getExitAnimation } from "../animations";
import { AssetState, Timeline } from "../types/timeline";
import {
  CardState,
  FrameState,
  FrameBoxState,
  PaperCardState,
  SpeechBubbleState,
  TextState,
} from "./timelineEngine";
import { getAssetGeometry, getContentScale } from "./assetPaths";

export interface VisualBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export type VisualPrimitiveKind =
  | "asset"
  | "card"
  | "paper-card"
  | "frame-box"
  | "speech-bubble"
  | "text"
  | "subtitle";

export interface VisualPrimitive {
  id: string;
  kind: VisualPrimitiveKind;
  box: VisualBox;
  opacity: number;
  zIndex: number;
  /** Only asset pairs may declare an intentional held/worn overlap. */
  allowOverlapWith?: string[];
  /** The asset which owns an anchored speech/thought bubble. */
  ownerId?: string;
}

const BASE_ASSET_SIZE = 200;
const DEFAULT_ENTRANCE_DURATION = 18;

export function boxArea(box: VisualBox): number {
  return Math.max(0, box.x1 - box.x0) * Math.max(0, box.y1 - box.y0);
}

export function intersectBoxes(a: VisualBox, b: VisualBox): number {
  return Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) *
    Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
}

export function overlapRatio(a: VisualBox, b: VisualBox): number {
  const smaller = Math.min(boxArea(a), boxArea(b));
  return smaller > 0 ? intersectBoxes(a, b) / smaller : 0;
}

export function outsideBoxFraction(box: VisualBox, width: number, height: number): number {
  const total = boxArea(box);
  if (total === 0) return 0;
  return 1 - intersectBoxes(box, { x0: 0, x1: width, y0: 0, y1: height }) / total;
}

function transformedBox(
  left: number,
  top: number,
  width: number,
  height: number,
  scale: number,
  translateX = 0,
  translateY = 0,
): VisualBox {
  const centerX = left + width / 2 + translateX;
  const centerY = top + height / 2 + translateY;
  const scaledWidth = width * scale;
  const scaledHeight = height * scale;
  return {
    x0: centerX - scaledWidth / 2,
    x1: centerX + scaledWidth / 2,
    y0: centerY - scaledHeight / 2,
    y1: centerY + scaledHeight / 2,
  };
}

function rotateBounds(box: VisualBox, degrees: number): VisualBox {
  if (!degrees) return box;
  const radians = Math.abs(degrees) * Math.PI / 180;
  const width = box.x1 - box.x0;
  const height = box.y1 - box.y0;
  const rotatedWidth = Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians));
  const rotatedHeight = Math.abs(width * Math.sin(radians)) + Math.abs(height * Math.cos(radians));
  const x = (box.x0 + box.x1) / 2;
  const y = (box.y0 + box.y1) / 2;
  return { x0: x - rotatedWidth / 2, x1: x + rotatedWidth / 2, y0: y - rotatedHeight / 2, y1: y + rotatedHeight / 2 };
}

/** Mirrors the CSS camera transform in Video.tsx. */
export function applyCamera(box: VisualBox, state: FrameState, width: number, height: number): VisualBox {
  const { zoom, centerX, centerY } = state.camera;
  const originX = centerX * width;
  const originY = centerY * height;
  return {
    x0: width / 2 + zoom * (box.x0 - originX),
    x1: width / 2 + zoom * (box.x1 - originX),
    y0: height / 2 + zoom * (box.y0 - originY),
    y1: height / 2 + zoom * (box.y1 - originY),
  };
}

/** Mirrors AnimatedAsset's image content box, transforms and emphasis. */
export function assetPrimitive(
  asset: AssetState,
  state: FrameState,
  frame: number,
  fps: number,
  width: number,
  height: number,
): VisualPrimitive {
  const geometry = getAssetGeometry(asset.src);
  const size = BASE_ASSET_SIZE * asset.scale * getContentScale(asset.src);
  const renderedWidth = Math.min(size * 1.8, size * Math.max(0.05, geometry.aspectRatio));
  const renderedHeight = size;
  const imageLeft = asset.position.x * width - renderedWidth / 2;
  const imageTop = asset.position.y * height - renderedHeight / 2;
  const content = geometry.contentBox;
  let scale = 1;
  let translateX = 0;
  let translateY = 0;
  let opacity = asset.opacity;
  const enter = state.assetEnterInfo.get(asset.assetId);
  const enterFrame = state.assetEnterFrames.get(asset.assetId) ?? frame;
  if (enter) {
    const animation = getEnterAnimation(enter.animation, frame - enterFrame, enter.duration, fps);
    scale *= animation.scale;
    translateX += animation.translateX;
    translateY += animation.translateY;
    opacity *= animation.opacity;
  }
  const exit = state.assetExitFrames.get(asset.assetId);
  if (exit && frame >= exit.frame) {
    const animation = getExitAnimation(exit.animation, frame - exit.frame, exit.duration, fps);
    scale *= animation.scale;
    translateX += animation.translateX;
    translateY += animation.translateY;
    opacity *= animation.opacity;
  }
  for (const emphasis of state.emphasizes.filter((item) => item.assetId === asset.assetId)) {
    if (frame < emphasis.startFrame || frame > emphasis.startFrame + emphasis.duration) continue;
    const animation = getEmphasizeAnimation(emphasis.animation, frame - emphasis.startFrame, emphasis.duration, fps);
    scale *= animation.scale;
    translateX += animation.translateX;
    translateY += animation.translateY;
  }
  const local = transformedBox(
    imageLeft + content.x * renderedWidth,
    imageTop + content.y * renderedHeight,
    content.width * renderedWidth,
    content.height * renderedHeight,
    scale,
    translateX,
    translateY,
  );
  return {
    id: asset.assetId,
    kind: "asset",
    box: applyCamera(local, state, width, height),
    opacity,
    zIndex: asset.zIndex,
    allowOverlapWith: asset.allowOverlapWith,
  };
}

function entranceBox(
  left: number,
  top: number,
  width: number,
  height: number,
  animation: string,
  enterFrame: number,
  frame: number,
  fps: number,
): { box: VisualBox; opacity: number } {
  const entrance = getEnterAnimation(animation, frame - enterFrame, DEFAULT_ENTRANCE_DURATION, fps);
  return { box: transformedBox(left, top, width, height, entrance.scale, entrance.translateX, entrance.translateY), opacity: entrance.opacity };
}

function cardPrimitive(card: CardState, state: FrameState, frame: number, fps: number, width: number, height: number): VisualPrimitive {
  const cardWidth = card.width * card.scale;
  const cardHeight = card.height * card.scale;
  const entrance = entranceBox(card.position.x * width - cardWidth / 2, card.position.y * height - cardHeight / 2, cardWidth, cardHeight, card.animation, card.enterFrame, frame, fps);
  return { id: card.cardId, kind: "card", box: applyCamera(entrance.box, state, width, height), opacity: entrance.opacity, zIndex: 10 };
}

function paperCardPrimitive(card: PaperCardState, state: FrameState, frame: number, fps: number, width: number, height: number): VisualPrimitive {
  const cardWidth = card.width * card.scale;
  const cardHeight = (card.variant === "survey" ? 680 : 700) * card.scale;
  const entrance = entranceBox(card.position.x * width - cardWidth / 2, card.position.y * height - cardHeight / 2, cardWidth, cardHeight, card.animation, card.enterFrame, frame, fps);
  return {
    id: card.cardId,
    kind: "paper-card",
    box: applyCamera(rotateBounds(entrance.box, card.rotation), state, width, height),
    opacity: entrance.opacity,
    zIndex: 12,
  };
}

function frameBoxPrimitive(frameBox: FrameBoxState, state: FrameState, frame: number, fps: number, width: number, height: number): VisualPrimitive {
  const frameWidth = frameBox.width * frameBox.scale;
  const monitorHeight = frameWidth * 0.62;
  // Includes monitor stand/base plus bounded caption/source allocation.
  const frameHeight = monitorHeight * 1.21 + (frameBox.caption ? 58 : 0) + (frameBox.source ? 38 : 0);
  const entrance = entranceBox(frameBox.position.x * width - frameWidth / 2, frameBox.position.y * height - monitorHeight / 2, frameWidth, frameHeight, frameBox.animation, frameBox.enterFrame, frame, fps);
  return { id: frameBox.frameId, kind: "frame-box", box: applyCamera(entrance.box, state, width, height), opacity: entrance.opacity, zIndex: 11 };
}

function bubblePrimitive(bubble: SpeechBubbleState, anchor: AssetState | undefined, state: FrameState, frame: number, fps: number, width: number, height: number): VisualPrimitive | undefined {
  if (!anchor) return undefined;
  const anchorX = anchor.position.x * width;
  const anchorY = anchor.position.y * height;
  const assetSize = BASE_ASSET_SIZE * anchor.scale;
  const bubbleWidth = Math.min(width * bubble.widthRatio, Math.max(420, bubble.text.length * (bubble.fontSize * 0.55) + 56));
  const estimatedLines = Math.max(1, Math.ceil((bubble.text.length * bubble.fontSize * 0.55) / Math.max(1, bubbleWidth - 44)));
  const bubbleHeight = Math.max(132, estimatedLines * bubble.fontSize * 1.28 + 52) + 20;
  let bubbleX = anchorX + assetSize * 0.3;
  let bubbleY = anchorY - assetSize * 0.6 - bubbleHeight;
  if (bubble.direction === "left") bubbleX = anchorX - assetSize * 0.3 - bubbleWidth;
  else if (bubble.direction === "top") {
    bubbleX = anchorX - bubbleWidth / 2;
    bubbleY = anchorY - assetSize * 0.8 - bubbleHeight;
  }
  bubbleX = Math.max(24, Math.min(width - bubbleWidth - 24, bubbleX));
  bubbleY = Math.max(24, Math.min(height * 0.72 - bubbleHeight, bubbleY));
  const entrance = entranceBox(bubbleX, bubbleY, bubbleWidth, bubbleHeight, bubble.animation, bubble.enterFrame, frame, fps);
  return {
    id: bubble.bubbleId,
    kind: "speech-bubble",
    box: applyCamera(entrance.box, state, width, height),
    opacity: entrance.opacity,
    zIndex: 100,
    ownerId: anchor.assetId,
  };
}

function textSize(text: TextState, width: number): { width: number; height: number } {
  const style = text.style ?? "BODY";
  const charWidth = text.fontSize * (style === "STAT" ? 0.64 : 0.57);
  const maxWidth = style === "STAT" ? width * 0.85 : style === "SUBTITLE" ? width * 0.78 : width * 0.72;
  const unwrapped = Math.max(text.fontSize, text.content.length * charWidth);
  const textWidth = Math.min(maxWidth, unwrapped + (style === "CALLOUT" ? 72 : 0));
  const lines = Math.max(1, Math.ceil(unwrapped / Math.max(1, maxWidth)));
  const padding = style === "CALLOUT" ? 28 : style === "SUBTITLE" ? 24 : 8;
  return { width: textWidth, height: lines * text.fontSize * 1.28 + padding * 2 };
}

function textPrimitive(text: TextState, state: FrameState, frame: number, fps: number, width: number, height: number): VisualPrimitive {
  const size = textSize(text, width);
  const entrance = entranceBox(text.position.x * width - size.width / 2, text.position.y * height - size.height / 2, size.width, size.height, text.animation, text.enterFrame, frame, fps);
  const isSubtitle = text.style === "SUBTITLE";
  return {
    id: text.textId,
    kind: isSubtitle ? "subtitle" : "text",
    box: isSubtitle ? entrance.box : applyCamera(entrance.box, state, width, height),
    opacity: entrance.opacity,
    zIndex: isSubtitle ? 60 : text.style === "SECTION" ? 55 : 60,
  };
}

/** Complete foreground primitive list in the same paint order/coordinate systems as Video.tsx. */
export function visualPrimitivesAtFrame(timeline: Timeline, state: FrameState, frame: number, fps = timeline.fps): VisualPrimitive[] {
  const width = timeline.width;
  const height = timeline.height;
  const primitives: VisualPrimitive[] = [];
  for (const card of state.cards.values()) primitives.push(cardPrimitive(card, state, frame, fps, width, height));
  for (const asset of state.assets.values()) primitives.push(assetPrimitive(asset, state, frame, fps, width, height));
  for (const bubble of state.speechBubbles.values()) {
    const primitive = bubblePrimitive(bubble, state.assets.get(bubble.anchorAssetId), state, frame, fps, width, height);
    if (primitive) primitives.push(primitive);
  }
  for (const card of state.paperCards.values()) primitives.push(paperCardPrimitive(card, state, frame, fps, width, height));
  for (const frameBox of state.frameBoxes.values()) primitives.push(frameBoxPrimitive(frameBox, state, frame, fps, width, height));
  for (const text of state.texts.values()) primitives.push(textPrimitive(text, state, frame, fps, width, height));
  return primitives.filter((primitive) => primitive.opacity > 0.02 && boxArea(primitive.box) > 1);
}
