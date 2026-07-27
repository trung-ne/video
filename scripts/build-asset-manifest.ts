import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { AssetKind, AssetManifest, AssetManifestEntry, AssetStyleFamily } from "../src/types/assets";

const publicDir = path.join(process.cwd(), "public");
const outputPath = path.join(publicDir, "assets.manifest.json");
const extensions = new Set([".svg", ".png", ".jpg", ".jpeg", ".webp"]);

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function words(value: string): string[] {
  return value.toLowerCase().replace(/\.[^.]+$/, "").split(/[/\\_\-\s]+/).filter(Boolean);
}

function inferKind(relative: string): AssetKind {
  const normalized = relative.replace(/\\/g, "/").toLowerCase();
  if (normalized.includes("/characters/") || /(^|\/)cat/.test(normalized)) return "character";
  if (normalized.includes("/scenes/") || normalized.includes("background")) return "stage";
  if (normalized.includes("chart")) return "chart";
  if (normalized.includes("/ui/") || normalized.includes("arrow")) return "ui";
  if (/\.(jpg|jpeg|webp)$/.test(normalized)) return "photo";
  return "prop";
}

function inferStyle(relative: string, kind: AssetKind): AssetStyleFamily {
  const normalized = relative.replace(/\\/g, "/");
  if (normalized.startsWith("generated-assets/characters/")) return "editorial_cat_v1";
  if (kind === "photo") return "photo";
  if (kind === "stage" && normalized.startsWith("assets/scenes/")) return "flat_stage_v1";
  return "legacy";
}

function publicSource(relative: string): string {
  const normalized = relative.replace(/\\/g, "/");
  if (normalized.startsWith("assets/") && normalized.endsWith(".svg")) {
    return normalized.slice("assets/".length, -".svg".length);
  }
  return normalized;
}

function buildEntry(file: string): AssetManifestEntry {
  const relative = path.relative(publicDir, file).replace(/\\/g, "/");
  const sourcePath = publicSource(relative);
  const kind = inferKind(relative);
  const tags = words(relative);
  const hash = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const generatedLead = relative.startsWith("generated-assets/characters/");
  const stat = fs.statSync(file);
  const densityByKind: Record<AssetKind, number> = {
    character: 0.45, prop: 0.3, stage: 0.72, photo: 0.9, chart: 0.68, ui: 0.4,
  };
  return {
    id: sourcePath.replace(/\.[^.]+$/, "").replace(/\//g, "."),
    path: sourcePath,
    sha256: hash,
    kind,
    styleFamily: inferStyle(relative, kind),
    characterId: generatedLead ? "lead-teal-cat" : undefined,
    emotion: kind === "character" ? tags.filter((tag) => ["happy", "sad", "surprised", "think"].includes(tag)) : undefined,
    action: kind === "character" ? tags.filter((tag) => ["explain", "talk", "think", "shrug", "worker", "teacher"].includes(tag)) : undefined,
    topics: kind !== "character" ? tags : undefined,
    source: generatedLead ? "generated" : "original",
    visualDensity: densityByKind[kind],
    recommendedScale: kind === "prop" || kind === "ui" ? 1.35 : 1,
    semanticRoles: kind === "character" ? ["subject", "actor"] : [kind, "focal"],
    actionTags: kind === "character" ? tags : [],
    settingTags: kind === "stage" ? tags : [],
    isFallback: /placeholder|fallback|concept.card/i.test(relative) || stat.size < 200,
  };
}

const files = [
  ...walk(path.join(publicDir, "assets")),
  ...walk(path.join(publicDir, "generated-assets")),
  ...walk(path.join(publicDir, "backgrounds")),
  ...walk(path.join(publicDir, "generated-backgrounds")),
].filter((file) => extensions.has(path.extname(file).toLowerCase()));

const entries = files.map(buildEntry).sort((a, b) => a.id.localeCompare(b.id));
const byHash = new Map<string, AssetManifestEntry>();
const deduped: AssetManifestEntry[] = [];
for (const entry of entries) {
  const canonical = byHash.get(entry.sha256);
  if (canonical) {
    canonical.aliases = [...(canonical.aliases ?? []), entry.path];
  } else {
    byHash.set(entry.sha256, entry);
    deduped.push(entry);
  }
}
const manifest: AssetManifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  entries: deduped,
};
fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Wrote ${deduped.length} canonical assets (${entries.length - deduped.length} duplicate aliases) to ${outputPath}`);
