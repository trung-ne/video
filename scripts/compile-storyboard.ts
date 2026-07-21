/**
 * compile-storyboard.ts — Storyboard JSON → SceneTimeline (scenes[]) JSON.
 *
 *   npx ts-node scripts/compile-storyboard.ts --storyboard projects/<id>/storyboard.json \
 *       --out projects/<id>/timeline.json [--durations projects/<id>/durations.json] \
 *       [--words projects/<id>/words.json] [--audio audio/<id>/voice.wav]
 */
import * as fs from "fs";
import { compileStoryboard, SceneTiming } from "../src/engine/storyboardCompiler";
import { AlignedWord } from "../src/types/storyboard";
import { runStoryboardCheck, printQualityReport } from "../src/ai/qualityCheck";

const args = process.argv.slice(2);
const getArg = (f: string) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : undefined; };

const sbPath = getArg("--storyboard");
const outPath = getArg("--out") ?? "timeline.json";
if (!sbPath || !fs.existsSync(sbPath)) { console.error(`❌ storyboard not found: ${sbPath}`); process.exit(1); }

const sb = JSON.parse(fs.readFileSync(sbPath, "utf-8"));
if (getArg("--audio")) sb.audio = getArg("--audio");

// Storyboard-level gates (INTENT_REALIZED, BEAT_UNANCHORED) before compiling.
printQualityReport(runStoryboardCheck(sb));

let durations: SceneTiming[] | undefined;
const dPath = getArg("--durations");
if (dPath && fs.existsSync(dPath)) {
  const d = JSON.parse(fs.readFileSync(dPath, "utf-8"));
  durations = (d.scenes ?? []).map((s: any) => ({ id: s.id, startFrame: s.startFrame, frames: s.frames }));
}

let words: AlignedWord[] | undefined;
const wPath = getArg("--words");
if (wPath && fs.existsSync(wPath)) {
  const w = JSON.parse(fs.readFileSync(wPath, "utf-8"));
  words = Array.isArray(w) ? w : w.words;
}

const timeline = compileStoryboard(sb, { durations, words });
fs.writeFileSync(outPath, JSON.stringify(timeline, null, 2));
console.log(`✅ Compiled storyboard → ${outPath}`);
console.log(`   Scenes: ${timeline.scenes.length} | Duration: ${timeline.durationInFrames} frames (${(timeline.durationInFrames / timeline.fps).toFixed(1)}s)`);
