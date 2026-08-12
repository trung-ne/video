/**
 * compile-storyboard.ts — Storyboard JSON → SceneTimeline (scenes[]) JSON.
 *
 *   npx ts-node scripts/compile-storyboard.ts --storyboard projects/<id>/storyboard.json \
 *       --out projects/<id>/timeline.json [--durations projects/<id>/durations.json] \
 *       [--words projects/<id>/words.json] [--audio audio/<id>/voice.wav]
 *
 * Timing integrity is a hard gate here (see src/engine/timingIntegrity.ts): scene
 * ids must agree across storyboard/durations, word alignment must belong to this
 * audio, and the compiled timeline must span the voice track. Compiling from
 * word-count estimates silently desyncs the whole video, so it is refused rather
 * than warned about. `--diagnostic-estimated-timing` opts out, and its output is
 * written as `*.estimated.json` so a diagnostic build can never be mistaken for a
 * production one by filename convention.
 */
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import { compileStoryboard, SceneTiming } from "../src/engine/storyboardCompiler";
import { SceneTimeline } from "../src/types/scene";
import { AlignedWord } from "../src/types/storyboard";
import { checksumJson } from "../src/ai/transcriptCoverage";
import { sha256File } from "../src/audio/prepareAudio";
import { assertStyleInventory, requestedAssetStyle, styleManifestHash } from "../src/engine/assetStyle";
import { runStoryboardCheck, printQualityReport } from "../src/ai/qualityCheck";
import {
  checkSceneIdAlignment,
  checkCanonicalSubtitleAlignment,
  checkTimelineSpansAudio,
  checkWordAlignment,
  formatTimingIssues,
  hasBlocker,
  TimingIssue,
} from "../src/engine/timingIntegrity";

const args = process.argv.slice(2);
const getArg = (f: string) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : undefined; };
const diagnosticEstimated = args.includes("--diagnostic-estimated-timing");
const timingGate = !diagnosticEstimated;

const sbPath = getArg("--storyboard");
const outPath = getArg("--out") ?? "timeline.json";
if (!sbPath || !fs.existsSync(sbPath)) { console.error(`❌ storyboard not found: ${sbPath}`); process.exit(1); }

const sb = JSON.parse(fs.readFileSync(sbPath, "utf-8"));
const assetStyle = requestedAssetStyle();
const storyboardChecksum = checksumJson(sb);
if (getArg("--audio")) sb.audio = getArg("--audio");

// Storyboard-level gates (INTENT_REALIZED, BEAT_UNANCHORED) before compiling.
// A report with a blocker/major is not merely advisory: writing a measured
// timeline here would let downstream render/publish mistake rejected authored
// intent for a production candidate.
const storyboardQuality = runStoryboardCheck(sb);
printQualityReport(storyboardQuality);
if (!diagnosticEstimated && (storyboardQuality.blockers > 0 || storyboardQuality.majors > 0)) {
  console.error(
    `\n❌ Compile refused: storyboard quality has ${storyboardQuality.blockers} blocker(s) `
      + `and ${storyboardQuality.majors} major issue(s). No timeline was written.\n`,
  );
  process.exit(1);
}

// A supplied-but-missing path must be an error, not silently `undefined` — a
// typo'd --durations would otherwise degrade into "no timing supplied".
function requireFile(flag: string, filePath: string): void {
  if (!fs.existsSync(filePath)) {
    console.error(`❌ ${flag} was given but does not exist: ${filePath}`);
    process.exit(1);
  }
}

let durations: SceneTiming[] | undefined;
let durationsTotalSec: number | undefined;
const dPath = getArg("--durations");
if (dPath) {
  requireFile("--durations", dPath);
  const d = JSON.parse(fs.readFileSync(dPath, "utf-8"));
  durations = (d.scenes ?? []).map((s: any) => ({ id: s.id, startFrame: s.startFrame, frames: s.frames }));
  durationsTotalSec = typeof d.totalSec === "number" ? d.totalSec : undefined;
}

let words: AlignedWord[] | undefined;
let alignment: any;
const wPath = getArg("--words");
if (wPath) {
  requireFile("--words", wPath);
  const w = JSON.parse(fs.readFileSync(wPath, "utf-8"));
  words = Array.isArray(w) ? w : w.words;
  const alignmentPath = getArg("--alignment") ?? path.join(path.dirname(wPath), "alignment.json");
  if (fs.existsSync(alignmentPath)) alignment = JSON.parse(fs.readFileSync(alignmentPath, "utf-8"));
}

