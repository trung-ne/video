import { IndexedWord } from "../transcriptCoverage";
import { DIRECTOR_POLICY_VERSION } from "../directorPolicy";

export function buildStoryMapPrompt(transcript: string, words: IndexedWord[], durationSeconds: number): string {
  const indexed = words.map((word) => `[${word.index}] ${word.text}`).join(" ");
  return `You are the global story editor for an original editorial cat explainer.
Prompt version: ${DIRECTOR_POLICY_VERSION}.

Create a global story map, not individual scenes. The map must cover word 0 through
word ${Math.max(0, words.length - 1)} exactly once in ordered, non-overlapping sections.
Estimated duration: ${durationSeconds} seconds.

For each section return:
- id
- sourceRange {startWord,endWord}
- thesis
- emotionalTurn
- claims: only claims stated by the transcript
- visualOpportunities
- heroVisualOpportunity
- claimVisuals: map claims to chart, map, evidence, photo, action, or visual gag
- treatmentSequence: planned visual-register sequence
- heroConcept: a concrete composition, not a boolean
- requiredProps, requiredSettings, requiredCharacterRoles
- noCharacterOpportunity
- visualContrastFromPreviousSection

Also return a top-level arc, visualMotifs, claims, and visualTreatmentPlan with
registerTargets, characterFreeTarget (minimum 0.20), heroConcepts, visualMotifs,
and forbiddenRepeats. For every factual claim set
evidencePolicy to none, quote, data, or source_card. Do not invent evidence.

INDEXED TRANSCRIPT:
${indexed}

RAW TRANSCRIPT FOR PUNCTUATION:
${transcript}

Return JSON only.`;
}
