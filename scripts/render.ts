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

const timeline = JSON.parse(fs.readFileSync(timelinePath, "utf-8"));
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

try {
  const cmd = [
    "npx remotion render",
    `src/index.ts`,
    compositionId,
    `"${outPath}"`,
    `--props="${propsTmpFile}"`,
    "--log=verbose",
  ].join(" ");

  execSync(cmd, { stdio: "inherit", cwd: process.cwd() });

  // Cleanup temp props file
  fs.unlinkSync(propsTmpFile);

  console.log(`\n✅ Render complete: ${outPath}`);
} catch (err) {
  console.error("\n❌ Render failed:", err);
  process.exit(1);
}
