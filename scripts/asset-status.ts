import * as fs from "fs";
import * as path from "path";

const project = process.argv[2];
if (!project) {
  console.error("Usage: npx ts-node scripts/asset-status.ts projects/<id>");
  process.exit(2);
}
const queuePath = path.join(project, "asset-requests.json");
if (!fs.existsSync(queuePath)) {
  console.log("Asset status: ready (no unresolved request queue).");
  process.exit(0);
}
const queue = JSON.parse(fs.readFileSync(queuePath, "utf8"));
const requests = Array.isArray(queue.requests) ? queue.requests : [];
if (!requests.length) {
  console.log("Asset status: ready.");
  process.exit(0);
}
console.error(`Asset status: assets_required (${requests.length} scene requests).`);
for (const request of requests.slice(0, 20)) {
  console.error(`- ${request.sceneId}: ${request.reason}`);
}
console.error("Fulfill the queue, run `npm run build-assets`, then regenerate/repair the storyboard.");
process.exit(1);
