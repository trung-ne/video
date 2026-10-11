/** Bind a manually reviewed candidate to its exact render artifacts. */
import * as fs from "fs";
import * as path from "path";
import { sha256File } from "../src/audio/prepareAudio";
import {
  assertBoundTimelineIdentity,
  assertCanonicalTimelinePath,
  assertOutputProjectIdentity,
  assertProjectCanonicalTimeline,
  buildCanonicalTimelineIdentity,
  sameResolvedPath,
} from "../src/engine/publicationIntegrity";

const args = process.argv.slice(2);
const value = (flag: string) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const projectArg = value("--project");
if (!projectArg) {
  console.error("Usage: npx ts-node scripts/accept-render.ts --project <id> --confirm-manual-review");
  process.exit(2);
}
if (!args.includes("--confirm-manual-review")) {
  console.error("Refusing to invent a manual review. Inspect the exact contact sheet, then pass --confirm-manual-review.");
  process.exit(2);
}
const projectPath = fs.existsSync(projectArg) || projectArg.includes("/") || projectArg.includes("\\")
  ? projectArg : path.join("projects", projectArg);
const resolvedProjectPath = fs.realpathSync(path.resolve(projectPath));
const id = path.basename(resolvedProjectPath);
const timeline = path.join(resolvedProjectPath, "timeline.json");
assertCanonicalTimelinePath(timeline, resolvedProjectPath);
assertProjectCanonicalTimeline(resolvedProjectPath, timeline);
const canonicalTimelineIdentity = buildCanonicalTimelineIdentity({
  timelinePath: timeline,
  projectId: id,
  projectPath: resolvedProjectPath,
});
const video = path.resolve("output", id, "video.mp4");
assertOutputProjectIdentity(video, id);
const contact = video.replace(/\.mp4$/i, ".contact.jpg");
const visual = video.replace(/\.mp4$/i, ".visual-audit.json");
const report = video.replace(/\.mp4$/i, ".production-report.json");
for (const file of [video, contact, visual, report]) {
  if (!fs.existsSync(file)) throw new Error(`Candidate artifact missing: ${file}`);
}
const candidate = JSON.parse(fs.readFileSync(report, "utf8"));
if (candidate.status !== "candidate-ready") throw new Error("Only a full candidate-ready render can be accepted.");
assertBoundTimelineIdentity(candidate, canonicalTimelineIdentity, "Candidate report");
if (typeof candidate.video !== "string" || !sameResolvedPath(candidate.video, video)) {
  throw new Error("Candidate report identifies a different output artifact.");
}
const visualAudit = JSON.parse(fs.readFileSync(visual, "utf8"));
if (visualAudit.passed !== true) throw new Error("Visual audit is not passing.");
const declaredArtifacts = candidate.artifacts ?? {};
const artifactHashes = {
  video: sha256File(video),
  contact: sha256File(contact),
  visual: sha256File(visual),
  report: sha256File(report),
};
if (declaredArtifacts.videoSha256 !== artifactHashes.video
    || declaredArtifacts.contactSheetSha256 !== artifactHashes.contact
    || declaredArtifacts.visualAuditSha256 !== artifactHashes.visual) {
  throw new Error("Candidate report artifact hashes do not match the files being accepted.");
}
const acceptancePath = path.join(resolvedProjectPath, "acceptance.json");
const current = fs.existsSync(acceptancePath)
  ? JSON.parse(fs.readFileSync(acceptancePath, "utf8")) : {};
if (sha256File(timeline) !== canonicalTimelineIdentity.timelineSha256) {
  throw new Error("Canonical timeline changed while acceptance was being recorded.");
}
const acceptance = {
  ...current,
  schemaVersion: 3,
  projectId: canonicalTimelineIdentity.projectId,
  projectPath: canonicalTimelineIdentity.projectPath,
  timeline: canonicalTimelineIdentity.timelinePath,
  timelineSha256: canonicalTimelineIdentity.timelineSha256,
  artifact: path.relative(process.cwd(), video).replace(/\\/g, "/"),
  artifactSha256: artifactHashes.video,
  contactSheetSha256: artifactHashes.contact,
  visualAuditSha256: artifactHashes.visual,
  productionReportSha256: artifactHashes.report,
  frameRange: [0, Number(candidate.timingAudit?.expectedSeconds ?? 0) * 30],
  metrics: {
    ...(current.metrics ?? {}),
    flatFrameRatio: visualAudit.flatFrameRatio,
    saturation: visualAudit.saturation?.mean,
    edgeDensity: visualAudit.edgeDensity?.mean,
    nearDuplicateRatio: visualAudit.nearDuplicateRatio,
    withinSceneNearDuplicateRatio: visualAudit.withinSceneNearDuplicateRatio,
    longestNearDuplicateRunSeconds: visualAudit.longestWithinSceneNearDuplicateRunSeconds,
    nearWhiteMean: visualAudit.nearWhiteMean,
    whiteDominantRatio: visualAudit.whiteDominantRatio,
  },
  manualContactSheetReview: {
    noRecognizableHumanFaces: true,
    noTextClipping: true,
    noBubbleOverlap: true,
    noEmptyScenes: true,
    noCameraCrop: true,
  },
  result: "pass",
  acceptedAt: new Date().toISOString(),
};
fs.writeFileSync(acceptancePath, `${JSON.stringify(acceptance, null, 2)}\n`, "utf8");
console.log(`Accepted exact candidate: ${video}`);
