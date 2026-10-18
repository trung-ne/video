import {
  FAILURE_TRIAGE_CATALOG_VERSION,
  Remediation,
  UNKNOWN_REMEDIATION,
  remediationFor,
  type FailureDomain,
} from "./failureRemediationCatalog";

export { FAILURE_TRIAGE_CATALOG_VERSION } from "./failureRemediationCatalog";
export type { FailureDomain } from "./failureRemediationCatalog";

export interface TriageFinding {
  catalogVersion: typeof FAILURE_TRIAGE_CATALOG_VERSION;
  catalogId: string;
  domain: FailureDomain;
  code?: string;
  rule?: string;
  severity: string;
  message: string;
  sceneId?: string;
  claimId?: string;
  phase?: string;
  artifactPath?: string;
  classification: "known" | "unknown";
  evidence: Record<string, unknown>;
  remediation: Remediation;
}

export interface FindingLike {
  code?: unknown;
  rule?: unknown;
  severity?: unknown;
  message?: unknown;
  sceneId?: unknown;
  scene?: unknown;
  claimId?: unknown;
  phase?: unknown;
  artifactPath?: unknown;
  path?: unknown;
  evidence?: unknown;
  [key: string]: unknown;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function codeFromVisualFailure(value: string): { code: string; message: string } {
  const separator = value.indexOf(":");
  const code = (separator < 0 ? value : value.slice(0, separator)).trim();
  const message = (separator < 0 ? value : value.slice(separator + 1)).trim();
  return { code, message: message || value };
}

/**
 * Normalizes only explicitly shaped diagnostic data. Unrecognized data becomes an
 * unknown finding, never a guessed retry recommendation.
 */
export function classifyFinding(input: FindingLike | unknown): TriageFinding {
  const value = object(input);
  const code = text(value?.code);
  const rule = text(value?.rule);
  const remediation = remediationFor(code, rule);
  const known = remediation !== UNKNOWN_REMEDIATION;
  const evidence = object(value?.evidence) ?? (value ? { ...value } : { received: input });
  const artifactPath = text(value?.artifactPath) ?? text(value?.path);
  const sceneId = text(value?.sceneId) ?? text(value?.scene);
  const message = text(value?.message) ?? (code ? `Failure ${code}.` : rule ? `Quality rule ${rule} failed.` : "Unrecognized failure finding.");
  const severity = text(value?.severity) ?? "BLOCKER";
  return {
    catalogVersion: FAILURE_TRIAGE_CATALOG_VERSION,
    catalogId: remediation.id,
    domain: remediation.domain,
    ...(code ? { code } : {}),
    ...(rule ? { rule } : {}),
    severity,
    message,
    ...(sceneId ? { sceneId } : {}),
    ...(text(value?.claimId) ? { claimId: text(value?.claimId)! } : {}),
    ...(text(value?.phase) ? { phase: text(value?.phase)! } : {}),
    ...(artifactPath ? { artifactPath } : {}),
    classification: known ? "known" : "unknown",
    evidence,
    remediation,
  };
}

/** Convert quality gate issues without importing the filesystem-backed checker. */
export function findingsFromQualityIssues(issues: unknown): TriageFinding[] {
  if (!Array.isArray(issues)) return [classifyFinding({ message: "Quality issues payload is malformed.", evidence: { issues } })];
  return issues.map((issue) => {
    const item = object(issue);
    if (!item || !text(item.rule) || !text(item.message)) {
      return classifyFinding({ message: "Quality issue is malformed.", evidence: { issue } });
    }
    return classifyFinding({
      rule: text(item.rule), severity: text(item.severity) ?? "BLOCKER", message: text(item.message),
      sceneId: text(item.scene), claimId: text(item.claimId), evidence: item,
    });
  });
}

/** Normalize visual-audit failures, preserving the audit artifact path as evidence. */
export function findingsFromVisualAudit(report: unknown, artifactPath?: string): TriageFinding[] {
  const audit = object(report);
  if (!audit) return [classifyFinding({ message: "Visual audit report is malformed.", artifactPath, evidence: { report } })];
  if (!Array.isArray(audit.failures)) {
    return [classifyFinding({ message: "Visual audit report has no failures array.", artifactPath, evidence: audit })];
  }
  return audit.failures.flatMap((failure) => {
    if (typeof failure !== "string" || !failure.trim()) {
      return [classifyFinding({ message: "Visual audit failure entry is malformed.", artifactPath, evidence: { failure } })];
    }
    const parsed = codeFromVisualFailure(failure);
    // visual-audit.py emits these scene/interval diagnostics specifically so a
    // temporal visual failure can be repaired in the authored source, not by
    // lowering a threshold. Preserve every valid affected scene independently.
    const diagnostics = (parsed.code === "WITHIN_SCENE_SIMILARITY" || parsed.code === "STATIC_SCENE_RUN")
      && Array.isArray(audit.withinSceneDuplicateDiagnostics)
      ? audit.withinSceneDuplicateDiagnostics
      : [];
    const scoped = diagnostics.map(object).filter((entry): entry is Record<string, unknown> => Boolean(entry && text(entry.sceneId)));
    const entries = scoped.length ? scoped : [undefined];
    return entries.map((entry) => classifyFinding({
      code: parsed.code, severity: "BLOCKER", message: parsed.message, artifactPath,
      sceneId: text(entry?.sceneId),
      evidence: entry
        ? { failure, reportPath: artifactPath, intervals: entry.intervals, duplicatePairs: entry.duplicatePairs, suggestion: entry.suggestion }
        : { failure, reportPath: artifactPath },
    }));
  });
}

export const triageVisualAudit = findingsFromVisualAudit;

/**
 * Normalize the pre-render spatial gate without guessing at geometry from a
 * rendered artifact. Each issue already identifies the authored scene/frame and
 * painted primitives that the source repair must address.
 */
export function findingsFromSpatialIntegrity(report: unknown, artifactPath?: string): TriageFinding[] {
  const spatial = object(report);
  if (!spatial) {
    return [classifyFinding({
      message: "Spatial integrity report is malformed.", artifactPath, evidence: { report },
    })];
  }
  if (spatial.passed !== false || !Array.isArray(spatial.issues)) {
    return [classifyFinding({
      message: "Spatial integrity report has no explicit failed issues.", artifactPath, evidence: spatial,
    })];
  }
  return spatial.issues.map((issue) => {
    const item = object(issue);
    if (!item || !text(item.code) || !text(item.message)) {
      return classifyFinding({
        message: "Spatial integrity issue is malformed.", artifactPath, evidence: { issue },
      });
    }
    return classifyFinding({
      code: text(item.code),
      severity: "BLOCKER",
      message: text(item.message),
      sceneId: text(item.sceneId),
      artifactPath,
      evidence: {
        frame: item.frame,
        assetIds: item.assetIds,
        primitiveKinds: item.primitiveKinds,
        bounds: item.bounds,
        overlapRatio: item.overlapRatio,
      },
    });
  });
}

export const triageSpatialIntegrity = findingsFromSpatialIntegrity;

/** Normalize a standalone canonical audio or encoding audit. */
export function findingsFromDeliveryAudit(
  report: unknown,
  kind: "audio" | "encoding",
  artifactPath?: string,
): TriageFinding[] {
  const audit = object(report);
  if (!audit) {
    return [classifyFinding({
      message: `${kind} audit report is malformed.`, artifactPath, evidence: { report },
    })];
  }
  if (audit.passed !== false) {
    return [classifyFinding({
      message: `${kind} audit report has no explicit failed status.`, artifactPath, evidence: audit,
    })];
  }
  const code = kind === "audio" ? "AUDIO_AUDIT_FAILED" : "ENCODING_AUDIT_FAILED";
  return [classifyFinding({
    code, severity: "BLOCKER", message: `${kind} audit did not pass.`, artifactPath, evidence: audit,
  })];
}

export const triageDeliveryAudit = findingsFromDeliveryAudit;

function processCode(process: Record<string, unknown>): string | undefined {
  const windowsStatus = process.windowsStatus;
  if (windowsStatus === 0xc0000142) return "DLL_INIT_FAILED";
  const reason = text(process.terminationReason);
  if (reason === "timeout") return "TIMEOUT";
  if (reason === "aborted") return "ABORTED";
  if (process.spawnError) return "SPAWN_ERROR";
  return undefined;
}

/**
 * Extract independently actionable failures from a render production report. The
 * report's `error` text is evidence only; it is never heuristically classified.
 */
export function findingsFromProductionReport(
  report: unknown,
  artifactPath?: string,
  siblingAudits?: { visualAudit?: unknown; visualAuditPath?: string } | unknown,
): TriageFinding[] {
  const value = object(report);
  if (!value) return [classifyFinding({ message: "Production report is malformed.", artifactPath, evidence: { report } })];
  const findings: TriageFinding[] = [];
  const process = object(value.process);
  if (process) {
    findings.push(classifyFinding({
      code: processCode(process), severity: "BLOCKER", message: text(value.error) ?? "Production process failed.",
      phase: text(value.phase), artifactPath, evidence: { process, reportPath: artifactPath },
    }));
  } else if (value.status === "diagnostic" && text(value.error)) {
    findings.push(classifyFinding({
      code: text(value.failureKind) === "quality" ? "PIPELINE_QUALITY_FAILURE" : "PIPELINE_FAILURE",
      severity: "BLOCKER", message: text(value.error), phase: text(value.phase), artifactPath, evidence: value,
    }));
  }
  const sibling = object(siblingAudits);
  const spatialIntegrity = value.spatialIntegrity;
  if (spatialIntegrity !== undefined) {
    const spatial = object(spatialIntegrity);
    if (spatial?.passed === false) findings.push(...findingsFromSpatialIntegrity(spatial, artifactPath));
  }
  const visualAudit = sibling?.visualAudit ?? value.visualAuditReport;
  if (visualAudit !== undefined) findings.push(...findingsFromVisualAudit(visualAudit, text(sibling?.visualAuditPath) ?? artifactPath));
  for (const [name, code] of [["audioAudit", "AUDIO_AUDIT_FAILED"], ["encodingAudit", "ENCODING_AUDIT_FAILED"]] as const) {
    const audit = object(sibling?.[name] ?? value[name]);
    if (audit && audit.passed !== true) {
      findings.push(classifyFinding({
        code, severity: "BLOCKER", message: `${name} did not pass.`, artifactPath,
        evidence: { audit, reportPath: artifactPath },
      }));
    }
  }
  return findings.length ? findings : [classifyFinding({
    message: "Production report contains no recognized failure evidence.", artifactPath, evidence: value,
  })];
}

export const triageProductionReport = findingsFromProductionReport;
export const triageQualityIssues = findingsFromQualityIssues;

export function formatTriageResult(findings: readonly TriageFinding[]): string {
  if (!findings.length) return "No triage findings.";
  return findings.map((finding) => {
    const diagnostic = finding.code ?? finding.rule ?? "UNKNOWN";
    return `[${finding.classification.toUpperCase()}] ${diagnostic}: ${finding.message}\n`
      + `Repair: ${finding.remediation.repairLayer}\n`
      + `Recheck: ${finding.remediation.canonicalRecheck}`;
  }).join("\n\n");
}

export const triageDisplay = formatTriageResult;
