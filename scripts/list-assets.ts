/**
 * list-assets.ts — List all available SVG assets
 *
 * Usage:
 *   npx ts-node scripts/list-assets.ts
 *   npx ts-node scripts/list-assets.ts finance
 *   npx ts-node scripts/list-assets.ts --used timeline.json
 */

import * as fs from "fs";
import * as path from "path";
import { listAvailableAssets } from "../src/ai/systemPrompt";

const args = process.argv.slice(2);
const filterCategory = args.find((a) => !a.startsWith("--") && !a.endsWith(".json"));
const usedTimelineIdx = args.indexOf("--used");
const usedTimeline = usedTimelineIdx !== -1 ? args[usedTimelineIdx + 1] : null;

const assets = listAvailableAssets();

// Group by category
const groups: Record<string, string[]> = {};
for (const asset of assets) {
  const parts = asset.split("/");
  const category = parts.length > 1 ? parts[0] : "root";
  if (!groups[category]) groups[category] = [];
  groups[category].push(asset);
}

// Filter
const filteredGroups = filterCategory
  ? Object.fromEntries(
      Object.entries(groups).filter(([k]) => k.toLowerCase().includes(filterCategory.toLowerCase()))
    )
  : groups;

// Used assets from timeline
let usedAssets = new Set<string>();
let timelineAssets = new Set<string>();
if (usedTimeline && fs.existsSync(usedTimeline)) {
  const tl = JSON.parse(fs.readFileSync(usedTimeline, "utf-8"));
  for (const event of tl.events ?? []) {
    if (event.type === "enter" && event.src) {
      timelineAssets.add(event.src);
    }
  }
}

console.log(`\n📁 public/assets/ — ${assets.length} total SVGs\n`);

let total = 0;
for (const [category, list] of Object.entries(filteredGroups)) {
  console.log(`  ${category}/ (${list.length})`);
  for (const asset of list) {
    const isUsed = timelineAssets.size > 0 && timelineAssets.has(asset);
    const marker = timelineAssets.size === 0 ? "" : isUsed ? "  ✅" : "  ○";
    console.log(`    ${asset}${marker}`);
    total++;
  }
  console.log();
}

if (usedTimeline) {
  // Check for assets in timeline but not in library
  for (const ta of timelineAssets) {
    if (!assets.includes(ta)) {
      console.log(`  ❌ MISSING: ${ta} (used in timeline but SVG not found!)`);
    }
  }
}

console.log(`Total: ${total} assets`);
console.log(`\nTip: Thêm SVG vào public/assets/<category>/<name>.svg`);
console.log(`     Dùng trong timeline: "src": "<category>/<name>"\n`);
