import { renderDirectorPolicy } from "../directorPolicy";

export function buildRepairPrompt(input: {
  failedScenes: unknown[];
  issues: unknown[];
  neighbors: unknown[];
  assetCandidates: unknown[];
}): string {
  return `Repair only the failed storyboard scenes. Preserve IDs and source ranges.
Do not regenerate valid scenes.

${renderDirectorPolicy()}

FAILED SCENES:
${JSON.stringify(input.failedScenes)}

VALIDATION ISSUES:
${JSON.stringify(input.issues)}

NEIGHBOR CONTEXT:
${JSON.stringify(input.neighbors)}

ASSET CANDIDATES:
${JSON.stringify(input.assetCandidates)}

Return JSON only: {"scenes":[...]}.`;
}
