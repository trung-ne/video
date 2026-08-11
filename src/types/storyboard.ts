// ============================================================
// Storyboard — the AUTHORING layer above SceneTimeline.
//
// This is the one place the LLM is asked to be creative: split the
// transcript into beats, decide the PURPOSE / EMOTION / FOCUS of each,
// pick a VISUAL GRAMMAR, and fill its concept slots. It does NOT place
// entities, choose animations, or compute frames — storyboardCompiler.ts
// turns a Storyboard into a SceneTimeline deterministically, and the
// existing sceneCompiler/motion-engine takes it the rest of the way.
//
//   Transcript → Storyboard (LLM) → SceneTimeline (compile) → events → Remotion
//
// Browser-safe: pure types, no runtime.
// ============================================================

// The visual grammars the compiler knows how to expand deterministically.
// Adding a grammar = adding one pure function in visualGrammars.ts.
export type VisualGrammar =
  | "COMPARE"       // two concepts side by side + arrow/highlight
  | "STAT_REVEAL"   // one shock number lands big, pulses on the beat
  | "POLICY_LIST"   // a lineup of numbered items/actors
  | "DIALOGUE_QA"   // two cats trade lines via speech bubbles
  | "TABLEAU"       // characters seated inside an illustrated stage set
  | "EVIDENCE"      // a paper card / TV frame showing a quote or data
  | "FRAMEBOX"      // image/data inside a drawn TV frame + a reacting cat
  | "CHAR_PROP"     // a cat looking at / pointing to an object (Kuleshov)
  | "DIAGRAM"       // a left→right flow of items connected by arrows
  | "CAUSE_EFFECT"  // cause → arrow → effect
  | "QA_REVEAL"     // a question, then the answer revealed later
  | "ICON_TRIPLE"   // three concepts in colored circles
  | "BEAT"          // full-bleed emotional image, no character, no overlay
  | "SOLO"          // one expressive cat addressing the viewer + a keyword
  | "MAP_FLOW"
  | "DATA_CHART"
  | "SURVEY_CARD"
  | "PHOTO_EVIDENCE"
  | "SCREEN_CAPTURE"
  | "FULL_SCENE_ACTION"
  | "HISTORY_TIMELINE"
  | "VISUAL_METAPHOR"
  | "FREEFORM";     // escape hatch: an author-written Scene is embedded as-is

export type Emotion =
  | "neutral" | "surprise" | "concern" | "sad" | "hopeful"
  | "sarcastic" | "curious" | "urgent" | "happy";

// Camera shot size — drives character scale + optional gentle zoom.
export type Shot = "wide" | "medium" | "close";

export type VisualRegister =
  | "character_action"
  | "infographic"
  | "evidence"
  | "photo_broll"
  | "framebox"
  | "visual_gag"
  | "full_tableau";

export type FocalType =
  | "character_action"
  | "full_scene"
  | "chart"
  | "map"
  | "diagram"
  | "evidence"
  | "photo"
  | "screenshot"
  | "visual_gag";

export type PhotoTreatment =
  | "full_bleed" | "tv_frame" | "document" | "screen"
  | "map" | "headline" | "cutaway";

export interface VisualUsageBudgets {
  maximumAssetUses: number;
  maximumStageRatio: number;
  maximumPoseRatio: number;
  maximumConsecutiveSameStage: number;
  maximumPhotoTreatmentRatio: number;
  maximumStatRevealRatio: number;
}

export interface VisualTreatmentPlan {
  registerTargets: Partial<Record<VisualRegister, number>>;
  characterFreeTarget: number;
  heroConcepts: string[];
  visualMotifs: string[];
  forbiddenRepeats: string[];
  usageBudgets: VisualUsageBudgets;
  requiredVisualModes: string[];
  heroCadenceSeconds: number;
  paletteProfile: "editorial-muted-v2";
}

export interface SourceRange {
  startWord: number;
  endWord: number;
  quoteChecksum: string;
}

export interface SemanticVisual {
  subject: string;
  action: string;
  object?: string;
  relation?: string;
  setting?: string;
  takeaway: string;
}

export interface AssetRequest {
  role: "character" | "prop" | "stage" | "photo" | "chart" | "ui";
  slot: string;
  query: string;
  requiredTags: string[];
  preferredTags?: string[];
  preferredAssetId?: string;
  lockedAssetId?: string;
  continuityReason?: string;
  allowGenerate: boolean;
}

export interface AssetSelection extends Omit<AssetRequest, "slot" | "role"> {
  role?: AssetRequest["role"];
}

export interface SceneContinuity {
  locationId?: string;
  castIds: string[];
  callbackId?: string;
}

export interface Beat {
  // A verbatim substring of the brief's narration that this beat covers.
  // The word-alignment step maps it to a frame so emphasis lands on the word.
  text: string;
  // 0..1 — how hard to hit it (drives pulse/shake strength + keyword size).
  importance: number;
  kind: "number" | "keyword" | "turn"; // turn = a rhetorical pivot
  /** Rendered target and state transition; beats without a target are not motion directions. */
  targetSlot?: string;
  action?: "swap_pose" | "swap_asset" | "focus_actor" | "focus_asset" | "reveal" | "emphasize" | "advance" | "handoff";
  targetAssetId?: string;
  /** Short on-screen label for an authored cutaway; never inferred from narration. */
  targetLabel?: string;
  holdState?: string;
}

