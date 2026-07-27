import { SceneBrief } from "../types/storyboard";

export interface VisualCritique {
  sceneId: string;
  score: number;
  issues: string[];
}

const GENERIC_HEADINGS = /^(the big picture|money|children|population|dating game|evidence|overview)$/i;

export function visualFingerprint(scene: Partial<SceneBrief>): string {
  if (scene.visualFingerprint?.trim()) return scene.visualFingerprint.trim().toLowerCase();
  const slots = scene.slots ?? {};
  const stage = String(slots.stage ?? slots.background ?? "none");
  const assets = Object.keys(scene.resolvedAssets ?? {}).sort().join("+") || "unresolved";
  const action = scene.semanticVisual?.action ?? "none";
  const castCount = scene.continuity?.castIds?.length ?? 0;
  return [scene.visualGrammar, scene.focalType, castCount, stage, action, assets]
    .join("|").toLowerCase();
}

export function critiqueSceneBrief(scene: SceneBrief): VisualCritique {
  let score = 0;
  const issues: string[] = [];
  if (scene.semanticVisual?.takeaway && scene.silentFrameTakeaway) score += 2;
  else issues.push("silent-frame takeaway is missing");
  if (scene.semanticVisual?.action && !/^(shows?|is|are|stands?|looks?)$/i.test(scene.semanticVisual.action)) score += 2;
  else issues.push("visible action is generic");
  if ((scene.assetRequests?.length ?? 0) > 0 && (scene.unresolvedAssetRequests?.length ?? 0) === 0) score += 2;
  else issues.push("semantic asset is unresolved");
  if ((scene.noveltyFromPrevious?.length ?? 0) > 0 && scene.visualFingerprint) score += 2;
  else issues.push("novelty/fingerprint is missing");
  const heroQualified = !scene.heroVisual || [
    "photo", "screenshot", "map", "chart", "diagram", "evidence", "full_scene", "visual_gag",
  ].includes(scene.focalType ?? "");
  if (heroQualified) score += 2;
  else issues.push("hero is metadata-only");
  const labels = Object.values(scene.slots ?? {}).map(String);
  if (!labels.some((label) => GENERIC_HEADINGS.test(label.trim()))) score += 2;
  else issues.push("generic taxonomy heading replaces a concrete takeaway");
  return { sceneId: scene.id, score, issues };
}

export function critiqueSceneBriefs(scenes: SceneBrief[]): VisualCritique[] {
  const fingerprints = new Map<string, number>();
  const critiques = scenes.map(critiqueSceneBrief);
  scenes.forEach((scene, index) => {
    const fingerprint = visualFingerprint(scene);
    scene.visualFingerprint = fingerprint;
    const previous = fingerprints.get(fingerprint);
    if (previous !== undefined && index - previous < 4) {
      critiques[index].score = Math.max(0, critiques[index].score - 2);
      critiques[index].issues.push(`visual fingerprint repeats scene ${scenes[previous].id}`);
    }
    fingerprints.set(fingerprint, index);
  });
  return critiques;
}
