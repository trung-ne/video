import * as crypto from "crypto";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { AssetKind, AssetManifest, AssetManifestEntry, AssetStyleFamily } from "../src/types/assets";
import { photoPolicyEntry } from "../src/engine/photoPolicy";

// ── Transparent-padding compensation ──────────────────────────────────────
// The generated PNGs carry uneven transparent margins (measured 56-81% of the
// canvas), so the same authored `scale` renders visibly different sizes and
// characters came out ~20% smaller than the SVGs they replaced. Measure the
// opaque bounding box once here and store a per-asset multiplier the renderer
// applies, which is equivalent to trimming the padding without touching the
// source files.
//
// Falls back to no compensation if Python/Pillow is unavailable — the manifest
// must still build. (Python is already a hard dependency of this repo: TTS,
// word alignment and the audio/visual audits all need it.)
function measureContentFractions(): Record<string, [number, number]> {
  const script = path.join(process.cwd(), "scripts", "measure-asset-content.py");
  if (!fs.existsSync(script)) return {};
  for (const python of ["python", "py"]) {
    try {
      const raw = execFileSync(python, [script, publicDir], {
        encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 8 * 1024 * 1024,
      });
      return JSON.parse(raw);
    } catch {
      continue;
    }
  }
  console.warn("⚠️  Không đo được padding asset (thiếu Python/Pillow) — bỏ qua contentScale.");
  return {};
}

type AssetVisualMetrics = NonNullable<AssetManifestEntry["visualMetrics"]>;
function measureAssetVisuals(): Record<string, AssetVisualMetrics> {
  const script = path.join(process.cwd(), "scripts", "measure-asset-visuals.py");
  if (!fs.existsSync(script)) return {};
  for (const python of ["python", "py"]) {
    try {
      return JSON.parse(execFileSync(python, [script, publicDir], {
        encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 16 * 1024 * 1024,
      }));
    } catch { continue; }
  }
  return {};
}

// Normalize so the content's longer side touches the frame: factor =
// 1 / max(widthFraction, heightFraction). Clamped so a mostly-empty image
// cannot blow up.
function contentScaleFor(fractions: [number, number] | undefined): number | undefined {
  if (!fractions) return undefined;
  const largest = Math.max(fractions[0], fractions[1]);
  if (!Number.isFinite(largest) || largest <= 0) return undefined;
  const scale = Math.min(1.8, Math.max(1, 1 / largest));
  return scale > 1.01 ? Number(scale.toFixed(3)) : undefined;
}

const publicDir = path.join(process.cwd(), "public");
const outputPath = path.join(publicDir, "assets.manifest.json");
const extensions = new Set([".svg", ".png", ".jpg", ".jpeg", ".webp"]);
const styleOverridesPath = path.join(process.cwd(), "config", "asset-style-overrides.json");
const styleOverrides = new Set<string>(fs.existsSync(styleOverridesPath)
  ? (JSON.parse(fs.readFileSync(styleOverridesPath, "utf8")).assets ?? []).map((item: any) => item.path)
  : []);

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

// Style family is decided by WHICH DIRECTORY the file lives in — the three
// production directories each map to a family, and everything left over
// (public/assets/**, the original hand-drawn SVGs) stays "legacy" so the
// resolver's DEFAULT_STYLE_FAMILIES filters it out automatically.
function inferStyle(relative: string, kind: AssetKind): AssetStyleFamily {
  const normalized = relative.replace(/\\/g, "/");
  if (styleOverrides.has(normalized)) {
    if (kind === "character") return "editorial_cat_v2";
    if (kind === "stage") return "flat_stage_v2";
    return "flat_icon_v2";
  }
  if (normalized.startsWith("generated-assets/characters/")) return "editorial_cat_v1";
  if (normalized.startsWith("generated-assets/icons/")) return "flat_icon_v1";
  if (normalized.startsWith("generated-assets/scenes/")) return "flat_stage_v1";
  if (normalized.startsWith("generated-backgrounds/")) return "flat_stage_v1";
  if (normalized.startsWith("backgrounds/")) return "photo";
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
  const photoPolicy = kind === "photo" ? photoPolicyEntry(sourcePath) : undefined;
  const visualMetrics = assetVisuals[relative];
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
    source: relative.startsWith("generated-") ? "generated" : photoPolicy ? "licensed" : "original",
    sourcePage: photoPolicy?.sourcePage,
    license: photoPolicy?.license,
    noRecognizableFaces: photoPolicy?.approved,
    visualDensity: densityByKind[kind],
    recommendedScale: kind === "prop" || kind === "ui" ? 1.35 : 1,
    contentScale: contentScaleFor(contentFractions[relative]),
    semanticRoles: kind === "character" ? ["subject", "actor"] : [kind, "focal"],
    actionTags: kind === "character" ? tags : [],
    settingTags: kind === "stage" ? tags : [],
    isFallback: /placeholder|fallback|concept.card/i.test(relative) || stat.size < 200 ||
      (kind === "photo" && !photoPolicy?.approved),
    paletteProfile: kind === "photo" ? "photo-natural" :
      styleOverrides.has(relative) ? "editorial-muted-v2" : "legacy-unprofiled",
    visualMetrics,
  };
}

