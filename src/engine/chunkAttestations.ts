import * as fs from "fs";
import * as path from "path";
import { checksumJson } from "../ai/transcriptCoverage";
import { sha256File } from "../audio/prepareAudio";
import { ChunkStage, StageAttestation } from "../types/chunk";

export interface ChunkAttestationIssue {
  code:
    | "ATTESTATION_MISSING"
    | "ATTESTATION_MALFORMED"
    | "ATTESTATION_FAILED"
    | "ATTESTATION_STAGE_MISMATCH"
    | "ATTESTATION_CHUNK_MISMATCH"
    | "ATTESTATION_INPUT_DRIFT"
    | "ATTESTATION_OUTPUT_MISSING"
    | "ATTESTATION_OUTPUT_DRIFT";
  message: string;
}

export function checksumArtifact(filePath: string): string {
  const lower = path.extname(filePath).toLowerCase();
  return lower === ".json"
    ? checksumJson(JSON.parse(fs.readFileSync(filePath, "utf8")))
    : sha256File(filePath);
}

export function createStageAttestation(input: Omit<StageAttestation, "schemaVersion" | "completedAt"> & {
  completedAt?: string;
}): StageAttestation {
  return {
    schemaVersion: 1,
    ...input,
    completedAt: input.completedAt ?? new Date().toISOString(),
  };
}

/** Writes atomically so a killed checkpoint never looks complete on resume. */
export function writeStageAttestation(filePath: string, attestation: StageAttestation): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(attestation, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, filePath);
}

export function readStageAttestation(filePath: string): StageAttestation | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as StageAttestation;
  } catch {
    return undefined;
  }
}

export function verifyStageAttestation(
  attestation: StageAttestation | undefined,
  expected: {
    chunkId: string;
    stage: ChunkStage;
    inputHashes: Record<string, string>;
    outputPaths?: Record<string, string>;
    policyVersion: string;
    thresholdProfileHash: string;
  },
): ChunkAttestationIssue[] {
  if (!attestation) return [{ code: "ATTESTATION_MISSING", message: `Missing ${expected.stage} attestation for ${expected.chunkId}.` }];
  if (attestation.schemaVersion !== 1 || !attestation.completedAt || !Number.isInteger(attestation.blockerCount)
    || !Number.isInteger(attestation.majorCount)) {
    return [{ code: "ATTESTATION_MALFORMED", message: `Malformed ${expected.stage} attestation for ${expected.chunkId}.` }];
  }
  if (attestation.chunkId !== expected.chunkId) return [{
    code: "ATTESTATION_CHUNK_MISMATCH",
    message: `Attestation belongs to ${attestation.chunkId}, expected ${expected.chunkId}.`,
  }];
  if (attestation.stage !== expected.stage) return [{
    code: "ATTESTATION_STAGE_MISMATCH",
    message: `Attestation stage is ${attestation.stage}, expected ${expected.stage}.`,
  }];
  if (!attestation.passed || attestation.blockerCount > 0 || attestation.majorCount > 0) return [{
    code: "ATTESTATION_FAILED",
    message: `${expected.stage} attestation for ${expected.chunkId} did not pass.`,
  }];
  if (attestation.policyVersion !== expected.policyVersion || attestation.thresholdProfileHash !== expected.thresholdProfileHash) return [{
    code: "ATTESTATION_INPUT_DRIFT",
    message: `${expected.stage} policy/profile changed after ${expected.chunkId} was checked.`,
  }];
  for (const [name, hash] of Object.entries(expected.inputHashes)) {
    if (attestation.inputHashes[name] !== hash) return [{
      code: "ATTESTATION_INPUT_DRIFT",
      message: `${expected.stage} input "${name}" changed for ${expected.chunkId}.`,
    }];
  }
  for (const [name, filePath] of Object.entries(expected.outputPaths ?? {})) {
    if (!fs.existsSync(filePath)) return [{
      code: "ATTESTATION_OUTPUT_MISSING",
      message: `${expected.stage} output "${name}" is missing for ${expected.chunkId}.`,
    }];
    const actual = checksumArtifact(filePath);
    if (attestation.outputHashes[name] !== actual) return [{
      code: "ATTESTATION_OUTPUT_DRIFT",
      message: `${expected.stage} output "${name}" changed after attestation for ${expected.chunkId}.`,
    }];
  }
  return [];
}
