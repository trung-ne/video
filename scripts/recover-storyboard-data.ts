/** Recover explicit Route-A source from a valid storyboard artifact. */
import * as fs from "fs";
import * as path from "path";
import { indexTranscript } from "../src/ai/transcriptCoverage";

const project = process.argv[2];
if (!project) throw new Error("Usage: ts-node scripts/recover-storyboard-data.ts <project-id>");
const dir = path.join("projects", project);
const storyboard = JSON.parse(fs.readFileSync(path.join(dir, "storyboard.json"), "utf8"));
const transcript = fs.readFileSync(path.join(dir, "transcript.txt"), "utf8");
const words = indexTranscript(transcript);
const scenes = storyboard.scenes.map((scene: any) => {
  const start = scene.sourceRange?.startWord ?? 0;
  const marker = words.slice(start, Math.min(start + 6, words.length)).map((word) => word.text).join(" ");
  return {
    marker,
    narrationOverride: scene.narration,
    grammar: scene.visualGrammar,
    emotion: scene.emotion,
    entranceStyle: scene.entranceStyle,
    purpose: scene.purpose,
    viewerFocus: scene.viewerFocus,
    slots: scene.slots,
    heroVisual: scene.heroVisual,
    shot: scene.shot,
    visualRegister: scene.visualRegister,
    focalType: scene.focalType,
    semanticVisual: scene.semanticVisual,
    silentFrameTakeaway: scene.silentFrameTakeaway,
    focalOccupancyTarget: scene.focalOccupancyTarget,
    characterRequired: scene.characterRequired,
    photoTreatment: scene.photoTreatment,
    captionTreatment: scene.captionTreatment,
    evidenceTreatment: scene.evidenceTreatment,
    sectionId: scene.sectionId,
    claimIds: scene.claimIds,
    beats: scene.beats,
  };
});
const out = `import type { AuthoredScene, VisualTreatmentPlan } from "../../src/types/storyboard";\n\n` +
  `export const CAST = ${JSON.stringify(storyboard.cast ?? {}, null, 2)} as const;\n\n` +
  `export const VISUAL_TREATMENT_PLAN: VisualTreatmentPlan = ${JSON.stringify(storyboard.visualTreatmentPlan, null, 2)};\n\n` +
  `export const SCENES: AuthoredScene[] = ${JSON.stringify(scenes, null, 2)};\n`;
fs.writeFileSync(path.join(dir, "storyboard-data.ts"), out, "utf8");
console.log(`Recovered ${scenes.length} explicit scenes to ${dir}/storyboard-data.ts`);
