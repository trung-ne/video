/**
 * List semantic assets from public/assets.manifest.json.
 *
 * Usage:
 *   npm run build-assets
 *   npx ts-node scripts/list-assets.ts [kind-or-topic]
 *   npx ts-node scripts/list-assets.ts --used projects/<id>/timeline.json
 */

import * as fs from "fs";
import * as path from "path";
import { AssetManifest } from "../src/types/assets";

const args = process.argv.slice(2);
const filter = args.find((arg) => !arg.startsWith("--") && !arg.endsWith(".json"))?.toLowerCase();
const usedIndex = args.indexOf("--used");
const usedTimeline = usedIndex >= 0 ? args[usedIndex + 1] : undefined;
const manifestPath = path.join(process.cwd(), "public", "assets.manifest.json");

if (!fs.existsSync(manifestPath)) {
  throw new Error("Missing public/assets.manifest.json. Run `npm run build-assets` first.");
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as AssetManifest;
const used = new Set<string>();
if (usedTimeline && fs.existsSync(usedTimeline)) {
  const timeline = JSON.parse(fs.readFileSync(usedTimeline, "utf8"));
  for (const scene of timeline.scenes ?? []) {
    for (const entity of scene.entities ?? []) if (entity.src) used.add(entity.src);
    if (scene.backgroundSrc && !String(scene.backgroundSrc).startsWith("#")) used.add(scene.backgroundSrc);
    for (const frameBox of scene.frameBoxes ?? []) if (frameBox.contentSrc) used.add(frameBox.contentSrc);
  }
  for (const event of timeline.events ?? []) {
    if (event.type === "enter" && event.src) used.add(event.src);
  }
}

const entries = manifest.entries.filter((entry) => {
  if (!filter) return true;
  return [
    entry.kind, entry.styleFamily, entry.id, entry.path,
    ...(entry.topics ?? []), ...(entry.action ?? []), ...(entry.emotion ?? []),
  ].some((value) => value.toLowerCase().includes(filter));
});

const groups = new Map<string, typeof entries>();
for (const entry of entries) {
  const group = `${entry.kind}/${entry.styleFamily}`;
  groups.set(group, [...(groups.get(group) ?? []), entry]);
}

console.log(`\nAsset manifest: ${manifest.entries.length} canonical assets\n`);
for (const [group, groupEntries] of [...groups.entries()].sort()) {
  console.log(`${group} (${groupEntries.length})`);
  for (const entry of groupEntries) {
    const marker = usedTimeline ? (used.has(entry.path) ? " ✓" : " ○") : "";
    const aliases = entry.aliases?.length ? ` aliases:${entry.aliases.length}` : "";
    console.log(`  ${entry.id} -> ${entry.path}${marker}${aliases}`);
  }
  console.log();
}

if (usedTimeline) {
  const known = new Set(manifest.entries.flatMap((entry) => [entry.path, ...(entry.aliases ?? [])]));
  for (const source of used) {
    if (!known.has(source) && !String(source).includes("gradient(")) {
      console.log(`MISSING ${source}`);
    }
  }
}

console.log(`Displayed ${entries.length}/${manifest.entries.length} canonical assets.`);
