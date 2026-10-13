import { checksumJson } from "../ai/transcriptCoverage";
import { ChunkPlan, orderedSceneIdsForScope, qualityScopeForChunk } from "../types/chunk";
import { Storyboard } from "../types/storyboard";

export const ITERATION_SCOPE_VERSION = 1;

export interface StoryboardIterationScope {
  schemaVersion: typeof ITERATION_SCOPE_VERSION;
  artifactRole: "storyboard-iteration-scope";
  nonPromotable: true;
  baselineStoryboardChecksum: string;
  storyboardChecksum: string;
  planChecksum: string;
  changedSceneIds: string[];
  addedSceneIds: string[];
  removedSceneIds: string[];
  diagnosticSceneIds: string[];
  affectedChunkIds: string[];
  haloScenes: number;
}

function uniqueSceneMap(storyboard: Storyboard): Map<string, unknown> {
  const values = new Map<string, unknown>();
  for (const scene of storyboard.scenes) {
    if (!scene.id || values.has(scene.id)) {
      throw new Error(`Storyboard iteration scope requires unique non-empty scene ids; found ${JSON.stringify(scene.id)}.`);
    }
    values.set(scene.id, scene);
  }
  return values;
}

/**
 * Pure, deterministic edit scope. This is feedback metadata only: it never
 * serves as input to a chunk attestation or canonical assembly.
 */
export function buildStoryboardIterationScope(
  baseline: Storyboard,
  storyboard: Storyboard,
  plan: ChunkPlan,
  haloScenes = 1,
): StoryboardIterationScope {
  if (!Number.isInteger(haloScenes) || haloScenes < 0 || haloScenes > 4) {
    throw new Error("Iteration haloScenes must be an integer from 0 to 4.");
  }
  const before = uniqueSceneMap(baseline);
  const after = uniqueSceneMap(storyboard);
  const addedSceneIds = [...after.keys()].filter((id) => !before.has(id));
  const removedSceneIds = [...before.keys()].filter((id) => !after.has(id));
  const changedSceneIds = [...after.keys()].filter((id) => before.has(id)
    && checksumJson(before.get(id)) !== checksumJson(after.get(id)));
  const directlyChanged = new Set([...addedSceneIds, ...changedSceneIds]);
  const allChanged = new Set([...directlyChanged, ...removedSceneIds]);

  const diagnostic = new Set<string>();
  for (const [index, scene] of storyboard.scenes.entries()) {
    if (!directlyChanged.has(scene.id)) continue;
    for (let offset = -haloScenes; offset <= haloScenes; offset += 1) {
      const neighbour = storyboard.scenes[index + offset];
      if (neighbour?.id) diagnostic.add(neighbour.id);
    }
  }
  // A deletion has no candidate scene to render. Inspect its new seam by taking
  // the surviving candidate scenes at the former ordinal boundary.
  for (const removedId of removedSceneIds) {
    const oldIndex = baseline.scenes.findIndex((scene) => scene.id === removedId);
    for (let offset = -haloScenes; offset <= haloScenes; offset += 1) {
      const neighbour = storyboard.scenes[oldIndex + offset];
      if (neighbour?.id) diagnostic.add(neighbour.id);
    }
  }

  const affectedChunkIds = plan.chunks
    .filter((chunk) => orderedSceneIdsForScope(qualityScopeForChunk(plan, chunk.id))
      .some((id) => allChanged.has(id) || diagnostic.has(id)))
    .map((chunk) => chunk.id);

  return {
    schemaVersion: ITERATION_SCOPE_VERSION,
    artifactRole: "storyboard-iteration-scope",
    nonPromotable: true,
    baselineStoryboardChecksum: checksumJson(baseline),
    storyboardChecksum: checksumJson(storyboard),
    planChecksum: checksumJson(plan),
    changedSceneIds: [...changedSceneIds].sort(),
    addedSceneIds: [...addedSceneIds].sort(),
    removedSceneIds: [...removedSceneIds].sort(),
    diagnosticSceneIds: storyboard.scenes.map((scene) => scene.id).filter((id) => diagnostic.has(id)),
    affectedChunkIds,
    haloScenes,
  };
}