/** Measured length of the actual voice track, or undefined if not probeable. */
function probeAudioSeconds(publicRelPath: string | undefined): number | undefined {
  if (!publicRelPath) return undefined;
  const candidates = [
    path.resolve("public", publicRelPath),
    path.resolve(publicRelPath),
  ];
  const wav = candidates.find((p) => fs.existsSync(p));
  if (!wav) return undefined;
  try {
    const ffprobePath = require("@ffprobe-installer/ffprobe").path as string;
    const out = execFileSync(ffprobePath, [
      "-v", "error", "-show_entries", "format=duration", "-of", "json", wav,
    ], { encoding: "utf8" });
    const sec = Number(JSON.parse(out)?.format?.duration);
    return Number.isFinite(sec) ? sec : undefined;
  } catch {
    return undefined;
  }
}

const probedAudioSec = probeAudioSeconds(sb.audio);
const audioSeconds = probedAudioSec ?? durationsTotalSec;

const preIssues: TimingIssue[] = [];
// With no durations.json, aligned words are the only possible boundary source.
const wordsProvideTiming = !(durations ?? []).length;

if (timingGate) {
  preIssues.push(...checkSceneIdAlignment(
    sb.scenes.map((s: any) => s.id),
    (durations ?? []).map((d) => d.id),
    undefined,
    { wordsProvideTiming },
  ));

  // A voice.wav that disagrees with durations.json means one of them is stale.
  if (probedAudioSec !== undefined && durationsTotalSec !== undefined
      && Math.abs(probedAudioSec - durationsTotalSec) > 1.0) {
    preIssues.push({
      code: "TIMING_AUDIO_STALE",
      severity: "BLOCKER",
      message:
        `voice.wav is ${probedAudioSec.toFixed(2)}s but durations.json reports ${durationsTotalSec.toFixed(2)}s.`,
      hint: "One artifact is left over from an earlier TTS run — regenerate both together.",
    });
  }

  if (audioSeconds !== undefined) {
    preIssues.push(...checkWordAlignment(words, audioSeconds, { wordsProvideTiming }));
  }
  preIssues.push(...checkCanonicalSubtitleAlignment(words, sb.scenes, alignment));

  const projectManifestPath = path.join(path.dirname(path.resolve(sbPath)), "project.json");
  if (fs.existsSync(projectManifestPath) && alignment?.language) {
    const declared = String(JSON.parse(fs.readFileSync(projectManifestPath, "utf-8")).language ?? "").toLowerCase();
    const alignedLanguage = String(alignment.language).toLowerCase();
    if (declared && alignedLanguage && !alignedLanguage.startsWith(declared) && !declared.startsWith(alignedLanguage)) {
      preIssues.push({
        code: "LANGUAGE_MISMATCH",
        severity: "BLOCKER",
        message: `project.json declares "${declared}" but canonical word alignment reports "${alignedLanguage}".`,
        hint: "Correct the project language or regenerate TTS/alignment with the intended language.",
      });
    }
  }

  if (preIssues.length) {
    console.error(`\n⏱️  TIMING INTEGRITY\n${formatTimingIssues(preIssues)}\n`);
    if (hasBlocker(preIssues)) {
      console.error("❌ Compile refused: timing artifacts disagree. Fix them — do NOT compile from estimates.");
      console.error("   (diagnostic only, writes *.estimated.json: --diagnostic-estimated-timing)\n");
      process.exit(1);
    }
  }
} else {
  console.warn(
    "\n⚠️  TIMING_ESTIMATED — scene timing may be guessed. " +
    "Writing *.estimated.json; render and publish will refuse it.\n"
  );
}

// The compiler enforces the same invariant independently (it is the engine-level
// backstop for callers that never come through this CLI). The pre-checks above
// exist to explain *why* before it throws.
// Digests of every input, so the artifact records exactly what it was built from.
const audioAbsolute = sb.audio
  ? [path.resolve("public", sb.audio), path.resolve(sb.audio)].find((p) => fs.existsSync(p))
  : undefined;
