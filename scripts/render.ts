/**
 * render.ts — CLI render pipeline
 *
 * Usage:
 *   npx ts-node scripts/render.ts
 *   npx ts-node scripts/render.ts --timeline timeline.json --out output/video.mp4
 */

import { execFileSync, execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { loadTimeline } from "../src/engine/loadTimeline";
import { printLivelinessReport } from "../src/engine/liveliness";
import { validateTimeline, printValidationResult } from "../src/ai/validateTimeline";
import { runQualityCheck, printQualityReport } from "../src/ai/qualityCheck";
import { prepareTimelineAudio, writeAudioAudit } from "../src/audio/prepareAudio";
import referenceQuality from "../config/reference-quality.json";

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
const outPath = getArg("--out", "output/video.mp4");
const compositionId = getArg("--composition", "CatExplainer");
const isProxy = args.includes("--proxy");

function runEncodingAudit(videoPath: string): any {
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
  if (video && video.pix_fmt !== referenceQuality.encoding.pixelFormat) {
    failures.push(`Pixel format must be ${referenceQuality.encoding.pixelFormat}, got ${video.pix_fmt}.`);
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
    videoPath: path.resolve(videoPath),
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

if (raw.audio && !isProxy && !args.includes("--skip-audio-prepare")) {
  preparedAudio = prepareTimelineAudio(raw.audio);
  raw.audio = preparedAudio.publicPath;
  console.log(`Audio prepared: ${preparedAudio.audit.integratedLufs} LUFS${preparedAudio.mastered ? " (mastered)" : ""}`);
}

// Scan which cat poses actually exist so pose-swaps never reference a missing asset.
const charDir = path.join(process.cwd(), "public", "assets", "characters");
const availablePoses = new Set<string>();
if (fs.existsSync(charDir)) {
  for (const f of fs.readdirSync(charDir)) {
    if (f.endsWith(".svg")) availablePoses.add(`characters/${f.replace(".svg", "")}`);
  }
}

// Single compile point — scenes → events + liveliness (shared with preview).
const { timeline, liveliness } = loadTimeline(raw, availablePoses);
printLivelinessReport(liveliness);

console.log(`✅ Timeline loaded: ${timelinePath}`);
console.log(`   Duration: ${timeline.durationInFrames} frames @ ${timeline.fps}fps`);
console.log(`   = ${(timeline.durationInFrames / timeline.fps).toFixed(1)} seconds`);
console.log(`   Events: ${timeline.events.length}`);

// Ensure output directory exists
const outDir = path.dirname(outPath);
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// Serialize props to pass to Remotion
const propsJson = JSON.stringify({ timeline });
const propsTmpFile = path.join(outDir, "_props.json");
fs.writeFileSync(propsTmpFile, propsJson);

console.log(`\n🎬 Rendering: ${compositionId}`);
console.log(`   Output: ${outPath}\n`);

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
    .filter((d) => d.startsWith("chromium_headless_shell-"))
    .sort()
    .reverse();
  for (const dir of candidates) {
    const exe = path.join(base, dir, "chrome-headless-shell-win64", "chrome-headless-shell.exe");
    if (fs.existsSync(exe)) return exe;
  }
  return null;
}

try {
  const browserExecutable = findCachedChromeHeadlessShell();
  const cmd = [
    "npx remotion render",
    `src/index.ts`,
    compositionId,
    `"${outPath}"`,
    `--props="${propsTmpFile}"`,
    "--log=info",
    "--codec=h264",
    isProxy ? "--scale=0.333" : `--video-bitrate=${referenceQuality.encoding.targetVideoBitrate}`,
    isProxy ? "--crf=23" : `--encoding-max-rate=${referenceQuality.encoding.maximumVideoBitrate}`,
    isProxy ? "--muted" : `--encoding-buffer-size=${referenceQuality.encoding.encodingBufferSize}`,
    `--audio-bitrate=${referenceQuality.encoding.audioBitrate}`,
    `--pixel-format=${referenceQuality.encoding.pixelFormat}`,
    browserExecutable ? `--browser-executable="${browserExecutable}"` : "",
  ]
    .filter(Boolean)
    .join(" ");

  execSync(cmd, { stdio: "inherit", cwd: process.cwd() });

  console.log(`\nEncoded media: ${outPath}. Running publish audits...`);
  const encodingAudit = isProxy ? null : runEncodingAudit(outPath);

  // Pixel-level regression gate. Timeline quotas cannot detect semantically
  // empty or visually repetitive frames, so sample the actual encoded MP4.
  if (!args.includes("--skip-visual-audit")) {
    const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path as string;
    const auditScript = path.join(process.cwd(), "scripts", "visual-audit.py");
    if (fs.existsSync(auditScript)) {
      execSync(
        `python "${auditScript}" --video "${path.resolve(outPath)}" --ffmpeg "${ffmpegPath}" --timeline "${path.resolve(timelinePath)}" --config "${path.resolve("config/reference-quality.json")}" --contact-sheet "${path.resolve(outPath.replace(/\.mp4$/i, ".contact.jpg"))}"`,
        { stdio: "inherit", cwd: process.cwd() }
      );
    }
  }
  const audioAuditPath = outPath.replace(/\.mp4$/i, ".audio-audit.json");
  const audioAudit = isProxy ? null : writeAudioAudit(path.resolve(outPath), audioAuditPath);
  const productionReport = {
    schemaVersion: 1,
    status: isProxy ? "proxy-ready" : "production-ready",
    video: path.resolve(outPath),
    timeline: path.resolve(timelinePath),
    preparedAudio,
    encodingAudit,
    audioAudit,
    visualAudit: path.resolve(outPath.replace(/\.mp4$/i, ".visual-audit.json")),
  };
  fs.writeFileSync(
    outPath.replace(/\.mp4$/i, ".production-report.json"),
    `${JSON.stringify(productionReport, null, 2)}\n`,
    "utf8",
  );
  console.log(`\n✅ ${isProxy ? "Proxy audit" : "Production render"} complete: ${outPath}`);
} catch (err) {
  const failedReport = {
    schemaVersion: 1,
    status: "diagnostic",
    video: fs.existsSync(outPath) ? path.resolve(outPath) : null,
    timeline: path.resolve(timelinePath),
    error: err instanceof Error ? err.message : String(err),
  };
  fs.writeFileSync(
    outPath.replace(/\.mp4$/i, ".production-report.json"),
    `${JSON.stringify(failedReport, null, 2)}\n`,
    "utf8",
  );
  console.error("\n❌ Render failed:", err);
  process.exit(1);
} finally {
  if (fs.existsSync(propsTmpFile)) {
    fs.unlinkSync(propsTmpFile);
  }
}
