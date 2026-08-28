import { SceneTiming } from "./storyboardCompiler";
import { AlignedWord, Storyboard } from "../types/storyboard";
import { ChunkPlan, SemanticChunk, StageAttestation } from "../types/chunk";
import { verifyStageAttestation, ChunkAttestationIssue } from "./chunkAttestations";

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

/** Convert canonical word times to a chunk-relative view while retaining IDs. */
export function rebaseChunkWords(words: AlignedWord[], sceneIds: string[]): AlignedWord[] {
  const sceneSet = new Set(sceneIds);
  const selected = words.filter((word) => word.scene && sceneSet.has(word.scene));
  if (!selected.length) return [];
  const start = selected[0].startSec;
  return selected.map((word) => ({ ...word, startSec: word.startSec - start, endSec: word.endSec - start }));
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

export function verifyChunkAssembly(
  plan: ChunkPlan,
  completeStoryboard: Storyboard,
  artifacts: ChunkMeasuredArtifacts[],
  expectedAttestations: Array<{
    stage: StageAttestation["stage"];
    policyVersion: string;
    thresholdProfileHash: string;
  }>,
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
  let expectedStart = 0;
  for (const artifact of artifacts) {
    for (const duration of [...artifact.durations].sort((a, b) => a.startFrame - b.startFrame)) {
      if (duration.startFrame < expectedStart) issues.push({ code: "ASSEMBLY_DURATION_OVERLAP", message: `${duration.id} overlaps an earlier chunk-scene duration.` });
      if (duration.startFrame > expectedStart) issues.push({ code: "ASSEMBLY_DURATION_GAP", message: `${duration.id} leaves a measured duration gap.` });
      expectedStart = duration.startFrame + duration.frames;
    }
    for (const requirement of expectedAttestations) {
      const filePath = artifact.attestationPaths[requirement.stage];
      const attestation = filePath ? require("./chunkAttestations").readStageAttestation(filePath) : undefined;
      const verification: ChunkAttestationIssue[] = verifyStageAttestation(attestation, {
        chunkId: artifact.chunkId,
        stage: requirement.stage,
        inputHashes: artifact.hashes,
        policyVersion: requirement.policyVersion,
        thresholdProfileHash: requirement.thresholdProfileHash,
      });
      if (verification.length) issues.push({
        code: "ASSEMBLY_ATTESTATION",
        message: verification.map((issue) => issue.message).join(" "),
      });
    }
  }
  return issues;
}
