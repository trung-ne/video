import { checksumJson } from "../ai/transcriptCoverage";
import type { SourceRange, Storyboard, StorySection, VisualRegister } from "./storyboard";

export const AUTHORING_WORDS_PER_SCENE = 40;
export const LONG_VIDEO_MINIMUM_SCENES = 8;
export const SAFE_LINEAGE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function minimumAuthoredScenesForWordCount(wordCount: number): number {
  if (!Number.isInteger(wordCount) || wordCount < 0) {
    throw new Error(`Transcript word count must be a non-negative integer; got ${wordCount}.`);
  }
  return Math.ceil(wordCount / AUTHORING_WORDS_PER_SCENE);
}

export function isLongVideoWordCount(wordCount: number): boolean {
  return minimumAuthoredScenesForWordCount(wordCount) >= LONG_VIDEO_MINIMUM_SCENES;
}

/** IDs that can safely be used as one filesystem path segment. */
export function isSafeLineageId(value: unknown): value is string {
  return typeof value === "string" && SAFE_LINEAGE_ID_PATTERN.test(value);
}

export function assertSafeLineageId(value: unknown, label: string): asserts value is string {
  if (!isSafeLineageId(value)) {
    throw new Error(`${label} must be lowercase alphanumeric words separated by single hyphens; got ${JSON.stringify(value)}.`);
  }
}

/**
 * A derived Route A work unit. It is never an authored source and it never
 * replaces the project-level storyboard/timeline artifacts.
 */
export interface SemanticChunk {
  id: string;
  ordinal: number;
  sectionIds: string[];
  sceneIds: string[];
  sourceRange: SourceRange;
  targetDurationSeconds: number;
  thesis: string;
  emotionalTurn: string;
  energyCurve?: StorySection["energyCurve"];
  treatmentSequence: VisualRegister[];
  claimIds: string[];
  previousChunkId?: string;
  nextChunkId?: string;
}

export interface ChunkPlan {
  schemaVersion: 2;
  projectId: string;
  transcriptChecksum: string;
  storyboardChecksum: string;
  plannerVersion: string;
  planningOptions: {
    targetChunkSeconds: number;
    maximumChunkTargetSeconds: number;
  };
  chunks: SemanticChunk[];
}

export interface ChunkQualityScope {
  kind: "chunk";
  chunkId: string;
  coreSceneIds: string[];
  haloBeforeSceneIds: string[];
  haloAfterSceneIds: string[];
}

export type QualityScope = { kind: "global" } | ChunkQualityScope;

function assertExactKeys(value: Record<string, unknown>, expected: string[], label: string): void {
  const actual = Object.keys(value);
  const missing = expected.filter((key) => !Object.prototype.hasOwnProperty.call(value, key));
  const extra = actual.filter((key) => !expected.includes(key));
  if (missing.length || extra.length || actual.length !== expected.length) {
    throw new Error(
      `${label} must contain exactly ${expected.join(", ")}`
      + `${missing.length ? `; missing ${missing.join(", ")}` : ""}`
      + `${extra.length ? `; unexpected ${extra.join(", ")}` : ""}.`,
    );
  }
}

function parseSceneIdArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`Quality scope ${field} must be an array.`);
  if (value.some((item) => !isSafeLineageId(item))) {
    throw new Error(`Quality scope ${field} must contain only safe lowercase path-segment scene ids.`);
  }
  return [...value] as string[];
}

