import type { AssetManifestEntry } from "../../types/assets";
import type { StorySection } from "../../types/storyboard";

export interface ScenePlanPromptInput {
  transcriptExcerpt: string;
  section: StorySection;
  storyMap: unknown;
  assetCandidates: AssetManifestEntry[];
  previousRegisters?: string[];
  recentFingerprints?: string[];
  usageLedger?: Record<string, Record<string, number>>;
  remainingQuotas?: Record<string, number>;
}

/** @deprecated Route B/API authoring is locked. */
export function buildScenePlanPrompt(_input: ScenePlanPromptInput): never {
  throw new Error(
    "Route B scene-plan generation is locked. Author every scene explicitly in storyboard-data.ts.",
  );
}
