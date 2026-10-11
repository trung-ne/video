import { listManifestAssetPaths, listResolvableRefs } from "../engine/assetPaths";
import { isApprovedNoFacePhoto } from "../engine/photoPolicy";

/** Production authoring vocabulary, derived from the generated asset manifest. */
export function listAvailableAssets(): string[] {
  return listResolvableRefs();
}

/** Approved photo references available to session-authored Route A storyboards. */
export function listAvailableBackgrounds(): string[] {
  return listManifestAssetPaths({ styleFamily: "photo" })
    .filter(isApprovedNoFacePhoto);
}

function routeBLocked(): never {
  throw new Error(
    "Route B/API prompt generation is locked. Author projects/<id>/storyboard-data.ts through Route A.",
  );
}

/** @deprecated Route B is deliberately unavailable. */
export function buildSystemPrompt(_assetList: string[], _durationSeconds: number): never {
  return routeBLocked();
}

/** @deprecated Route B is deliberately unavailable. */
export function buildScriptFromIdea(_idea: string): never {
  return routeBLocked();
}
