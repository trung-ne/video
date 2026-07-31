function ranked(values: string[], limit = 10): Array<{ value: string; uses: number }> {
  const counts = new Map<string, number>();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].map(([value, uses]) => ({ value, uses }))
    .sort((a, b) => b.uses - a.uses || a.value.localeCompare(b.value)).slice(0, limit);
}

function longestRun(values: string[]): { value: string; length: number } {
  let best = { value: "", length: 0 };
  let current = { value: "", length: 0 };
  for (const value of values) {
    current = value === current.value ? { value, length: current.length + 1 } : { value, length: 1 };
    if (current.length > best.length) best = { ...current };
  }
  return best;
}

export function buildDirectionSummary(timeline: any): any {
  const scenes: any[] = timeline.scenes ?? [];
  const assets = scenes.flatMap((scene) => scene.semanticAssetIds ?? []);
  const stages = scenes.map((scene) => String(scene.backgroundSrc ?? ""))
    .filter((value) => value.includes("scenes/") || value.includes("generated-backgrounds/"));
  const poses = assets.filter((value: string) => value.includes("characters/") || value.includes("generated-assets/characters/"));
  const treatments = scenes.map((scene) => String(scene.photoTreatment ?? "")).filter(Boolean);
  return {
    topAssets: ranked(assets),
    topStages: ranked(stages),
    topPoses: ranked(poses),
    photoTreatments: ranked(treatments),
    visualGrammars: ranked(scenes.map((scene) => String(scene.visualGrammar ?? "unknown"))),
    visualRegisters: ranked(scenes.map((scene) => String(scene.visualRegister ?? "unknown"))),
    longestStageRun: longestRun(scenes.map((scene) => String(scene.backgroundSrc ?? ""))),
    longestGrammarRun: longestRun(scenes.map((scene) => String(scene.visualGrammar ?? "unknown"))),
    assetResolutionNotes: scenes.flatMap((scene) =>
      (scene.assetResolutionNotes ?? []).map((note: string) => ({ sceneId: scene.id, note }))),
  };
}
