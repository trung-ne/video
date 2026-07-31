import { AssetRequest } from "../types/storyboard";

export type StoryboardCast = Record<string, {
  src: string;
  badge?: string;
  poseFamily?: "narrator";
}>;

const CHARACTER_SLOTS = new Set(["who", "seatB", "asker", "answerer"]);
const DIRECT_ASSET_SLOTS = new Set([
  "prop", "leftAsset", "rightAsset", "causeIcon", "effectIcon", "anchor",
  "answerAsset", "stage", "content", "image", "chart", "map", "photo",
]);

/**
 * Resolve only slots that name renderable assets. Stage anchors such as
 * `seat_left` describe placement and must never enter semanticAssetIds.
 * Character-role slots are resolved through CAST so metrics see the actual
 * costume path rather than an authoring token such as `host`.
 */
export function resolveAuthoredAssets(
  slots: Record<string, string>,
  cast: StoryboardCast,
): Record<string, string> {
  const resolved: Record<string, string> = {};

  for (const key of CHARACTER_SLOTS) {
    const value = slots[key]?.trim();
    if (!value) continue;
    const src = cast[value]?.src ?? (value.includes("/") ? value : undefined);
    if (src) resolved[key] = src;
  }

  for (const key of DIRECT_ASSET_SLOTS) {
    const value = slots[key]?.trim();
    if (value) resolved[key] = value;
  }

  const icons = slots.icons;
  if (icons) {
    icons.split("|").map((value) => value.trim()).filter(Boolean)
      .forEach((value, index) => { resolved[`icon${index}`] = value; });
  }
  return resolved;
}

export function roleForAuthoredAssetSlot(key: string): AssetRequest["role"] {
  if (key === "stage") return "stage";
  if (CHARACTER_SLOTS.has(key)) return "character";
  if (key === "photo") return "photo";
  if (key === "chart" || key === "map") return "chart";
  if (key === "content" || key === "image") return "ui";
  return "prop";
}
