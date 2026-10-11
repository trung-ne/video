// ============================================================
// assetPaths.ts — the ONE place a logical asset ref becomes a real file.
//
// Storyboards author stable logical refs ("characters/cat_explain",
// "finance/money", "assets/scenes/cafe.svg"). Production art lives in
// generated-assets/ + generated-backgrounds/ + backgrounds/, and the original
// hand-drawn public/assets/*.svg set is retired.
//
// The mapping is NOT written here — it comes from `aliases` in
// public/assets.manifest.json, which build-asset-manifest.ts derives from the
// files actually on disk. Drop a new file into generated-assets/, re-run
// `npm run build-assets`, and it resolves automatically; nothing in this file
// or in any prompt needs editing.
//
// Browser-safe: a JSON import + pure functions. No fs, so it works inside
// Remotion (preview + render) exactly as it does in Node scripts.
// ============================================================

import manifest from "../../public/assets.manifest.json";
import type { AssetKind, AssetManifestEntry, AssetStyleFamily } from "../types/assets";

const ALIASES: Record<string, string> = (manifest as { aliases?: Record<string, string> }).aliases ?? {};
const CONTENT_SCALES: Record<string, number> =
  (manifest as { contentScales?: Record<string, number> }).contentScales ?? {};
const ASSET_ENTRIES: AssetManifestEntry[] =
  (manifest as unknown as { entries?: AssetManifestEntry[] }).entries ?? [];
const GEOMETRY_BY_PATH = new Map(
  ASSET_ENTRIES.map((entry) => [entry.path, {
    aspectRatio: entry.aspectRatio ?? 1,
    contentBox: entry.contentBox ?? { x: 0, y: 0, width: 1, height: 1 },
  }] as const),
);
const SATURATION_BY_PATH = new Map(
  ASSET_ENTRIES
    .filter((entry) => typeof entry.visualMetrics?.meanSaturation === "number")
    .map((entry) => [entry.path, entry.visualMetrics!.meanSaturation!] as const),
);
const KIND_BY_PATH = new Map(
  ASSET_ENTRIES.map((entry) => [entry.path, entry.kind] as const),
);
const ENTRY_BY_PATH = new Map(
  ASSET_ENTRIES.map((entry) => [entry.path, entry] as const),
);
const ENTRY_BY_REF = new Map<string, AssetManifestEntry>();
for (const entry of ASSET_ENTRIES) {
  for (const ref of [entry.id, entry.path, ...(entry.aliases ?? [])]) {
    ENTRY_BY_REF.set(ref, entry);
  }
}

const HAS_EXTENSION = /\.(?:png|jpe?g|webp|gif|svg)$/i;

/** The retired hand-drawn set. Nothing new should resolve into it. */
export function isLegacyAssetPath(path: string): boolean {
  return path.startsWith("assets/");
}

/**
 * Logical ref → path under public/, ready for Remotion's staticFile().
 *
 * Accepts either form authored in storyboards:
 *   "characters/cat_explain"      (extensionless logical ref)
 *   "assets/scenes/cafe.svg"      (stage ref, historically written with a path)
 *   "backgrounds/sunrise.jpg"     (already a real path — passed through)
 *
 * Falls back to the legacy `assets/<ref>.svg` location only when the manifest
 * has no alias, so a missing generated asset degrades to the old art instead
 * of rendering a broken image. `resolveAssetSrcStrict` reports that case.
 */
export function resolveAssetSrc(src: string): string {
  if (!src) return src;
  const alias = ALIASES[src];
  if (alias) return alias;
  if (HAS_EXTENSION.test(src)) return src;
  return `assets/${src}.svg`;
}

/**
 * Same resolution, but tells the caller whether real production art backed it.
 * Used by validation/quality gates to flag refs still stuck on legacy art.
 */
export function resolveAssetSrcStrict(src: string): {
  path: string;
  resolvedFromAlias: boolean;
  isLegacy: boolean;
} {
  const path = resolveAssetSrc(src);
  return {
    path,
    resolvedFromAlias: Boolean(ALIASES[src]),
    isLegacy: isLegacyAssetPath(path),
  };
}

/**
 * Multiplier that cancels an asset's transparent padding so the same authored
 * `scale` yields the same visual size across assets. 1 when the art already
 * fills its canvas (or when padding was never measured).
 *
 * Accepts a logical ref or a physical path — it resolves first either way.
 */
export function getContentScale(src: string): number {
  if (!src) return 1;
  return CONTENT_SCALES[resolveAssetSrc(src)] ?? 1;
}

/** True for a character whether the source is a logical ref or a style-pinned path. */
export function isCharacterAssetSrc(src: string): boolean {
  const path = resolveAssetSrc(src);
  return KIND_BY_PATH.get(path) === "character" || /(?:^|\/)characters\//.test(path);
}

/** True for UI art whether the source is a logical ref or a style-pinned path. */
export function isUiAssetSrc(src: string): boolean {
  const path = resolveAssetSrc(src);
  return KIND_BY_PATH.get(path) === "ui" || /(?:^|\/)ui\//.test(path);
}

/** Visible alpha geometry, normalized to the source image. */
export function getAssetGeometry(src: string): {
  aspectRatio: number;
  contentBox: { x: number; y: number; width: number; height: number };
} {
  return GEOMETRY_BY_PATH.get(resolveAssetSrc(src)) ?? {
    aspectRatio: 1,
    contentBox: { x: 0, y: 0, width: 1, height: 1 },
  };
}

/**
 * Per-asset chroma normalization for raster stages/photos. The manifest audit
 * measures source saturation, so a highly saturated workstation photo is
 * muted more than an already editorial asset. This is deliberately applied
 * by image components, never as a whole-video filter.
 */
export function getPaletteSaturationScale(src: string, target = 0.45): number {
  if (!src) return 1;
  const measured = SATURATION_BY_PATH.get(resolveAssetSrc(src));
  if (!measured || measured <= target) return 1;
  return Math.max(0.3, Math.min(0.92, target / measured));
}

/** Every logical ref that currently maps to production art. */
export function listResolvableRefs(): string[] {
  return Object.keys(ALIASES).sort();
}

/** Find the canonical manifest entry behind a logical ref, physical path, id, or deduplicated alias. */
export function getManifestAssetEntry(src: string): AssetManifestEntry | undefined {
  if (!src) return undefined;
  const ref = src.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  const resolvedPath = ALIASES[ref] ?? ref;
  return ENTRY_BY_PATH.get(resolvedPath) ?? ENTRY_BY_REF.get(ref);
}

/** Canonical physical paths from the checked-in manifest, optionally filtered by semantic kind/style. */
export function listManifestAssetPaths(
  filter: { kind?: AssetKind; styleFamily?: AssetStyleFamily } = {},
): string[] {
  return ASSET_ENTRIES
    .filter((entry) =>
      (filter.kind === undefined || entry.kind === filter.kind) &&
      (filter.styleFamily === undefined || entry.styleFamily === filter.styleFamily),
    )
    .map((entry) => entry.path)
    .sort();
}
