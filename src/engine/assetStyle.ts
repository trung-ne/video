import * as crypto from "crypto";
import manifest from "../../public/assets.manifest.json";

export const ASSET_STYLES = ["c", "d", "f"] as const;
export type AssetStyle = typeof ASSET_STYLES[number];

type StyleManifest = {
  aliases?: Record<string, string>;
  styleAliases?: Partial<Record<AssetStyle, Record<string, string>>>;
  styleHashes?: Partial<Record<AssetStyle, string>>;
};

const styleManifest = manifest as StyleManifest;

export function requestedAssetStyle(value = process.env.ASSET_STYLE): AssetStyle {
  const style = (value || "f").toLowerCase();
  if (!(ASSET_STYLES as readonly string[]).includes(style)) {
    throw new Error(`ASSET_STYLE must be one of ${ASSET_STYLES.join(", ")}, got ${JSON.stringify(value)}.`);
  }
  return style as AssetStyle;
}

export function styleManifestHash(style: AssetStyle): string | undefined {
  return styleManifest.styleHashes?.[style];
}

/** Resolve an authored logical ref into one physical file from the selected style. */
export function resolveStyledAsset(src: string, style: AssetStyle): string | undefined {
  return styleManifest.styleAliases?.[style]?.[src];
}

export function assertStyleInventory(style: AssetStyle, refs: string[]): Record<string, string> {
  const resolved: Record<string, string> = {};
  const missing: string[] = [];
  // A production compile must never certify a partial style library merely
  // because this particular storyboard used only a few props. Every base
  // production logical ref needs a corresponding selected-style file first.
  const required = [
    ...refs,
    ...Object.entries(styleManifest.aliases ?? {})
      .filter(([, physical]) => physical.startsWith("generated-assets/") || physical.startsWith("generated-backgrounds/"))
      .map(([ref]) => ref),
  ];
  for (const ref of [...new Set(required.filter(Boolean))]) {
    const path = resolveStyledAsset(ref, style);
    if (path) resolved[ref] = path;
    else missing.push(ref);
  }
  if (missing.length) {
    throw new Error(
      `ASSET_STYLE=${style} is missing ${missing.length} required production asset(s): ${missing.slice(0, 12).join(", ")}` +
      `${missing.length > 12 ? "…" : ""}. Generate the matching style batch and run npm run build-assets.`,
    );
  }
  if (!styleManifestHash(style)) {
    throw new Error(`ASSET_STYLE=${style} has no manifest hash. Run npm run build-assets after adding style assets.`);
  }
  return resolved;
}

export function hashStyleAliases(aliases: Record<string, string>): string {
  return crypto.createHash("sha256").update(JSON.stringify(Object.entries(aliases).sort())).digest("hex");
}

/** Fail closed when the selected style inventory changed after timeline compile. */
export function assertTimelineAssetStyle(provenance: any, requested = requestedAssetStyle()): AssetStyle {
  if (provenance?.assetStyle !== requested) {
    throw new Error(`ASSET_STYLE=${requested} does not match timeline style ${provenance?.assetStyle ?? "missing"}. Recompile first.`);
  }
  const current = styleManifestHash(requested);
  if (!current || provenance?.assetStyleManifestHash !== current) {
    throw new Error(`ASSET_STYLE=${requested} manifest changed after compile. Run npm run build-assets and recompile first.`);
  }
  return requested;
}
