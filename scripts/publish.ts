import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const args = process.argv.slice(2);
function getArg(flag: string, fallback = ""): string {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const timeline = getArg("--timeline");
const project = getArg("--project");
const projectPath = project
  ? (fs.existsSync(project) || project.includes("/") || project.includes("\\")
      ? project
      : path.join("projects", project))
  : "";
const resolvedTimeline = timeline || (projectPath ? path.join(projectPath, "timeline.json") : "");
const projectId = projectPath ? path.basename(projectPath) : "";
const output = getArg("--out", projectId ? path.join("output", projectId, "video.mp4") : "");
if (!resolvedTimeline || !output || !fs.existsSync(resolvedTimeline)) {
  console.error(
    "Usage: npm run publish -- --project <id> " +
    "[--out output/<id>/video.mp4]\n" +
    "   or: npm run publish -- --timeline projects/<id>/timeline.json --out output/<id>/video.mp4"
  );
  process.exit(2);
}

const proxy = output.replace(/\.mp4$/i, ".proxy.mp4");
const reportPath = output.replace(/\.mp4$/i, ".publish-report.json");
const publishRunId = `publish-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const publishRunDir = path.join(path.dirname(output), ".runs", publishRunId);
const stagedReportPath = path.join(publishRunDir, path.basename(reportPath));
fs.mkdirSync(publishRunDir, { recursive: true });

/**
 * Run a render and then verify its evidence, not just its exit code.
 *
 * A zero exit only means render.ts did not throw — it can still have skipped the
 * timing check (via --frames, or a flag combination that bypasses it). Reading
 * the report back is the one check publish can make that render cannot make
 * about itself.
 */
function runRender(extra: string[]): any {
  const target = extra.includes("--proxy") ? proxy : output;
  const label = extra.includes("--proxy") ? "Proxy" : "Full";
  const result = spawnSync(process.execPath, [
    "-r", "ts-node/register", "scripts/render.ts",
    "--timeline", resolvedTimeline, "--out", target,
    ...extra,
  ], { cwd: process.cwd(), stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${label} render failed`);

  const renderReportPath = target.replace(/\.mp4$/i, ".production-report.json");
  if (!fs.existsSync(renderReportPath)) {
    throw new Error(`${label} render produced no production report at ${renderReportPath}`);
  }
  const renderReport = JSON.parse(fs.readFileSync(renderReportPath, "utf8"));

  const expectedStatus = extra.includes("--proxy") ? "proxy-ready" : "production-ready";
  if (renderReport.status !== expectedStatus) {
    throw new Error(`${label} render reported status "${renderReport.status}", expected "${expectedStatus}"`);
  }
  if (!renderReport.timingAudit) {
    throw new Error(
      `${label} render carries no timingAudit — its duration was never verified against the timeline.`
    );
  }
  if (!extra.includes("--proxy") && renderReport.timingAudit.scope !== "full timeline") {
    throw new Error(
      `${label} render only verified "${renderReport.timingAudit.scope}" — a partial render cannot be published.`
    );
  }
  return renderReport;
}

const report: any = {
  schemaVersion: 1,
  timeline: path.resolve(resolvedTimeline),
  output: path.resolve(output),
  proxy: path.resolve(proxy),
  status: "running",
  startedAt: new Date().toISOString(),
};

try {
  if (!args.includes("--skip-proxy")) runRender(["--proxy"]);
  const fullReport = runRender([]);
  // Carry the evidence into the publish report so it says why it passed.
  report.timingProvenance = fullReport.timingProvenance ?? null;
  report.timingAudit = fullReport.timingAudit;
  report.encodingAudit = fullReport.encodingAudit ?? null;
  report.status = "production-ready";
  report.completedAt = new Date().toISOString();
} catch (error) {
  report.status = "diagnostic";
  report.error = error instanceof Error ? error.message : String(error);
  report.completedAt = new Date().toISOString();
  fs.writeFileSync(stagedReportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.error(`Publish blocked: ${report.error}`);
  console.error(`Diagnostic report: ${stagedReportPath}`);
  process.exit(1);
}

fs.writeFileSync(stagedReportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
const previousReport = path.join(publishRunDir, `previous-${path.basename(reportPath)}`);
try {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  if (fs.existsSync(reportPath)) fs.renameSync(reportPath, previousReport);
  fs.renameSync(stagedReportPath, reportPath);
} catch (error) {
  if (!fs.existsSync(reportPath) && fs.existsSync(previousReport)) {
    fs.renameSync(previousReport, reportPath);
  }
  throw error;
}
console.log(`Production-ready: ${output}`);
