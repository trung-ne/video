import {
  Timeline,
  TimelineEvent,
  EnterEvent,
  ExitEvent,
  ClearEvent,
  EmphasizeEvent,
  SwapEvent,
  MoveEvent,
  CameraEvent,
  BackgroundEvent,
  EmphasizeType,
  AssetState,
} from "../types/timeline";
import { boxesOverlapRatio, visibleAssetBox } from "./spatialIntegrity";

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
const INVESTOR_POSE_FAMILY = [
  "characters/cat_investor_phone",
  "characters/cat_investor_contract",
  "characters/cat_investor_panic",
];

const EMPHASIZE_CYCLE: EmphasizeType[] = ["pulse", "bounce", "pulse", "shake"];

export interface LivelinessOptions {
  availablePoses?: Set<string>; // pose srcs known to exist on disk (from render.ts scan)
  beatInterval?: number;        // frames between injected micro-beats (default 140 ≈ 4.7s)
  minWindow?: number;           // only fill quiet windows longer than this (default 200)
  fps?: number;
  sceneSpans?: Array<{
    start: number;
    end: number;
    narrationBeatFrames?: number[];
  }>;
}

export interface LivelinessReport {
  emphasizesAdded: number;
  swapsAdded: number;
  movesAdded: number;
  cameraMovesAdded: number;
  backgroundBeatsAdded: number;
  charactersTouched: number;
}

interface Span {
  assetId: string;
  src: string;
  position: { x: number; y: number };
  scale: number;
  motionPolicy: "fixed" | "collision-safe";
  start: number;
  end: number;
}

