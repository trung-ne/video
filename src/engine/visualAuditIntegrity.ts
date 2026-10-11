import { checksumJson } from "../ai/transcriptCoverage";
import type { QualityScope } from "../types/chunk";

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const TIMESTAMP_DECIMALS = 9;
const COMPARISON_METRICS = [
  "flatFrameRatio",
  "edgeDensity",
  "nearDuplicateRatio",
  "longestNearDuplicateRunSeconds",
  "saturation",
  "nearWhiteMean",
  "whiteDominantRatio",
] as const;

export interface VisualMeasurementContract {
  version: string;
  hash: string;
  specification: any;
  sampleSeconds: number;
  sampleOffsets: number[];
}

export interface VisualAuditExpectation {
  contract: VisualMeasurementContract;
  expectedDurationSeconds: number;
  probedDurationSeconds: number;
  sampleOffsets: number[];
  frameRate: number;
  timelineOffsetSeconds: number;
  subtitleBandTopRatio: number;
  sceneIds: string[];
  qualityScope: QualityScope;
}

function record(value: unknown, label: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, any>;
}

function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
  return value;
}

function finiteRatio(value: unknown, label: string): number {
  const parsed = finite(value, label);
  if (parsed < 0 || parsed > 1) throw new Error(`${label} must be in [0, 1].`);
  return parsed;
}

function assertOptionalRatio(value: unknown, expected: number | null, label: string): void {
  if (expected === null) {
    if (value !== null) throw new Error(`${label} must be null when no applicable pairs exist.`);
    return;
  }
  if (Math.abs(finiteRatio(value, label) - expected) > 0.00011) {
    throw new Error(`${label} does not match its temporal pair evidence.`);
  }
}

