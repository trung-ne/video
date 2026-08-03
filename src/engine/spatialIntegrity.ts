import { computeFrameState } from "./timelineEngine";
import { getAssetGeometry, getContentScale } from "./assetPaths";
import { AssetState, Timeline } from "../types/timeline";

const BASE_ASSET_SIZE = 200;
const MAX_OVERLAP_OF_SMALLER = 0.20;
const MAX_OUT_OF_FRAME_FRACTION = 0.05;

export interface SpatialIssue {
  code: "ASSET_COLLISION" | "ASSET_OUT_OF_FRAME" | "UNDECLARED_ASSET_OVERLAP";
  frame: number;
  sceneId?: string;
  message: string;
  assetIds: string[];
  overlapRatio?: number;
}

export interface SpatialIntegrityReport {
  passed: boolean;
  sampledFrames: number[];
  issues: SpatialIssue[];
}

interface Box { x0: number; x1: number; y0: number; y1: number; }

/** Mirrors AnimatedAsset's real image box, including alpha padding and aspect ratio. */
export function visibleAssetBox(asset: AssetState, width: number, height: number): Box {
  const size = BASE_ASSET_SIZE * asset.scale * getContentScale(asset.src);
  const geometry = getAssetGeometry(asset.src);
  const renderedWidth = Math.min(size * 1.8, size * Math.max(0.05, geometry.aspectRatio));
  const renderedHeight = size;
  const imageLeft = asset.position.x * width - renderedWidth / 2;
  const imageTop = asset.position.y * height - renderedHeight / 2;
  const box = geometry.contentBox;
  return {
    x0: imageLeft + box.x * renderedWidth,
    x1: imageLeft + (box.x + box.width) * renderedWidth,
    y0: imageTop + box.y * renderedHeight,
    y1: imageTop + (box.y + box.height) * renderedHeight,
  };
}

function area(box: Box): number { return Math.max(0, box.x1 - box.x0) * Math.max(0, box.y1 - box.y0); }
function intersection(a: Box, b: Box): number {
  return Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) *
    Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
}
function overlapRatio(a: Box, b: Box): number {
  const smaller = Math.min(area(a), area(b));
  return smaller > 0 ? intersection(a, b) / smaller : 0;
}
function outsideFraction(box: Box, width: number, height: number): number {
  const visible = intersection(box, { x0: 0, x1: width, y0: 0, y1: height });
  const total = area(box);
  return total > 0 ? 1 - visible / total : 0;
}

function sampleFrames(timeline: Timeline, sceneSpans?: Array<{ id?: string; start: number; end: number; narrationBeatFrames?: number[] }>): number[] {
  const frames = new Set<number>();
  for (const event of timeline.events) {
    if (event.type === "enter") frames.add(event.frame + (event.animationDuration ?? 20));
    if (event.type === "move") {
      frames.add(event.frame);
      frames.add(event.frame + Math.round(event.duration / 2));
      frames.add(event.frame + event.duration);
    }
  }
  for (const scene of sceneSpans ?? []) {
    frames.add(scene.start + 25);
    frames.add(scene.end - 1);
    for (const frame of scene.narrationBeatFrames ?? []) frames.add(frame);
  }
  return [...frames]
    .filter((frame) => Number.isInteger(frame) && frame >= 0 && frame < timeline.durationInFrames)
    .sort((a, b) => a - b);
}

export function checkSpatialIntegrity(
  timeline: Timeline,
  sceneSpans?: Array<{ id?: string; start: number; end: number; narrationBeatFrames?: number[] }>,
): SpatialIntegrityReport {
  const sampledFrames = sampleFrames(timeline, sceneSpans);
  const issues: SpatialIssue[] = [];
  const seen = new Set<string>();
  const sceneFor = (frame: number) => sceneSpans?.find((scene) => frame >= scene.start && frame < scene.end)?.id;

  for (const frame of sampledFrames) {
    const state = computeFrameState(timeline, frame);
    const assets = [...state.assets.values()].filter((asset) => asset.opacity > 0);
    const boxes = new Map(assets.map((asset) => [asset.assetId, visibleAssetBox(asset, timeline.width, timeline.height)]));
    for (const asset of assets) {
      const box = boxes.get(asset.assetId)!;
      const fraction = outsideFraction(box, timeline.width, timeline.height);
      if (fraction > MAX_OUT_OF_FRAME_FRACTION) {
        const key = `out:${frame}:${asset.assetId}`;
        if (!seen.has(key)) {
          seen.add(key);
          issues.push({ code: "ASSET_OUT_OF_FRAME", frame, sceneId: sceneFor(frame), assetIds: [asset.assetId],
            message: `${asset.assetId} has ${(fraction * 100).toFixed(0)}% of its visible artwork outside the canvas.` });
        }
      }
    }
    for (let i = 0; i < assets.length; i++) for (let j = i + 1; j < assets.length; j++) {
      const a = assets[i], b = assets[j];
      const ratio = overlapRatio(boxes.get(a.assetId)!, boxes.get(b.assetId)!);
      if (ratio <= MAX_OVERLAP_OF_SMALLER) continue;
      const permitted = a.allowOverlapWith?.includes(b.assetId) || b.allowOverlapWith?.includes(a.assetId);
      if (permitted) continue;
      const key = `collision:${frame}:${a.assetId}:${b.assetId}`;
      if (!seen.has(key)) {
        seen.add(key);
        issues.push({ code: "UNDECLARED_ASSET_OVERLAP", frame, sceneId: sceneFor(frame), assetIds: [a.assetId, b.assetId], overlapRatio: ratio,
          message: `${a.assetId} and ${b.assetId} overlap ${(ratio * 100).toFixed(0)}% of the smaller visible asset. Use a separate placement, or declare a genuine held/worn interaction.` });
      }
    }
  }
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
