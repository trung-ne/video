/**
 * quality-check.ts — chạy full quality checklist cho một timeline
 *
 * Usage:
 *   npx ts-node scripts/quality-check.ts timeline.json
 *   npx ts-node scripts/quality-check.ts projects/video-003-tai-sao-eng/timeline.json
 *
 * Exit codes:
 *   0 — passed (no blockers)
 *   1 — has blockers
 *   2 — has majors (no blockers)
 */

import * as fs from "fs";
import * as path from "path";
import { runQualityCheck, printQualityReport } from "../src/ai/qualityCheck";
import { autoFixBackgrounds, printBackgroundFixReport } from "../src/ai/backgroundResolver";
import { checkSceneBeatTimingSources, checkTimingProvenance, formatTimingIssues, hasBlocker } from "../src/engine/timingIntegrity";
import { adjacentArtifactInputs, verifyArtifactInputs } from "../src/engine/artifactIntegrity";
import { loadTimeline } from "../src/engine/loadTimeline";
import { checkSpatialIntegrity, formatSpatialIntegrityReport } from "../src/engine/spatialIntegrity";

const args = process.argv.slice(2);
const timelinePath = args.find((arg) => !arg.startsWith("--"));
const autoFix = args.includes("--fix");

if (!timelinePath) {
  console.error("Usage: npm run quality -- projects/<id>/timeline.json [--fix]");
  process.exit(2);
}
if (!fs.existsSync(timelinePath)) {
  console.error(`❌ File không tồn tại: ${timelinePath}`);
  process.exit(1);
}

const timeline = JSON.parse(fs.readFileSync(timelinePath, "utf-8"));

// Optional: auto-fix backgrounds before checking
if (autoFix && Array.isArray(timeline.scenes)) {
  if (timeline.timingProvenance) {
    console.error(
      "Refusing --fix on a provenanced compiled timeline. " +
      "Fix storyboard.json/storyboard-data.ts and recompile so provenance remains truthful."
    );
    process.exit(1);
  }
  console.log("🔧 Auto-fixing backgrounds...");
  const bgReport = autoFixBackgrounds(timeline);
  printBackgroundFixReport(bgReport);
  if (bgReport.changed.length > 0) {
    fs.writeFileSync(timelinePath, JSON.stringify(timeline, null, 2));
    console.log(`💾 Saved fixed timeline: ${timelinePath}`);
  }
}

const report = runQualityCheck(timeline, timelinePath);
printQualityReport(report);
const transient = loadTimeline(timeline);
const spatialReport = checkSpatialIntegrity(
  transient.timeline,
  Array.isArray(timeline.scenes) ? timeline.scenes.map((scene: any) => ({
    id: scene.id, start: scene.startFrame, end: scene.startFrame + scene.durationFrames,
    narrationBeatFrames: (scene.subtitleCues ?? []).map((cue: any) => scene.startFrame + cue.startFrame),
  })) : undefined,
);
console.log(formatSpatialIntegrityReport(spatialReport));

// Timing provenance is reported alongside the grade, because a high grade on an
// estimate-timed timeline is exactly how the v5-codex incident read: 100/100
// grade A on a video whose audio was 389s longer than its timeline. The grade
// describes composition; it says nothing about whether the timing is real.
const timingIssues = [
  ...checkTimingProvenance(timeline.timingProvenance),
  ...checkSceneBeatTimingSources(timeline.scenes, timeline.timingProvenance),
  ...verifyArtifactInputs(
    adjacentArtifactInputs(timelinePath, timeline.timingProvenance, { includeWords: true })
  ),
];
const timingUntrusted = hasBlocker(timingIssues);
if (timingIssues.length) {
  console.log(`⏱️  TIMING PROVENANCE\n${formatTimingIssues(timingIssues)}\n`);
} else {
  const p = timeline.timingProvenance;
  console.log(
    `⏱️  Timing: ${p.mode} (scenes from ${p.sceneTimingSource}, beats from ${p.beatTimingSource})\n`
  );
}

// Print grade summary
if (timingUntrusted) {
  console.log("❌ Video quality: NOT PRODUCTION-READY — timing cannot be trusted (see above).\n");
} else if (report.blockers > 0) {
  console.log("❌ Video quality: BLOCKED — fix all blockers before render.\n");
} else if (report.majors > 0) {
  console.log("❌ Video quality: NOT PRODUCTION-READY — fix all major issues before render.\n");
} else if (report.grade === "A") {
  console.log("🏆 Video quality: EXCELLENT — sẵn sàng render!\n");
} else if (report.grade === "B") {
  console.log("👍 Video quality: GOOD — có thể render, cân nhắc fix MAJOR issues.\n");
} else if (report.grade === "C") {
  console.log("⚠️  Video quality: ACCEPTABLE — nên fix MAJOR issues trước khi render.\n");
} else if (report.grade === "D") {
  console.log("🔴 Video quality: POOR — cần fix nhiều issues trước khi render.\n");
} else if (report.blockers > 0) {
  console.log("❌ Video quality: FAILING — có BLOCKER, không nên render.\n");
} else {
  console.log("🔴 Video quality: POOR — quá nhiều MAJOR issues, nên regenerate.\n");
}

// Hint about --fix
if (!autoFix && report.checks.find((c) => c.name.includes("Background: ảnh nền") && !c.passed)) {
  console.log("💡 Tip: chạy với --fix để tự động sửa backgrounds:\n");
  console.log(`   npx ts-node scripts/quality-check.ts ${timelinePath} --fix\n`);
}

process.exit(timingUntrusted || report.blockers > 0 || !spatialReport.passed ? 1 : report.majors > 0 ? 2 : 0);
