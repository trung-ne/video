/**
 * Stable, pure remediation vocabulary for failed production gates.
 * This module deliberately has no filesystem or process dependencies.
 */
export type FailureDomain =
  | "schema"
  | "quality"
  | "timing"
  | "chunk-lineage"
  | "render-audit"
  | "process"
  | "pipeline"
  | "unknown";

export type RetryClass = "source-fix" | "safe-phase-retry" | "manual-environment" | "manual-review";

export interface Remediation {
  id: string;
  domain: FailureDomain;
  /** Exact diagnostic codes/rules covered by this entry. */
  codes?: readonly string[];
  rules?: readonly string[];
  /** A code family is only used for established, emitted code namespaces. */
  codePrefixes?: readonly string[];
  repairLayer: string;
  sourceOfTruth: string;
  forbiddenActions: readonly string[];
  resolutionFlow: readonly string[];
  canonicalRecheck: string;
  retryClass: RetryClass;
}

export const FAILURE_TRIAGE_CATALOG_VERSION = "failure-triage-catalog-v1";

const SOURCE_FIX_FORBIDDEN = [
  "Do not edit compiled timeline.json by hand.",
  "Do not bypass the failed gate or publish a diagnostic artifact.",
] as const;

const CATALOG: readonly Remediation[] = [
  {
    id: "visual-low-colour-register", domain: "render-audit", codes: ["LOW_COLOUR_REGISTER"],
    repairLayer: "Authored storyboard scene treatment and asset selection.",
    sourceOfTruth: "projects/<id>/storyboard-data.ts, then rebuilt storyboard.json.",
    forbiddenActions: SOURCE_FIX_FORBIDDEN,
    resolutionFlow: ["Increase meaningful colour contrast in the affected authored scene.", "Rebuild, compile from measured timing, and rerender the canonical candidate."],
    canonicalRecheck: "Run the canonical visual audit with its pinned profile.", retryClass: "source-fix",
  },
  {
    id: "visual-over-saturated", domain: "render-audit", codes: ["OVER_SATURATED"],
    repairLayer: "Authored storyboard palette/treatment.", sourceOfTruth: "projects/<id>/storyboard-data.ts.",
    forbiddenActions: SOURCE_FIX_FORBIDDEN,
    resolutionFlow: ["Reduce authored saturated visual treatments.", "Rebuild and rerender the canonical candidate."],
    canonicalRecheck: "Run the canonical visual audit with its pinned profile.", retryClass: "source-fix",
  },
  {
    id: "visual-white-register", domain: "render-audit", codes: ["WHITE_REGISTER_SHORTAGE", "WHITE_DOMINANT_SHORTAGE"],
    repairLayer: "Authored scene background and treatment.", sourceOfTruth: "projects/<id>/storyboard-data.ts.",
    forbiddenActions: SOURCE_FIX_FORBIDDEN,
    resolutionFlow: ["Restore intentional white-space/white-background treatment in authored scenes.", "Rebuild and rerender."],
    canonicalRecheck: "Run the canonical visual audit with its pinned profile.", retryClass: "source-fix",
  },
  {
    id: "visual-density", domain: "render-audit", codes: ["LOW_VISUAL_DENSITY", "FLAT_REGISTER", "FOCAL_OCCUPANCY"],
    repairLayer: "Authored composition, props, and semantic visual state.", sourceOfTruth: "projects/<id>/storyboard-data.ts.",
    forbiddenActions: SOURCE_FIX_FORBIDDEN,
    resolutionFlow: ["Add a meaningful authored focal composition rather than decorative wallpaper.", "Rebuild and rerender."],
    canonicalRecheck: "Run the canonical visual audit with its pinned profile.", retryClass: "source-fix",
  },
  {
    id: "visual-temporal-cadence", domain: "render-audit", codes: ["FRAME_SIMILARITY", "WITHIN_SCENE_SIMILARITY", "SEAM_FRAME_SIMILARITY", "STATIC_SCENE_RUN"],
    repairLayer: "Authored scene/beat cadence.", sourceOfTruth: "projects/<id>/storyboard-data.ts and authored beat transitions.",
    forbiddenActions: SOURCE_FIX_FORBIDDEN,
    resolutionFlow: ["Author a real semantic state change or split the scene.", "Rebuild, compile against measured timing, and rerender."],
    canonicalRecheck: "Run the canonical visual audit with its pinned profile.", retryClass: "source-fix",
  },
  {
    id: "spatial-temporal-integrity", domain: "quality", codes: [
      "ASSET_COLLISION",
      "ASSET_OUT_OF_FRAME",
      "UNDECLARED_ASSET_OVERLAP",
      "FOREGROUND_COLLISION",
      "TEXT_SUBTITLE_OVERLAP",
      "PRIMITIVE_OUT_OF_FRAME",
      "CONFLICTING_MOTION",
      "ABRUPT_MOVE",
      "UNEXPLAINED_POSITION_JUMP",
    ],
    repairLayer: "Scene-local authored composition and beat timing.",
    sourceOfTruth: "projects/<id>/storyboard-data.ts, then rebuilt storyboard.json and measured compile.",
    forbiddenActions: [
      "Do not edit compiled timeline.json, generated timing artifacts, reports, or output video.",
      "Do not relax spatial/temporal thresholds, suppress an overlap declaration, or publish a diagnostic artifact.",
    ],
    resolutionFlow: [
      "Use the reported scene, frame, and element identities to repair the authored scene locally.",
      "Rebuild through Route A, rerun affected proof, then rerender and audit the canonical candidate.",
    ],
    canonicalRecheck: "Run the pre-render spatial integrity gate and every canonical production audit.", retryClass: "source-fix",
  },
  {
    id: "visual-audit-evidence", domain: "render-audit", codePrefixes: ["MISSING_", "MALFORMED_"],
    repairLayer: "Audit inputs, canonical artifact, and audit configuration.", sourceOfTruth: "The canonical render artifact and pinned visual-audit profile.",
    forbiddenActions: ["Do not alter audit JSON to manufacture evidence.", "Do not promote an artifact with incomplete audit evidence."],
    resolutionFlow: ["Verify the canonical artifact and pinned audit configuration.", "Correct the upstream artifact/configuration, then rerun the audit."],
    canonicalRecheck: "Rerun the canonical visual audit.", retryClass: "safe-phase-retry",
  },
  {
    id: "quality-rule", domain: "quality", codePrefixes: ["RULE:"],
    repairLayer: "Session-authored storyboard source.", sourceOfTruth: "projects/<id>/storyboard-data.ts and storyboard.json.",
    forbiddenActions: SOURCE_FIX_FORBIDDEN,
    resolutionFlow: ["Repair the cited authored scene, claim, or visual treatment.", "Build storyboard, compile from measured timing, and rerun quality gates."],
    canonicalRecheck: "Run the canonical storyboard/quality check.", retryClass: "source-fix",
  },
  {
    id: "timing-integrity", domain: "timing", codePrefixes: ["TIMING_", "SUBTITLE_ALIGNMENT_"],
    repairLayer: "TTS/alignment artifacts and authored scene identity.", sourceOfTruth: "durations.json, words.json, measured audio, and storyboard scene ids.",
    forbiddenActions: ["Do not use estimated timing.", "Do not hand-edit compiled frame durations or bypass timing provenance."],
    resolutionFlow: ["Correct source scene ids or regenerate the affected measured TTS/alignment artifact.", "Compile again using measured artifacts."],
    canonicalRecheck: "Run timing integrity checks and render the full canonical timeline.", retryClass: "source-fix",
  },
  {
    id: "chunk-lineage", domain: "chunk-lineage", codePrefixes: ["CHUNK_", "ATTESTATION_", "ASSEMBLY_", "PLAN_", "SECTION_", "CLAIM_CROSS_CHUNK"],
    repairLayer: "Canonical storyboard/chunk plan and hash-bound artifacts.", sourceOfTruth: "projects/<id>/storyboard.json, chunks/chunk-plan.json, and stage attestations.",
    forbiddenActions: ["Do not edit receipts, provenance, or assembled artifacts to clear drift.", "Do not publish a chunk proof."],
    resolutionFlow: ["Repair the canonical authored source or missing artifact.", "Regenerate only the invalidated canonical chunk stages, then assemble and fully gate."],
    canonicalRecheck: "Verify canonical chunk plan, attestations, assembly provenance, and full render.", retryClass: "source-fix",
  },
  {
    id: "schema-or-asset", domain: "schema", codePrefixes: ["ASSET_", "SCENE_", "BACKGROUND_", "SOURCE_RANGE", "UNRESOLVED_", "UNIQUE_"],
    repairLayer: "Authored storyboard schema and asset manifest.", sourceOfTruth: "projects/<id>/storyboard-data.ts and public/assets.manifest.json.",
    forbiddenActions: SOURCE_FIX_FORBIDDEN,
    resolutionFlow: ["Correct authored fields or add/build the requested production asset.", "Rebuild storyboard and rerun validation."],
    canonicalRecheck: "Run schema validation and canonical quality check.", retryClass: "source-fix",
  },
  {
    id: "process-dll-initialization", domain: "process", codes: ["DLL_INIT_FAILED"],
    repairLayer: "Local process environment.", sourceOfTruth: "The failing process result and local runtime installation.",
    forbiddenActions: ["Do not classify a cancelled run as retryable.", "Do not publish an incomplete render."],
    resolutionFlow: ["Retry the failed phase once after confirming no cancellation.", "If it recurs, repair the local runtime environment."],
    canonicalRecheck: "Rerun the same canonical phase and retain its process result.", retryClass: "safe-phase-retry",
  },
  {
    id: "process-infrastructure", domain: "process", codePrefixes: ["PROCESS_", "SPAWN_", "EXIT_", "TIMEOUT_", "ABORTED"],
    repairLayer: "Local process environment.", sourceOfTruth: "The recorded process result and environment diagnostics.",
    forbiddenActions: ["Do not treat cancellation as a successful retry.", "Do not bypass mandatory audits."],
    resolutionFlow: ["Resolve the local executable/environment failure.", "Rerun only the failed canonical phase when its inputs remain unchanged."],
    canonicalRecheck: "Rerun the failed canonical phase.", retryClass: "manual-environment",
  },
  {
    id: "pipeline-failure", domain: "pipeline", codePrefixes: ["PIPELINE_", "ENCODING_", "AUDIO_", "RENDER_"],
    repairLayer: "Canonical production inputs or render configuration.", sourceOfTruth: "The canonical timeline, audio artifacts, and production report.",
    forbiddenActions: ["Do not publish a diagnostic run.", "Do not suppress the failed production gate."],
    resolutionFlow: ["Correct the documented upstream failure.", "Rerun the required canonical pipeline phase."],
    canonicalRecheck: "Run the canonical production render and its mandatory audits.", retryClass: "source-fix",
  },
] as const;

export const FAILURE_REMEDIATION_CATALOG: readonly Remediation[] = CATALOG;

export const UNKNOWN_REMEDIATION: Remediation = {
  id: "unknown-failure", domain: "unknown", repairLayer: "Manual investigation; no automatic repair is authorized.",
  sourceOfTruth: "The original failing gate output and canonical artifacts.",
  forbiddenActions: ["Do not retry blindly as a successful remediation.", "Do not bypass, suppress, or publish around an unrecognized failure."],
  resolutionFlow: ["Preserve the original evidence.", "Investigate and add an explicit catalog entry before automated remediation."],
  canonicalRecheck: "Repeat the original canonical gate after a reviewed repair.", retryClass: "manual-review",
};

export function remediationFor(code?: string, rule?: string): Remediation {
  const token = code ?? (rule ? `RULE:${rule}` : undefined);
  if (!token) return UNKNOWN_REMEDIATION;
  return CATALOG.find((entry) => entry.codes?.includes(token)
    || entry.rules?.includes(rule ?? "")
    || entry.codePrefixes?.some((prefix) => token.startsWith(prefix))) ?? UNKNOWN_REMEDIATION;
}
