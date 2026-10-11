import * as fs from "fs";
import * as path from "path";
import { sha256File } from "../audio/prepareAudio";

export interface CanonicalTimelineIdentity {
  projectId: string | null;
  projectPath: string | null;
  timelinePath: string;
  timelineSha256: string;
}

export const MANUAL_CONTACT_SHEET_REVIEW_KEYS = [
  "noRecognizableHumanFaces",
  "noTextClipping",
  "noBubbleOverlap",
  "noEmptyScenes",
  "noCameraCrop",
] as const;

function comparablePath(filePath: string): string {
  const normalized = path.normalize(path.resolve(filePath));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function resolvedRealPath(filePath: string): string {
  const resolved = path.resolve(filePath);
  return fs.existsSync(resolved) ? fs.realpathSync(resolved) : resolved;
}

export function sameResolvedPath(left: string, right: string): boolean {
  return comparablePath(resolvedRealPath(left)) === comparablePath(resolvedRealPath(right));
}

function pathIsWithin(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === ""
    || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/**
 * Metadata on a derived timeline can be deleted, but its project-local
 * filesystem lineage cannot. Check both caller-visible and real paths against
 * this project's own chunks/ subtree. A checkout may itself live below an
 * unrelated ancestor named chunks, so arbitrary ancestors are intentionally
 * not classified as derived artifacts.
 */
export function assertCanonicalTimelinePath(timelinePath: string, projectRoot: string): void {
  const lexicalTimeline = path.resolve(timelinePath);
  const lexicalChunks = path.join(path.resolve(projectRoot), "chunks");
  const physicalTimeline = resolvedRealPath(timelinePath);
  const physicalChunks = resolvedRealPath(path.join(resolvedRealPath(projectRoot), "chunks"));
  if (pathIsWithin(lexicalChunks, lexicalTimeline) || pathIsWithin(physicalChunks, physicalTimeline)) {
    throw new Error(`Derived timeline under the project chunks/ tree is non-promotable: ${lexicalTimeline}`);
  }
}

export function assertProjectCanonicalTimeline(projectPath: string, timelinePath: string): void {
  const expected = path.join(resolvedRealPath(projectPath), "timeline.json");
  if (!sameResolvedPath(expected, timelinePath)) {
    throw new Error(`Canonical project timeline must be ${expected}; got ${path.resolve(timelinePath)}.`);
  }
}

export function buildCanonicalTimelineIdentity(options: {
  timelinePath: string;
  projectId?: string | null;
  projectPath?: string | null;
}): CanonicalTimelineIdentity {
  const timelinePath = resolvedRealPath(options.timelinePath);
  if (!fs.existsSync(timelinePath)) throw new Error(`Canonical timeline is missing: ${timelinePath}`);
  const projectPath = options.projectPath ? resolvedRealPath(options.projectPath) : null;
  return {
    projectId: options.projectId ?? null,
    projectPath,
    timelinePath,
    timelineSha256: sha256File(timelinePath),
  };
}

export function assertOutputProjectIdentity(
  outputPath: string,
  projectId: string | null,
  outputRoot = path.resolve("output"),
): void {
  if (!projectId) return;
  const resolvedOutput = path.resolve(outputPath);
  const relative = path.relative(path.resolve(outputRoot), resolvedOutput);
  const insideOutput = relative !== ""
    && !relative.startsWith(`..${path.sep}`)
    && relative !== ".."
    && !path.isAbsolute(relative);
  if (!insideOutput) return;
  const [outputProjectId] = relative.split(path.sep);
  const equal = process.platform === "win32"
    ? outputProjectId.toLowerCase() === projectId.toLowerCase()
    : outputProjectId === projectId;
  if (!equal) {
    throw new Error(
      `Output project identity mismatch: timeline belongs to ${projectId}, but output is under output/${outputProjectId}.`,
    );
  }
}

export function assertBoundTimelineIdentity(
  value: any,
  expected: CanonicalTimelineIdentity,
  label: string,
): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is malformed.`);
  }
  if (typeof value.timeline !== "string" || !sameResolvedPath(value.timeline, expected.timelinePath)) {
    throw new Error(`${label} identifies a different canonical timeline path.`);
  }
  if (typeof value.timelineSha256 !== "string" || value.timelineSha256 !== expected.timelineSha256) {
    throw new Error(`${label} canonical timeline hash does not match the current timeline.`);
  }
  if (value.projectId !== expected.projectId) {
    throw new Error(`${label} project id does not match the selected project.`);
  }
  if (expected.projectPath === null) {
    if (value.projectPath !== null) throw new Error(`${label} project path does not match the selected project.`);
  } else if (typeof value.projectPath !== "string" || !sameResolvedPath(value.projectPath, expected.projectPath)) {
    throw new Error(`${label} project path does not match the selected project.`);
  }
}

export function assertExactManualContactSheetReview(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Manual contact-sheet review must be an object with every required decision set to true.");
  }
  const keys = Object.keys(value as Record<string, unknown>);
  const expected = [...MANUAL_CONTACT_SHEET_REVIEW_KEYS];
  if (keys.length !== expected.length
      || expected.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
      || keys.some((key) => !(expected as string[]).includes(key))) {
    throw new Error(`Manual contact-sheet review must contain exactly: ${expected.join(", ")}.`);
  }
  if (expected.some((key) => (value as Record<string, unknown>)[key] !== true)) {
    throw new Error("Every manual contact-sheet review decision must be boolean true.");
  }
}
