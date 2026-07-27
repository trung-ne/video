/**
 * build-storyboard-v4.ts — mechanical resolver for the hand-authored
 * projects/video-003-tai-sao-eng-v4 scenes.
 *
 * Every creative decision (scene boundaries, grammar, emotion, slots,
 * purpose, viewerFocus) lives in scripts/_authored-v4-scenes.ts, written by
 * hand against the actual transcript content. This script's ONLY job is
 * mechanical: find each scene's `marker` phrase in the tokenized transcript,
 * slice exact contiguous word ranges from it (guaranteeing full, gap-free,
 * non-overlapping transcript coverage), and emit storyboard.json.
 *
 *   npx ts-node scripts/build-storyboard-v4.ts
 */
import * as fs from "fs";
import * as path from "path";
import { indexTranscript, makeSourceRange, sourceExcerpt, checksumText } from "../src/ai/transcriptCoverage";
import { SCENES, CAST } from "./_authored-v4-scenes";

const projectDir = "projects/video-003-tai-sao-eng-v4";
const transcriptPath = path.join(projectDir, "transcript.txt");
const outPath = path.join(projectDir, "storyboard.json");

const transcript = fs.readFileSync(transcriptPath, "utf8").normalize("NFC");
const words = indexTranscript(transcript);

function tokenize(s: string): string[] {
  const matches = s.normalize("NFC").match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) ?? [];
  return matches.map((w) => w.toLowerCase());
}

function findMarker(marker: string, fromIndex: number): number {
  const tokens = tokenize(marker);
  if (tokens.length === 0) throw new Error(`Empty marker`);
  for (let i = fromIndex; i <= words.length - tokens.length; i++) {
    let ok = true;
    for (let j = 0; j < tokens.length; j++) {
      if (words[i + j].text.toLowerCase() !== tokens[j]) { ok = false; break; }
    }
    if (ok) return i;
  }
  throw new Error(`Marker not found from word ${fromIndex}: "${marker}"`);
}

const ranges: { startWord: number; endWord: number }[] = [];
let cursor = 0;
for (let i = 0; i < SCENES.length; i++) {
  const startIdx = i === 0 ? 0 : findMarker(SCENES[i].marker, cursor);
  if (i > 0) ranges[i - 1].endWord = startIdx - 1;
  ranges.push({ startWord: startIdx, endWord: -1 });
  cursor = startIdx;
}
ranges[ranges.length - 1].endWord = words.length - 1;

// Sanity: every scene after the first must actually start where its own
// marker was found (i.e. markers must be found in transcript order).
for (let i = 0; i < ranges.length; i++) {
  if (ranges[i].endWord < ranges[i].startWord) {
    throw new Error(`Scene ${i} (${SCENES[i].marker}) has empty/invalid range ${ranges[i].startWord}-${ranges[i].endWord}`);
  }
}

// Slot keys that carry an actual asset/background reference (as opposed to
// plain label/caption/question strings) — used to surface each scene's real
// visual anchor(s) into resolvedAssets, so the story-arc check can see what
// every scene already has instead of re-deriving it from nothing.
const ASSET_SLOT_KEYS = [
  "who", "seatB", "prop", "leftAsset", "rightAsset", "causeIcon", "effectIcon",
  "stage", "content", "image", "chart", "map", "photo",
];

function resolvedAssetsFor(slots: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ASSET_SLOT_KEYS) {
    const value = slots[key];
    if (value) out[key] = value;
  }
  const icons = slots.icons;
  if (icons) {
    icons.split("|").map((v) => v.trim()).filter(Boolean).forEach((v, i) => { out[`icon${i}`] = v; });
  }
  // Every grammar we use renders a focal character even without an explicit
  // `who` override (emotion-pose fallback in visualGrammars.ts) — record it.
  if (Object.keys(out).length === 0) out.character = "characters/cat";
  return out;
}

const scenes = SCENES.map((s, i) => {
  const range = makeSourceRange(words, ranges[i].startWord, ranges[i].endWord);
  const narration = s.narrationOverride ?? sourceExcerpt(transcript, words, range);
  const slots = s.slots ?? {};
  return {
    id: `v4-${String(i + 1).padStart(3, "0")}`,
    narration,
    purpose: s.purpose,
    emotion: s.emotion,
    viewerFocus: s.viewerFocus,
    visualGrammar: s.grammar,
    sourceRange: range,
    heroVisual: s.heroVisual ?? false,
    shot: s.shot,
    slots,
    semanticVisual: { subject: "cat", action: s.viewerFocus, takeaway: s.purpose },
    resolvedAssets: resolvedAssetsFor(slots),
  };
});

const storyboard = {
  schemaVersion: 1,
  transcriptChecksum: checksumText(transcript),
  promptVersion: "v4-hand-authored",
  fps: 30,
  width: 1920,
  height: 1080,
  cast: CAST,
  scenes,
};

fs.mkdirSync(projectDir, { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(storyboard, null, 2)}\n`, "utf8");
console.log(`Wrote ${outPath}`);
console.log(`Scenes: ${scenes.length} | Transcript words: ${words.length} | Coverage: words 0-${words.length - 1}`);
