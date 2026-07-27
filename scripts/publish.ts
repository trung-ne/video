import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const args = process.argv.slice(2);
function getArg(flag: string, fallback = ""): string {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const timeline = getArg("--timeline");
const output = getArg("--out", "output/video.mp4");
if (!timeline || !fs.existsSync(timeline)) {
  console.error("Usage: npm run publish -- --timeline projects/<id>/timeline.json --out output/<id>.mp4");
  process.exit(2);
}

const proxy = output.replace(/\.mp4$/i, ".proxy.mp4");
const reportPath = output.replace(/\.mp4$/i, ".publish-report.json");

function runRender(extra: string[]): void {
  const result = spawnSync(process.execPath, [
    "-r", "ts-node/register", "scripts/render.ts",
    "--timeline", timeline, "--out", extra.includes("--proxy") ? proxy : output,
    ...extra,
  ], { cwd: process.cwd(), stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${extra.includes("--proxy") ? "Proxy" : "Full"} render failed`);
}

const report: any = {
  schemaVersion: 1,
  timeline: path.resolve(timeline),
  output: path.resolve(output),
  proxy: path.resolve(proxy),
  status: "running",
  startedAt: new Date().toISOString(),
};

try {
  if (!args.includes("--skip-proxy")) runRender(["--proxy"]);
  runRender([]);
  report.status = "production-ready";
  report.completedAt = new Date().toISOString();
} catch (error) {
  report.status = "diagnostic";
  report.error = error instanceof Error ? error.message : String(error);
  report.completedAt = new Date().toISOString();
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.error(`Publish blocked: ${report.error}`);
  process.exit(1);
}

fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Production-ready: ${output}`);
