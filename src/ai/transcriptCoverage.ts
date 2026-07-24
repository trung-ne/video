import { createHash } from "crypto";
import { SceneBrief, SourceRange, Storyboard } from "../types/storyboard";

export interface IndexedWord {
  index: number;
  text: string;
  start: number;
  end: number;
}

export interface CoverageIssue {
  code: "EMPTY_TRANSCRIPT" | "MISSING_RANGE" | "INVALID_RANGE" | "GAP" | "OVERLAP" | "CHECKSUM_MISMATCH";
  sceneId?: string;
  message: string;
}

export interface CoverageReport {
  valid: boolean;
  transcriptChecksum: string;
  words: IndexedWord[];
  issues: CoverageIssue[];
}

export function checksumText(value: string): string {
  return createHash("sha256").update(value.normalize("NFC"), "utf8").digest("hex");
}

export function indexTranscript(transcript: string): IndexedWord[] {
  const words: IndexedWord[] = [];
  const re = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;
  let match: RegExpExecArray | null;
  while ((match = re.exec(transcript.normalize("NFC"))) !== null) {
    words.push({
      index: words.length,
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return words;
}

export function sourceText(words: IndexedWord[], range: SourceRange): string {
  return words.slice(range.startWord, range.endWord + 1).map((w) => w.text).join(" ");
}

export function sourceExcerpt(transcript: string, words: IndexedWord[], range: SourceRange): string {
  const first = words[range.startWord];
  const last = words[range.endWord];
  if (!first || !last) return "";
  return transcript.normalize("NFC").slice(first.start, last.end).trim();
}

export function makeSourceRange(words: IndexedWord[], startWord: number, endWord: number): SourceRange {
  const text = sourceText(words, { startWord, endWord, quoteChecksum: "" });
  return { startWord, endWord, quoteChecksum: checksumText(text) };
}

export function validateStoryboardCoverage(transcript: string, storyboard: Pick<Storyboard, "scenes">): CoverageReport {
  const words = indexTranscript(transcript);
  const issues: CoverageIssue[] = [];
  if (words.length === 0) {
    issues.push({ code: "EMPTY_TRANSCRIPT", message: "Transcript has no indexable words." });
    return { valid: false, transcriptChecksum: checksumText(transcript), words, issues };
  }

  let expectedStart = 0;
  for (const scene of storyboard.scenes as SceneBrief[]) {
    const range = scene.sourceRange;
    if (!range) {
      issues.push({ code: "MISSING_RANGE", sceneId: scene.id, message: `${scene.id} has no sourceRange.` });
      continue;
    }
    if (range.startWord < 0 || range.endWord < range.startWord || range.endWord >= words.length) {
      issues.push({ code: "INVALID_RANGE", sceneId: scene.id, message: `${scene.id} has invalid word range ${range.startWord}-${range.endWord}.` });
      continue;
    }
    if (range.startWord > expectedStart) {
      issues.push({ code: "GAP", sceneId: scene.id, message: `Gap before ${scene.id}: expected word ${expectedStart}, got ${range.startWord}.` });
    } else if (range.startWord < expectedStart) {
      issues.push({ code: "OVERLAP", sceneId: scene.id, message: `Overlap at ${scene.id}: expected word ${expectedStart}, got ${range.startWord}.` });
    }
    const actual = checksumText(sourceText(words, range));
    if (actual !== range.quoteChecksum) {
      issues.push({ code: "CHECKSUM_MISMATCH", sceneId: scene.id, message: `${scene.id} source checksum does not match transcript.` });
    }
    expectedStart = Math.max(expectedStart, range.endWord + 1);
  }

  if (expectedStart < words.length) {
    issues.push({ code: "GAP", message: `Storyboard stops at word ${expectedStart - 1}; transcript ends at ${words.length - 1}.` });
  }
  return {
    valid: issues.length === 0,
    transcriptChecksum: checksumText(transcript),
    words,
    issues,
  };
}
