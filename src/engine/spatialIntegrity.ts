import { computeFrameState } from "./timelineEngine";
import { Timeline, TimelineEvent } from "../types/timeline";
import {
  outsideBoxFraction,
  overlapRatio,
  visualPrimitivesAtFrame,
  VisualPrimitive,
  VisualPrimitiveKind,
  VisualBox,
} from "./visualGeometry";

const MAX_OVERLAP_OF_SMALLER = 0.20;
const MAX_TEXT_OVERLAP_OF_SMALLER = 0.08;
const MAX_OUT_OF_FRAME_FRACTION = 0.05;
const MIN_SMOOTH_MOVE_FRAMES = 8;
const MIN_MOTION_DISTANCE = 0.04;

export type SpatialIssueCode =
  | "ASSET_COLLISION"
  | "ASSET_OUT_OF_FRAME"
  | "UNDECLARED_ASSET_OVERLAP"
  | "FOREGROUND_COLLISION"
  | "TEXT_SUBTITLE_OVERLAP"
  | "PRIMITIVE_OUT_OF_FRAME"
  | "CONFLICTING_MOTION"
  | "ABRUPT_MOVE"
  | "UNEXPLAINED_POSITION_JUMP";

export interface SpatialIssue {
  code: SpatialIssueCode;
  frame: number;
  sceneId?: string;
  message: string;
  /** Kept for compatibility with asset-only callers. */
  assetIds: string[];
  primitiveKinds?: VisualPrimitiveKind[];
  bounds?: VisualBox[];
  overlapRatio?: number;
}

export interface SpatialIntegrityReport {
  passed: boolean;
  sampledFrames: number[];
  issues: SpatialIssue[];
}

export interface SceneSpan {
  id?: string;
  start: number;
  end: number;
  narrationBeatFrames?: number[];
}

/**
 * Compatibility export for tests and callers which need an asset's final content
 * bounds. The full gate uses visualPrimitivesAtFrame so entrance/exit/emphasis
 * transforms and camera movement are included.
 */
export function visibleAssetBox(asset: import("../types/timeline").AssetState, width: number, height: number): VisualBox {
  const timeline: Timeline = { fps: 30, width, height, durationInFrames: 1, events: [] };
  const state = computeFrameState({
    ...timeline,
    events: [{ type: "enter", frame: 0, assetId: asset.assetId, src: asset.src, position: asset.position, scale: asset.scale, zIndex: asset.zIndex }],
  }, 30);
  const primitive = visualPrimitivesAtFrame(timeline, {
    ...state,
    assets: new Map([[asset.assetId, asset]]),
    assetEnterInfo: new Map(),
    assetEnterFrames: new Map(),
  }, 30).find((candidate) => candidate.id === asset.assetId);
  if (!primitive) throw new Error(`Unable to calculate visible bounds for ${asset.assetId}.`);
  return primitive.box;
}

function addTransitionFrames(frames: Set<number>, start: number, duration: number, maxFrame: number): void {
  const safeDuration = Math.max(0, Math.round(duration));
  // Animation windows are generally <= 30 frames. Sampling every frame in them
  // catches transient collisions without turning a long hold into a render-costly
  // full-video scan. Long motion remains bounded at <=25 probes plus endpoints.
  const step = safeDuration <= 60 ? 1 : Math.max(1, Math.ceil(safeDuration / 24));
  for (let offset = 0; offset <= safeDuration; offset += step) {
    const frame = start + offset;
    if (frame >= 0 && frame < maxFrame) frames.add(frame);
  }
  if (start + safeDuration >= 0 && start + safeDuration < maxFrame) frames.add(start + safeDuration);
}