const provenance = {
  audioSeconds,
  audioSha256: audioAbsolute ? sha256File(audioAbsolute) : undefined,
  storyboardChecksum,
  durationsChecksum: dPath ? checksumJson(JSON.parse(fs.readFileSync(dPath, "utf-8"))) : undefined,
  wordsChecksum: wPath ? checksumJson(JSON.parse(fs.readFileSync(wPath, "utf-8"))) : undefined,
  subtitleTiming: alignment ? {
    source: alignment.source,
    canonicalWordCount: Number(alignment.canonicalWordCount ?? 0),
    matchedWordCount: Number(alignment.matchedWordCount ?? 0),
    coverage: Number(alignment.coverage ?? 0),
    matchedCoverage: Number(alignment.matchedCoverage ?? alignment.coverage ?? 0),
    interpolatedWordCount: Number(alignment.interpolatedWordCount ?? 0),
    language: alignment.language,
  } : undefined,
};

let timeline: SceneTimeline;
try {
  timeline = compileStoryboard(sb, { durations, words, provenance, allowEstimatedTiming: !timingGate });
} catch (error) {
  console.error(`\n❌ Compile refused: ${(error as Error).message}\n`);
  process.exit(1);
}

// Pin every image reference to a physical file from the selected style. This is
// deliberately after scene compilation: authored storyboard refs remain stable,
// but every downstream renderer/audit receives style-specific geometry.
const styleRefs: string[] = [];
for (const scene of timeline.scenes) {
  if (scene.backgroundSrc && !scene.backgroundSrc.startsWith("#") && !scene.backgroundSrc.includes("gradient") && !scene.backgroundSrc.startsWith("rgb")) styleRefs.push(scene.backgroundSrc);
  for (const entity of scene.entities) styleRefs.push(entity.src);
  for (const card of scene.cards ?? []) if (card.iconSrc) styleRefs.push(card.iconSrc);
  for (const frame of scene.frameBoxes ?? []) if (frame.contentSrc) styleRefs.push(frame.contentSrc);
}
const stylePaths = assertStyleInventory(assetStyle, styleRefs);
const pin = (src: string) => stylePaths[src] ?? src;
for (const scene of timeline.scenes) {
  if (scene.backgroundSrc) scene.backgroundSrc = pin(scene.backgroundSrc);
  for (const entity of scene.entities) entity.src = pin(entity.src);
  for (const card of scene.cards ?? []) if (card.iconSrc) card.iconSrc = pin(card.iconSrc);
  for (const frame of scene.frameBoxes ?? []) if (frame.contentSrc) frame.contentSrc = pin(frame.contentSrc);
}
timeline.timingProvenance = {
  ...timeline.timingProvenance,
  assetStyle,
  assetStyleManifestHash: styleManifestHash(assetStyle),
};

if (timingGate && audioSeconds !== undefined) {
  const timelineSeconds = timeline.durationInFrames / timeline.fps;
  const postIssues = [
    ...checkTimelineSpansAudio(timelineSeconds, audioSeconds, {
      sceneCount: timeline.scenes.length,
      fps: timeline.fps,
    }),
    ...checkSceneIdAlignment(
      sb.scenes.map((s: any) => s.id),
      (durations ?? []).map((d) => d.id),
      timeline.scenes.map((s) => s.id),
    ).filter((i) => i.code === "TIMING_ID_TIMELINE_DRIFT"),
  ];
  if (postIssues.length) {
    console.error(`\n⏱️  TIMING INTEGRITY (post-compile)\n${formatTimingIssues(postIssues)}\n`);
    if (hasBlocker(postIssues)) {
      console.error("❌ Compile refused: the compiled timeline does not match the narration track.\n");
      process.exit(1);
    }
  }
}

// The canonical name means "measured". A diagnostic build gets a distinct name so
// it cannot be picked up by convention or renamed into production by accident.
const writePath = diagnosticEstimated
  ? outPath.replace(/\.json$/i, ".estimated.json")
  : outPath;
fs.writeFileSync(writePath, JSON.stringify(timeline, null, 2));
console.log(`✅ Compiled storyboard → ${writePath}`);
console.log(`   Scenes: ${timeline.scenes.length} | Duration: ${timeline.durationInFrames} frames (${(timeline.durationInFrames / timeline.fps).toFixed(1)}s)`);
if (audioSeconds !== undefined) {
  const drift = timeline.durationInFrames / timeline.fps - audioSeconds;
  const verdict = Math.abs(drift) < 1 ? "matches" : "DOES NOT MATCH";
  console.log(`   Timing: ${verdict} voice track ${audioSeconds.toFixed(1)}s (drift ${drift.toFixed(2)}s)`);
}
