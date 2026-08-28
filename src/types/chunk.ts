import { SourceRange, Storyboard, StorySection, VisualRegister } from "./storyboard";

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
  schemaVersion: 1;
  projectId: string;
  transcriptChecksum: string;
  storyboardChecksum: string;
  plannerVersion: string;
  chunks: SemanticChunk[];
}

export type QualityScope =
  | { kind: "global" }
  | {
      kind: "chunk";
      chunkId: string;
      coreSceneIds: string[];
      haloBeforeSceneIds: string[];
      haloAfterSceneIds: string[];
    };

export type ChunkStage = "authoring" | "tts" | "alignment" | "compile" | "visual-proof";

export interface StageAttestation {
  schemaVersion: 1;
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

export interface ChunkAssemblyProvenance {
  planChecksum: string;
  chunkOrder: string[];
  chunkTimelineChecksums: Record<string, string>;
  chunkAudioChecksums: Record<string, string>;
  chunkAttestationChecksums: Record<string, string[]>;
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
    | "SECTION_ID_DUPLICATE"
    | "SECTION_RANGE_INVALID"
    | "SECTION_RANGE_GAP"
    | "SECTION_RANGE_OVERLAP"
    | "SECTION_METADATA_MISSING"
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
  return `chunk-${String(ordinal).padStart(3, "0")}-${firstSectionId}`;
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
  for (const scene of storyboard.scenes) {
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
  for (const claim of storyboard.claims ?? []) {
    const owners = new Set((claim.sceneIds ?? []).map((sceneId) => chunkByScene.get(sceneId)).filter(Boolean));
    if (owners.size > 1) issues.push({
      code: "CLAIM_CROSS_CHUNK",
      message: `Claim ${claim.id} spans ${[...owners].join(", ")}; declare and verify it as a cross-chunk dependency.`,
    });
  }
  if (issues.length) return { issues };

  return {
    plan: {
      schemaVersion: 1,
      projectId: options.projectId,
      transcriptChecksum: storyboard.transcriptChecksum ?? "",
      storyboardChecksum: options.storyboardChecksum,
      plannerVersion: "route-a-chunks-v1",
      chunks,
    },
    issues: [],
  };
}

export function qualityScopeForChunk(plan: ChunkPlan, chunkIdValue: string): QualityScope {
  const index = plan.chunks.findIndex((chunk) => chunk.id === chunkIdValue);
  if (index < 0) throw new Error(`Unknown chunk "${chunkIdValue}".`);
  const chunk = plan.chunks[index];
  return {
    kind: "chunk",
    chunkId: chunk.id,
    coreSceneIds: [...chunk.sceneIds],
    haloBeforeSceneIds: index > 0 ? [plan.chunks[index - 1].sceneIds.at(-1)!] : [],
    haloAfterSceneIds: index + 1 < plan.chunks.length ? [plan.chunks[index + 1].sceneIds[0]] : [],
  };
}
