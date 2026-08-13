/**
 * render.ts — CLI render pipeline
 *
 * Usage:
 *   npx ts-node scripts/render.ts
 *   npx ts-node scripts/render.ts --project <id> --out output/<id>/video.mp4
 *   npx ts-node scripts/render.ts --timeline timeline.json --out output/video.mp4
 *
 * Without --out, the output path defaults to output/<id>/video.mp4 (id from
 * --project, or from the parent folder name when --timeline points inside
 * projects/<id>/) — every artifact for a video (video.mp4, contact.jpg,
 * *-audit.json, production-report.json) lands in one output/<id>/ folder
 * instead of flat output/<id>-suffix.ext files.
 */

import { execFileSync, execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { loadLocalEnvironment } from "./load-env";
import { loadTimeline } from "../src/engine/loadTimeline";
import { printLivelinessReport } from "../src/engine/liveliness";
import { checkSpatialIntegrity, formatSpatialIntegrityReport } from "../src/engine/spatialIntegrity";
import { validateTimeline, printValidationResult } from "../src/ai/validateTimeline";
import { runQualityCheck, printQualityReport } from "../src/ai/qualityCheck";
import { prepareTimelineAudio, writeAudioAudit, resolvePublicAudio, sha256File } from "../src/audio/prepareAudio";
import { adjacentArtifactInputs, verifyArtifactInputs } from "../src/engine/artifactIntegrity";
import { acquireRenderLock } from "../src/engine/renderLock";
import { promoteArtifacts, pruneRunHistory } from "../src/engine/promoteArtifacts";
import { buildReferenceComparison } from "../src/engine/referenceComparison";
import { buildDirectionSummary } from "../src/engine/directionReport";
import { DEFAULT_PROXY_SCALE, getScaledDimensions } from "../src/engine/renderDimensions";
import {
  checkRenderMatchesTimeline,
  checkSceneBeatTimingSources,
  checkTimelineSpansAudio,
  checkTimingProvenance,
  formatTimingIssues,
  hasBlocker,
} from "../src/engine/timingIntegrity";
import referenceQuality from "../config/reference-quality.json";
import { assertTimelineAssetStyle } from "../src/engine/assetStyle";

loadLocalEnvironment();

const args = process.argv.slice(2);

function getArg(flag: string, defaultVal: string): string {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

const projectArg = getArg("--project", "");
const projectPath = projectArg
  ? (fs.existsSync(projectArg) || projectArg.includes("/") || projectArg.includes("\\")
      ? projectArg
      : path.join("projects", projectArg))
  : "";
const timelinePath = getArg("--timeline", projectPath ? path.join(projectPath, "timeline.json") : "timeline.json");

// Derive a project id for the default output folder: from --project, or from
// the parent directory name when --timeline points inside projects/<id>/.
function defaultOutPath(): string {
  const id = projectPath
    ? path.basename(projectPath)
    : (() => {
        const dir = path.basename(path.dirname(timelinePath));
        return dir && dir !== "." ? dir : null;
      })();
  return id ? path.join("output", id, "video.mp4") : "output/video.mp4";
}

const outPath = getArg("--out", defaultOutPath());
const compositionId = getArg("--composition", "CatExplainer");
const isProxy = args.includes("--proxy");
const framesArg = getArg("--frames", "");
if (framesArg && path.resolve(outPath) === path.resolve(defaultOutPath())) {
  console.error(
    "A --frames diagnostic must use a non-canonical --out path (for example output/<id>/slices/check.mp4). " +
    "A partial render can never replace the production video."
  );
  process.exit(1);
}
const frameRangeStart = framesArg ? Number(framesArg.split("-")[0]) : 0;
if (!Number.isFinite(frameRangeStart) || frameRangeStart < 0) {
  console.error(`Invalid --frames start: ${framesArg}`);
  process.exit(1);
}
const referenceBaselinePath = path.resolve("config/reference-visual-baseline.json");
if (!fs.existsSync(referenceBaselinePath)) {
  console.error(`Reference baseline not found: ${referenceBaselinePath}`);
  process.exit(1);
}
const referenceBaseline = JSON.parse(fs.readFileSync(referenceBaselinePath, "utf8"));
const referenceVideoPath = path.resolve(String(referenceBaseline.reference ?? ""));
if (!fs.existsSync(referenceVideoPath)
    || sha256File(referenceVideoPath) !== referenceBaseline.referenceSha256) {
  console.error(
    `Reference baseline hash mismatch for ${referenceVideoPath}. ` +
    "Run npm run reference-audit only after confirming the intended reference file."
  );
  process.exit(1);
}

/** Container duration in seconds, or undefined if the file is missing/unreadable. */
function probeDurationSeconds(filePath: string): number | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  try {
    const ffprobePath = require("@ffprobe-installer/ffprobe").path as string;
    const out = execFileSync(ffprobePath, [
      "-v", "error", "-show_entries", "format=duration", "-of", "json", filePath,
    ], { encoding: "utf8" });
    const seconds = Number(JSON.parse(out)?.format?.duration);
    return Number.isFinite(seconds) ? seconds : undefined;
  } catch {
    return undefined;
  }
}

function runEncodingAudit(videoPath: string, recordAs = videoPath): any {
  const ffprobePath = require("@ffprobe-installer/ffprobe").path as string;
  const rawReport = execFileSync(ffprobePath, [
    "-v", "error", "-show_streams", "-show_format", "-of", "json", videoPath,
  ], { encoding: "utf8" });
  const probe = JSON.parse(rawReport);
  const video = (probe.streams ?? []).find((stream: any) => stream.codec_type === "video");
  const audio = (probe.streams ?? []).find((stream: any) => stream.codec_type === "audio");
  const failures: string[] = [];
  if (!video || video.width !== 1920 || video.height !== 1080) failures.push("Video must be 1920x1080.");
  if (video && video.codec_name !== "h264") failures.push(`Video codec must be h264, got ${video.codec_name}.`);
  if (video && ![referenceQuality.encoding.pixelFormat, "yuvj420p"].includes(video.pix_fmt)) {
    failures.push(`Pixel format must be ${referenceQuality.encoding.pixelFormat}-compatible, got ${video.pix_fmt}.`);
  }
  const rateParts = String(video?.avg_frame_rate ?? "0/1").split("/").map(Number);
  const fps = rateParts[1] ? rateParts[0] / rateParts[1] : 0;
  if (Math.abs(fps - 30) > 0.1) failures.push(`Frame rate must be 30fps, got ${fps}.`);
  const videoBitrate = Number(video?.bit_rate ?? 0);
  const totalBitrate = Number(probe.format?.bit_rate ?? 0);
  if (videoBitrate < referenceQuality.encoding.minimumVideoBitrate) {
    failures.push(`1080p video bitrate is below ${referenceQuality.encoding.minimumVideoBitrate} bps.`);
  }
  if (!audio) failures.push("Rendered file has no audio stream.");
  if (audio && audio.codec_name !== "aac") failures.push(`Audio codec must be aac, got ${audio.codec_name}.`);
  const report = {
    videoPath: path.resolve(recordAs),
    codec: video?.codec_name,
    width: video?.width,
    height: video?.height,
    fps,
    pixelFormat: video?.pix_fmt,
    videoBitrate,
    totalBitrate,
    audioCodec: audio?.codec_name,
    audioBitrate: Number(audio?.bit_rate ?? 0),
    failures,
    passed: failures.length === 0,
  };
  const reportPath = videoPath.replace(/\.mp4$/i, ".encoding-audit.json");
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (failures.length) throw new Error(`Encoding audit failed: ${failures.join(" ")}`);
  return report;
}

// Validate timeline file
if (!fs.existsSync(timelinePath)) {
  console.error(`❌ Timeline file not found: ${timelinePath}`);
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(timelinePath, "utf-8"));
try {
  assertTimelineAssetStyle(raw.timingProvenance);
} catch (error) {
  console.error(`❌ ${(error as Error).message}`);
  process.exit(1);
}
let preparedAudio: any = null;

// Schema gate — fail fast with a clear message instead of crashing deep inside
// Remotion on a malformed/hand-edited timeline. Pass --skip-validate to bypass.
if (!args.includes("--skip-validate")) {
  const validation = validateTimeline(raw);
  printValidationResult(validation, timelinePath);
  if (!validation.valid) {
    console.error("\n❌ Timeline không hợp lệ — dừng render. (dùng --skip-validate để bỏ qua)");
    process.exit(1);
  }
}

// Director gate — schema-valid is not the same as production-ready. Refuse to
// spend minutes rendering a timeline with blockers/majors unless the caller
// explicitly opts out for debugging.
if (!args.includes("--skip-quality")) {
  const quality = runQualityCheck(raw, timelinePath);
  printQualityReport(quality);
  if (quality.blockers > 0 || quality.majors > 0 || !["A", "B"].includes(quality.grade)) {
    console.error(
      "\n❌ Timeline chưa đạt quality gate — dừng render. " +
      "(dùng --skip-quality chỉ cho render chẩn đoán)"
    );
    process.exit(1);
  }
}

// Provenance gate — a timeline must say how it was timed. Absent provenance is a
// refusal, not a pass: every artifact written before that field existed lacks it,
// including ones whose durations were spread proportionally by word count.
const allowUnprovenanced = args.includes("--allow-unprovenanced-timing");
{
  const issues = checkTimingProvenance(raw.timingProvenance, { allowUnprovenanced });
  issues.push(...checkSceneBeatTimingSources(raw.scenes, raw.timingProvenance));
  if (issues.length) {
    console.error(`\n⏱️  TIMING PROVENANCE\n${formatTimingIssues(issues)}\n`);
    if (hasBlocker(issues)) process.exit(1);
  }
}

// Preflight: the timeline must span the voice track BEFORE the expensive loudnorm
// pass, so a 389s shortfall surfaces in seconds rather than minutes.
const sourceAudioPath = raw.audio ? resolvePublicAudio(raw.audio) : undefined;
const sourceAudioSeconds = sourceAudioPath ? probeDurationSeconds(sourceAudioPath) : undefined;
if (raw.audio && sourceAudioSeconds === undefined) {
  console.error(`\n❌ Voice track not found or unreadable: ${sourceAudioPath}\n`);
  process.exit(1);
}
{
  const issues = verifyArtifactInputs(
    adjacentArtifactInputs(timelinePath, raw.timingProvenance, {
      audioPath: sourceAudioPath,
      includeWords: false,
    })
  );
  if (issues.length) {
    console.error(`\n⏱️  ARTIFACT PROVENANCE\n${formatTimingIssues(issues)}\n`);
    if (hasBlocker(issues)) process.exit(1);
  }
}
if (sourceAudioSeconds !== undefined) {
  const issues = checkTimelineSpansAudio(raw.durationInFrames / (raw.fps ?? 30), sourceAudioSeconds, {
    sceneCount: Array.isArray(raw.scenes) ? raw.scenes.length : undefined,
    fps: raw.fps ?? 30,
  });
  if (issues.length) {
    console.error(`\n⏱️  TIMING PREFLIGHT\n${formatTimingIssues(issues)}\n`);
    if (hasBlocker(issues)) process.exit(1);
  }
}

if (raw.audio && !isProxy && !args.includes("--skip-audio-prepare")) {
  preparedAudio = prepareTimelineAudio(raw.audio);
  raw.audio = preparedAudio.publicPath;
  console.log(`Audio prepared: ${preparedAudio.audit.integratedLufs} LUFS${preparedAudio.mastered ? " (mastered)" : ""}`);

  // Mastering must not change length. If it ever does, every scene boundary and
  // every word timestamp silently shifts against the audio Remotion plays.
  const preparedSeconds = probeDurationSeconds(preparedAudio.audit.input);
  if (preparedSeconds !== undefined && sourceAudioSeconds !== undefined) {
    const issues = checkRenderMatchesTimeline(preparedSeconds, sourceAudioSeconds, raw.fps ?? 30);
    if (issues.length) {
      console.error(
        `\n⏱️  Mastered audio length differs from the source track:\n${formatTimingIssues(issues)}\n`
      );
      if (hasBlocker(issues)) process.exit(1);
    }
  }
}

// Scan which cat poses actually exist so pose-swaps never reference a missing asset.
const charDir = path.join(process.cwd(), "public", "assets", "characters");
const generatedCharDir = path.join(process.cwd(), "public", "generated-assets", "characters");
const availablePoses = new Set<string>();
if (fs.existsSync(charDir)) {
  for (const f of fs.readdirSync(charDir)) {
    if (f.endsWith(".svg")) availablePoses.add(`characters/${f.replace(".svg", "")}`);
  }
}

// Single compile point — scenes → events + liveliness (shared with preview).
const { timeline, liveliness } = loadTimeline(raw, availablePoses);
printLivelinessReport(liveliness);
const spatialReport = checkSpatialIntegrity(
  timeline,
  Array.isArray(raw.scenes) ? raw.scenes.map((scene: any) => ({
    id: scene.id,
    start: scene.startFrame,
    end: scene.startFrame + scene.durationFrames,
    narrationBeatFrames: (scene.subtitleCues ?? []).map((cue: any) => scene.startFrame + cue.startFrame),
  })) : undefined,
);
console.log(formatSpatialIntegrityReport(spatialReport));
if (!spatialReport.passed) {
  console.error("\n❌ Spatial integrity gate failed — fix storyboard placement; do not render a colliding timeline.");
  process.exit(1);
}

console.log(`✅ Timeline loaded: ${timelinePath}`);
console.log(`   Duration: ${timeline.durationInFrames} frames @ ${timeline.fps}fps`);
console.log(`   = ${(timeline.durationInFrames / timeline.fps).toFixed(1)} seconds`);
console.log(`   Events: ${timeline.events.length}`);

// Render into a per-run staging directory and promote only once every gate has
// passed. Previously a blocked run left a fresh MP4 sitting beside the previous
// run's audits with a report that said "diagnostic" — anything globbing
// output/<id>/*.visual-audit.json then picked up data describing a different file.
const finalDir = path.dirname(outPath);
const runId = `run-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const stagingDir = path.join(finalDir, ".runs", runId);
const renderLock = acquireRenderLock(finalDir, runId);
fs.mkdirSync(stagingDir, { recursive: true });
const stagedOut = path.join(stagingDir, path.basename(outPath));

// Serialize props to pass to Remotion
const propsJson = JSON.stringify({ timeline });
const propsTmpFile = path.join(stagingDir, "_props.json");
fs.writeFileSync(propsTmpFile, propsJson);

console.log(`\n🎬 Rendering: ${compositionId}`);
console.log(`   Staging: ${stagedOut}`);
console.log(`   Publishes to: ${outPath}\n`);

// This sandbox has no outbound network access, so Remotion can't download its
// own Chrome Headless Shell. Point it at a compatible binary already cached
// locally by Playwright instead (same underlying Chromium browser).
function findCachedChromeHeadlessShell(): string | null {
  const base = path.join(
    process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Local"),
    "ms-playwright"
  );
  if (!fs.existsSync(base)) return null;
  const candidates = fs
    .readdirSync(base)
    .filter((d) => d.startsWith("chromium_headless_shell-") || d.startsWith("chromium-"))
    .sort()
    .reverse();
  for (const dir of candidates) {
    const candidatesInDir = [
      path.join(base, dir, "chrome-headless-shell-win64", "chrome-headless-shell.exe"),
      path.join(base, dir, "chrome-win64", "chrome.exe"),
      path.join(base, dir, "chrome-win", "chrome.exe"),
    ];
    for (const exe of candidatesInDir) {
      if (fs.existsSync(exe)) return exe;
    }
  }
  return null;
}

// Declared outside the try so a failed run's diagnostic report can still say
// whether the render matched what was asked for.
let timingAudit: {
  mp4Seconds: number; expectedSeconds: number; driftSeconds: number; scope: string;
} | null = null;

try {
  if (isProxy) {
    getScaledDimensions(timeline.width, timeline.height, DEFAULT_PROXY_SCALE);
  }
  const browserExecutable = findCachedChromeHeadlessShell();
  const cmd = [
    "npx remotion render",
    `src/index.ts`,
    compositionId,
    `"${stagedOut}"`,
    `--props="${propsTmpFile}"`,
    "--log=info",
    "--codec=h264",
    isProxy ? `--scale=${DEFAULT_PROXY_SCALE}` : `--video-bitrate=${referenceQuality.encoding.targetVideoBitrate}`,
    isProxy ? "--crf=23" : `--encoding-max-rate=${referenceQuality.encoding.maximumVideoBitrate}`,
    isProxy ? "--muted" : `--encoding-buffer-size=${referenceQuality.encoding.encodingBufferSize}`,
    framesArg ? `--frames=${framesArg}` : "",
    `--audio-bitrate=${referenceQuality.encoding.audioBitrate}`,
    `--pixel-format=${referenceQuality.encoding.pixelFormat}`,
    browserExecutable ? `--browser-executable="${browserExecutable}"` : "",
  ]
    .filter(Boolean)
    .join(" ");

  execSync(cmd, { stdio: "inherit", cwd: process.cwd() });

  console.log(`\nEncoded media: ${stagedOut}. Running publish audits...`);
  // A bounded --frames render is a diagnostic slice, never a publishable
  // deliverable. Its average bitrate is dominated by its particular few
  // seconds (especially a quiet white opening) and cannot prove or disprove
  // the production encoding contract. Keep the full-render audit fail-closed;
  // slices still undergo requested-range timing and pixel audits below.
  const encodingAudit = (isProxy || framesArg) ? null : runEncodingAudit(stagedOut, outPath);

  // A render that does not match what was asked for must never reach an audit or
  // a cross-render comparison — a truncated MP4 scores *better* on sampled pixel
  // metrics, so this blocks before visual-audit runs, not after. A partial
  // --frames render is compared against its requested range rather than skipped.
  {
    const mp4Seconds = probeDurationSeconds(stagedOut);
    if (mp4Seconds === undefined) throw new Error(`Rendered file is unreadable: ${stagedOut}`);
    const [from, to] = framesArg.includes("-")
      ? framesArg.split("-").map(Number)
      : [Number(framesArg), Number(framesArg)];
    const expectedSeconds = framesArg
      ? (to - from + 1) / timeline.fps
      : timeline.durationInFrames / timeline.fps;
    const issues = checkRenderMatchesTimeline(mp4Seconds, expectedSeconds, timeline.fps);
    timingAudit = {
      mp4Seconds,
      expectedSeconds,
      driftSeconds: Number((mp4Seconds - expectedSeconds).toFixed(3)),
      scope: framesArg ? `frames ${framesArg}` : "full timeline",
    };
    if (issues.length) {
      console.error(`\n⏱️  TIMING INTEGRITY\n${formatTimingIssues(issues)}\n`);
      if (hasBlocker(issues)) throw new Error("Render timing does not match what was requested — refusing to audit or publish.");
    }
  }

  // Pixel-level regression gate. Timeline quotas cannot detect semantically
  // empty or visually repetitive frames, so sample the actual encoded MP4.
  if (!args.includes("--skip-visual-audit")) {
    const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path as string;
    const auditScript = path.join(process.cwd(), "scripts", "visual-audit.py");
    if (fs.existsSync(auditScript)) {
      execSync(
        `python "${auditScript}" --video "${path.resolve(stagedOut)}" --record-video-path "${path.resolve(outPath)}" --ffmpeg "${ffmpegPath}" --timeline "${path.resolve(timelinePath)}" --timeline-offset-seconds "${frameRangeStart / timeline.fps}" --config "${path.resolve("config/reference-quality.json")}" --contact-sheet "${path.resolve(stagedOut.replace(/\.mp4$/i, ".contact.jpg"))}" --record-contact-sheet "${path.resolve(outPath.replace(/\.mp4$/i, ".contact.jpg"))}"`,
        { stdio: "inherit", cwd: process.cwd() }
      );
    }
  }
  // Loudness targets describe a whole narration track. Measuring a --frames slice
  // against them is meaningless — a two-second excerpt legitimately sits outside
  // the full-track LUFS window — so a partial render skips the audio audit for the
  // same reason a proxy does.
  const audioAuditPath = stagedOut.replace(/\.mp4$/i, ".audio-audit.json");
  const audioAudit = isProxy || framesArg || args.includes("--skip-audio-audit")
    ? null
    : writeAudioAudit(path.resolve(stagedOut), audioAuditPath, path.resolve(outPath));
  const visualAuditPath = stagedOut.replace(/\.mp4$/i, ".visual-audit.json");
  const referenceComparison =
    fs.existsSync(visualAuditPath)
      ? buildReferenceComparison(
          JSON.parse(fs.readFileSync(visualAuditPath, "utf8")),
          referenceBaseline,
        )
      : null;
  if (!isProxy && !framesArg && referenceComparison) {
    const profile = JSON.parse(fs.readFileSync(path.resolve("config/reference-quality.json"), "utf8"));
    const deltaLimit = Number(profile.visualAudit?.maximumSaturationAboveReference ?? 0.025);
    const saturationDelta = Number(referenceComparison.deltaCandidateMinusReference?.saturation);
    if (Number.isFinite(saturationDelta) && saturationDelta > deltaLimit) {
      throw new Error(
        `SATURATION_REFERENCE_DRIFT: candidate exceeds the reference by ${saturationDelta.toFixed(4)} ` +
        `(maximum ${deltaLimit.toFixed(4)}). Normalize the high-impact art assets; do not filter the MP4.`,
      );
    }
  }
  const durationsManifestPath = path.join(path.dirname(path.resolve(timelinePath)), "durations.json");
  const durationsManifest = fs.existsSync(durationsManifestPath)
    ? JSON.parse(fs.readFileSync(durationsManifestPath, "utf8"))
    : null;
  const ttsMetrics = durationsManifest?.ttsMetrics ?? (durationsManifest
    ? {
        chunkCount: Array.isArray(durationsManifest.scenes) ? durationsManifest.scenes.length : null,
        measurement: "legacy manifest; gap and wall-clock metrics unavailable",
      }
    : null);
  const contactSheetPath = stagedOut.replace(/\.mp4$/i, ".contact.jpg");
  const encodingAuditPath = stagedOut.replace(/\.mp4$/i, ".encoding-audit.json");
  const productionReport = {
    schemaVersion: 1,
    // Rendering proves a technical candidate only. Publication is a separate,
    // hash-bound editorial decision made by publish.ts after manual review.
    status: isProxy ? "proxy-ready" : framesArg ? "diagnostic" : "candidate-ready",
    video: path.resolve(outPath),
    timeline: path.resolve(timelinePath),
    timingProvenance: raw.timingProvenance ?? null,
    unprovenancedTimingAllowed: allowUnprovenanced || undefined,
    preparedAudio,
    encodingAudit,
    timingAudit,
    audioAudit,
    visualAudit: args.includes("--skip-visual-audit")
      ? null
      : path.resolve(outPath.replace(/\.mp4$/i, ".visual-audit.json")),
    referenceComparison,
    directionSummary: buildDirectionSummary(raw),
    spatialIntegrity: spatialReport,
    ttsMetrics,
    artifacts: {
      videoSha256: sha256File(stagedOut),
      contactSheetSha256: fs.existsSync(contactSheetPath) ? sha256File(contactSheetPath) : null,
      visualAuditSha256: fs.existsSync(visualAuditPath) ? sha256File(visualAuditPath) : null,
      audioAuditSha256: fs.existsSync(audioAuditPath) ? sha256File(audioAuditPath) : null,
      encodingAuditSha256: fs.existsSync(encodingAuditPath) ? sha256File(encodingAuditPath) : null,
    },
  };
  fs.writeFileSync(
    stagedOut.replace(/\.mp4$/i, ".production-report.json"),
    `${JSON.stringify(productionReport, null, 2)}\n`,
    "utf8",
  );

  // Every gate passed — only now does the published build change.
  if (fs.existsSync(propsTmpFile)) fs.unlinkSync(propsTmpFile);
  const previousBuild = promoteArtifacts(stagingDir, finalDir, runId);
  pruneRunHistory(finalDir);
  if (previousBuild) console.log(`   Previous successful build archived at: ${previousBuild}`);
  console.log(`\n✅ ${isProxy ? "Proxy audit" : framesArg ? "Diagnostic slice" : "Production render"} complete: ${outPath}`);
} catch (err) {
  // The previously published build is left exactly as it was. The failed run
  // stays in its staging dir so its artifacts can be inspected without being
  // mistaken for the current production output.
  const failedReport = {
    schemaVersion: 1,
    status: "diagnostic",
    video: fs.existsSync(stagedOut) ? path.resolve(stagedOut) : null,
    timeline: path.resolve(timelinePath),
    timingProvenance: raw.timingProvenance ?? null,
    timingAudit,
    stagingDir: path.resolve(stagingDir),
    error: err instanceof Error ? err.message : String(err),
  };
  fs.writeFileSync(
    path.join(stagingDir, "production-report.json"),
    `${JSON.stringify(failedReport, null, 2)}\n`,
    "utf8",
  );
  pruneRunHistory(finalDir);
  console.error("\n❌ Render failed:", err);
  console.error(`   Published build untouched. Failed run kept at: ${stagingDir}`);
  process.exitCode = 1;
} finally {
  if (fs.existsSync(propsTmpFile)) {
    fs.unlinkSync(propsTmpFile);
  }
  renderLock.release();
}
if (fs.existsSync(generatedCharDir)) {
  for (const f of fs.readdirSync(generatedCharDir)) {
    if (f.endsWith(".png")) availablePoses.add(`characters/${f.replace(".png", "")}`);
  }
}
