export type AssetKind = "character" | "prop" | "stage" | "photo" | "chart" | "ui";

// "legacy" = the original hand-drawn public/assets/*.svg set. It is still
// indexed so nothing breaks, but it is excluded from the resolver's default
// style families, so it is never selected for new work.
export type AssetStyleFamily =
  | "editorial_cat_v1"  // generated-assets/characters
  | "flat_icon_v1"      // generated-assets/icons
  | "flat_stage_v1"     // generated-assets/scenes + generated-backgrounds
  | "photo"             // backgrounds/*.jpg
  | "legacy";

export interface AssetPoint {
  x: number;
  y: number;
}

export interface AssetManifestEntry {
  id: string;
  path: string;
  sha256: string;
  kind: AssetKind;
  styleFamily: AssetStyleFamily;
  characterId?: string;
  emotion?: string[];
  action?: string[];
  topics?: string[];
  props?: string[];
  facing?: "left" | "right" | "front";
  contentBox?: { x: number; y: number; width: number; height: number };
  anchors?: Record<string, AssetPoint>;
  source?: "original" | "generated" | "licensed";
  sourcePage?: string;
  license?: string;
  noRecognizableFaces?: boolean;
  aliases?: string[];
  visualDensity?: number;
  recommendedScale?: number;
  // Multiplier that cancels out an asset's transparent padding, so two assets
  // authored at the same `scale` occupy the same visual size. 1 = no padding.
  // Measured from the alpha channel by scripts/measure-asset-content.py.
  contentScale?: number;
  aspectRatio?: number;
  semanticRoles?: string[];
  actionTags?: string[];
  settingTags?: string[];
  isFallback?: boolean;
}

export interface AssetManifest {
  schemaVersion: 1;
  generatedAt: string;
  entries: AssetManifestEntry[];
  // Logical authoring ref → physical path under public/, derived from what is
  // actually on disk (never hand-written). Lets storyboards keep writing
  // "characters/cat_explain" / "finance/money" / "assets/scenes/cafe.svg"
  // while rendering resolves to the current generated-* asset.
  aliases?: Record<string, string>;
  // Physical path → contentScale, for the renderer to look up without walking
  // the full entry list. Only assets whose padding differs from 1 appear here.
  contentScales?: Record<string, number>;
}
