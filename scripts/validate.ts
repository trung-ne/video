import * as fs from "fs";
import { printValidationResult, validateTimeline } from "../src/ai/validateTimeline";

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
const result = validateTimeline(timeline);
printValidationResult(result, timelinePath);
process.exit(result.valid ? 0 : 1);
