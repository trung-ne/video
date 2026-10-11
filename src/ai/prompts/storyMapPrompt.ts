import type { IndexedWord } from "../transcriptCoverage";

/** @deprecated Route B/API authoring is locked. */
export function buildStoryMapPrompt(
  _transcript: string,
  _words: IndexedWord[],
  _durationSeconds: number,
): never {
  throw new Error(
    "Route B story-map generation is locked. Author the complete storyboard-data.ts through Route A.",
  );
}
