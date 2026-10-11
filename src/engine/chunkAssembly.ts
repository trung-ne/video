import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { SceneTiming } from "./storyboardCompiler";
import { AlignedWord, Storyboard } from "../types/storyboard";
import { ChunkPlan, ChunkQualityScope, SemanticChunk, StageAttestation, orderedSceneIdsForScope } from "../types/chunk";
import { readStageAttestation, verifyStageAttestation, ArtifactDigestCache, ChunkAttestationIssue } from "./chunkAttestations";

export interface ChunkAssemblyIssue {
  code:
    | "ASSEMBLY_CHUNK_ORDER"
    | "ASSEMBLY_SCENE_SET"
    | "ASSEMBLY_DURATION_GAP"
    | "ASSEMBLY_DURATION_OVERLAP"
    | "ASSEMBLY_ATTESTATION";
  message: string;
}

export interface ChunkMeasuredArtifacts {
  chunkId: string;
  durations: SceneTiming[];
  words: AlignedWord[];
  attestationPaths: Partial<Record<StageAttestation["stage"], string>>;
  hashes: Record<string, string>;
  /** Named materialized outputs used when validating stage attestations. */
  outputs: Record<string, string>;
}

export interface ChunkAssemblyPromotionArtifact {
  name: string;
  candidatePath: string;
  finalPath: string;
}

export interface ChunkAssemblyPromotionOptions {
  signal?: AbortSignal;
  transactionId?: string;
  /** Test seam for deterministic rollback coverage. */
  renameFile?: (source: string, destination: string) => void;
}

/**
 * Commit an already-complete canonical artifact set, restoring every prior file
 * if any rename fails. Candidates must be staged on the same filesystem as
 * their destination; the caller orders the commit record (timeline) last.
 */
export function promoteChunkAssemblyArtifacts(
  artifacts: ChunkAssemblyPromotionArtifact[],
  options: ChunkAssemblyPromotionOptions = {},
): void {
  if (!artifacts.length) throw new Error("Chunk assembly promotion requires at least one artifact.");
  const transactionId = options.transactionId ?? `${process.pid}-${crypto.randomUUID()}`;
  if (!/^[a-zA-Z0-9-]+$/.test(transactionId)) throw new Error("Chunk assembly transaction id is unsafe.");
  const rename = options.renameFile ?? fs.renameSync;
  const finalPaths = artifacts.map((artifact) => path.resolve(artifact.finalPath));
  const candidatePaths = artifacts.map((artifact) => path.resolve(artifact.candidatePath));
  if (new Set(finalPaths).size !== finalPaths.length || new Set(candidatePaths).size !== candidatePaths.length) {
    throw new Error("Chunk assembly promotion paths must be unique.");
  }

  const normalized = artifacts.map((artifact, index) => {
    const finalPath = finalPaths[index];
    const candidatePath = candidatePaths[index];
    if (candidatePath === finalPath) throw new Error(`${artifact.name} candidate path equals its canonical destination.`);
    if (!fs.existsSync(candidatePath) || !fs.statSync(candidatePath).isFile()) {
      throw new Error(`Missing staged chunk assembly artifact ${artifact.name}: ${candidatePath}`);
    }
    fs.mkdirSync(path.dirname(finalPath), { recursive: true });
    const candidateDevice = fs.statSync(candidatePath).dev;
    const destinationDevice = fs.statSync(path.dirname(finalPath)).dev;
    if (candidateDevice !== destinationDevice) {
      throw new Error(`${artifact.name} candidate and destination are on different filesystems.`);
    }
    const backupPath = `${finalPath}.${transactionId}.assembly-backup`;
    if (fs.existsSync(backupPath)) throw new Error(`Chunk assembly backup already exists: ${backupPath}`);
    return { ...artifact, candidatePath, finalPath, backupPath };
  });

  const archived: typeof normalized = [];
  const promoted: typeof normalized = [];
  const interrupted = () => {
    if (options.signal?.aborted) throw new Error("Chunk assembly promotion was interrupted before commit completed.");
  };

  try {
    interrupted();
    for (const artifact of normalized) {
      interrupted();
      if (!fs.existsSync(artifact.finalPath)) continue;
      rename(artifact.finalPath, artifact.backupPath);
      archived.push(artifact);
    }
    for (const artifact of normalized) {
      interrupted();
      rename(artifact.candidatePath, artifact.finalPath);
      promoted.push(artifact);
    }
    interrupted();
  } catch (error) {
    const rollbackErrors: string[] = [];
    for (const artifact of [...promoted].reverse()) {
      if (!fs.existsSync(artifact.finalPath)) continue;
      try {
        rename(artifact.finalPath, artifact.candidatePath);
      } catch (rollbackError) {
        rollbackErrors.push(`${artifact.name} candidate restore: ${(rollbackError as Error).message}`);
      }
    }
    for (const artifact of [...archived].reverse()) {
      if (!fs.existsSync(artifact.backupPath)) continue;
      try {
        if (fs.existsSync(artifact.finalPath)) fs.rmSync(artifact.finalPath, { force: true });
        rename(artifact.backupPath, artifact.finalPath);
      } catch (rollbackError) {
        rollbackErrors.push(`${artifact.name} prior restore: ${(rollbackError as Error).message}`);
      }
    }
    if (rollbackErrors.length) {
      throw new Error(`${(error as Error).message} Rollback also failed: ${rollbackErrors.join("; ")}`);
    }
    throw error;
  }

  // Commit succeeded. Old generations are no longer canonical; backup cleanup
  // is best effort and cannot turn a complete new set into a rollback attempt.
  for (const artifact of archived) {
    try { fs.rmSync(artifact.backupPath, { force: true }); }
    catch { /* A stale backup is diagnostic; the complete new set remains committed. */ }
  }
}

