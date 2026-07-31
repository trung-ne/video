export interface VisualMetricSnapshot {
  flatFrameRatio: number;
  edgeDensity: number;
  nearDuplicateRatio: number;
  longestNearDuplicateRunSeconds: number;
  saturation: number;
  nearWhiteMean: number;
  whiteDominantRatio: number;
}

function snapshot(report: any): VisualMetricSnapshot {
  return {
    flatFrameRatio: Number(report.flatFrameRatio),
    edgeDensity: Number(report.edgeDensity?.mean ?? report.edgeDensityMean),
    nearDuplicateRatio: Number(report.nearDuplicateRatio),
    longestNearDuplicateRunSeconds: Number(report.longestNearDuplicateRunSeconds),
    saturation: Number(report.saturation?.mean ?? report.saturationMean),
    nearWhiteMean: Number(report.nearWhiteMean),
    whiteDominantRatio: Number(report.whiteDominantRatio),
  };
}

export function buildReferenceComparison(visualAudit: any, baseline: any): any {
  const candidate = snapshot(visualAudit);
  const robust = baseline?.robustBaseline?.metrics;
  if (!robust) throw new Error("Reference baseline has no robustBaseline.metrics block.");
  const reference: VisualMetricSnapshot = {
    flatFrameRatio: Number(robust.flatFrameRatio?.mean),
    edgeDensity: Number(robust.edgeDensity?.mean),
    nearDuplicateRatio: Number(robust.nearDuplicateRatio?.mean),
    longestNearDuplicateRunSeconds: Number(robust.longestNearDuplicateRunSeconds?.mean),
    saturation: Number(robust.saturation?.mean),
    nearWhiteMean: Number(robust.nearWhiteMean?.mean),
    whiteDominantRatio: Number(robust.whiteDominantRatio?.mean),
  };
  const deltas = Object.fromEntries(
    Object.keys(candidate).map((key) => {
      const metric = key as keyof VisualMetricSnapshot;
      return [metric, Number((candidate[metric] - reference[metric]).toFixed(4))];
    })
  );
  return {
    baseline: "robustBaseline",
    reference: baseline.reference,
    referenceSha256: baseline.referenceSha256,
    offsetsSeconds: baseline.offsetsSeconds,
    candidate,
    referenceMean: reference,
    deltaCandidateMinusReference: deltas,
  };
}
