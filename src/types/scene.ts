import { AnimationType, EmphasizeType, ExitType, TextStyle } from "./timeline";
import { SourceRange, VisualRegister } from "./storyboard";

// ============================================================
// SCENE DSL — High-level schema that AI generates
// SceneCompiler translates this → Timeline events for Remotion
// ============================================================

// Slot IDs map to fixed canvas positions (resolved by SceneCompiler)
export type SlotId =
  | "HOST"          // (0.50, 0.68) — cat's permanent position
  | "CENTER"        // (0.50, 0.35)
  | "CENTER_MID"    // (0.50, 0.50)
  | "LEFT"          // (0.25, 0.40)
  | "RIGHT"         // (0.75, 0.40)
  | "LEFT_MID"      // (0.25, 0.55)
  | "RIGHT_MID"     // (0.75, 0.55)
  | "FAR_LEFT"      // (0.15, 0.40)
  | "FAR_RIGHT"     // (0.85, 0.40)
  | "LEFT_BOTTOM"   // (0.20, 0.65)
  | "RIGHT_BOTTOM"  // (0.80, 0.65);

export type TextSlotId =
  | "TOP_TITLE"         // (0.50, 0.12)
  | "SECTION_HEADER"    // (0.50, 0.15)
  | "CALLOUT_LEFT"      // (0.25, 0.20) — dùng cho DIALOGUE/DUAL_CONTRAST (trên nhân vật)
  | "CALLOUT_CENTER"    // (0.50, 0.20) — dùng cho DIALOGUE/QA_REVEAL (trên nhân vật)
  | "CALLOUT_RIGHT"     // (0.75, 0.20) — dùng cho DIALOGUE/DUAL_CONTRAST (trên nhân vật)
  | "LABEL_UNDER_LEFT"  // (0.22, 0.62) — dùng cho ICON_TRIPLE (dưới icon trái)
  | "LABEL_UNDER_CENTER"// (0.50, 0.62) — dùng cho ICON_TRIPLE (dưới icon giữa)
  | "LABEL_UNDER_RIGHT" // (0.78, 0.62) — dùng cho ICON_TRIPLE (dưới icon phải)
  | "STAT_CENTER"       // (0.50, 0.45)
  | "BODY"              // (0.50, 0.82)
  | "CAPTION"           // (0.50, 0.91)
  | "SUBTITLE";         // (0.50, 0.88)

// ─── Layout presets ──────────────────────────────────────────
export type LayoutPreset =
  // V3 layouts (preferred — from real video analysis)
  | "SOLO"              // 1 character large center — intro, emotional moments
  | "DIALOGUE"          // 2 characters left/right — Q&A, teaching, contrast mindset
  | "DUAL_CONTRAST"     // 2 things compared (A vs B)
  | "SIZE_HIERARCHY"    // big entity + small entity (parent-child, foundation-person)
  | "CHAR_PROP"         // character + object interaction
  | "ICON_TRIPLE"       // 3 icons in a row
  | "QA_REVEAL"         // question → reveal
  | "LINEUP"            // 3-4 characters in a row
  | "STAT_DRAMA"        // big stat center on dark background
  | "CLOSE_UP"          // character close-up, emotional
  | "TABLEAU"           // V5: illustrated stage set + characters seated at anchors

  // Legacy layouts (still supported)
  | "INTRO"             // same as SOLO
  | "SINGLE"            // 1 concept asset center
  | "COMPARE"           // same as DUAL_CONTRAST
  | "CAUSE_EFFECT"      // left → right (2 assets + arrow)
  | "CAUSE_EFFECT_CHAIN"// left → center → right (3 assets)
  | "ACCUMULATION"      // 3 assets appear one by one
  | "STAT"              // same as STAT_DRAMA
  | "CONCLUSION"        // cat + takeaway text
  | "CTA"               // call-to-action
  | "CUSTOM";           // explicit positions via entity.position

// ─── Camera hints ────────────────────────────────────────────
export type CameraAction =
  | "ZOOM_IN"      // zoom toward a slot or asset
  | "ZOOM_OUT"     // pull back to show big picture
  | "FOCUS_ON"     // pan + zoom to a specific asset
  | "RESET"        // return to zoom=1 center
  | "PAN_LR";      // pan left then right (comparison)

export interface SceneCameraHint {
  action: CameraAction;
  target?: string;   // assetId to focus on (for FOCUS_ON)
  zoom?: number;     // override default zoom level
  delay?: number;    // frames after scene start, default 40
  duration?: number; // camera move duration frames, default 30
}