/** Projection is derived from the complete resolved storyboard, never from authored SCENES. */
export function projectStoryboardForChunk(storyboard: Storyboard, chunk: SemanticChunk): Storyboard {
  const sceneSet = new Set(chunk.sceneIds);
  const sectionSet = new Set(chunk.sectionIds);
  const claimSet = new Set(chunk.claimIds);
  const scenes = storyboard.scenes.filter((scene) => sceneSet.has(scene.id));
  if (scenes.length !== chunk.sceneIds.length || scenes.some((scene, index) => scene.id !== chunk.sceneIds[index])) {
    throw new Error(`${chunk.id} scene projection no longer matches the complete storyboard.`);
  }
  return {
    ...storyboard,
    sections: (storyboard.sections ?? []).filter((section) => sectionSet.has(section.id)),
    claims: (storyboard.claims ?? []).filter((claim) => claimSet.has(claim.id)),
    scenes,
  };
}

/** Exact one-scene seam window used only by non-promotable quality proofs. */
export function projectStoryboardForQualityScope(storyboard: Storyboard, scope: ChunkQualityScope): Storyboard {
  const orderedIds = orderedSceneIdsForScope(scope);
  if (new Set(orderedIds).size !== orderedIds.length) {
    throw new Error(`${scope.chunkId} quality scope contains duplicate scene ids.`);
  }
  const byId = new Map(storyboard.scenes.map((scene) => [scene.id, scene]));
  const scenes = orderedIds.map((id) => byId.get(id));
  if (scenes.some((scene) => !scene)) {
    const missing = orderedIds.filter((id) => !byId.has(id));
    throw new Error(`${scope.chunkId} quality scope references missing scene(s): ${missing.join(", ")}.`);
  }
  const sourceOrder = new Map(storyboard.scenes.map((scene, index) => [scene.id, index]));
  if (orderedIds.some((id, index) => index > 0 && sourceOrder.get(id)! <= sourceOrder.get(orderedIds[index - 1])!)) {
    throw new Error(`${scope.chunkId} quality scope is not in complete-storyboard order.`);
  }
  const selectedSceneIds = new Set(orderedIds);
  const sectionIds = new Set(scenes.map((scene) => scene!.sectionId).filter((id): id is string => Boolean(id)));
  const claimIds = new Set(scenes.flatMap((scene) => scene!.claimIds ?? []));
  return {
    ...storyboard,
    sections: (storyboard.sections ?? []).filter((section) => sectionIds.has(section.id)
      || scenes.some((scene) => scene!.sourceRange
        && section.sourceRange.startWord <= scene!.sourceRange!.startWord
        && section.sourceRange.endWord >= scene!.sourceRange!.endWord)),
    claims: (storyboard.claims ?? []).filter((claim) => claimIds.has(claim.id)
      || (claim.sceneIds ?? []).some((id) => selectedSceneIds.has(id))),
    scenes: scenes as Storyboard["scenes"],
  };
}

