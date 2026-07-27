/**
 * build-storyboard.ts — mechanical resolver for a hand-authored storyboard
 * (the "session-authored" path: an agent reads the transcript directly in
 * chat and writes scene content by hand, with no API key / model call).
 *
 * Every creative decision (scene boundaries, grammar, emotion, slots,
 * purpose, viewerFocus) lives in a per-project data file exporting `SCENES`
 * (and optionally `CAST`) — see projects/<id>/storyboard-data.ts for the
 * shape (AuthoredScene). This script's ONLY job is mechanical: find each
 * scene's `marker` phrase in the tokenized transcript, slice exact
 * contiguous word ranges from it (guaranteeing full, gap-free,
 * non-overlapping transcript coverage), and emit storyboard.json.
 *
 *   npx ts-node scripts/build-storyboard.ts --project <id-or-path>
 *   npx ts-node scripts/build-storyboard.ts --project <id> --data path/to/data.ts --out path/to/storyboard.json
 */
import * as fs from "fs";
import * as path from "path";
import { indexTranscript, makeSourceRange, sourceExcerpt, checksumText } from "../src/ai/transcriptCoverage";

const args = process.argv.slice(2);
function getArg(flag: string, defaultVal?: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

const projectArg = getArg("--project");
if (!projectArg) {
  console.error("❌ Cần --project <id-or-path> (folder chứa transcript.txt + storyboard-data.ts)");
  process.exit(1);
}
const projectDir = fs.existsSync(projectArg) || projectArg.includes("/") || projectArg.includes("\\")
  ? projectArg
  : path.join("projects", projectArg);

const transcriptPath = getArg("--transcript", path.join(projectDir, "transcript.txt"))!;
const dataPath = getArg("--data", path.join(projectDir, "storyboard-data.ts"))!;
const outPath = getArg("--out", path.join(projectDir, "storyboard.json"))!;

if (!fs.existsSync(transcriptPath)) {
  console.error(`❌ Transcript not found: ${transcriptPath}`);
  process.exit(1);
}
if (!fs.existsSync(dataPath)) {
  console.error(`❌ Storyboard data file not found: ${dataPath}`);
  process.exit(1);
}

// Dynamic require (not a static import) since the data file path is only
// known at runtime — ts-node's register hook lets us require() a .ts file
// directly, same as any other CommonJS module.
const dataModule = require(path.resolve(dataPath));
const SCENES: any[] = dataModule.SCENES;
const CAST: Record<string, any> = dataModule.CAST ?? {};
if (!Array.isArray(SCENES) || SCENES.length === 0) {
  console.error(`❌ ${dataPath} must export a non-empty \`SCENES\` array`);
  process.exit(1);
}

// Short id prefix for scene ids: reuse a trailing version tag from the
// project id (e.g. "...-v4" -> "v4-"), else a generic "scene-".
function defaultIdPrefix(): string {
  const base = path.basename(projectDir);
  const m = /-(v\d+[a-z0-9]*)$/i.exec(base);
  return m ? `${m[1]}-` : "scene-";
}
const idPrefix = getArg("--id-prefix", defaultIdPrefix())!;

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
    id: `${idPrefix}${String(i + 1).padStart(3, "0")}`,
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
  promptVersion: "session-authored",
  fps: 30,
  width: 1920,
  height: 1080,
  cast: CAST,
  scenes,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(storyboard, null, 2)}\n`, "utf8");
console.log(`Wrote ${outPath}`);
console.log(`Scenes: ${scenes.length} | Transcript words: ${words.length} | Coverage: words 0-${words.length - 1}`);