function sampleFrames(timeline: Timeline, sceneSpans?: SceneSpan[]): number[] {
  const frames = new Set<number>();
  for (const event of timeline.events) {
    switch (event.type) {
      case "enter":
        addTransitionFrames(frames, event.frame, event.animationDuration ?? 18, timeline.durationInFrames);
        break;
      case "exit":
        addTransitionFrames(frames, event.frame, event.animationDuration ?? 18, timeline.durationInFrames);
        break;
      case "move":
      case "camera":
        addTransitionFrames(frames, event.frame, event.duration, timeline.durationInFrames);
        break;
      case "emphasize":
        addTransitionFrames(frames, event.frame, event.duration ?? 18, timeline.durationInFrames);
        break;
      default:
        if (event.frame >= 0 && event.frame < timeline.durationInFrames) frames.add(event.frame);
        break;
    }
  }
  for (const scene of sceneSpans ?? []) {
    frames.add(scene.start + 1);
    frames.add(scene.start + 25);
    frames.add(scene.end - 1);
    for (const frame of scene.narrationBeatFrames ?? []) frames.add(frame);
  }
  return [...frames]
    .filter((frame) => Number.isInteger(frame) && frame >= 0 && frame < timeline.durationInFrames)
    .sort((a, b) => a - b);
}

function isPermittedOverlap(a: VisualPrimitive, b: VisualPrimitive): boolean {
  if (a.kind === "speech-bubble" && a.ownerId === b.id) return true;
  if (b.kind === "speech-bubble" && b.ownerId === a.id) return true;
  return a.kind === "asset" && b.kind === "asset" &&
    (a.allowOverlapWith?.includes(b.id) === true || b.allowOverlapWith?.includes(a.id) === true);
}

function shouldCheckPair(a: VisualPrimitive, b: VisualPrimitive): boolean {
  const panels = new Set<VisualPrimitiveKind>(["card", "paper-card", "frame-box"]);
  if (a.kind === "asset" && b.kind === "asset") return true;
  if (panels.has(a.kind) && panels.has(b.kind)) return true;
  // A bubble has an explicit owner exception; it may not cover any other foreground object.
  if (a.kind === "speech-bubble" || b.kind === "speech-bubble") return true;
  // V4 reserves the subtitle band for subtitles. Other normal text may sit over a
  // panel or be compositionally adjacent to an asset, so it is not treated as a
  // geometric collision on its own.
  return (a.kind === "subtitle" && b.kind === "text") || (b.kind === "subtitle" && a.kind === "text");
}

function overlapThreshold(a: VisualPrimitive, b: VisualPrimitive): number {
  return a.kind === "text" || a.kind === "subtitle" || b.kind === "text" || b.kind === "subtitle"
    ? MAX_TEXT_OVERLAP_OF_SMALLER
    : MAX_OVERLAP_OF_SMALLER;
}

function sceneAt(sceneSpans: SceneSpan[] | undefined, frame: number): string | undefined {
  return sceneSpans?.find((scene) => frame >= scene.start && frame < scene.end)?.id;
}

function motionIssues(timeline: Timeline, sceneSpans: SceneSpan[] | undefined): SpatialIssue[] {
  const issues: SpatialIssue[] = [];
  const events = [...timeline.events].sort((a, b) => a.frame - b.frame);
  const moves = events.filter((event): event is Extract<TimelineEvent, { type: "move" }> => event.type === "move");
  for (const move of moves) {
    const distance = Math.hypot(move.position.x, move.position.y);
    if (move.duration < MIN_SMOOTH_MOVE_FRAMES) {
      issues.push({
        code: "ABRUPT_MOVE",
        frame: move.frame,
        sceneId: sceneAt(sceneSpans, move.frame),
        assetIds: [move.assetId],
        message: `${move.assetId} moves over ${move.duration} frames; visible motion must last at least ${MIN_SMOOTH_MOVE_FRAMES} frames.`,
      });
    }
    // The actual distance is checked against the asset's preceding state below;
    // an endpoint-only event cannot establish an intentional smooth trajectory.
    void distance;
  }
  for (let index = 0; index < moves.length; index += 1) {
    const a = moves[index];
    for (let other = index + 1; other < moves.length; other += 1) {
      const b = moves[other];
      if (a.assetId !== b.assetId || b.frame >= a.frame + a.duration) continue;
      issues.push({
        code: "CONFLICTING_MOTION",
        frame: b.frame,
        sceneId: sceneAt(sceneSpans, b.frame),
        assetIds: [a.assetId],
        message: `${a.assetId} has overlapping move events at frames ${a.frame} and ${b.frame}; author one continuous trajectory.`,
      });
    }
  }
  return issues;
}