export interface SceneBrief {
  id: string;
  // Full spoken line for this scene — becomes narration (subtitle source).
  narration: string;
  /**
   * Performance direction for the TTS backend. It is never rendered or
   * considered part of narration/subtitles.
   */
  ttsInstruction?: string;
  /** Claims whose wording/value must survive TTS and ASR comparison exactly. */
  criticalClaims?: string[];
  /** TTS-only surface-to-reading hints; canonical narration is unchanged. */
  pronunciationOverrides?: Record<string, string>;

  // ── Authoring intent (what the LLM is actually good at) ──
  purpose: string;        // one line: what this scene must make the viewer get
  emotion: Emotion;
  viewerFocus: string;    // the ONE thing the eye should land on
  visualGrammar: VisualGrammar;
  sectionId?: string;
  sourceRange?: SourceRange;
  visualRegister?: VisualRegister;
  semanticVisual?: SemanticVisual;
  claimIds?: string[];
  heroVisual?: boolean;
  focalType?: FocalType;
  characterRequired?: boolean;
  visualFingerprint?: string;
  silentFrameTakeaway?: string;
  focalOccupancyTarget?: number;
  noveltyFromPrevious?: string[];
  assetRequests?: AssetRequest[];
  resolvedAssets?: Record<string, string>;
  unresolvedAssetRequests?: string[];
  continuity?: SceneContinuity;
  photoTreatment?: PhotoTreatment;
  captionTreatment?: "none" | "environmental" | "source-label" | "chapter-pill" | "speech-bubble";
  evidenceTreatment?: "none" | "document" | "headline" | "screen" | "map" | "source-card";
  assetResolutionNotes?: string[];
  shot?: Shot;            // default: medium

  // Concept fills for the chosen grammar. Keys depend on grammar, e.g.
  // COMPARE → { left, right }; STAT_REVEAL → { stat, unit }; DIALOGUE_QA →
  // { askerText, answererText }; TABLEAU → { stage, seatA, seatB }.
  slots?: Record<string, string>;

  beats?: Beat[];

  // FREEFORM escape hatch: a fully-authored Scene object (same shape the
  // old pipeline produced) that the compiler passes through untouched.
  freeform?: unknown;
}

export interface Storyboard {
  schemaVersion?: 1 | 2;
  transcriptChecksum?: string;
  promptVersion?: string;
  fps: number;
  width: number;
  height: number;
  audio?: string;
  // Casting table — role name → { src costume, badge }. Kept stable so a
  // character reads as the same person across scenes (reference-video style).
  cast?: Record<string, { src: string; badge?: string; poseFamily?: "narrator" }>;
  sections?: StorySection[];
  claims?: StoryClaim[];
  visualTreatmentPlan?: VisualTreatmentPlan;
  generation?: {
    provider?: string;
    model?: string;
    passIds?: string[];
    repairs?: Array<{ sceneId: string; reason: string }>;
  };
  scenes: SceneBrief[];
}

/**
 * Route A's hand-authored source shape. Creative/semantic fields are required
 * here so every project uses the same contract instead of copying a local
 * interface that can drift from build-storyboard.ts.
 */
export interface AuthoredScene {
  marker: string;
  narrationOverride?: string;
  /** Hand-authored delivery direction for expressive TTS; never spoken. */
  ttsInstruction?: string;
  /** Proper names, terms, or numeric claims that must not be lost or changed. */
  criticalClaims?: string[];
  /** TTS-only surface-to-reading hints; never rewrite subtitle narration. */
  pronunciationOverrides?: Record<string, string>;
  grammar: VisualGrammar;
  emotion: Emotion;
  purpose: string;
  viewerFocus: string;
  slots?: Record<string, string>;
  heroVisual?: boolean;
  shot?: Shot;
  visualRegister: VisualRegister;
  focalType: FocalType;
  semanticVisual: SemanticVisual;
  silentFrameTakeaway: string;
  focalOccupancyTarget: number;
  characterRequired?: boolean;
  photoTreatment?: PhotoTreatment;
  captionTreatment?: SceneBrief["captionTreatment"];
  evidenceTreatment?: SceneBrief["evidenceTreatment"];
  sectionId?: string;
  claimIds?: string[];
  beats?: Beat[];
  assetSelections?: Record<string, AssetSelection>;
}

export interface StorySection {
  id: string;
  sourceRange: SourceRange;
  sourceMarker?: string;
  thesis: string;
  emotionalTurn: string;
  energyCurve?: "build" | "sustain" | "release" | "climax";
  targetDurationSeconds?: number;
  claimVisuals?: string[];
  treatmentSequence?: VisualRegister[];
  heroConcept?: string;
  requiredProps?: string[];
  requiredSettings?: string[];
  requiredCharacterRoles?: string[];
  noCharacterOpportunity?: boolean;
  visualContrastFromPreviousSection?: string;
}

export interface StoryClaim {
  id: string;
  text: string;
  sourceRange: SourceRange;
  /** Route-A authoring may resolve this verbatim transcript marker at build time. */
  sourceMarker?: string;
  evidencePolicy: "none" | "quote" | "data" | "source_card";
  sceneIds?: string[];
  publisher?: string;
  title?: string;
  date?: string;
  url?: string;
  checkedDate?: string;
  shortSourceLabel?: string;
}

// One aligned word (from scripts/align_words.py → words.json).
export interface AlignedWord {
  /** Canonical TTS scene that spoke this token. */
  scene?: string;
  /** Zero-based token position inside the canonical narration for `scene`. */
  sceneWordIndex?: number;
  /** Zero-based token position in the full canonical TTS script. */
  canonicalWordIndex?: number;
  /** Optional trace back to the source transcript; never used to cue subtitles. */
  wordIndex?: number;
  word: string;
  startSec: number;
  endSec: number;
  confidence?: number;
}
