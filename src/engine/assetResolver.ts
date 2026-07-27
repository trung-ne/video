import { AssetKind, AssetManifest, AssetManifestEntry, AssetStyleFamily } from "../types/assets";
import { AssetRequest } from "../types/storyboard";

export interface AssetResolution {
  request: AssetRequest;
  asset?: AssetManifestEntry;
  score: number;
  unresolvedReason?: string;
}

export interface AssetResolutionContext {
  usage?: ReadonlyMap<string, number>;
  maximumUses?: number;
}

const DEFAULT_STYLE_FAMILIES: AssetStyleFamily[] = ["editorial_cat_v1", "flat_stage_v1", "photo"];

function normalizedTokens(values: Array<string | undefined>): Set<string> {
  return new Set(values.flatMap((value) => (value ?? "").toLowerCase().split(/[^a-z0-9\u00c0-\u024f]+/u)).filter(Boolean));
}

function assetTokens(asset: AssetManifestEntry): Set<string> {
  return normalizedTokens([
    asset.id, asset.path, asset.characterId,
    ...(asset.emotion ?? []), ...(asset.action ?? []), ...(asset.topics ?? []), ...(asset.props ?? []),
  ]);
}

export function scoreAsset(
  request: AssetRequest,
  asset: AssetManifestEntry,
  context: AssetResolutionContext = {},
): number {
  if (asset.kind !== request.role) return -Infinity;
  if (asset.isFallback) return -Infinity;
  const tokens = assetTokens(asset);
  const query = normalizedTokens([request.query, ...request.requiredTags]);
  let score = 0;
  for (const token of query) if (tokens.has(token)) score += 3;
  for (const tag of request.requiredTags) {
    const parts = normalizedTokens([tag]);
    if ([...parts].every((part) => tokens.has(part))) score += 5;
  }
  if (request.preferredAssetId === asset.id) score += 100;
  if (asset.styleFamily === "legacy") score -= 20;
  const uses = context.usage?.get(asset.path) ?? 0;
  if (context.maximumUses !== undefined && uses >= context.maximumUses) score -= 100;
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
  if (request.preferredAssetId) {
    const exact = manifest.entries.find((entry) => entry.id === request.preferredAssetId);
    if (exact && allowedStyles.includes(exact.styleFamily) && exact.kind === request.role) {
      return { request, asset: exact, score: 100 };
    }
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
  return { request, ...candidates[0] };
}

export function resolveAssetRequests(
  requests: AssetRequest[],
  manifest: AssetManifest,
  context: AssetResolutionContext = {},
): AssetResolution[] {
  return requests.map((request) => resolveAssetRequest(request, manifest, DEFAULT_STYLE_FAMILIES, context));
}