// ─── Entity (asset) inside a scene ───────────────────────────
export interface SceneEntity {
  assetId: string;
  src: string;

  // Position: use slot OR explicit {x, y} for CUSTOM layout
  slot?: SlotId;
  position?: { x: number; y: number };
  // V5 TABLEAU: named spot on an illustrated stage set (see stageAnchors.ts) —
  // e.g. "bed", "sofa_left". Wins over slot; requires stage backgroundSrc.
  anchor?: string;

  role?: "host" | "hero" | "cause" | "effect" | "support";
  scale?: number;                      // default 1.0
  zIndex?: number;                     // default 1
  label?: string;                      // label shown below asset

  badge?: string;                      // number/text badge on character (e.g. "4")
  circle?: string;                     // colored disc behind icon (icon-in-circle grouping, e.g. "#8E44AD")

  enterAnimation?: AnimationType;      // default: popIn
  enterDelay?: number;                 // frames after scene.startFrame, default 0
  animationDuration?: number;          // frames, default 20

  // Optional exit within the scene (if omitted, asset persists)
  exitFrame?: number;                  // absolute frame
  exitAnimation?: ExitType;

  // Clear specific assets when THIS entity enters (for within-scene phase transitions)
  clearPrevious?: string[];

  // Optional emphasis
  emphasize?: {
    animation: EmphasizeType;
    delay?: number;     // frames after enter, default 30
    duration?: number;  // frames, default 25
    value?: number;     // for counter type
  };
}

// ─── Text overlay inside a scene ─────────────────────────────
export interface SceneText {
  id: string;
  content: string;
  style: TextStyle;

  // Position: use slot OR explicit {x, y}
  slot?: TextSlotId;
  position?: { x: number; y: number };

  delay?: number;      // frames after scene.startFrame, default 0
  duration?: number;   // frames visible; if omitted: lasts until scene end

  background?: string; // for CALLOUT style
  color?: string;      // explicit override; otherwise compiler auto-picks by background darkness
  align?: "left" | "center" | "right";
  fontWeight?: number;
}

// ─── Paper card (evidence / survey) inside a scene ───────────
export interface ScenePaperCard {
  id: string;
  variant: "evidence" | "survey";
  body: string;
  title?: string;            // red header for survey
  choices?: string[];        // survey checkbox options
  position?: { x: number; y: number }; // default {0.5, 0.42}
  scale?: number;
  rotation?: number;
  delay?: number;            // frames after scene start
  duration?: number;         // frames visible; omit = until scene end
  width?: number;
}

// ─── TV/monitor frame with data content inside a scene ───────
export interface SceneFrameBox {
  id: string;
  contentSrc: string;        // image path under public/ (map, chart)
  caption?: string;
  position?: { x: number; y: number }; // default {0.5, 0.42}
  scale?: number;
  delay?: number;
  duration?: number;
  width?: number;
}

// ─── Speech bubble attached to a character in a scene ────────
// The reference video's primary dialogue device: nearly every conversational
// scene shows the actual spoken line in a bubble above the speaker.
export interface SceneSpeechBubble {
  id: string;
  anchorAssetId: string;     // assetId of the character speaking
  text: string;              // the line itself — keep ≤ 8 words
  style?: "speech" | "thought" | "shout"; // default: speech
  direction?: "left" | "right" | "top";   // tail direction, default right
  delay?: number;            // frames after scene start
  duration?: number;         // frames visible; omit = until scene end
}

// ─── Transition between scenes ───────────────────────────────
export type TransitionStyle = "flash" | "wipe" | "fadeBlack" | "fadeWhite" | "zoom";

export interface SceneTransition {
  style: TransitionStyle;
  duration?: number; // default 15 frames
}

// ─── Scene definition ────────────────────────────────────────
export interface Scene {
  id: string;
  label: string;           // human-readable description for debugging

  startFrame: number;      // absolute frame this scene begins
  durationFrames: number;  // how long this scene lasts

  layout: LayoutPreset;
  narration?: string;      // the words being spoken (helps compiler time things)
  sourceRange?: SourceRange;
  visualRegister?: VisualRegister;
  semanticTakeaway?: string;
  semanticAssetIds?: string[];
  claimIds?: string[];
  heroVisual?: boolean;
  unresolvedAssets?: string[];
  backgroundSrc?: string;  // CSS color/gradient or image path for background event
  backgroundBlur?: number;    // blur px for photo bg (8-14 recommended so flat 2D cat pops)
  backgroundOverlay?: string; // scrim over photo bg for legibility (e.g. "rgba(0,0,0,0.35)")