function nonnegativeInteger(value: unknown, label: string): number {
  const parsed = finite(value, label);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${label} must be a non-negative integer.`);
  return parsed;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new Error(`${label} must be an array of non-empty strings.`);
  }
  if (new Set(value).size !== value.length) throw new Error(`${label} must not contain duplicates.`);
  return [...value];
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameNumbers(left: number[], right: number[], tolerance = 1e-9): boolean {
  return left.length === right.length && left.every((value, index) => Math.abs(value - right[index]) <= tolerance);
}

function roundTimestamp(value: number): number {
  const rounded = Number(value.toFixed(TIMESTAMP_DECIMALS));
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function normalizeVisualAuditOffsets(
  value: unknown,
  sampleSeconds: number,
  durationSeconds?: number,
): number[] {
  finite(sampleSeconds, "Visual audit sampleSeconds");
  if (!(sampleSeconds > 0)) throw new Error("Visual audit sampleSeconds must be positive.");
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Visual audit sampleOffsetsSeconds must be a non-empty array.");
  }
  const normalized = value.map((item, index) => {
    const offset = finite(item, `Visual audit sampleOffsetsSeconds[${index}]`);
    if (offset < 0 || offset >= sampleSeconds) {
      throw new Error(`Visual audit sampleOffsetsSeconds[${index}] must be in [0, ${sampleSeconds}).`);
    }
    return roundTimestamp(offset);
  }).sort((left, right) => left - right);
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("Visual audit sampleOffsetsSeconds must remain unique at canonical precision.");
  }
  if (normalized.length > 8) throw new Error("Visual audit supports at most 8 phase offsets.");
  if (durationSeconds !== undefined) {
    finite(durationSeconds, "Visual audit duration");
    if (!(durationSeconds > 0)) throw new Error("Visual audit duration must be positive.");
    const outside = normalized.find((offset) => offset >= durationSeconds);
    if (outside !== undefined) {
      throw new Error(`Visual audit phase offset ${outside} must be smaller than the requested duration.`);
    }
  }
  return normalized;
}

export function expectedVisualSampleSchedule(
  offsets: number[],
  sampleSeconds: number,
  durationSeconds: number,
): number[] {
  const phases = normalizeVisualAuditOffsets(offsets, sampleSeconds, durationSeconds);
  const schedule: number[] = [];
  const seen = new Set<number>();
  for (const offset of phases) {
    const maximum = Math.max(0, Math.ceil((durationSeconds - offset) / sampleSeconds) + 1);
    for (let index = 0; index < maximum; index += 1) {
      const seconds = roundTimestamp(offset + index * sampleSeconds);
      if (seconds >= durationSeconds) break;
      if (seen.has(seconds)) throw new Error("Visual audit phase offsets collapse to a duplicate timestamp.");
      seen.add(seconds);
      schedule.push(seconds);
    }
  }
  schedule.sort((left, right) => left - right);
  if (!schedule.length) throw new Error("Visual audit sampling schedule is empty.");
  return schedule;
}

/** Validate the pinned profile and baseline before any expensive render starts. */
export function assertVisualMeasurementConfiguration(profileValue: unknown, baselineValue: unknown): VisualMeasurementContract {
  const profile = record(profileValue, "Visual audit profile");
  const baseline = record(baselineValue, "Reference visual baseline");
  if (baseline.schemaVersion !== 2) throw new Error("Reference visual baseline must use schemaVersion 2.");
  if (typeof profile.measurementSpecVersion !== "string" || !profile.measurementSpecVersion) {
    throw new Error("Visual audit profile lacks measurementSpecVersion.");
  }
  if (typeof profile.measurementSpecHash !== "string" || !HASH_PATTERN.test(profile.measurementSpecHash)) {
    throw new Error("Visual audit profile lacks a valid measurementSpecHash.");
  }
  if (profile.measurementSpecVersion !== baseline.measurementSpecVersion
      || profile.measurementSpecHash !== baseline.measurementSpecHash) {
    throw new Error("Visual audit profile and reference baseline use different measurement specifications.");
  }
  const specification = record(baseline.measurementSpec, "Reference measurementSpec");
  if (specification.metricVersion !== profile.measurementSpecVersion) {
    throw new Error("Reference measurementSpec version does not match its declared version.");
  }
  const sampling = record(specification.sampling, "Reference measurementSpec.sampling");
  const contentMask = record(specification.contentMask, "Reference measurementSpec.contentMask");
  const sampleSeconds = finite(profile.sampleSeconds, "Visual audit profile sampleSeconds");
  if (!(sampleSeconds > 0)
      || sampleSeconds !== finite(baseline.sampleSeconds, "Reference baseline sampleSeconds")
      || sampleSeconds !== finite(sampling.intervalSeconds, "Reference measurement interval")) {
    throw new Error("Visual audit sample interval differs between profile, specification, and baseline.");
  }
  const sampleOffsets = normalizeVisualAuditOffsets(profile.sampleOffsetsSeconds, sampleSeconds);
  const baselineOffsets = normalizeVisualAuditOffsets(baseline.offsetsSeconds, sampleSeconds);
  const specificationOffsets = normalizeVisualAuditOffsets(sampling.phaseOffsetsSeconds, sampleSeconds);
  if (!sameNumbers(sampleOffsets, baselineOffsets) || !sameNumbers(sampleOffsets, specificationOffsets)) {
    throw new Error("Visual audit phase offsets differ between profile, specification, and baseline.");
  }
  const bandTop = finite(profile.subtitleBandTopRatio, "Visual audit subtitleBandTopRatio");
  if (bandTop !== finite(contentMask.includedTopRatio, "Reference measurement content mask")) {
    throw new Error("Visual audit content mask differs from the reference measurement specification.");
  }
  const pooled = record(baseline.pooledBaseline, "Reference pooledBaseline");
  for (const metric of COMPARISON_METRICS) finite(pooled[metric], `Reference pooledBaseline.${metric}`);
  return {
    version: profile.measurementSpecVersion,
    hash: profile.measurementSpecHash,
    specification,
    sampleSeconds,
    sampleOffsets,
  };
}

function roundedMetric(value: number): number {
  return Number(value.toFixed(4));
}

function metricMean(values: number[]): number {
  return roundedMetric(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function metricPercentile(values: number[], percentile: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * percentile / 100;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const value = lower === upper
    ? sorted[lower]
    : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
  return roundedMetric(value);
}

function assertMetricSummary(value: unknown, label: string, samples?: number[]): void {
  const summary = record(value, label);
  for (const key of ["mean", "p10", "p50"]) finiteRatio(summary[key], `${label}.${key}`);
  if (samples && (Math.abs(summary.mean - metricMean(samples)) > 0.00011
      || Math.abs(summary.p10 - metricPercentile(samples, 10)) > 0.00011
      || Math.abs(summary.p50 - metricPercentile(samples, 50)) > 0.00011)) {
    throw new Error(`${label} does not match its owned frame evidence.`);
  }
}

function assertApplicability(report: Record<string, any>, scope: QualityScope, seamExpected: boolean): void {
  const applicability = record(report.gateApplicability, "Visual audit gateApplicability");
  const distributionApplies = scope.kind === "global";
  for (const key of ["saturation", "nearWhiteMean", "whiteDominantRatio", "flatFrameRatio", "nearDuplicateRatio"]) {
    const item = record(applicability[key], `Visual audit gateApplicability.${key}`);
    if (item.applies !== distributionApplies || item.category !== "distribution") {
      throw new Error(`Visual audit ${key} applicability does not match ${scope.kind} scope.`);
    }
  }
  for (const key of ["edgeDensity", "focalOccupancy", "withinSceneNearDuplicateRatio", "longestStaticRun", "minimumEvidence"]) {
    if (record(applicability[key], `Visual audit gateApplicability.${key}`).applies !== true) {
      throw new Error(`Visual audit ${key} must apply to a timeline-backed ${scope.kind} audit.`);
    }
  }
  const seam = record(applicability.seamNearDuplicateRatio, "Visual audit gateApplicability.seamNearDuplicateRatio");
  if (seam.applies !== seamExpected || seam.category !== "seam-temporal") {
    throw new Error("Visual audit seam applicability does not match the audited timeline.");
  }
}

/** Require complete, finite evidence before a report can contribute to readiness. */
export function assertVisualAuditReport(reportValue: unknown, expectation: VisualAuditExpectation): void {
  const report = record(reportValue, "Visual audit report");
  if (report.schemaVersion !== 2) throw new Error("Visual audit report must use schemaVersion 2.");
  if (report.measurementSpecVersion !== expectation.contract.version
      || report.measurementSpecHash !== expectation.contract.hash
      || checksumJson(report.measurementSpec) !== checksumJson(expectation.contract.specification)) {
    throw new Error("Visual audit report measurement specification does not match the pinned profile and baseline.");
  }
  if (report.passed !== true || !Array.isArray(report.failures) || report.failures.length !== 0) {
    throw new Error("Visual audit report is not a clean passing report.");
  }
  const sampleSeconds = finite(report.sampleSeconds, "Visual audit sampleSeconds");
  if (sampleSeconds !== expectation.contract.sampleSeconds) throw new Error("Visual audit sample interval drifted.");
  const expectedOffsets = normalizeVisualAuditOffsets(
    expectation.sampleOffsets,
    sampleSeconds,
    expectation.expectedDurationSeconds,
  );
  if (!sameNumbers(expectedOffsets, expectation.contract.sampleOffsets)) {
    throw new Error("Requested visual audit phases differ from the pinned measurement contract.");
  }
  const reportOffsets = normalizeVisualAuditOffsets(report.sampleOffsets, sampleSeconds);
  if (!sameNumbers(reportOffsets, expectedOffsets)) throw new Error("Visual audit sample offsets drifted.");
  if (reportOffsets.length === 1) {
    if (Math.abs(finite(report.sampleOffsetSeconds, "Visual audit sampleOffsetSeconds") - reportOffsets[0]) > 1e-9) {
      throw new Error("Visual audit singular sample offset is inconsistent.");
    }
  } else if (report.sampleOffsetSeconds !== null) {
    throw new Error("Multiphase visual audit must not claim a singular sample offset.");
  }
  if (Math.abs(finite(report.timelineOffsetSeconds, "Visual audit timelineOffsetSeconds")
      - expectation.timelineOffsetSeconds) > 1e-9) {
    throw new Error("Visual audit timeline offset drifted from the rendered frame range.");
  }
  if (Math.abs(finite(report.subtitleBandMaskedFrom, "Visual audit subtitleBandMaskedFrom")
      - expectation.subtitleBandTopRatio) > 1e-9) {
    throw new Error("Visual audit content mask drifted from the pinned measurement specification.");
  }

  const expectedDuration = finite(report.expectedDurationSeconds, "Visual audit expectedDurationSeconds");
  const probedDuration = finite(report.probedDurationSeconds, "Visual audit probedDurationSeconds");
  if (report.durationSource !== "caller-expected-and-probe-verified") {
    throw new Error("Visual audit must bind caller-expected duration to an independent probe.");
  }
  const durationTolerance = finite(report.durationToleranceSeconds, "Visual audit durationToleranceSeconds");
  const expectedFrameRate = finite(expectation.frameRate, "Expected frame rate");
  if (!(expectedFrameRate > 0)) throw new Error("Expected frame rate must be positive.");
  // AAC priming/padding may extend the MP4 container by one 1024-sample
  // access unit beyond the video frame span. This remains a bounded muxing
  // allowance rather than a general timing-drift tolerance.
  const expectedDurationTolerance = Math.max(0.005, 1 / expectedFrameRate + 1024 / 48_000 + 0.005);
  if (Math.abs(durationTolerance - expectedDurationTolerance) > 0.0001) {
    throw new Error("Visual audit duration tolerance does not match the rendered frame rate.");
  }
  if (Math.abs(expectedDuration - expectation.expectedDurationSeconds) > 1e-6) {
    throw new Error("Visual audit covers a different requested duration.");
  }
  if (Math.abs(probedDuration - expectation.probedDurationSeconds) > 1e-6) {
    throw new Error("Visual audit probed duration differs from the rendered artifact timing audit.");
  }
  if (!(durationTolerance > 0) || Math.abs(probedDuration - expectedDuration) > durationTolerance + 1e-6) {
    throw new Error("Visual audit duration coverage is outside its declared tolerance.");
  }

  const schedule = expectedVisualSampleSchedule(expectedOffsets, sampleSeconds, expectedDuration);
  const expectedCount = nonnegativeInteger(report.expectedSampleCount, "Visual audit expectedSampleCount");
  const sampledFrames = nonnegativeInteger(report.sampledFrames, "Visual audit sampledFrames");
  const gatingFrames = nonnegativeInteger(report.gatingSampledFrames, "Visual audit gatingSampledFrames");
  if (expectedCount !== schedule.length || sampledFrames !== schedule.length || !Array.isArray(report.samples)
      || report.samples.length !== schedule.length) {
    throw new Error("Visual audit sample count does not prove complete schedule coverage.");
  }

  const scope = expectation.qualityScope;
  const scopeRecord = record(report.auditScope, "Visual audit auditScope");
  const sceneIds = stringArray(expectation.sceneIds, "Expected visual-audit scene ids");
  const core = new Set(scope.kind === "chunk" ? scope.coreSceneIds : []);
  const before = new Set(scope.kind === "chunk" ? scope.haloBeforeSceneIds : []);
  const after = new Set(scope.kind === "chunk" ? scope.haloAfterSceneIds : []);
  const seamExpected = scope.kind === "chunk"
    ? before.size > 0 || core.size > 1
    : sceneIds.length > 1;
  if (scopeRecord.kind !== scope.kind || scopeRecord.seamExpected !== seamExpected) {
    throw new Error("Visual audit report scope applicability does not match this timeline.");
  }
  if (scope.kind === "global") {
    if (scopeRecord.chunkId !== null || scopeRecord.coreSceneIds !== null || report.gatingCoreSceneIds !== null
        || gatingFrames !== sampledFrames || scopeRecord.scalarOwnership !== "all-samples"
        || scopeRecord.temporalOwnership !== "all-destinations") {
      throw new Error("Global visual audit report contains chunk-only scope evidence.");
    }
  } else {
    const orderedScope = [...scope.haloBeforeSceneIds, ...scope.coreSceneIds, ...scope.haloAfterSceneIds];
    if (!sameStrings(sceneIds, orderedScope)) {
      throw new Error("Expected visual-audit scenes do not exactly match the chunk scope.");
    }
    const sortedCore = [...core].sort();
    const reportCore = stringArray(scopeRecord.coreSceneIds, "Visual audit auditScope.coreSceneIds").sort();
    const gatingCore = stringArray(report.gatingCoreSceneIds, "Visual audit gatingCoreSceneIds").sort();
    if (scopeRecord.chunkId !== scope.chunkId
        || !sameStrings(reportCore, sortedCore)
        || !sameStrings(gatingCore, sortedCore)
        || scopeRecord.scalarOwnership !== "core-only"
        || scopeRecord.temporalOwnership !== "destination-core") {
      throw new Error("Chunk visual audit report does not identify the declared core scope.");
    }
  }

  const expectedScenes = new Set(sceneIds);
  let observedCore = 0;
  let previousDecodedSeconds: number | null = null;
  const gatingRows: Array<Record<string, any>> = [];
  for (let index = 0; index < report.samples.length; index += 1) {
    const row = record(report.samples[index], `Visual audit samples[${index}]`);
    const scheduledSeconds = finite(
      row.scheduledSeconds,
      `Visual audit samples[${index}].scheduledSeconds`,
    );
    if (Math.abs(scheduledSeconds - schedule[index]) > 1e-9) {
      throw new Error(`Visual audit scheduled timestamp ${index} differs from the canonical schedule.`);
    }
    const decodedSeconds = finite(row.seconds, `Visual audit samples[${index}].seconds`);
    const frameTolerance = 1 / expectedFrameRate + 1e-9;
    const bucketEnd = Math.min(scheduledSeconds + sampleSeconds, expectedDuration);
    if (decodedSeconds < scheduledSeconds - frameTolerance
        || decodedSeconds >= bucketEnd + frameTolerance) {
      throw new Error(`Visual audit decoded timestamp ${index} falls outside its scheduled sampling window.`);
    }
    if (previousDecodedSeconds !== null && decodedSeconds <= previousDecodedSeconds) {
      throw new Error("Visual audit decoded sample timestamps must be strictly increasing.");
    }
    previousDecodedSeconds = decodedSeconds;
    for (const key of ["white", "saturation", "edges", "dominantColor", "focalOccupancy"]) {
      finiteRatio(row[key], `Visual audit samples[${index}].${key}`);
    }
    if (row.focalOccupancyTarget === null) {
      if (row.focalOccupancyDelta !== null) {
        throw new Error(`Visual audit samples[${index}] has a delta without a declared target.`);
      }
    } else {
      const target = finiteRatio(row.focalOccupancyTarget, `Visual audit samples[${index}].focalOccupancyTarget`);
      const delta = finite(row.focalOccupancyDelta, `Visual audit samples[${index}].focalOccupancyDelta`);
      if (Math.abs(delta - (row.focalOccupancy - target)) > 0.00011) {
        throw new Error(`Visual audit samples[${index}] has inconsistent focal occupancy metadata.`);
      }
    }
    if (typeof row.flat !== "boolean") throw new Error(`Visual audit samples[${index}].flat must be boolean.`);
    if (!(typeof row.sceneId === "string" && row.sceneId.length > 0) || !expectedScenes.has(row.sceneId)) {
      throw new Error(`Visual audit samples[${index}] lacks valid timeline scene attribution.`);
    }
    if (scope.kind === "global") {
      gatingRows.push(row);
      if (row.sampleRole !== "global") throw new Error("Global visual audit contains a non-global sample role.");
    } else if (core.has(row.sceneId)) {
      observedCore += 1;
      gatingRows.push(row);
      if (row.sampleRole !== "core") throw new Error("Chunk core sample has the wrong ownership role.");
    } else if (before.has(row.sceneId)) {
      if (row.sampleRole !== "halo-before") throw new Error("Chunk before-halo sample has the wrong ownership role.");
    } else if (after.has(row.sceneId)) {
      if (row.sampleRole !== "halo-after") throw new Error("Chunk after-halo sample has the wrong ownership role.");
    } else {
      throw new Error(`Visual audit sample belongs to undeclared scene ${row.sceneId}.`);
    }
  }
  if (gatingRows.length === 0 || gatingRows.length !== gatingFrames
      || (scope.kind === "chunk" && observedCore !== gatingFrames)) {
    throw new Error("Visual audit gating frame count does not match owned samples.");
  }

  for (const key of [
    "nearWhiteMean", "whiteDominantRatio", "flatFrameRatio", "nearDuplicateRatio",
    "withinSceneNearDuplicateRatio",
  ]) finiteRatio(report[key], `Visual audit ${key}`);
  if (Math.abs(report.nearWhiteMean - metricMean(gatingRows.map((row) => row.white))) > 0.00011
      || Math.abs(report.whiteDominantRatio - metricMean(gatingRows.map((row) => Number(row.white > 0.6)))) > 0.00011
      || Math.abs(report.flatFrameRatio - metricMean(gatingRows.map((row) => Number(row.flat)))) > 0.00011) {
    throw new Error("Visual audit frame-distribution metrics do not match owned sample evidence.");
  }
  for (const key of ["longestNearDuplicateRunSeconds", "longestWithinSceneNearDuplicateRunSeconds"]) {
    if (finite(report[key], `Visual audit ${key}`) < 0) throw new Error(`Visual audit ${key} must be non-negative.`);
  }
  finiteRatio(report.structuralChangeMean, "Visual audit structuralChangeMean");
  assertMetricSummary(report.saturation, "Visual audit saturation", gatingRows.map((row) => row.saturation));
  assertMetricSummary(report.edgeDensity, "Visual audit edgeDensity", gatingRows.map((row) => row.edges));
  const occupancy = record(report.focalOccupancy, "Visual audit focalOccupancy");
  const occupancyValues = gatingRows.map((row) => row.focalOccupancy);
  finiteRatio(occupancy.mean, "Visual audit focalOccupancy.mean");
  finiteRatio(occupancy.p10, "Visual audit focalOccupancy.p10");
  if (Math.abs(occupancy.mean - metricMean(occupancyValues)) > 0.00011
      || Math.abs(occupancy.p10 - metricPercentile(occupancyValues, 10)) > 0.00011) {
    throw new Error("Visual audit focal occupancy does not match owned sample evidence.");
  }
  const targetRows = gatingRows.filter((row) => row.focalOccupancyTarget !== null);
  if (nonnegativeInteger(occupancy.declaredTargetSamples, "Visual audit focalOccupancy.declaredTargetSamples") !== targetRows.length) {
    throw new Error("Visual audit declared occupancy target count does not match sample evidence.");
  }
  const belowTargetRatio = targetRows.length
    ? metricMean(targetRows.map((row) => Number(row.focalOccupancyDelta < 0)))
    : null;
  assertOptionalRatio(
    occupancy.belowDeclaredTargetRatio,
    belowTargetRatio,
    "Visual audit focalOccupancy.belowDeclaredTargetRatio",
  );

  const ownedPairs = nonnegativeInteger(report.ownedPairCount, "Visual audit ownedPairCount");
  const withinPairs = nonnegativeInteger(report.withinScenePairCount, "Visual audit withinScenePairCount");
  const seamPairs = nonnegativeInteger(report.seamPairCount, "Visual audit seamPairCount");
  if (!Array.isArray(report.temporalPairs) || report.temporalPairs.length !== ownedPairs || ownedPairs === 0) {
    throw new Error("Visual audit temporal pair evidence is incomplete.");
  }
  const expectedPairs: Array<{ left: any; right: any; kind: "within-scene" | "seam" }> = [];
  for (let index = 1; index < report.samples.length; index += 1) {
    const left = report.samples[index - 1];
    const right = report.samples[index];
    if (scope.kind === "global" || core.has(right.sceneId)) {
      expectedPairs.push({ left, right, kind: left.sceneId === right.sceneId ? "within-scene" : "seam" });
    }
  }
  const expectedWithinPairs = expectedPairs.filter((pair) => pair.kind === "within-scene").length;
  const expectedSeamPairs = expectedPairs.length - expectedWithinPairs;
  const temporalSpec = record(expectation.contract.specification.temporalMetrics, "Visual measurement temporalMetrics");
  const duplicateThreshold = finiteRatio(temporalSpec.nearDuplicatePixelThreshold, "Visual near-duplicate threshold");
  if (ownedPairs !== expectedPairs.length || withinPairs !== expectedWithinPairs || seamPairs !== expectedSeamPairs) {
    throw new Error("Visual audit temporal pair counts do not match chronological destination ownership.");
  }
  let differenceSum = 0;
  const validatedPairs: Array<{ kind: "within-scene" | "seam"; delta: number; duplicate: boolean }> = [];
  for (let index = 0; index < report.temporalPairs.length; index += 1) {
    const pair = record(report.temporalPairs[index], `Visual audit temporalPairs[${index}]`);
    const expectedPair = expectedPairs[index];
    const from = finite(pair.fromSeconds, `Visual audit temporalPairs[${index}].fromSeconds`);
    const to = finite(pair.toSeconds, `Visual audit temporalPairs[${index}].toSeconds`);
    const delta = finite(pair.deltaSeconds, `Visual audit temporalPairs[${index}].deltaSeconds`);
    const difference = finiteRatio(pair.difference, `Visual audit temporalPairs[${index}].difference`);
    const duplicateClassificationWrong = difference < duplicateThreshold - 0.0000005
      ? pair.nearDuplicate !== true
      : difference > duplicateThreshold + 0.0000005
        ? pair.nearDuplicate !== false
        : false;
    if (!(to > from) || Math.abs(delta - (to - from)) > 1e-8 || typeof pair.nearDuplicate !== "boolean"
        || Math.abs(from - expectedPair.left.seconds) > 1e-9
        || Math.abs(to - expectedPair.right.seconds) > 1e-9
        || pair.fromSceneId !== expectedPair.left.sceneId
        || pair.toSceneId !== expectedPair.right.sceneId
        || pair.pairKind !== expectedPair.kind
        || duplicateClassificationWrong) {
      throw new Error(`Visual audit temporalPairs[${index}] does not match the canonical chronological pair stream.`);
    }
    differenceSum += difference;
    validatedPairs.push({ kind: expectedPair.kind, delta, duplicate: pair.nearDuplicate });
  }
  const normalizedDuplicateRatio = (pairs: typeof validatedPairs): number | null => pairs.length
    ? pairs.reduce((sum, pair) => sum + (pair.duplicate ? Math.min(pair.delta / sampleSeconds, 1) : 0), 0) / pairs.length
    : null;
  const edgeDuplicateRatio = (pairs: typeof validatedPairs): number | null => pairs.length
    ? pairs.filter((pair) => pair.duplicate).length / pairs.length
    : null;
  const withinEvidence = validatedPairs.filter((pair) => pair.kind === "within-scene");
  const seamEvidence = validatedPairs.filter((pair) => pair.kind === "seam");
  assertOptionalRatio(report.nearDuplicateRatio, normalizedDuplicateRatio(validatedPairs), "Visual audit nearDuplicateRatio");
  assertOptionalRatio(report.edgeNearDuplicateRatio, edgeDuplicateRatio(validatedPairs), "Visual audit edgeNearDuplicateRatio");
  assertOptionalRatio(report.withinSceneNearDuplicateRatio, normalizedDuplicateRatio(withinEvidence), "Visual audit withinSceneNearDuplicateRatio");
  assertOptionalRatio(report.withinSceneEdgeNearDuplicateRatio, edgeDuplicateRatio(withinEvidence), "Visual audit withinSceneEdgeNearDuplicateRatio");
  assertOptionalRatio(report.seamNearDuplicateRatio, normalizedDuplicateRatio(seamEvidence), "Visual audit seamNearDuplicateRatio");
  assertOptionalRatio(report.seamEdgeNearDuplicateRatio, edgeDuplicateRatio(seamEvidence), "Visual audit seamEdgeNearDuplicateRatio");
  assertOptionalRatio(report.crossSceneNearDuplicateRatio, normalizedDuplicateRatio(seamEvidence), "Visual audit crossSceneNearDuplicateRatio");
  const withinDuplicateCount = withinEvidence.filter((pair) => pair.duplicate).length;
  const seamDuplicateCount = seamEvidence.filter((pair) => pair.duplicate).length;
  if (nonnegativeInteger(report.withinSceneDuplicateCount, "Visual audit withinSceneDuplicateCount") !== withinDuplicateCount
      || nonnegativeInteger(report.seamDuplicateCount, "Visual audit seamDuplicateCount") !== seamDuplicateCount
      || nonnegativeInteger(report.crossScenePairCount, "Visual audit crossScenePairCount") !== seamPairs
      || nonnegativeInteger(report.crossSceneDuplicateCount, "Visual audit crossSceneDuplicateCount") !== seamDuplicateCount) {
    throw new Error("Visual audit duplicate counts do not match temporal pair evidence.");
  }
  const pairsByScene: Record<string, number> = {};
  expectedPairs.forEach((pair) => {
    if (pair.kind === "within-scene") {
      pairsByScene[pair.right.sceneId] = (pairsByScene[pair.right.sceneId] ?? 0) + 1;
    }
  });
  if (checksumJson(record(report.withinScenePairCountsByScene, "Visual audit withinScenePairCountsByScene"))
      !== checksumJson(pairsByScene)) {
    throw new Error("Visual audit per-scene temporal counts do not match pair evidence.");
  }
  const structuralMean = differenceSum / report.temporalPairs.length;
  if (Math.abs(structuralMean - report.structuralChangeMean) > 0.00011) {
    throw new Error("Visual audit structuralChangeMean does not match its actual temporal intervals.");
  }
  const minimumEvidence = record(report.minimumEvidence, "Visual audit minimumEvidence");
  const minimumSpec = record(expectation.contract.specification.minimumEvidence, "Visual measurement minimumEvidence");
  for (const key of ["scalarCoreFrames", "ownedTemporalPairs", "sameScenePairsWhenTimelinePresent", "seamPairsWhenExpected"]) {
    if (minimumEvidence[key] !== minimumSpec[key]) {
      throw new Error(`Visual audit minimumEvidence.${key} drifted from the measurement specification.`);
    }
  }
  if (minimumEvidence.sufficient !== true
      || minimumEvidence.observedScalarFrames !== gatingFrames
      || minimumEvidence.observedOwnedTemporalPairs !== ownedPairs
      || minimumEvidence.observedWithinScenePairs !== withinPairs
      || minimumEvidence.observedSeamPairs !== seamPairs
      || gatingFrames < nonnegativeInteger(minimumSpec.scalarCoreFrames, "Minimum scalar evidence")
      || ownedPairs < nonnegativeInteger(minimumSpec.ownedTemporalPairs, "Minimum owned temporal evidence")
      || withinPairs < nonnegativeInteger(minimumSpec.sameScenePairsWhenTimelinePresent, "Minimum within-scene evidence")
      || (seamExpected && seamPairs < nonnegativeInteger(minimumSpec.seamPairsWhenExpected, "Minimum seam evidence"))) {
    throw new Error("Visual audit minimum-evidence declaration is inconsistent.");
  }
  assertApplicability(report, scope, seamExpected);
}

export function assertVisualReportComparableToBaseline(reportValue: unknown, baselineValue: unknown): void {
  const report = record(reportValue, "Visual audit report");
  const baseline = record(baselineValue, "Reference visual baseline");
  if (report.schemaVersion !== 2 || baseline.schemaVersion !== 2
      || report.measurementSpecVersion !== baseline.measurementSpecVersion
      || report.measurementSpecHash !== baseline.measurementSpecHash
      || checksumJson(report.measurementSpec) !== checksumJson(baseline.measurementSpec)) {
    throw new Error("Candidate and reference visual measurements are not comparable.");
  }
  const candidateOffsets = normalizeVisualAuditOffsets(report.sampleOffsets, finite(report.sampleSeconds, "Candidate sampleSeconds"));
  const referenceOffsets = normalizeVisualAuditOffsets(baseline.offsetsSeconds, finite(baseline.sampleSeconds, "Reference sampleSeconds"));
  if (report.sampleSeconds !== baseline.sampleSeconds || !sameNumbers(candidateOffsets, referenceOffsets)) {
    throw new Error("Candidate and reference visual audits use different sampling phases.");
  }
}

export function finiteVisualComparisonMetric(value: unknown, label: string): number {
  return finite(value, label);
}
