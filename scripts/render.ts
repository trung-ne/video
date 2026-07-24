/**
 * render.ts — CLI render pipeline
 *
 * Usage:
 *   npx ts-node scripts/render.ts
 *   npx ts-node scripts/render.ts --timeline timeline.json --out output/video.mp4
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { loadTimeline } from "../src/engine/loadTimeline";
import { printLivelinessReport } from "../src/engine/liveliness";
import { validateTimeline, printValidationResult } from "../src/ai/validateTimeline";
import { runQualityCheck, printQualityReport } from "../src/ai/qualityCheck";

const args = process.argv.slice(2);

function getArg(flag: string, defaultVal: string): string {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

const timelinePath = getArg("--timeline", "timeline.json");
const outPath = getArg("--out", "output/video.mp4");
const compositionId = getArg("--composition", "CatExplainer");

// Validate timeline file
if (!fs.existsSync(timelinePath)) {
  console.error(`❌ Timeline file not found: ${timelinePath}`);
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(timelinePath, "utf-8"));

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
    "--log=verbose",
    browserExecutable ? `--browser-executable="${browserExecutable}"` : "",
  ]
    .filter(Boolean)
    .join(" ");

  execSync(cmd, { stdio: "inherit", cwd: process.cwd() });

  console.log(`\n✅ Render complete: ${outPath}`);

  // Pixel-level regression gate. Timeline quotas cannot detect semantically
  // empty or visually repetitive frames, so sample the actual encoded MP4.
  if (!args.includes("--skip-visual-audit")) {
    const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path as string;
    const auditScript = path.join(process.cwd(), "scripts", "visual-audit.py");
    if (fs.existsSync(auditScript)) {
      execSync(
        `python "${auditScript}" --video "${path.resolve(outPath)}" --ffmpeg "${ffmpegPath}"`,
        { stdio: "inherit", cwd: process.cwd() }
      );
    }
  }
} catch (err) {
  console.error("\n❌ Render failed:", err);
  process.exit(1);
} finally {
  if (fs.existsSync(propsTmpFile)) {
    fs.unlinkSync(propsTmpFile);
  }
}
