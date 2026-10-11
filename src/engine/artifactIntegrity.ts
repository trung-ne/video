import * as fs from "fs";
import * as path from "path";
import { checksumJson } from "../ai/transcriptCoverage";
import { sha256File } from "../audio/prepareAudio";
import { TimingIssue, TimingProvenance } from "./timingIntegrity";

export type ArtifactKind = "audio" | "storyboard" | "durations" | "words";

export interface ArtifactInput {
  kind: ArtifactKind;
  filePath: string;
  expected?: string;
  /** Production measured timelines must bind this input, not merely name it. */
  required?: boolean;
}

export function canonicalJsonChecksum(filePath: string): string {
  return checksumJson(JSON.parse(fs.readFileSync(filePath, "utf8")));
}

export function artifactChecksum(kind: ArtifactKind, filePath: string): string {
  return kind === "audio" ? sha256File(filePath) : canonicalJsonChecksum(filePath);
}

export function verifyArtifactInputs(inputs: ArtifactInput[]): TimingIssue[] {
  const issues: TimingIssue[] = [];
  for (const input of inputs) {
    if (!input.expected) {
      if (input.required) {
        issues.push({
          code: `TIMING_${input.kind.toUpperCase()}_CHECKSUM_MISSING`,
          severity: "BLOCKER",
          message: `timeline provenance does not bind its measured ${input.kind} input.`,
          hint: "Recompile from the current storyboard, measured durations, word alignment, and voice track.",
        });
      }
      continue;
    }
    if (!fs.existsSync(input.filePath)) {
      issues.push({
        code: `TIMING_${input.kind.toUpperCase()}_MISSING`,
        severity: "BLOCKER",
        message: `${input.kind} artifact is missing: ${path.resolve(input.filePath)}.`,
        hint: "Regenerate the measured timing artifacts and recompile the timeline.",
      });
      continue;
    }
    const actual = artifactChecksum(input.kind, input.filePath);
    if (actual !== input.expected) {
      issues.push({
        code: `TIMING_${input.kind.toUpperCase()}_HASH_MISMATCH`,
        severity: "BLOCKER",
        message:
          `${input.kind} hash does not match timeline provenance ` +
          `(expected ${input.expected}, got ${actual}).`,
        hint: `The artifact changed after compile: ${path.resolve(input.filePath)}. Recompile before render.`,
      });
    }
  }
  return issues;
}

export function adjacentArtifactInputs(
  timelinePath: string,
  provenance: TimingProvenance | undefined,
  opts: { audioPath?: string; wordsPath?: string; includeWords?: boolean; requireComplete?: boolean } = {},
): ArtifactInput[] {
  if (!provenance) return [];
  const dir = path.dirname(path.resolve(timelinePath));
  const inputs: ArtifactInput[] = [];
  const required = opts.requireComplete === true;
  if (opts.audioPath) {
    inputs.push({ kind: "audio", filePath: opts.audioPath, expected: provenance.audioSha256, required });
  }
  inputs.push({
    kind: "storyboard",
    filePath: path.join(dir, "storyboard.json"),
    expected: provenance.storyboardChecksum,
    required,
  });
  inputs.push({
    kind: "durations",
    filePath: path.join(dir, "durations.json"),
    expected: provenance.durationsChecksum,
    required,
  });
  if (opts.includeWords) {
    inputs.push({
      kind: "words",
      filePath: opts.wordsPath ?? path.join(dir, "words.json"),
      expected: provenance.wordsChecksum,
      required,
    });
  }
  return inputs;
}