/** Convert a globally timed list to a chunk-relative measured timeline. */
export function rebaseChunkDurations(durations: SceneTiming[], sceneIds: string[]): SceneTiming[] {
  const byId = new Map(durations.map((duration) => [duration.id, duration]));
  const selected = sceneIds.map((id) => byId.get(id));
  if (selected.some((duration) => !duration)) throw new Error("Chunk durations are missing a selected scene id.");
  const first = selected[0]!;
  return selected.map((duration) => ({
    id: duration!.id,
    startFrame: duration!.startFrame - first.startFrame,
    frames: duration!.frames,
  }));
}

/** Convert canonical word times to a chunk-relative view using the measured audio origin. */
export function rebaseChunkWords(words: AlignedWord[], sceneIds: string[], chunkStartSec: number): AlignedWord[] {
  const sceneSet = new Set(sceneIds);
  const selected = words.filter((word) => word.scene && sceneSet.has(word.scene));
  return selected.map((word) => ({ ...word, startSec: word.startSec - chunkStartSec, endSec: word.endSec - chunkStartSec }));
}

export function assembleChunkDurations(chunks: Array<Pick<ChunkMeasuredArtifacts, "chunkId" | "durations">>): SceneTiming[] {
  let cursor = 0;
  const assembled: SceneTiming[] = [];
  for (const chunk of chunks) {
    const local = [...chunk.durations].sort((a, b) => a.startFrame - b.startFrame);
    for (const duration of local) {
      assembled.push({ id: duration.id, startFrame: cursor + duration.startFrame, frames: duration.frames });
    }
    const end = local.reduce((maximum, duration) => Math.max(maximum, duration.startFrame + duration.frames), 0);
    cursor += end;
  }
  return assembled;
}

export interface AssemblyAttestationRequirement {
  stage: StageAttestation["stage"];
  policyVersion: string;
  thresholdProfileHash: string;
  digestCache?: ArtifactDigestCache;
  /** Each stage has its own lineage; never apply one catch-all input hash map. */
  inputHashes: (artifact: ChunkMeasuredArtifacts) => Record<string, string>;
  outputPaths?: (artifact: ChunkMeasuredArtifacts) => Record<string, string>;
}

export function verifyChunkAssembly(
  plan: ChunkPlan,
  completeStoryboard: Storyboard,
  artifacts: ChunkMeasuredArtifacts[],
  expectedAttestations: AssemblyAttestationRequirement[],
): ChunkAssemblyIssue[] {
  const issues: ChunkAssemblyIssue[] = [];
  if (artifacts.length !== plan.chunks.length || artifacts.some((artifact, index) => artifact.chunkId !== plan.chunks[index]?.id)) {
    issues.push({ code: "ASSEMBLY_CHUNK_ORDER", message: "Chunk artifacts do not match the deterministic plan order." });
    return issues;
  }
  const expectedSceneIds = completeStoryboard.scenes.map((scene) => scene.id);
  const actualSceneIds = artifacts.flatMap((artifact) => artifact.durations.map((duration) => duration.id));
  if (actualSceneIds.length !== expectedSceneIds.length || actualSceneIds.some((id, index) => id !== expectedSceneIds[index])) {
    issues.push({ code: "ASSEMBLY_SCENE_SET", message: "Chunk durations do not contain the complete storyboard scene set in order." });
  }
  for (const artifact of artifacts) {
    let expectedStart = 0;
    for (const duration of [...artifact.durations].sort((a, b) => a.startFrame - b.startFrame)) {
      if (duration.startFrame < expectedStart) issues.push({ code: "ASSEMBLY_DURATION_OVERLAP", message: `${duration.id} overlaps an earlier duration in ${artifact.chunkId}.` });
      if (duration.startFrame > expectedStart) issues.push({ code: "ASSEMBLY_DURATION_GAP", message: `${duration.id} leaves a measured duration gap in ${artifact.chunkId}.` });
      expectedStart = duration.startFrame + duration.frames;
    }
    for (const requirement of expectedAttestations) {
      const filePath = artifact.attestationPaths[requirement.stage];
      const verification: ChunkAttestationIssue[] = verifyStageAttestation(
        filePath ? readStageAttestation(filePath) : undefined,
        {
          chunkId: artifact.chunkId,
          stage: requirement.stage,
          inputHashes: requirement.inputHashes(artifact),
          outputPaths: requirement.outputPaths?.(artifact),
          policyVersion: requirement.policyVersion,
          thresholdProfileHash: requirement.thresholdProfileHash,
          digestCache: requirement.digestCache,
        },
      );
      if (verification.length) issues.push({
        code: "ASSEMBLY_ATTESTATION",
        message: verification.map((issue) => issue.message).join(" "),
      });
    }
  }
  return issues;
}
