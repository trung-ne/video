export interface VisualMetricSnapshot {
  flatFrameRatio: number;
  edgeDensity: number;
  nearDuplicateRatio: number;
  saturation: number;
}

function snapshot(report: any): VisualMetricSnapshot {
  return {
    flatFrameRatio: Number(report.flatFrameRatio),
    edgeDensity: Number(report.edgeDensity?.mean ?? report.edgeDensityMean),
    nearDuplicateRatio: Number(report.nearDuplicateRatio),
    saturation: Number(report.saturation?.mean ?? report.saturationMean),
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
    saturation: Number(robust.saturation?.mean),
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
