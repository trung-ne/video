import {
  Timeline,
  TimelineEvent,
  EnterEvent,
  ExitEvent,
  ClearEvent,
  EmphasizeEvent,
  SwapEvent,
  EmphasizeType,
} from "../types/timeline";

// ============================================================
// liveliness.ts — continuous micro-variation injector
//
// The reference channel NEVER lets the screen sit perfectly still. Even in a
// long static shot, something changes every ~5s: the cat swaps pose, does a
// little bounce, an icon pops in. Our AI tends to enter everything at frame 0
// then freeze for thousands of frames → boring.
//
// This post-processor runs on the COMPILED timeline (events) and, for every
// character asset, fills its long "quiet windows" with small automatic beats:
//   • emphasize  — subtle pulse / bounce / nod / shake (always safe)
//   • swap       — pose change within the same narrator-cat family (if the
//                  target pose asset exists)
//
// It is deterministic and idempotent-ish (guards against re-injecting).
// ============================================================

// Poses that are the SAME purple narrator cat, just different body language.
// Swapping among these keeps the character identity; swapping a costumed cat
// (cat_business, cat_dad…) would change identity, so those only get emphasize.
const NARRATOR_POSE_FAMILY = [
  "characters/cat",
  "characters/cat_talk",
  "characters/cat_explain",
  "characters/cat_think",
  "characters/cat_happy",
  "characters/cat_sad",
  "characters/cat_shrug",
  "characters/cat_surprised",
  "characters/cat_point_left",
];

// "Talking" poses used to animate a narrator cat during a hold (mouth/gesture).
const TALK_CYCLE = [
  "characters/cat_talk",
  "characters/cat_explain",
  "characters/cat_think",
];

const EMPHASIZE_CYCLE: EmphasizeType[] = ["pulse", "bounce", "pulse", "shake"];

export interface LivelinessOptions {
  availablePoses?: Set<string>; // pose srcs known to exist on disk (from render.ts scan)
  beatInterval?: number;        // frames between injected micro-beats (default 140 ≈ 4.7s)
  minWindow?: number;           // only fill quiet windows longer than this (default 200)
  fps?: number;
}

export interface LivelinessReport {
  emphasizesAdded: number;
  swapsAdded: number;
  charactersTouched: number;
}

interface Span {
  assetId: string;
  src: string;
  start: number;
  end: number;
}

// Build the active [start,end) span of every asset, honoring exit + clear-all.
function computeAssetSpans(events: TimelineEvent[], total: number): Span[] {
  const sorted = [...events].sort((a, b) => a.frame - b.frame);
  const open = new Map<string, Span>();
  const spans: Span[] = [];

  const close = (assetId: string, end: number) => {
    const s = open.get(assetId);
    if (s) {
      s.end = end;
      spans.push(s);
      open.delete(assetId);
    }
  };

  for (const ev of sorted) {
    if (ev.type === "enter") {
      const e = ev as EnterEvent;
      close(e.assetId, e.frame); // re-enter closes previous span
      open.set(e.assetId, { assetId: e.assetId, src: e.src, start: e.frame, end: total });
    } else if (ev.type === "swap") {
      const e = ev as SwapEvent;
      const s = open.get(e.assetId);
      if (s) s.src = e.src; // track current pose so we don't fight manual swaps
    } else if (ev.type === "exit") {
      close((ev as ExitEvent).assetId, ev.frame);
    } else if (ev.type === "clear") {
      const e = ev as ClearEvent;
      if (!e.assetIds || e.assetIds.length === 0) {
        for (const id of [...open.keys()]) close(id, ev.frame);
      } else {
        for (const id of e.assetIds) close(id, ev.frame);
      }
    }
  }
  for (const id of [...open.keys()]) close(id, total);
  return spans;
}

// Frames where a given asset already has a visual beat (emphasize/swap/move),
// so we only fill the genuine gaps.
function existingBeatFrames(events: TimelineEvent[], assetId: string): number[] {
  return events
    .filter(
      (e) =>
        (e.type === "emphasize" || e.type === "swap" || e.type === "move") &&
        (e as any).assetId === assetId
    )
    .map((e) => e.frame)
    .sort((a, b) => a - b);
}

