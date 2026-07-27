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
  recentFingerprints?: string[];
  usageLedger?: Record<string, Record<string, number>>;
  remainingQuotas?: Record<string, number>;
}

export function buildScenePlanPrompt(input: ScenePlanPromptInput): string {
  return `You are the scene director for one section of an original editorial cat explainer.
Prompt version: ${DIRECTOR_POLICY_VERSION}.

${renderDirectorPolicy()}

Create visual shots averaging 5-9 seconds. Every scene must include sourceRange,
semanticVisual, visualRegister, visualGrammar, assetRequests, continuity, and
heroVisual. Also include focalType, characterRequired, visualFingerprint,
silentFrameTakeaway, focalOccupancyTarget (0.18-0.60), and noveltyFromPrevious.
Narration will be reconstructed by code from sourceRange; do not
paraphrase it.
Every assetRequest must include the exact grammar slot it fills, for example
{"role":"prop","slot":"prop","query":"pay envelope","requiredTags":["money"],"allowGenerate":true}.

${grammarPromptTable()}

GOOD: a worker cat hands a shrinking pay envelope to a landlord beside a rising
rent chart. BAD: two identical cats beside the words "wages" and "rent".
GOOD: a map with highlighted migration arrows. BAD: a thinking cat plus an arrow.
GOOD: a sourced claim card with no invented number. BAD: a fake survey percentage.
GOOD: reuse an office stage for continuity. BAD: change location only for variety.
GOOD: a full-screen population pyramid with no cat. BAD: a cat beside a tiny chart.
GOOD: a landlord removes money from a worker's shrinking pay envelope.
BAD: one cat plus a money icon plus the heading MONEY.

CHARACTER RULE:
- A character is optional. At least 20% of the section should work without one.
- If characterRequired=true, it must perform semanticVisual.action.
- Do not let the same entity shape, pose, stage, label, or grammar exceed its budget.

HERO RULE:
- heroVisual=true requires a large photo/screenshot/map/chart, sourced evidence,
  a multi-node diagram, a full action tableau, or a setup/payoff visual gag.
- A colored background, keyword, pose, small prop, or generic paper card is not hero.

SILENT-FRAME TEST:
- silentFrameTakeaway says what a muted viewer infers from visible action.
- visualFingerprint encodes grammar|focalType|character-count|stage|main-action.

SECTION:
${JSON.stringify(input.section)}

GLOBAL STORY MAP:
${JSON.stringify(input.storyMap)}

PREVIOUS REGISTERS:
${JSON.stringify(input.previousRegisters ?? [])}

RECENT VISUAL FINGERPRINTS (do not repeat):
${JSON.stringify(input.recentFingerprints ?? [])}

USAGE LEDGER:
${JSON.stringify(input.usageLedger ?? {})}

REMAINING TREATMENT QUOTAS:
${JSON.stringify(input.remainingQuotas ?? {})}

ASSET CANDIDATES (use IDs exactly; request missing assets explicitly):
${JSON.stringify(input.assetCandidates)}

TRANSCRIPT EXCERPT:
${input.transcriptExcerpt}

Return JSON only: {"scenes":[...]}.`;
}