function center(box: VisualBox): { x: number; y: number } {
  return { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
}

function hasExpectedAnimation(timeline: Timeline, primitive: VisualPrimitive, from: number, to: number): boolean {
  return timeline.events.some((event) => {
    if (event.type === "camera" && event.frame <= to && event.frame + event.duration >= from) return true;
    if (event.type === "enter" && event.assetId === primitive.id) return event.frame <= to && event.frame + (event.animationDuration ?? 18) >= from;
    if (event.type === "exit" && event.assetId === primitive.id) return event.frame <= to && event.frame + (event.animationDuration ?? 18) >= from;
    if (event.type === "move" && event.assetId === primitive.id) return event.frame <= to && event.frame + event.duration >= from;
    if (event.type === "emphasize" && event.assetId === primitive.id) return event.frame <= to && event.frame + (event.duration ?? 18) >= from;
    if (event.type === "swap" && event.assetId === primitive.id) return event.frame >= from && event.frame <= to;
    if (event.type === "text" && event.textId === primitive.id) return event.frame <= to && event.frame + 18 >= from;
    if (event.type === "speechBubble" && event.bubbleId === primitive.id) return event.frame <= to && event.frame + 18 >= from;
    if ((event.type === "card" || event.type === "paperCard") && event.cardId === primitive.id) return event.frame <= to && event.frame + 18 >= from;
    if (event.type === "frameBox" && event.frameId === primitive.id) return event.frame <= to && event.frame + 18 >= from;
    return false;
  });
}

function temporalContinuityIssues(
  timeline: Timeline,
  frames: number[],
  primitiveByFrame: Map<number, VisualPrimitive[]>,
  sceneSpans: SceneSpan[] | undefined,
): SpatialIssue[] {
  const issues: SpatialIssue[] = [];
  for (let index = 1; index < frames.length; index += 1) {
    const previousFrame = frames[index - 1];
    const frame = frames[index];
    if (frame !== previousFrame + 1) continue;
    const previous = new Map((primitiveByFrame.get(previousFrame) ?? []).map((item) => [item.id, item]));
    for (const primitive of primitiveByFrame.get(frame) ?? []) {
      const prior = previous.get(primitive.id);
      if (!prior || hasExpectedAnimation(timeline, primitive, previousFrame, frame)) continue;
      const from = center(prior.box);
      const to = center(primitive.box);
      const displacement = Math.hypot(to.x - from.x, to.y - from.y);
      const smallerSide = Math.max(1, Math.min(prior.box.x1 - prior.box.x0, prior.box.y1 - prior.box.y0));
      const scaleDelta = Math.max(
        Math.abs((primitive.box.x1 - primitive.box.x0) / Math.max(1, prior.box.x1 - prior.box.x0) - 1),
        Math.abs((primitive.box.y1 - primitive.box.y0) / Math.max(1, prior.box.y1 - prior.box.y0) - 1),
      );
      if (displacement > smallerSide * 0.25 || scaleDelta > 0.25 || Math.abs(primitive.opacity - prior.opacity) > 0.25) {
        issues.push({
          code: "UNEXPLAINED_POSITION_JUMP",
          frame,
          sceneId: sceneAt(sceneSpans, frame),
          assetIds: [primitive.id],
          primitiveKinds: [primitive.kind],
          bounds: [prior.box, primitive.box],
          message: `${primitive.kind} ${primitive.id} changes discontinuously between frames ${previousFrame} and ${frame} without an authored transition.`,
        });
      }
    }
  }
  return issues;
}

export function checkSpatialIntegrity(timeline: Timeline, sceneSpans?: SceneSpan[]): SpatialIntegrityReport {
  const sampledFrames = sampleFrames(timeline, sceneSpans);
  const issues = motionIssues(timeline, sceneSpans);
  const seen = new Set<string>();
  const primitiveByFrame = new Map<number, VisualPrimitive[]>();
  for (const frame of sampledFrames) {
    const state = computeFrameState(timeline, frame);
    const primitives = visualPrimitivesAtFrame(timeline, state, frame);
    primitiveByFrame.set(frame, primitives);
    for (const primitive of primitives) {
      const fraction = outsideBoxFraction(primitive.box, timeline.width, timeline.height);
      // Monitors include their stand/caption below the declared centre. A small
      // overscan is intentional stage framing, while a largely cropped panel is
      // still an error. Artwork and documents retain the strict 5% bound.
      const allowedOutside = primitive.kind === "frame-box" ? 0.15 : MAX_OUT_OF_FRAME_FRACTION;
      if (fraction <= allowedOutside) continue;
      const key = `out:${sceneAt(sceneSpans, frame) ?? "?"}:${primitive.kind}:${primitive.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push({
        code: primitive.kind === "asset" ? "ASSET_OUT_OF_FRAME" : "PRIMITIVE_OUT_OF_FRAME",
        frame,
        sceneId: sceneAt(sceneSpans, frame),
        assetIds: [primitive.id],
        primitiveKinds: [primitive.kind],
        bounds: [primitive.box],
        message: `${primitive.kind} ${primitive.id} has ${(fraction * 100).toFixed(0)}% of its visible geometry outside the canvas.`,
      });
    }
    for (let index = 0; index < primitives.length; index += 1) {
      for (let other = index + 1; other < primitives.length; other += 1) {
        const a = primitives[index];
        const b = primitives[other];
        if (!shouldCheckPair(a, b)) continue;
        const ratio = overlapRatio(a.box, b.box);
        if (ratio <= overlapThreshold(a, b) || isPermittedOverlap(a, b)) continue;
        // One collision declaration is enough to block. Keeping its first frame
        // gives the author an actionable source location without generating one
        // identical issue per animation frame.
        const key = `collision:${sceneAt(sceneSpans, frame) ?? "?"}:${a.kind}:${a.id}:${b.kind}:${b.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const subtitle = a.kind === "subtitle" || b.kind === "subtitle";
        const assets = a.kind === "asset" && b.kind === "asset";
        issues.push({
          code: subtitle ? "TEXT_SUBTITLE_OVERLAP" : assets ? "UNDECLARED_ASSET_OVERLAP" : "FOREGROUND_COLLISION",
          frame,
          sceneId: sceneAt(sceneSpans, frame),
          assetIds: [a.id, b.id],
          primitiveKinds: [a.kind, b.kind],
          bounds: [a.box, b.box],
          overlapRatio: ratio,
          message: `${a.kind} ${a.id} and ${b.kind} ${b.id} overlap ${(ratio * 100).toFixed(0)}% of the smaller rendered element. Separate their authored placement or declare only a genuine owned interaction.`,
        });
      }
    }
  }
  issues.push(...temporalContinuityIssues(timeline, sampledFrames, primitiveByFrame, sceneSpans));
  return { passed: issues.length === 0, sampledFrames, issues };
}

export function formatSpatialIntegrityReport(report: SpatialIntegrityReport): string {
  if (report.passed) return `Spatial integrity: pass (${report.sampledFrames.length} checkpoints)`;
  return [
    `Spatial integrity: ${report.issues.length} blocker(s) across ${report.sampledFrames.length} checkpoints`,
    ...report.issues.slice(0, 12).map((issue) =>
      `  [${issue.code}] scene ${issue.sceneId ?? "?"}, frame ${issue.frame}: ${issue.message}`),
  ].join("\n");
}