export function injectLiveliness(
  timeline: Timeline,
  opts: LivelinessOptions = {}
): LivelinessReport {
  const interval = opts.beatInterval ?? 140;
  const minWindow = opts.minWindow ?? 200;
  const poses = opts.availablePoses;
  const total = timeline.durationInFrames;

  // Character spans get the full treatment (emphasize + narrator pose-swap).
  // Non-character focal assets (props/icons/finance/people — the icon nodes
  // of ICON_TRIPLE, DIAGRAM, POLICY_LIST, HISTORY_TIMELINE, etc.) still sit
  // on screen for the whole scene but previously got NO periodic beat at
  // all when a scene had no character entity, leaving those registers
  // completely static for their full duration. Give them emphasize-only
  // beats too. Thin connector glyphs (ui/arrow_*) are excluded — pulsing a
  // tiny connecting arrow every few seconds reads as jitter, not liveliness.
  const spans = computeAssetSpans(timeline.events, total).filter(
    (s) => !s.src.startsWith("ui/arrow")
  );

  const added: TimelineEvent[] = [];
  let emphasizesAdded = 0;
  let swapsAdded = 0;
  const touched = new Set<string>();

  for (const span of spans) {
    const windowLen = span.end - span.start;
    if (windowLen < minWindow) continue;

    const isNarratorCat = NARRATOR_POSE_FAMILY.includes(span.src);
    const existing = existingBeatFrames(timeline.events, span.assetId);
    const near = (f: number) => existing.some((x) => Math.abs(x - f) < interval * 0.5);

    // Place beats from start+buffer, every `interval`, up to end-buffer.
    let currentPose = span.src;
    let beatIndex = 0;
    for (let f = span.start + Math.round(interval * 0.9); f < span.end - 40; f += interval) {
      if (near(f)) { beatIndex++; continue; }
      touched.add(span.assetId);

      // Alternate: even beats → emphasize; odd beats → pose swap (narrator only)
      const doSwap =
        isNarratorCat && beatIndex % 2 === 1;

      if (doSwap) {
        // choose next talking pose different from current, that exists
        const candidates = TALK_CYCLE.filter(
          (p) => p !== currentPose && (!poses || poses.has(p))
        );
        const pick = candidates.length
          ? candidates[beatIndex % candidates.length]
          : null;
        if (pick) {
          added.push({ frame: f, type: "swap", assetId: span.assetId, src: pick } as SwapEvent);
          currentPose = pick;
          swapsAdded++;
          // swap back toward a neutral base a bit later so it reads as a gesture
          const back = Math.min(f + Math.round(interval * 0.5), span.end - 20);
          const basePose = poses && !poses.has(span.src) ? pick : span.src;
          if (back > f + 20) {
            added.push({ frame: back, type: "swap", assetId: span.assetId, src: basePose } as SwapEvent);
            currentPose = basePose;
            swapsAdded++;
          }
        } else {
          // no swap available → fall back to emphasize
          added.push(makeEmphasize(f, span.assetId, beatIndex));
          emphasizesAdded++;
        }
      } else {
        added.push(makeEmphasize(f, span.assetId, beatIndex));
        emphasizesAdded++;
      }
      beatIndex++;
    }
  }

  timeline.events.push(...added);
  timeline.events.sort((a, b) => a.frame - b.frame);

  return { emphasizesAdded, swapsAdded, charactersTouched: touched.size };
}

function makeEmphasize(frame: number, assetId: string, beatIndex: number): EmphasizeEvent {
  const animation = EMPHASIZE_CYCLE[beatIndex % EMPHASIZE_CYCLE.length];
  return {
    frame,
    type: "emphasize",
    assetId,
    animation,
    duration: animation === "shake" ? 18 : 22,
  } as EmphasizeEvent;
}

export function printLivelinessReport(r: LivelinessReport): void {
  console.log(`\n✨ Liveliness injector:`);
  console.log(
    `   ${r.charactersTouched} character(s) enlivened · +${r.emphasizesAdded} emphasize · +${r.swapsAdded} pose-swap beats`
  );
}
