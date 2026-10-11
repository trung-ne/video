import { SourceRange } from "../types/storyboard";

interface AuthoredIdentity { id?: string }
interface PriorIdentity { id?: string; sourceRange?: { quoteChecksum?: string } }

export interface SceneIdentityResult {
  ids: string[];
  issues: string[];
}

/**
 * Resolve stable scene foreign keys without guessing through ambiguous repeated
 * narration. Explicit authored IDs win; a prior ID is reusable only when its
 * source quote is unique in both the old and current storyboard.
 */
export function resolveStableSceneIds(
  authoredScenes: AuthoredIdentity[],
  sourceRanges: SourceRange[],
  priorScenes: PriorIdentity[],
  fallbackPrefix: string,
): SceneIdentityResult {
  const issues: string[] = [];
  if (authoredScenes.length !== sourceRanges.length) {
    return { ids: [], issues: ["Scene identity resolution requires one source range per authored scene."] };
  }

  const currentRangeCounts = new Map<string, number>();
  for (const range of sourceRanges) {
    currentRangeCounts.set(range.quoteChecksum, (currentRangeCounts.get(range.quoteChecksum) ?? 0) + 1);
  }

  const priorCandidates = new Map<string, Set<string>>();
  for (const scene of priorScenes) {
    const id = typeof scene.id === "string" ? scene.id.trim() : "";
    const checksum = scene.sourceRange?.quoteChecksum;
    if (!id || !checksum) continue;
    const candidates = priorCandidates.get(checksum) ?? new Set<string>();
    candidates.add(id);
    priorCandidates.set(checksum, candidates);
  }

  const used = new Set<string>();
  const ids = authoredScenes.map((scene, index) => {
    let id = "";
    if (scene.id !== undefined) {
      if (typeof scene.id !== "string" || !scene.id.trim()) {
        issues.push(`SCENES[${index}] has an empty or non-string authored id.`);
      } else {
        id = scene.id.trim();
      }
    }
    if (!id && currentRangeCounts.get(sourceRanges[index].quoteChecksum) === 1) {
      const candidates = priorCandidates.get(sourceRanges[index].quoteChecksum);
      if (candidates?.size === 1) id = [...candidates][0];
    }
    if (!id) id = `${fallbackPrefix}${String(index + 1).padStart(3, "0")}`;
    if (used.has(id)) issues.push(`SCENES[${index}] resolves to duplicate scene id "${id}".`);
    used.add(id);
    return id;
  });

  return { ids, issues };
}
