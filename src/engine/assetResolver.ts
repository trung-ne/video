import { AssetKind, AssetManifest, AssetManifestEntry, AssetStyleFamily } from "../types/assets";
import { AssetRequest } from "../types/storyboard";

export interface AssetResolution {
  request: AssetRequest;
  asset?: AssetManifestEntry;
  score: number;
  unresolvedReason?: string;
  reasons?: string[];
}

export interface AssetResolutionContext {
  usage?: ReadonlyMap<string, number>;
  maximumUses?: number;
}

const DEFAULT_STYLE_FAMILIES: AssetStyleFamily[] = [
  "editorial_cat_v2", "flat_icon_v2", "flat_stage_v2",
  "editorial_cat_v1", "flat_icon_v1", "flat_stage_v1", "photo",
];

function normalizedTokens(values: Array<string | undefined>): Set<string> {
  return new Set(values.flatMap((value) => (value ?? "").toLowerCase().split(/[^a-z0-9\u00c0-\u024f]+/u)).filter(Boolean));
}

function assetTokens(asset: AssetManifestEntry): Set<string> {
  return normalizedTokens([
    asset.id, asset.path, asset.characterId,
    ...(asset.emotion ?? []), ...(asset.action ?? []), ...(asset.topics ?? []), ...(asset.props ?? []),
  ]);
}

function matchesAssetRef(asset: AssetManifestEntry, value: string | undefined): boolean {
  if (!value) return false;
  return asset.id === value || asset.path === value || (asset.aliases ?? []).includes(value);
}

export function scoreAsset(
  request: AssetRequest,
  asset: AssetManifestEntry,
  context: AssetResolutionContext = {},
): number {
  if (asset.kind !== request.role) return -Infinity;
  if (asset.isFallback) return -Infinity;
  if (request.lockedAssetId && !matchesAssetRef(asset, request.lockedAssetId)) return -Infinity;
  const tokens = assetTokens(asset);
  const query = normalizedTokens([request.query, ...request.requiredTags, ...(request.preferredTags ?? [])]);
  for (const tag of request.requiredTags) {
    const parts = normalizedTokens([tag]);
    if (![...parts].every((part) => tokens.has(part))) return -Infinity;
  }
  let score = 0;
  for (const token of query) if (tokens.has(token)) score += 3;
  for (const tag of request.requiredTags) {
    const parts = normalizedTokens([tag]);
    if ([...parts].every((part) => tokens.has(part))) score += 5;
  }
  if (matchesAssetRef(asset, request.preferredAssetId)) score += 30;
  if (matchesAssetRef(asset, request.lockedAssetId)) score += 1000;
  if (asset.styleFamily === "legacy") score -= 20;
  const uses = context.usage?.get(asset.path) ?? 0;
  if (!request.lockedAssetId && context.maximumUses !== undefined && uses >= context.maximumUses) return -Infinity;
  score -= uses * 6;
  if (asset.actionTags?.some((tag) => query.has(tag))) score += 4;
  if (asset.settingTags?.some((tag) => query.has(tag))) score += 4;
  return score;
}

export function resolveAssetRequest(
  request: AssetRequest,
  manifest: AssetManifest,
  allowedStyles: AssetStyleFamily[] = DEFAULT_STYLE_FAMILIES,
  context: AssetResolutionContext = {},
): AssetResolution {
  if (request.lockedAssetId && !request.continuityReason?.trim()) {
    return { request, score: 0, unresolvedReason: "lockedAssetId requires a continuityReason." };
  }
  const candidates = manifest.entries
    .filter((entry) => allowedStyles.includes(entry.styleFamily))
    .map((asset) => ({ asset, score: scoreAsset(request, asset, context) }))
    .filter((candidate) => Number.isFinite(candidate.score) && candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.asset.id.localeCompare(b.asset.id));
  if (candidates.length === 0) {
    return {
      request,
      score: 0,
      unresolvedReason: request.allowGenerate
        ? "No semantic match; add to asset generation queue."
        : "No semantic match and generation is disabled.",
    };
  }
  const selected = candidates[0];
  const uses = context.usage?.get(selected.asset.path) ?? 0;
  return {
    request, ...selected,
    reasons: [
      `semantic match for ${request.query}`,
      `style ${selected.asset.styleFamily}`,
      `usage ${uses}/${context.maximumUses ?? "unbounded"}`,
      request.preferredAssetId && matchesAssetRef(selected.asset, request.preferredAssetId)
        ? "preferred asset accepted within budget" : "novel compatible asset",
    ],
  };
}

export function resolveAssetRequests(
  requests: AssetRequest[],
  manifest: AssetManifest,
  context: AssetResolutionContext = {},
): AssetResolution[] {
  const usage = new Map(context.usage ?? []);
  return requests.map((request) => {
    const result = resolveAssetRequest(request, manifest, DEFAULT_STYLE_FAMILIES, { ...context, usage });
    if (result.asset) usage.set(result.asset.path, (usage.get(result.asset.path) ?? 0) + 1);
    return result;
  });
}
