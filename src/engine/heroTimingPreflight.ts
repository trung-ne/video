import { measuredHeroSpacingIssues } from "../ai/qualityCheck";
import { narrationWordCount } from "./visualCadence";

export interface HeroTimingScene {
  id: string;
  narration: string;
  heroVisual?: boolean;
}

export interface MeasuredSceneTiming {
  id: string;
  startSeconds: number;
  durationSeconds: number;
}

/** A forecast is never a production gate; only audio-backed prefix times are measured. */
export function heroTimingPreflight(
  scenes: HeroTimingScene[],
  measuredPrefix: MeasuredSceneTiming[],
  fps = 30,
): {
  measuredSceneIds: string[];
  unmeasuredSceneIds: string[];
  measuredIssues: ReturnType<typeof measuredHeroSpacingIssues>;
  measuredShortPairs: Array<{ previous: string; current: string; gapSeconds: number }>;
  forecastPairs: Array<{ previous: string; current: string; estimatedGapSeconds: number }>;
} {
  if (measuredPrefix.some((scene, index) => scene.id !== scenes[index]?.id ||
      !Number.isFinite(scene.startSeconds) || !Number.isFinite(scene.durationSeconds) ||
      scene.startSeconds < 0 || scene.durationSeconds <= 0 ||
      Math.abs(scene.startSeconds - (index === 0 ? 0 :
        measuredPrefix[index - 1].startSeconds + measuredPrefix[index - 1].durationSeconds)) > 1e-6)) {
    throw new Error("Hero timing preflight requires a contiguous, positive measured scene prefix.");
  }
  const measured = scenes.slice(0, measuredPrefix.length).map((scene, index) => ({
    id: scene.id,
    heroVisual: scene.heroVisual,
    startFrame: Math.round(measuredPrefix[index].startSeconds * fps),
  }));
  const measuredIssues = measuredHeroSpacingIssues(measured, fps);
  const measuredHeroes = measured.filter((scene) => scene.heroVisual);
  const measuredShortPairs = measuredHeroes.slice(1).flatMap((current, index) => {
    const previous = measuredHeroes[index];
    const gapSeconds = (current.startFrame - previous.startFrame) / fps;
    return gapSeconds < 20 ? [{ previous: previous.id, current: current.id, gapSeconds }] : [];
  });
  const forecast: Array<{ id: string; heroVisual?: boolean; startSeconds: number }> = [];
  let nextStart = measuredPrefix.length
    ? measuredPrefix.at(-1)!.startSeconds + measuredPrefix.at(-1)!.durationSeconds
    : 0;
  for (const scene of scenes.slice(measuredPrefix.length)) {
    forecast.push({ id: scene.id, heroVisual: scene.heroVisual, startSeconds: nextStart });
    nextStart += narrationWordCount(scene.narration) / 2.5;
  }
  const allHeroes = [
    ...measured.map((scene) => ({ id: scene.id, heroVisual: scene.heroVisual,
      startSeconds: scene.startFrame / fps })),
    ...forecast,
  ].filter((scene) => scene.heroVisual);
  const forecastPairs = allHeroes.slice(1).flatMap((current, index) => {
    const previous = allHeroes[index];
    if (scenes.findIndex((scene) => scene.id === current.id) < measuredPrefix.length) return [];
    const estimatedGapSeconds = current.startSeconds - previous.startSeconds;
    return estimatedGapSeconds < 25 ? [{ previous: previous.id, current: current.id,
      estimatedGapSeconds: Math.round(estimatedGapSeconds * 10) / 10 }] : [];
  });
  return {
    measuredSceneIds: measured.map((scene) => scene.id),
    unmeasuredSceneIds: forecast.map((scene) => scene.id),
    measuredIssues,
    measuredShortPairs,
    forecastPairs,
  };
}