/** Fail-closed runtime parser for an untrusted --quality-scope JSON file. */
export function parseQualityScope(value: unknown): QualityScope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Quality scope must be a JSON object.");
  }
  const record = value as Record<string, unknown>;
  if (record.kind === "global") {
    assertExactKeys(record, ["kind"], "Global quality scope");
    return { kind: "global" };
  }
  if (record.kind !== "chunk") throw new Error('Quality scope kind must be exactly "global" or "chunk".');
  const keys = ["kind", "chunkId", "coreSceneIds", "haloBeforeSceneIds", "haloAfterSceneIds"];
  assertExactKeys(record, keys, "Chunk quality scope");
  assertSafeLineageId(record.chunkId, "Quality scope chunkId");
  const scope: ChunkQualityScope = {
    kind: "chunk",
    chunkId: record.chunkId,
    coreSceneIds: parseSceneIdArray(record.coreSceneIds, "coreSceneIds"),
    haloBeforeSceneIds: parseSceneIdArray(record.haloBeforeSceneIds, "haloBeforeSceneIds"),
    haloAfterSceneIds: parseSceneIdArray(record.haloAfterSceneIds, "haloAfterSceneIds"),
  };
  if (scope.coreSceneIds.length === 0) throw new Error("Quality scope coreSceneIds must not be empty.");
  const allIds = orderedSceneIdsForScope(scope);
  if (new Set(allIds).size !== allIds.length) {
    throw new Error("Quality scope scene ids must be unique across core and halo arrays.");
  }
  return scope;
}

export type ChunkStage = "authoring" | "tts" | "alignment" | "compile" | "visual-proof";

export type ChunkTtsConfig = {
  engine: "edge-tts";
  voice: string;
  sampleRateHz: 24000;
  rate: "+0%";
  volume: "+0%";
  pitch: "+0Hz";
  gapPolicyVersion: "edge-gap-0.08-v1";
  gapSeconds: 0.08;
  terminalGapPolicy: "all-non-final-chunks";
} | {
  engine: "kokoro";
  voice: string;
  sampleRateHz: 24000;
  languageCode: string;
  speed: number;
  repoId: "hexgrad/Kokoro-82M";
  modelRevision: string;
  modelDir: string | null;
  device: "cpu";
  gapPolicyVersion: "kokoro-gap-0.08-v1";
  gapSeconds: 0.08;
  terminalGapPolicy: "all-non-final-chunks";
};

export interface ChunkRunConfig {
  schemaVersion: 1;
  projectId: string;
  policyVersion: string;
  planChecksum: string;
  storyboardChecksum: string;
  globalAuthoringReportChecksum: string;
  tts: ChunkTtsConfig;
  alignment: {
    engine: "faster-whisper";
    model: string;
    language: string | null;
    device: "cpu";
    computeType: "int8";
    vadFilter: false;
  };
  compile: {
    policyVersion: "measured-route-a-v1";
    assetStyle: "production";
    scopePolicy: "exact-one-scene-halo-v1";
  };
  proof: {
    artifactRole: "chunk-proof";
    qualityProfileHash: string;
    scopePolicy: "exact-one-scene-halo-v1";
  };
}

export interface StageAttestation {
  schemaVersion: 2;
  chunkId: string;
  stage: ChunkStage;
  inputHashes: Record<string, string>;
  outputHashes: Record<string, string>;
  policyVersion: string;
  thresholdProfileHash: string;
  passed: boolean;
  blockerCount: number;
  majorCount: number;
  completedAt: string;
}

export interface ChunkAssemblyToolchainHashes {
  productionCodeSnapshot: string;
  assemblyOrchestrator: string;
  audioAssembler: string;
  ttsSceneBuilder: string;
  timelineCompiler: string;
}

export interface ChunkAssemblyProvenance {
  schemaVersion: 3;
  projectId: string;
  storyboardChecksum: string;
  planChecksum: string;
  runConfigChecksum: string;
  chunkOrder: string[];
  chunkTimelineChecksums: Record<string, string>;
  chunkAudioChecksums: Record<string, string>;
  chunkAttestationChecksums: Record<string, Record<ChunkStage, string>>;
  assemblyToolchainHashes: ChunkAssemblyToolchainHashes;
  canonicalOutputHashes: {
    ttsScenes: string;
    audio: string;
    durations: string;
    words: string;
    alignment: string;
    timelineBody: string;
  };
  assemblyPolicyVersion: string;
}

export interface ChunkPlanningOptions {
  projectId: string;
  storyboardChecksum: string;
  /** A section may not be mechanically split to satisfy this budget. */
  maximumChunkTargetSeconds?: number;
  /** Adjacent whole sections are grouped only when their declared targets fit. */
  targetChunkSeconds?: number;
}

