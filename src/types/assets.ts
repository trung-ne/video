export type AssetKind = "character" | "prop" | "stage" | "photo" | "chart" | "ui";
export type AssetStyleFamily = "editorial_cat_v1" | "flat_stage_v1" | "photo" | "legacy";

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
  aliases?: string[];
}

export interface AssetManifest {
  schemaVersion: 1;
  generatedAt: string;
  entries: AssetManifestEntry[];
}
