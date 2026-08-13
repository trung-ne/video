import * as fs from "fs";
import { printValidationResult, validateTimeline } from "../src/ai/validateTimeline";
import { assertTimelineAssetStyle } from "../src/engine/assetStyle";

const timelinePath = process.argv[2];
if (!timelinePath) {
  console.error("Usage: npm run validate -- projects/<id>/timeline.json");
  process.exit(2);
}
if (!fs.existsSync(timelinePath)) {
  console.error(`Timeline not found: ${timelinePath}`);
  process.exit(2);
}
const timeline = JSON.parse(fs.readFileSync(timelinePath, "utf8"));
// Validation is a production gate too: do not certify a timeline selected for
// another art geometry/style even when its JSON shape is otherwise valid.
try {
  assertTimelineAssetStyle(timeline.timingProvenance);
} catch (error) {
  console.error(`❌ ${(error as Error).message}`);
  process.exit(1);
}
const result = validateTimeline(timeline);
printValidationResult(result, timelinePath);
process.exit(result.valid ? 0 : 1);
