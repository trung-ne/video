export type AnimationType =
  | "popIn"
  | "fadeIn"
  | "slideLeft"
  | "slideRight"
  | "slideUp"
  | "slideDown"
  | "zoomIn"
  | "drawSVG"
  | "none";

export type EmphasizeType =
  | "pulse"
  | "shake"
  | "bounce"
  | "highlight"
  | "counter";

export type ExitType = "fadeOut" | "slideLeft" | "slideRight" | "zoomOut" | "popOut";

export interface Position {
  x: number; // 0.0 - 1.0 relative to canvas width
  y: number; // 0.0 - 1.0 relative to canvas height
}

export interface AssetState {
  assetId: string;
  src: string;           // path relative to public/assets/ (no extension)
  position: Position;
  scale: number;         // 1.0 = default size
  opacity: number;
  zIndex: number;
  label?: string;        // text label shown below asset
  visible: boolean;
}

// Timeline is event-driven: each event mutates the persistent canvas

export interface EnterEvent {
  frame: number;
  type: "enter";
  assetId: string;
  src: string;
  position: Position;
  scale?: number;
  animation?: AnimationType;
  animationDuration?: number; // frames, default 18
  label?: string;
  zIndex?: number;
}

export interface ExitEvent {
  frame: number;
  type: "exit";
  assetId: string;
  animation?: ExitType;
  animationDuration?: number;
}

export interface MoveEvent {
  frame: number;
  type: "move";
  assetId: string;
  position: Position;
  scale?: number;
  duration: number; // frames for the move transition
}

export interface EmphasizeEvent {
  frame: number;
  type: "emphasize";
  assetId: string;
  animation: EmphasizeType;
  duration?: number; // frames
  value?: number;    // for counter: target number
}

export interface CameraEvent {
  frame: number;
  type: "camera";
  zoom: number;       // 1.0 = normal, 1.5 = 50% zoom in
  centerX: number;    // 0.0-1.0
  centerY: number;    // 0.0-1.0
  duration: number;   // frames for camera move
}

export type TextStyle =
  | "TITLE"      // Video title, large, dark — top of screen
  | "STAT"       // Big shocking number, red accent — center dramatic
  | "CALLOUT"    // Key concept pill with background — short phrase
  | "SECTION"    // Section header — topic change divider
  | "BODY"       // Explanation text — follows narration
  | "CAPTION";   // Small secondary info — bottom of screen

export interface TextEvent {
  frame: number;
  type: "text";
  textId: string;
  content: string;
  position: Position;
  fontSize?: number;
  color?: string;
  style?: TextStyle;        // Visual style preset (overrides fontSize/color defaults)
  background?: string;      // Background color (for CALLOUT style)
  align?: "left" | "center" | "right";
  fontWeight?: number;
  animation?: AnimationType;
  exitFrame?: number;
}

export interface ClearEvent {
  frame: number;
  type: "clear";
  assetIds?: string[]; // if empty, clear all
}

// NEW: Real photo background behind everything
export interface BackgroundEvent {
  frame: number;
  type: "background";
  src: string;          // path relative to public/ (e.g. "backgrounds/office_01.jpg") or hex color "#FAFAF8"
  blur?: number;        // blur px, default 0 (8-16 for behind-character blur)
  opacity?: number;     // 0-1, default 1
  duration?: number;    // frames for crossfade transition, default 20
}

// NEW: Speech bubble tied to an asset
export interface SpeechBubbleEvent {
  frame: number;
  type: "speechBubble";
  bubbleId: string;
  anchorAssetId: string;   // which character it comes from
  text: string;
  style?: "speech" | "thought" | "shout"; // default: speech
  direction?: "left" | "right" | "top";   // tail direction, default right
  exitFrame?: number;
  fontSize?: number;       // default 22
  background?: string;     // bubble color, default white
  textColor?: string;      // default #1a1a1a
}

// NEW: Concept card (framed box with icon + label)
export interface CardEvent {
  frame: number;
  type: "card";
  cardId: string;
  position: Position;
  scale?: number;
  background: string;      // card fill color e.g. "#FFB3D1"
  iconSrc?: string;        // asset path inside card
  label?: string;          // text below icon
  animation?: AnimationType;
  exitFrame?: number;
  width?: number;          // px, default 280
  height?: number;         // px, default 200
}

// NEW: Scene flash/wipe transition
export interface TransitionEvent {
  frame: number;
  type: "transition";
  style: "flash" | "wipe" | "fadeBlack" | "fadeWhite" | "zoom";
  duration?: number;       // frames, default 15
}

export type TimelineEvent =
  | EnterEvent
  | ExitEvent
  | MoveEvent
  | EmphasizeEvent
  | CameraEvent
  | TextEvent
  | ClearEvent
  | BackgroundEvent
  | SpeechBubbleEvent
  | CardEvent
  | TransitionEvent;

export interface Timeline {
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
  audio?: string;       // path relative to public/
  background?: string;  // hex color or image path, default "#FAFAF8"
  events: TimelineEvent[];
}