export interface ChunkPlanIssue {
  code:
    | "SECTIONS_MISSING"
    | "SECTION_ID_UNSAFE"
    | "SECTION_ID_DUPLICATE"
    | "SECTION_RANGE_INVALID"
    | "SECTION_RANGE_GAP"
    | "SECTION_RANGE_OVERLAP"
    | "SECTION_METADATA_MISSING"
    | "SECTION_EMPTY"
    | "SCENE_ID_UNSAFE"
    | "SCENE_ID_DUPLICATE"
    | "SCENE_OUTSIDE_SECTION"
    | "SCENE_IN_MULTIPLE_SECTIONS"
    | "SECTION_TOO_LARGE"
    | "CLAIM_CROSS_CHUNK";
  message: string;
  sectionId?: string;
  sceneId?: string;
}

export interface ChunkPlanResult {
  plan?: ChunkPlan;
  issues: ChunkPlanIssue[];
}

const DEFAULT_TARGET_CHUNK_SECONDS = 120;
const DEFAULT_MAX_CHUNK_TARGET_SECONDS = 180;

function rangeContains(outer: SourceRange, inner: SourceRange | undefined): boolean {
  return Boolean(inner)
    && outer.startWord <= inner!.startWord
    && outer.endWord >= inner!.endWord;
}

function checksumRange(range: SourceRange): string {
  return range.quoteChecksum;
}

function chunkId(ordinal: number, firstSectionId: string): string {
  assertSafeLineageId(firstSectionId, "Section id used to derive a chunk id");
  const id = `chunk-${String(ordinal).padStart(3, "0")}-${firstSectionId}`;
  assertSafeLineageId(id, "Derived chunk id");
  return id;
}

/**
 * Validate and deterministically group the already-built complete storyboard.
 * The builder, rather than this function, owns transcript marker resolution.
 */
