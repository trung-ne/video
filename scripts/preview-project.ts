import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";
import { loadTimeline } from "../src/engine/loadTimeline";
import { checkTimingProvenance, formatTimingIssues } from "../src/engine/timingIntegrity";
import { assertTimelineAssetStyle } from "../src/engine/assetStyle";
import { loadLocalEnvironment } from "./load-env";

loadLocalEnvironment();

const args = process.argv.slice(2);
const index = args.indexOf("--project");
const projectArg = index >= 0 ? args[index + 1] : undefined;
if (!projectArg) throw new Error("Usage: npx ts-node scripts/preview-project.ts --project <id-or-path>");
const projectPath = fs.existsSync(projectArg) || projectArg.includes("/") || projectArg.includes("\\")
  ? projectArg
  : path.join("projects", projectArg);
const measuredTimelinePath = path.join(projectPath, "timeline.json");
const estimatedTimelinePath = path.join(projectPath, "timeline.estimated.json");
const timelinePath = fs.existsSync(measuredTimelinePath)
  ? measuredTimelinePath
  : estimatedTimelinePath;
if (!fs.existsSync(timelinePath)) {
  throw new Error(`Timeline not found: ${measuredTimelinePath} or ${estimatedTimelinePath}`);
}
if (timelinePath === estimatedTimelinePath) {
  console.warn(`No measured timeline found; previewing diagnostic artifact: ${estimatedTimelinePath}`);
}

const authored = JSON.parse(fs.readFileSync(timelinePath, "utf8"));
assertTimelineAssetStyle(authored.timingProvenance);

// Preview does not gate — you often want to look at something broken. But it must
// say what it is showing, so an estimate-timed or legacy timeline is never mistaken
// for the production one while you judge it on screen.
const provenanceIssues = checkTimingProvenance(authored.timingProvenance, { allowUnprovenanced: true });
if (provenanceIssues.length) {
  console.warn(`⏱️  ${formatTimingIssues(provenanceIssues)}`);
} else {
  const p = authored.timingProvenance;
  console.log(`⏱️  Timing: ${p.mode} (scenes from ${p.sceneTimingSource}, beats from ${p.beatTimingSource})`);
}

const timeline = loadTimeline(authored).timeline;
if (args.includes("--check-only")) {
  console.log(`Preview preflight passed: ${timelinePath}`);
  process.exit(0);
}
const propsPath = path.join(os.tmpdir(), `cat-preview-${process.pid}.json`);
fs.writeFileSync(propsPath, JSON.stringify({ timeline }), "utf8");
try {
  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(command, [
    "remotion", "studio", "src/index.ts", `--props=${propsPath}`,
  ], { stdio: "inherit", cwd: process.cwd() });
  process.exitCode = result.status ?? 1;
} finally {
  if (fs.existsSync(propsPath)) fs.unlinkSync(propsPath);
}
