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
  | "BEAT"          // full-bleed emotional image, no character, no overlay
  | "SOLO"          // one expressive cat addressing the viewer + a keyword
  | "FREEFORM";     // escape hatch: an author-written Scene is embedded as-is

export type Emotion =
  | "neutral" | "surprise" | "concern" | "sad" | "hopeful"
  | "sarcastic" | "curious" | "urgent" | "happy";

// Camera shot size — drives character scale + optional gentle zoom.
export type Shot = "wide" | "medium" | "close";

export interface Beat {
  // A verbatim substring of the brief's narration that this beat covers.
  // The word-alignment step maps it to a frame so emphasis lands on the word.
  text: string;
  // 0..1 — how hard to hit it (drives pulse/shake strength + keyword size).
  importance: number;
  kind: "number" | "keyword" | "turn"; // turn = a rhetorical pivot
}

export interface SceneBrief {
  id: string;
  // Full spoken line for this scene — becomes narration (subtitle source).
  narration: string;

  // ── Authoring intent (what the LLM is actually good at) ──
  purpose: string;        // one line: what this scene must make the viewer get
  emotion: Emotion;
  viewerFocus: string;    // the ONE thing the eye should land on
  visualGrammar: VisualGrammar;
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
  fps: number;
  width: number;
  height: number;
  audio?: string;
  // Casting table — role name → { src costume, badge }. Kept stable so a
  // character reads as the same person across scenes (reference-video style).
  cast?: Record<string, { src: string; badge?: string }>;
  scenes: SceneBrief[];
}

// One aligned word (from scripts/align_words.py → words.json).
export interface AlignedWord {
  scene?: string;
  word: string;
  startSec: number;
  endSec: number;
}
