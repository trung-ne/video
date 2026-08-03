/** Bind a manually reviewed candidate to its exact render artifacts. */
import * as fs from "fs";
import * as path from "path";
import { sha256File } from "../src/audio/prepareAudio";

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
const id = path.basename(path.resolve(projectPath));
const video = path.resolve("output", id, "video.mp4");
const contact = video.replace(/\.mp4$/i, ".contact.jpg");
const visual = video.replace(/\.mp4$/i, ".visual-audit.json");
const report = video.replace(/\.mp4$/i, ".production-report.json");
for (const file of [video, contact, visual, report]) {
  if (!fs.existsSync(file)) throw new Error(`Candidate artifact missing: ${file}`);
}
const candidate = JSON.parse(fs.readFileSync(report, "utf8"));
if (candidate.status !== "candidate-ready") throw new Error("Only a full candidate-ready render can be accepted.");
const visualAudit = JSON.parse(fs.readFileSync(visual, "utf8"));
if (!visualAudit.passed) throw new Error("Visual audit is not passing.");
const current = fs.existsSync(path.join(projectPath, "acceptance.json"))
  ? JSON.parse(fs.readFileSync(path.join(projectPath, "acceptance.json"), "utf8")) : {};
const acceptance = {
  ...current,
  schemaVersion: 2,
  artifact: path.relative(process.cwd(), video).replace(/\\/g, "/"),
  artifactSha256: sha256File(video),
  contactSheetSha256: sha256File(contact),
  visualAuditSha256: sha256File(visual),
  productionReportSha256: sha256File(report),
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
fs.writeFileSync(path.join(projectPath, "acceptance.json"), `${JSON.stringify(acceptance, null, 2)}\n`, "utf8");
console.log(`Accepted exact candidate: ${video}`);
