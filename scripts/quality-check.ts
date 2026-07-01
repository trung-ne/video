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

const args = process.argv.slice(2);
const timelinePath = args[0] ?? "timeline.json";
const autoFix = args.includes("--fix");

if (!fs.existsSync(timelinePath)) {
  console.error(`❌ File không tồn tại: ${timelinePath}`);
  process.exit(1);
}

const timeline = JSON.parse(fs.readFileSync(timelinePath, "utf-8"));

// Optional: auto-fix backgrounds before checking
if (autoFix && Array.isArray(timeline.scenes)) {
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

// Print grade summary
if (report.grade === "A") {
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

process.exit(report.blockers > 0 ? 1 : report.majors > 0 ? 2 : 0);