  entities: SceneEntity[];
  texts: SceneText[];

  paperCards?: ScenePaperCard[]; // evidence / survey cards
  frameBoxes?: SceneFrameBox[];  // TV/monitor data frames
  speechBubbles?: SceneSpeechBubble[]; // dialogue lines above characters

  camera?: SceneCameraHint;
  transition?: SceneTransition; // played at the START of this scene

  // Assets to clear when this scene starts
  // true = clear everything; string[] = clear specific assetIds
  clearPrevious?: boolean | string[];
}

// ─── Top-level SceneTimeline (what AI produces) ──────────────
export interface SceneTimeline {
  schemaVersion?: 1 | 2;
  fps: 30;
  width: 1920;
  height: 1080;
  durationInFrames: number;
  audio?: string;
  background?: string;
  scenes: Scene[];
}

// ─── Slot coordinate map (used by SceneCompiler) ─────────────
export const SLOT_POSITIONS: Record<SlotId, { x: number; y: number }> = {
  HOST:         { x: 0.50, y: 0.60 },   // main cat — slightly below center
  CENTER:       { x: 0.50, y: 0.50 },   // dead center
  CENTER_MID:   { x: 0.50, y: 0.52 },   // mid center (most common for characters)
  LEFT:         { x: 0.28, y: 0.52 },   // left character in dialogue
  RIGHT:        { x: 0.72, y: 0.52 },   // right character in dialogue
  LEFT_MID:     { x: 0.25, y: 0.52 },
  RIGHT_MID:    { x: 0.75, y: 0.52 },
  FAR_LEFT:     { x: 0.15, y: 0.52 },
  FAR_RIGHT:    { x: 0.85, y: 0.52 },
  LEFT_BOTTOM:  { x: 0.20, y: 0.65 },
  RIGHT_BOTTOM: { x: 0.80, y: 0.65 },
};

export const TEXT_SLOT_POSITIONS: Record<TextSlotId, { x: number; y: number }> = {
  TOP_TITLE:          { x: 0.50, y: 0.12 },
  SECTION_HEADER:     { x: 0.50, y: 0.15 },
  CALLOUT_LEFT:       { x: 0.25, y: 0.20 },
  CALLOUT_CENTER:     { x: 0.50, y: 0.20 },
  CALLOUT_RIGHT:      { x: 0.75, y: 0.20 },
  LABEL_UNDER_LEFT:   { x: 0.22, y: 0.62 },
  LABEL_UNDER_CENTER: { x: 0.50, y: 0.62 },
  LABEL_UNDER_RIGHT:  { x: 0.78, y: 0.62 },
  STAT_CENTER:        { x: 0.50, y: 0.45 },
  BODY:               { x: 0.50, y: 0.82 },
  CAPTION:            { x: 0.50, y: 0.91 },
  SUBTITLE:           { x: 0.50, y: 0.88 },
};

// Default slot assignments per layout preset
export const LAYOUT_ENTITY_SLOTS: Record<LayoutPreset, SlotId[]> = {
  // V3 layouts
  SOLO:               ["CENTER_MID"],
  TABLEAU:            ["LEFT", "RIGHT"], // fallback when entities have no anchor
  DIALOGUE:           ["LEFT", "RIGHT"],
  DUAL_CONTRAST:      ["LEFT_MID", "RIGHT_MID"],
  SIZE_HIERARCHY:     ["CENTER", "CENTER_MID"],
  CHAR_PROP:          ["LEFT", "RIGHT"],
  ICON_TRIPLE:        ["LEFT", "CENTER", "RIGHT"],
  QA_REVEAL:          ["CENTER_MID"],
  LINEUP:             ["FAR_LEFT", "LEFT", "RIGHT", "FAR_RIGHT"],
  STAT_DRAMA:         ["HOST"],
  CLOSE_UP:           ["CENTER_MID"],

  // Legacy layouts
  INTRO:              ["CENTER_MID"],
  SINGLE:             ["CENTER"],
  COMPARE:            ["LEFT_MID", "RIGHT_MID"],
  CAUSE_EFFECT:       ["LEFT", "RIGHT"],
  CAUSE_EFFECT_CHAIN: ["FAR_LEFT", "CENTER", "FAR_RIGHT"],
  ACCUMULATION:       ["LEFT", "CENTER", "RIGHT"],
  STAT:               ["HOST"],
  CONCLUSION:         ["CENTER_MID"],
  CTA:                ["CENTER_MID"],
  CUSTOM:             [],
};
