import {
  assertVisualReportComparableToBaseline,
  finiteVisualComparisonMetric,
} from "./visualAuditIntegrity";

export interface VisualMetricSnapshot {
  flatFrameRatio: number;
  edgeDensity: number;
  nearDuplicateRatio: number;
  longestNearDuplicateRunSeconds: number;
  saturation: number;
  nearWhiteMean: number;
  whiteDominantRatio: number;
}

function metric(value: unknown, label: string): number {
  return finiteVisualComparisonMetric(value, label);
}

function snapshot(report: any): VisualMetricSnapshot {
  return {
    flatFrameRatio: metric(report?.flatFrameRatio, "Candidate flatFrameRatio"),
    edgeDensity: metric(report?.edgeDensity?.mean, "Candidate edgeDensity.mean"),
    nearDuplicateRatio: metric(report?.nearDuplicateRatio, "Candidate nearDuplicateRatio"),
    longestNearDuplicateRunSeconds: metric(
      report?.longestNearDuplicateRunSeconds,
      "Candidate longestNearDuplicateRunSeconds",
    ),
    saturation: metric(report?.saturation?.mean, "Candidate saturation.mean"),
    nearWhiteMean: metric(report?.nearWhiteMean, "Candidate nearWhiteMean"),
    whiteDominantRatio: metric(report?.whiteDominantRatio, "Candidate whiteDominantRatio"),
  };
}

export function buildReferenceComparison(visualAudit: any, baseline: any): any {
  assertVisualReportComparableToBaseline(visualAudit, baseline);
  const candidate = snapshot(visualAudit);
  const pooled = baseline?.pooledBaseline;
  if (!pooled || typeof pooled !== "object" || Array.isArray(pooled)) {
    throw new Error("Reference baseline has no pooledBaseline block.");
  }
  const reference: VisualMetricSnapshot = {
    flatFrameRatio: metric(pooled.flatFrameRatio, "Reference pooledBaseline.flatFrameRatio"),
    edgeDensity: metric(pooled.edgeDensity, "Reference pooledBaseline.edgeDensity"),
    nearDuplicateRatio: metric(pooled.nearDuplicateRatio, "Reference pooledBaseline.nearDuplicateRatio"),
    longestNearDuplicateRunSeconds: metric(
      pooled.longestNearDuplicateRunSeconds,
      "Reference pooledBaseline.longestNearDuplicateRunSeconds",
    ),
    saturation: metric(pooled.saturation, "Reference pooledBaseline.saturation"),
    nearWhiteMean: metric(pooled.nearWhiteMean, "Reference pooledBaseline.nearWhiteMean"),
    whiteDominantRatio: metric(pooled.whiteDominantRatio, "Reference pooledBaseline.whiteDominantRatio"),
  };
  const deltas = Object.fromEntries(
    Object.keys(candidate).map((key) => {
      const metricName = key as keyof VisualMetricSnapshot;
      return [metricName, Number((candidate[metricName] - reference[metricName]).toFixed(4))];
    }),
  );
  if (!Array.isArray(visualAudit.temporalPairs) || visualAudit.temporalPairs.length === 0) {
    throw new Error("Candidate visual audit lacks temporal-pair interval metadata.");
  }
  const pairDeltas: number[] = visualAudit.temporalPairs.map((pair: any, index: number) => {
    const delta = metric(pair?.deltaSeconds, `Candidate temporalPairs[${index}].deltaSeconds`);
    if (!(delta > 0)) throw new Error(`Candidate temporalPairs[${index}].deltaSeconds must be positive.`);
    return delta;
  });
  const pairDeltaSeconds = [...new Set(pairDeltas)].sort((left, right) => left - right);
  const structuralChangeMean = metric(visualAudit.structuralChangeMean, "Candidate structuralChangeMean");
  const ownedPairCount = metric(visualAudit.ownedPairCount, "Candidate ownedPairCount");
  if (!Number.isInteger(ownedPairCount) || ownedPairCount !== visualAudit.temporalPairs.length) {
    throw new Error("Candidate ownedPairCount does not match its structural temporal evidence.");
  }
  return {
    baseline: "pooledBaseline",
    reference: baseline.reference,
    referenceSha256: baseline.referenceSha256,
    measurementSpecVersion: baseline.measurementSpecVersion,
    measurementSpecHash: baseline.measurementSpecHash,
    sampling: {
      sampleSeconds: baseline.sampleSeconds,
      offsetsSeconds: baseline.offsetsSeconds,
      temporalPairing: baseline.measurementSpec.sampling.pairing,
    },
    structuralChange: {
      candidateMean: structuralChangeMean,
      ownedPairCount,
      actualPairDeltaSeconds: pairDeltaSeconds,
    },
    candidate,
    referenceMean: reference,
    deltaCandidateMinusReference: deltas,
  };
}