interface SceneSpan {
  start: number;
  end: number;
  narrationBeatFrames?: number[];
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
      open.set(e.assetId, {
        assetId: e.assetId,
        src: e.src,
        position: { ...e.position },
        scale: e.scale,
        motionPolicy: e.motionPolicy ?? "collision-safe",
        start: e.frame,
        end: total,
      });
    } else if (ev.type === "swap") {
      const e = ev as SwapEvent;
      const s = open.get(e.assetId);
      if (s) s.src = e.src; // track current pose so we don't fight manual swaps
    } else if (ev.type === "move") {
      const e = ev as MoveEvent;
      const s = open.get(e.assetId);
      if (s) s.position = { ...e.position };
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
  // A non-fixed asset may move only to a candidate that clears every peer's
  // visible alpha box. Fixed stage anchors deliberately have no candidate.
  const safeMove = (span: Span, frame: number, direction: number, beatIndex: number) => {
    if (span.motionPolicy === "fixed") return null;
    const candidates = [
      { dx: direction * 0.06, dy: ((beatIndex % 3) - 1) * 0.012, scale: direction > 0 ? 1.06 : 0.94 },
      { dx: -direction * 0.04, dy: 0, scale: 1 },
      { dx: 0, dy: -0.03, scale: 1 },
    ];
    for (const candidate of candidates) {
      const asset: AssetState = {
        assetId: span.assetId, src: span.src,
        position: { x: Math.max(0.12, Math.min(0.88, span.position.x + candidate.dx)), y: Math.max(0.16, Math.min(0.82, span.position.y + candidate.dy)) },
        scale: span.scale * candidate.scale, opacity: 1, zIndex: 1, visible: true,
      };
      const box = visibleAssetBox(asset, timeline.width, timeline.height);
      const blocked = spans.some((other) => {
        if (other.assetId === span.assetId || other.start > frame || other.end <= frame) return false;
        const peer: AssetState = { assetId: other.assetId, src: other.src, position: other.position, scale: other.scale, opacity: 1, zIndex: 1, visible: true };
        return boxesOverlapRatio(box, visibleAssetBox(peer, timeline.width, timeline.height)) > 0.20;
      });
      if (!blocked) return { position: asset.position, scale: asset.scale };
    }
    return null;
  };

  const added: TimelineEvent[] = [];
  let emphasizesAdded = 0;
  let swapsAdded = 0;
  let movesAdded = 0;
  let cameraMovesAdded = 0;
  let backgroundBeatsAdded = 0;
  const touched = new Set<string>();

  const clearFrames = timeline.events
    .filter((event) => event.type === "clear")
    .map((event) => event.frame)
    .filter((frame, index, values) => index === 0 || frame !== values[index - 1])
    .sort((a, b) => a - b);
  const fallbackStarts = clearFrames[0] === 0 ? clearFrames : [0, ...clearFrames];
  const sceneSpans: SceneSpan[] = opts.sceneSpans ?? fallbackStarts.map((start, sceneIndex) => ({
    start,
    end: fallbackStarts[sceneIndex + 1] ?? total,
    narrationBeatFrames: [],
  }));

  for (const [spanIndex, span] of spans.entries()) {
    const windowLen = span.end - span.start;
    if (windowLen < minWindow) continue;

    const isNarratorCat = NARRATOR_POSE_FAMILY.includes(span.src);
    const isInvestorCat = INVESTOR_POSE_FAMILY.includes(span.src);
    const isCharacter = span.src.startsWith("characters/");
    const existing = existingBeatFrames(timeline.events, span.assetId);
    const near = (f: number) => existing.some((x) => Math.abs(x - f) < interval * 0.5);

    const ownerScene = sceneSpans.find(
      (scene) => span.start >= scene.start && span.start < scene.end,
    );
    const narrationFrames = (ownerScene?.narrationBeatFrames ?? [])
      .filter((frame) => frame >= span.start + 55 && frame < span.end - 35)
      .sort((a, b) => a - b)
      .filter((frame, index, values) => index === 0 || frame - values[index - 1] >= 55);
    const fallbackFrames: number[] = [];
    for (let f = span.start + Math.round(interval * 0.9); f < span.end - 40; f += interval) {
      fallbackFrames.push(f);
    }
    // Subtitle cues are derived from measured word alignment. They are the
    // editorial beat source; the periodic list only fills unusually long gaps.
    const candidateFrames = [...narrationFrames];
    for (const frame of fallbackFrames) {
      if (!candidateFrames.some((candidate) => Math.abs(candidate - frame) < 75)) {
        candidateFrames.push(frame);
      }
    }
    candidateFrames.sort((a, b) => a - b);

    // Persistent moves/swaps survive until the following narration beat. The
    // old short emphasize-only pulse disappeared between 5-second audit samples.
    let currentPose = span.src;
    let beatIndex = 0;
    for (const f of candidateFrames) {
      if (near(f)) { beatIndex++; continue; }
      touched.add(span.assetId);

      const doSwap = isNarratorCat || isInvestorCat;
      const direction = (spanIndex + beatIndex) % 2 === 0 ? 1 : -1;
      // The move must read as a changed relationship, not sub-pixel idle
      // drift. At 1080p the former 0.04–0.055 shift left successive poses
      // heavily overlapping and measured under 1% structural change.
      const isCenterFocal = Math.abs(span.position.x - 0.5) < 0.18;
      const displacement = isCharacter
        ? (isCenterFocal ? 0.22 : 0.10)
        : (isCenterFocal ? 0.16 : 0.075);

      const safe = safeMove(span, f, direction, beatIndex);
      if (safe) {
        // A persistent but bounded layout change carries the beat across audit
        // samples without borrowing space from a peer.
        added.push({
          frame: f,
          type: "move",
          assetId: span.assetId,
          position: safe.position,
          scale: safe.scale,
          duration: 18,
        } as MoveEvent);
        movesAdded++;
      }

      if (doSwap) {
        // choose next talking pose different from current, that exists
        const poseCycle = isInvestorCat ? INVESTOR_POSE_FAMILY : TALK_CYCLE;
        const candidates = poseCycle.filter(
          (p) => p !== currentPose && (!poses || poses.has(p))
        );
        const pick = candidates.length
          ? candidates[beatIndex % candidates.length]
          : null;
        if (pick) {
          added.push({ frame: f, type: "swap", assetId: span.assetId, src: pick } as SwapEvent);
          currentPose = pick;
          swapsAdded++;
          // Keep the pose until the next narration beat. A short swap-and-back
          // pulse disappears between 5-second audit samples and, more
          // importantly, leaves the composition editorially unchanged.
        } else {
          // no swap available → fall back to emphasize
          added.push(makeEmphasize(f, span.assetId, beatIndex));
          emphasizesAdded++;
        }
      } else {
        // A brief emphasis lands the word; the move above keeps the resulting
        // composition changed after the emphasis ends.
        if (isCharacter || beatIndex % 2 === 0) {
          added.push(makeEmphasize(f, span.assetId, beatIndex));
          emphasizesAdded++;
        }
      }
      beatIndex++;
    }
  }

  // Illustrated TABLEAU stages occupy most pixels, so foreground-only motion
  // can still read as the same shot. At measured narration boundaries, wash
  // the stage back briefly/persistently so the authored focal cat/prop becomes
  // the visual sentence. This changes a component state, never the camera.
  for (const scene of sceneSpans) {
    const baseBackground = timeline.events
      .filter((event): event is BackgroundEvent => event.type === "background" && event.frame === scene.start)
      .at(-1);
    if (!baseBackground || !/(?:^|\/)assets\/scenes\//.test(baseBackground.src)) continue;
    const cueFrames: number[] = [];
    // A state change must cross the five-second audit cadence. Word cues can
    // land too early, leaving both sampled frames in the same visual state.
    for (let frame = scene.start + Math.max(90, Math.round((scene.end - scene.start) * 0.45)); frame < scene.end - 35; frame += 120) {
      cueFrames.push(frame);
    }
    cueFrames.forEach((frame, index) => {
      added.push({
        frame,
        type: "background",
        src: baseBackground.src,
        blur: baseBackground.blur,
        opacity: baseBackground.opacity,
        overlay: index % 2 === 0
          ? "rgba(255,255,255,0.28)"
          : "rgba(255,255,255,0.05)",
        duration: 18,
      } as BackgroundEvent);
      backgroundBeatsAdded++;
    });
  }

  // Camera changes persist between narration beats. Prefer real authored scene
  // spans; clear events are only a fallback for legacy event-only timelines.
  sceneSpans.forEach(({ start, end }) => {
    if (end - start < minWindow) return;
    const authoredCameraFrames = timeline.events
      .filter((event) => event.type === "camera" && event.frame >= start && event.frame < end)
      .map((event) => event.frame);
    if (start > 0 && !authoredCameraFrames.some((frame) => Math.abs(frame - start) <= 1)) {
      added.push({
        frame: start,
        type: "camera",
        zoom: 1,
        centerX: 0.5,
        centerY: 0.5,
        duration: 1,
      } as CameraEvent);
      cameraMovesAdded++;
    }
    // Camera motion is not a generic liveliness substitute. Authored camera
    // beats survive; the injector only resets the viewport between scenes.
  });

  timeline.events.push(...added);
  timeline.events.sort((a, b) => a.frame - b.frame);

  return {
    emphasizesAdded,
    swapsAdded,
    movesAdded,
    cameraMovesAdded,
    backgroundBeatsAdded,
    charactersTouched: touched.size,
  };
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
    `   ${r.charactersTouched} character(s) enlivened · +${r.emphasizesAdded} emphasize · +${r.swapsAdded} pose-swap · +${r.movesAdded} persistent move · +${r.backgroundBeatsAdded} stage-focus beats · +${r.cameraMovesAdded} camera beats`
  );
}