export function planSemanticChunks(
  storyboard: Storyboard,
  options: ChunkPlanningOptions,
): ChunkPlanResult {
  const issues: ChunkPlanIssue[] = [];
  const sections = storyboard.sections ?? [];
  if (!sections.length) {
    return { issues: [{ code: "SECTIONS_MISSING", message: "Long-video chunking requires authored semantic SECTIONS." }] };
  }

  const seenSections = new Set<string>();
  let previousEnd = -1;
  for (const section of sections) {
    if (!isSafeLineageId(section.id)) {
      issues.push({
        code: "SECTION_ID_UNSAFE",
        sectionId: section.id,
        message: `Section id ${JSON.stringify(section.id)} is not a safe lowercase path segment.`,
      });
    }
    if (seenSections.has(section.id)) {
      issues.push({ code: "SECTION_ID_DUPLICATE", sectionId: section.id, message: `Duplicate section id "${section.id}".` });
    }
    seenSections.add(section.id);
    const range = section.sourceRange;
    if (!range || range.startWord < 0 || range.endWord < range.startWord) {
      issues.push({ code: "SECTION_RANGE_INVALID", sectionId: section.id, message: `${section.id} has an invalid sourceRange.` });
      continue;
    }
    if (!section.thesis?.trim() || !section.emotionalTurn?.trim() || !section.energyCurve
      || !(Number(section.targetDurationSeconds) > 0) || !section.treatmentSequence?.length) {
      issues.push({
        code: "SECTION_METADATA_MISSING",
        sectionId: section.id,
        message: `${section.id} needs thesis, emotionalTurn, energyCurve, targetDurationSeconds, and treatmentSequence for chunked production.`,
      });
    }
    if (previousEnd >= 0) {
      if (range.startWord > previousEnd + 1) issues.push({
        code: "SECTION_RANGE_GAP", sectionId: section.id,
        message: `Gap before ${section.id}: expected word ${previousEnd + 1}, got ${range.startWord}.`,
      });
      if (range.startWord <= previousEnd) issues.push({
        code: "SECTION_RANGE_OVERLAP", sectionId: section.id,
        message: `Overlap at ${section.id}: previous section ends ${previousEnd}, got ${range.startWord}.`,
      });
    }
    previousEnd = Math.max(previousEnd, range.endWord);
  }

  const membership = new Map<string, string[]>();
  const seenScenes = new Set<string>();
  for (const scene of storyboard.scenes) {
    if (!isSafeLineageId(scene.id)) {
      issues.push({
        code: "SCENE_ID_UNSAFE",
        sceneId: scene.id,
        message: `Scene id ${JSON.stringify(scene.id)} is not a safe lowercase path segment and cannot be used for TTS artifacts.`,
      });
    }
    if (seenScenes.has(scene.id)) {
      issues.push({ code: "SCENE_ID_DUPLICATE", sceneId: scene.id, message: `Duplicate scene id "${scene.id}".` });
    }
    seenScenes.add(scene.id);
    const owners = sections.filter((section) => rangeContains(section.sourceRange, scene.sourceRange));
    membership.set(scene.id, owners.map((owner) => owner.id));
    if (owners.length === 0) issues.push({
      code: "SCENE_OUTSIDE_SECTION", sceneId: scene.id,
      message: `${scene.id} is not contained by an authored section.`,
    });
    if (owners.length > 1) issues.push({
      code: "SCENE_IN_MULTIPLE_SECTIONS", sceneId: scene.id,
      message: `${scene.id} belongs to multiple sections (${owners.map((owner) => owner.id).join(", ")}).`,
    });
  }
  for (const section of sections) {
    if (!storyboard.scenes.some((scene) => membership.get(scene.id)?.[0] === section.id)) {
      issues.push({
        code: "SECTION_EMPTY",
        sectionId: section.id,
        message: `${section.id} contains no authored scene; semantic chunks may not be empty.`,
      });
    }
  }
  if (issues.length) return { issues };

  const maxSeconds = options.maximumChunkTargetSeconds ?? DEFAULT_MAX_CHUNK_TARGET_SECONDS;
  const targetSeconds = Math.min(options.targetChunkSeconds ?? DEFAULT_TARGET_CHUNK_SECONDS, maxSeconds);
  for (const section of sections) {
    if ((section.targetDurationSeconds ?? 0) > maxSeconds) {
      issues.push({
        code: "SECTION_TOO_LARGE", sectionId: section.id,
        message: `${section.id} targets ${section.targetDurationSeconds}s; maximum unsplit chunk target is ${maxSeconds}s. Split this semantic section explicitly.`,
      });
    }
  }
  if (issues.length) return { issues };

  const groups: StorySection[][] = [];
  let current: StorySection[] = [];
  let currentSeconds = 0;
  for (const section of sections) {
    const seconds = Number(section.targetDurationSeconds);
    if (current.length && currentSeconds + seconds > targetSeconds) {
      groups.push(current);
      current = [];
      currentSeconds = 0;
    }
    current.push(section);
    currentSeconds += seconds;
  }
  if (current.length) groups.push(current);

  const chunks = groups.map((group, index): SemanticChunk => {
    const sectionIds = group.map((section) => section.id);
    const sceneIds = storyboard.scenes
      .filter((scene) => sectionIds.includes(membership.get(scene.id)![0]))
      .map((scene) => scene.id);
    const range: SourceRange = {
      startWord: group[0].sourceRange.startWord,
      endWord: group.at(-1)!.sourceRange.endWord,
      // The range digest is diagnostic in a derived manifest; it must never be
      // used as a transcript-coverage proof in place of the original sections.
      quoteChecksum: `${checksumRange(group[0].sourceRange)}:${checksumRange(group.at(-1)!.sourceRange)}`,
    };
    const claimIds = new Set<string>();
    for (const scene of storyboard.scenes.filter((item) => sceneIds.includes(item.id))) {
      for (const claimId of scene.claimIds ?? []) claimIds.add(claimId);
    }
    return {
      id: chunkId(index + 1, group[0].id),
      ordinal: index + 1,
      sectionIds,
      sceneIds,
      sourceRange: range,
      targetDurationSeconds: group.reduce((sum, section) => sum + Number(section.targetDurationSeconds), 0),
      thesis: group.map((section) => section.thesis.trim()).join(" / "),
      emotionalTurn: group.at(-1)!.emotionalTurn,
      energyCurve: group.at(-1)!.energyCurve,
      treatmentSequence: group.flatMap((section) => section.treatmentSequence ?? []),
      claimIds: [...claimIds],
    };
  }).map((chunk, index, all) => ({
    ...chunk,
    previousChunkId: all[index - 1]?.id,
    nextChunkId: all[index + 1]?.id,
  }));

  const chunkByScene = new Map<string, string>();
  for (const chunk of chunks) for (const sceneId of chunk.sceneIds) chunkByScene.set(sceneId, chunk.id);
  // Scene references are the rendered/assembled truth. StoryClaim.sceneIds is
  // optional descriptive metadata and may be absent or stale, so it cannot be
  // the sole source for deciding whether a claim crosses a chunk boundary.
  const ownersByClaim = new Map<string, Set<string>>();
  for (const scene of storyboard.scenes) {
    const owner = chunkByScene.get(scene.id);
    if (!owner) continue;
    for (const claimId of scene.claimIds ?? []) {
      let owners = ownersByClaim.get(claimId);
      if (!owners) {
        owners = new Set<string>();
        ownersByClaim.set(claimId, owners);
      }
      owners.add(owner);
    }
  }
  for (const [claimId, owners] of ownersByClaim) {
    if (owners.size > 1) issues.push({
      code: "CLAIM_CROSS_CHUNK",
      message: `Claim ${claimId} spans ${[...owners].join(", ")}; declare and verify it as a cross-chunk dependency.`,
    });
  }
  if (issues.length) return { issues };

  return {
    plan: {
      schemaVersion: 2,
      projectId: options.projectId,
      transcriptChecksum: storyboard.transcriptChecksum ?? "",
      storyboardChecksum: options.storyboardChecksum,
      plannerVersion: "route-a-chunks-v2",
      planningOptions: {
        targetChunkSeconds: targetSeconds,
        maximumChunkTargetSeconds: maxSeconds,
      },
      chunks,
    },
    issues: [],
  };
}

