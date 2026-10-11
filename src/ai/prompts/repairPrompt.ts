export interface RepairPromptInput {
  failedScenes: unknown[];
  issues: unknown[];
  neighbors: unknown[];
  assetCandidates: unknown[];
}

/** @deprecated Route B/API repair is locked. */
export function buildRepairPrompt(_input: RepairPromptInput): never {
  throw new Error(
    "Route B storyboard repair is locked. Patch the failing Route A scene in storyboard-data.ts.",
  );
}
