import { AssetManifestEntry } from "../../types/assets";
import { StorySection } from "../../types/storyboard";
import { grammarPromptTable } from "../../engine/grammarRegistry";
import { DIRECTOR_POLICY_VERSION, renderDirectorPolicy } from "../directorPolicy";

export interface ScenePlanPromptInput {
  transcriptExcerpt: string;
  section: StorySection;
  storyMap: unknown;
  assetCandidates: AssetManifestEntry[];
  previousRegisters?: string[];
}

export function buildScenePlanPrompt(input: ScenePlanPromptInput): string {
  return `You are the scene director for one section of an original editorial cat explainer.
Prompt version: ${DIRECTOR_POLICY_VERSION}.

${renderDirectorPolicy()}

Create visual shots averaging 5-9 seconds. Every scene must include sourceRange,
semanticVisual, visualRegister, visualGrammar, assetRequests, continuity, and
heroVisual. Narration will be reconstructed by code from sourceRange; do not
paraphrase it.

${grammarPromptTable()}

GOOD: a worker cat hands a shrinking pay envelope to a landlord beside a rising
rent chart. BAD: two identical cats beside the words "wages" and "rent".
GOOD: a map with highlighted migration arrows. BAD: a thinking cat plus an arrow.
GOOD: a sourced claim card with no invented number. BAD: a fake survey percentage.
GOOD: reuse an office stage for continuity. BAD: change location only for variety.

SECTION:
${JSON.stringify(input.section)}

GLOBAL STORY MAP:
${JSON.stringify(input.storyMap)}

PREVIOUS REGISTERS:
${JSON.stringify(input.previousRegisters ?? [])}

ASSET CANDIDATES (use IDs exactly; request missing assets explicitly):
${JSON.stringify(input.assetCandidates)}

TRANSCRIPT EXCERPT:
${input.transcriptExcerpt}

Return JSON only: {"scenes":[...]}.`;
}
