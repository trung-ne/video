/** Director-facing entrance families. No family may overshoot its final size. */
export type EntranceStyle = "fade" | "rise" | "slide" | "softScale" | "reveal" | "cut";

/** Runtime variants. slide/reveal directions are resolved from the final position. */
export type AnimationType =
  | "fadeIn"
  | "riseIn"
  | "slideLeft"
  | "slideRight"
  | "softScaleIn"
  | "revealLeft"
  | "revealRight"
  | "cutIn"
  // Used only by continuity pose swaps; it is not an authored entrance style.
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
  src: string;           // legacy ID relative to public/assets/ (no extension), or public-relative image path with extension
  position: Position;
  scale: number;         // 1.0 = default size
  opacity: number;
  zIndex: number;
  label?: string;        // text label shown below asset
  badge?: string;        // number/text badge overlaid on the character
  circle?: string;       // colored disc rendered BEHIND the icon (icon-in-circle grouping)
  facing?: "left" | "right" | "front";
  /** Spatial contract carried from the authored scene into the transient timeline. */
  motionPolicy?: "fixed" | "collision-safe";
  /** Asset ids this asset is intentionally allowed to overlap (for held/worn props). */
  allowOverlapWith?: string[];
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
  badge?: string;             // number/text badge on the character (e.g. "4") — game-theory ranking
  circle?: string;            // colored disc behind icon (icon-in-circle grouping, e.g. "#8E44AD")
  facing?: "left" | "right" | "front";
  motionPolicy?: "fixed" | "collision-safe";
  allowOverlapWith?: string[];
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

// Change an existing asset's src (pose/costume) in place — keeps position/scale.
// Used for continuous micro-variation: swapping a cat's pose mid-scene so a long
// hold never sits perfectly still (matches the reference channel).
export interface SwapEvent {
  frame: number;
  type: "swap";
  assetId: string;
  src: string;
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
  | "CAPTION"    // Small secondary info — bottom of screen
  | "SUBTITLE";  // Burned-in narration caption — dark box, white text, very bottom

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
  overlay?: string;     // scrim color drawn OVER a photo bg for legibility (e.g. "rgba(0,0,0,0.35)")
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
  widthRatio?: number;     // width cap as fraction of canvas width, default 0.38
  background?: string;     // bubble color, default white
  textColor?: string;      // default #1a1a1a
  animation?: AnimationType;
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

// NEW: Paper card — torn-paper document (evidence) or survey (question + checkboxes)
// Matches the real channel's "newspaper evidence" (t0s) and "Khảo sát" survey card (t250s)
export interface PaperCardEvent {
  frame: number;
  type: "paperCard";
  cardId: string;
  variant: "evidence" | "survey"; // evidence = quote/document; survey = question + choices
  position: Position;             // card center, default {0.5, 0.42}
  scale?: number;                 // default 1
  title?: string;                 // red header (survey) e.g. "Khảo sát"; omit for plain evidence
  body: string;                   // main document/question text
  choices?: string[];             // survey checkbox options (variant="survey")
  rotation?: number;              // tilt degrees, default -2 (evidence), 0 (survey)
  animation?: AnimationType;
  exitFrame?: number;
  width?: number;                 // px, default 1100
  source?: string;
  date?: string;
  highlight?: string;
}

// NEW: TV/monitor frame containing a data image (map, chart) — matches t700s
export interface FrameBoxEvent {
  frame: number;
  type: "frameBox";
  frameId: string;
  position: Position;             // frame center, default {0.5, 0.42}
  scale?: number;                 // default 1
  contentSrc: string;             // image path under public/ shown inside the TV
  caption?: string;               // small caption under the frame
  animation?: AnimationType;
  exitFrame?: number;
  width?: number;                 // px, default 1000
  source?: string;
  objectFit?: "contain" | "cover";
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
  | SwapEvent
  | EmphasizeEvent
  | CameraEvent
  | TextEvent
  | ClearEvent
  | BackgroundEvent
  | SpeechBubbleEvent
  | CardEvent
  | PaperCardEvent
  | FrameBoxEvent
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