export interface CanonicalChunkPlanIssue {
  code: "PLAN_MALFORMED" | "PLAN_ID_UNSAFE" | "PLAN_REDERIVATION_FAILED" | "PLAN_NONCANONICAL";
  message: string;
}

function recordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Treat chunk-plan.json as an untrusted derived cache. Consumers must call this
 * before constructing any chunk paths; it re-plans from the complete storyboard
 * using the persisted planning options and requires canonical JSON equality.
 */
export function verifyCanonicalChunkPlan(
  storyboard: Storyboard,
  candidate: unknown,
  expectedProjectId: string,
): CanonicalChunkPlanIssue[] {
  const malformed = (message: string): CanonicalChunkPlanIssue[] => [{ code: "PLAN_MALFORMED", message }];
  if (!recordValue(candidate)) return malformed("Chunk plan must be an object.");
  const rootKeys = [
    "schemaVersion", "projectId", "transcriptChecksum", "storyboardChecksum",
    "plannerVersion", "planningOptions", "chunks",
  ];
  if (Object.keys(candidate).sort().join("\0") !== [...rootKeys].sort().join("\0")) {
    return malformed("Chunk plan root fields are not exact.");
  }
  if (candidate.schemaVersion !== 2 || candidate.plannerVersion !== "route-a-chunks-v2"
    || candidate.projectId !== expectedProjectId) {
    return malformed("Chunk plan schema, policy, or project identity is invalid.");
  }
  if (!recordValue(candidate.planningOptions)
    || Object.keys(candidate.planningOptions).sort().join("\0")
      !== ["targetChunkSeconds", "maximumChunkTargetSeconds"].sort().join("\0")) {
    return malformed("Chunk planning options are not exact.");
  }
  const target = candidate.planningOptions.targetChunkSeconds;
  const maximum = candidate.planningOptions.maximumChunkTargetSeconds;
  if (typeof target !== "number" || !Number.isFinite(target) || target <= 0
    || typeof maximum !== "number" || !Number.isFinite(maximum) || maximum <= 0 || target > maximum) {
    return malformed("Chunk planning options must be finite positive numbers with target <= maximum.");
  }
  if (!Array.isArray(candidate.chunks) || candidate.chunks.length === 0) {
    return malformed("Chunk plan must contain a non-empty chunks array.");
  }
  const seenChunkIds = new Set<string>();
  for (const [index, value] of candidate.chunks.entries()) {
    if (!recordValue(value)) return malformed(`Chunk ${index + 1} must be an object.`);
    if (!isSafeLineageId(value.id)) {
      return [{ code: "PLAN_ID_UNSAFE", message: `Chunk ${index + 1} has unsafe id ${JSON.stringify(value.id)}.` }];
    }
    if (seenChunkIds.has(value.id)) return malformed(`Chunk id ${value.id} is duplicated.`);
    seenChunkIds.add(value.id);
    for (const field of ["sectionIds", "sceneIds"] as const) {
      if (!Array.isArray(value[field]) || value[field].length === 0
        || value[field].some((id) => !isSafeLineageId(id))) {
        return [{ code: "PLAN_ID_UNSAFE", message: `${value.id} ${field} must contain safe path-segment ids.` }];
      }
    }
    if (!Array.isArray(value.claimIds)
      || value.claimIds.some((id) => typeof id !== "string" || id.trim().length === 0)
      || new Set(value.claimIds).size !== value.claimIds.length) {
      return malformed(`${value.id} claimIds must be a unique string array.`);
    }
    for (const field of ["previousChunkId", "nextChunkId"] as const) {
      if (value[field] !== undefined && !isSafeLineageId(value[field])) {
        return [{ code: "PLAN_ID_UNSAFE", message: `${value.id} ${field} is unsafe.` }];
      }
    }
  }

  let derived: ChunkPlanResult;
  try {
    derived = planSemanticChunks(storyboard, {
      projectId: expectedProjectId,
      storyboardChecksum: checksumJson(storyboard),
      targetChunkSeconds: target,
      maximumChunkTargetSeconds: maximum,
    });
  } catch (error) {
    return [{
      code: "PLAN_REDERIVATION_FAILED",
      message: `Chunk plan could not be re-derived: ${error instanceof Error ? error.message : String(error)}`,
    }];
  }
  if (!derived.plan || derived.issues.length) {
    return [{
      code: "PLAN_REDERIVATION_FAILED",
      message: `Chunk plan could not be re-derived: ${derived.issues.map((entry) => entry.message).join(" ")}`,
    }];
  }
  if (checksumJson(candidate) !== checksumJson(derived.plan)) {
    return [{
      code: "PLAN_NONCANONICAL",
      message: "chunk-plan.json differs from deterministic re-planning (including adjacency, claims, or persisted options).",
    }];
  }
  return [];
}

export function qualityScopeForChunk(plan: ChunkPlan, chunkIdValue: string): ChunkQualityScope {
  const index = plan.chunks.findIndex((chunk) => chunk.id === chunkIdValue);
  if (index < 0) throw new Error(`Unknown chunk "${chunkIdValue}".`);
  const chunk = plan.chunks[index];
  if (!chunk.sceneIds.length) throw new Error(`${chunk.id} has no core scenes.`);
  const previous = plan.chunks[index - 1];
  const next = plan.chunks[index + 1];
  if (previous && !previous.sceneIds.length) throw new Error(`${previous.id} has no scene available for the prior halo.`);
  if (next && !next.sceneIds.length) throw new Error(`${next.id} has no scene available for the next halo.`);
  return {
    kind: "chunk",
    chunkId: chunk.id,
    coreSceneIds: [...chunk.sceneIds],
    haloBeforeSceneIds: previous ? [previous.sceneIds.at(-1)!] : [],
    haloAfterSceneIds: next ? [next.sceneIds[0]] : [],
  };
}

export function orderedSceneIdsForScope(scope: ChunkQualityScope): string[] {
  return [...scope.haloBeforeSceneIds, ...scope.coreSceneIds, ...scope.haloAfterSceneIds];
}
