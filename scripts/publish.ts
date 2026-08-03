/**
 * publish.ts — promote one already-rendered candidate after hash-bound review.
 *
 * This deliberately does not render. Rendering answers "can this candidate be
 * encoded?"; publishing answers "was this exact candidate reviewed and
 * accepted?" Keeping those states separate prevents a stale acceptance file
 * from silently blessing a later MP4.
 */
import * as fs from "fs";
import * as path from "path";
import { sha256File } from "../src/audio/prepareAudio";

const args = process.argv.slice(2);
function getArg(flag: string, fallback = ""): string {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const projectArg = getArg("--project");
const projectPath = projectArg
  ? (fs.existsSync(projectArg) || projectArg.includes("/") || projectArg.includes("\\")
      ? projectArg : path.join("projects", projectArg))
  : "";
const timelinePath = getArg("--timeline", projectPath ? path.join(projectPath, "timeline.json") : "");
const projectId = projectPath ? path.basename(path.resolve(projectPath)) : "";
const output = getArg("--out", projectId ? path.join("output", projectId, "video.mp4") : "");
if (!projectPath || !timelinePath || !output) {
  console.error("Usage: npm run publish -- --project <id> [--out output/<id>/video.mp4]");
  process.exit(2);
}

const resolvedOutput = path.resolve(output);
const reportPath = resolvedOutput.replace(/\.mp4$/i, ".production-report.json");
const visualAuditPath = resolvedOutput.replace(/\.mp4$/i, ".visual-audit.json");
const contactSheetPath = resolvedOutput.replace(/\.mp4$/i, ".contact.jpg");
const acceptancePath = path.resolve(projectPath, "acceptance.json");
const publishReportPath = resolvedOutput.replace(/\.mp4$/i, ".publish-report.json");

function mustReadJson(file: string, label: string): any {
  if (!fs.existsSync(file)) throw new Error(`${label} is missing: ${file}`);
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { throw new Error(`${label} is invalid JSON: ${file}`); }
}
function requireHash(actualPath: string, expected: unknown, label: string) {
  if (!fs.existsSync(actualPath)) throw new Error(`${label} artifact is missing: ${actualPath}`);
  const actual = sha256File(actualPath);
  if (typeof expected !== "string" || actual !== expected) {
    throw new Error(`${label} hash mismatch: acceptance/report does not describe the current artifact.`);
  }
  return actual;
}

try {
  const candidate = mustReadJson(reportPath, "candidate production report");
  if (candidate.status !== "candidate-ready") {
    throw new Error(`Candidate status is ${JSON.stringify(candidate.status)}; render a full candidate before publishing.`);
  }
  if (!candidate.timingAudit || candidate.timingAudit.scope !== "full timeline") {
    throw new Error("Candidate lacks a full-timeline timing audit.");
  }
  if (!candidate.visualAudit || !candidate.audioAudit || !candidate.encodingAudit) {
    throw new Error("Candidate is missing visual, audio, or encoding audit evidence.");
  }
  const acceptance = mustReadJson(acceptancePath, "acceptance");
  if (acceptance.result !== "pass") throw new Error("Acceptance result is not pass.");
  if (path.resolve(acceptance.artifact ?? "") !== resolvedOutput) {
    throw new Error("Acceptance artifact points at a different MP4.");
  }
  const videoSha256 = requireHash(resolvedOutput, acceptance.artifactSha256, "MP4");
  const contactSheetSha256 = requireHash(contactSheetPath, acceptance.contactSheetSha256, "Contact sheet");
  const visualAuditSha256 = requireHash(visualAuditPath, acceptance.visualAuditSha256, "Visual audit");
  const candidateReportSha256 = requireHash(reportPath, acceptance.productionReportSha256, "Production report");

  const declared = candidate.artifacts ?? {};
  if (declared.videoSha256 !== videoSha256 || declared.contactSheetSha256 !== contactSheetSha256
      || declared.visualAuditSha256 !== visualAuditSha256) {
    throw new Error("Candidate report artifact hashes do not match the reviewed files.");
  }
  if (!Object.values(acceptance.manualContactSheetReview ?? {}).every(Boolean)) {
    throw new Error("Manual contact-sheet review is incomplete.");
  }
  const publishReport = {
    schemaVersion: 1,
    status: "production-ready",
    publishedAt: new Date().toISOString(),
    timeline: path.resolve(timelinePath),
    output: resolvedOutput,
    acceptance: acceptancePath,
    artifacts: { videoSha256, contactSheetSha256, visualAuditSha256, candidateReportSha256 },
  };
  fs.writeFileSync(publishReportPath, `${JSON.stringify(publishReport, null, 2)}\n`, "utf8");
  console.log(`Production-ready: ${resolvedOutput}`);
} catch (error) {
  console.error(`Publish blocked: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