const contentFractions = measureContentFractions();
const assetVisuals = measureAssetVisuals();

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
// ─── Logical ref → production file alias map ──────────────────────────────
// Storyboards keep authoring stable logical refs ("characters/cat_explain",
// "finance/money", "assets/scenes/cafe.svg"). Rendering must resolve those to
// the current production art in generated-assets/ + generated-backgrounds/,
// never to the retired public/assets/*.svg set.
//
// Both sides of every mapping are files that actually exist on disk: the key
// comes from a real legacy ref, the value from a real generated file. Nothing
// here is a hand-maintained per-asset list, so adding a new generated file is
// picked up automatically on the next `npm run build-assets`.
function physicalSet(dir: string): Set<string> {
  const full = path.join(publicDir, dir);
  if (!fs.existsSync(full)) return new Set();
  return new Set(fs.readdirSync(full).filter((f) => extensions.has(path.extname(f).toLowerCase())));
}

const generatedCharacters = physicalSet("generated-assets/characters");
const generatedIcons = physicalSet("generated-assets/icons");
const generatedScenes = physicalSet("generated-assets/scenes");
const generatedBackgrounds = physicalSet("generated-backgrounds");

const hyphen = (value: string) => value.replace(/_/g, "-");

function firstExisting(
  candidates: Array<[Set<string>, string, string]>,
): string | undefined {
  for (const [pool, dir, file] of candidates) {
    if (pool.has(file)) return `${dir}/${file}`;
  }
  return undefined;
}

const aliases: Record<string, string> = {};
for (const file of files) {
  const relative = path.relative(publicDir, file).replace(/\\/g, "/");
  if (!relative.startsWith("assets/") || !relative.endsWith(".svg")) continue;
  const ref = relative.slice("assets/".length, -".svg".length); // e.g. finance/money
  const slash = ref.indexOf("/");
  if (slash === -1) continue;
  const category = ref.slice(0, slash);
  const name = ref.slice(slash + 1);

  let target: string | undefined;
  if (category === "characters") {
    target = firstExisting([[generatedCharacters, "generated-assets/characters", `${name}.png`]]);
  } else if (category === "scenes") {
    // generated-backgrounds is the higher-fidelity override when present.
    target = firstExisting([
      [generatedBackgrounds, "generated-backgrounds", `${hyphen(name)}.png`],
      [generatedScenes, "generated-assets/scenes", `${hyphen(name)}.png`],
    ]);
    if (target) aliases[relative] = target; // stage refs are authored WITH the assets/…svg path
  } else {
    target = firstExisting([
      [generatedIcons, "generated-assets/icons", `${category}-${hyphen(name)}.png`],
      [generatedIcons, "generated-assets/icons", `${hyphen(name)}.png`],
    ]);
  }
  if (target) aliases[ref] = target;
}

// New production-only character art has no retired SVG counterpart by
// design. Give every generated character the same stable logical ref contract
// as migrated characters instead of requiring a placeholder file in
// public/assets/ just to manufacture an alias.
for (const file of generatedCharacters) {
  const name = path.basename(file, path.extname(file));
  aliases[`characters/${name}`] = `generated-assets/characters/${file}`;
}

const legacyRefs = files.filter((f) => {
  const r = path.relative(publicDir, f).replace(/\\/g, "/");
  return r.startsWith("assets/") && r.endsWith(".svg");
}).length;

// Flat path → contentScale lookup so the renderer does not walk every entry.
const contentScales: Record<string, number> = {};
for (const entry of deduped) {
  if (entry.contentScale && entry.contentScale > 1.01) contentScales[entry.path] = entry.contentScale;
}

const manifest: AssetManifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  entries: deduped,
  aliases,
  contentScales,
};
fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Wrote ${deduped.length} canonical assets (${entries.length - deduped.length} duplicate aliases) to ${outputPath}`);
console.log(`Aliases: ${Object.keys(aliases).length} logical refs → production art (${legacyRefs} legacy svg on disk)`);
