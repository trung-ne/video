/**
 * Read-only artifact collector for the provisional failure-triage command.
 *
 * This intentionally does not classify failures or invoke pipeline code. It only
 * provides a bounded, safe view of artifacts for a single Route A project. Gate
 * diagnosis belongs in the core triage layer, so this script remains usable while
 * that layer evolves.
 */
import * as fs from "fs";
import * as path from "path";
import {
  findingsFromDeliveryAudit,
  findingsFromProductionReport,
  findingsFromVisualAudit,
  formatTriageResult,
  type TriageFinding,
} from "../src/engine/failureTriage";

const WORKSPACE_ROOT = path.resolve(__dirname, "..");
const PROJECTS_ROOT = path.join(WORKSPACE_ROOT, "projects");
const OUTPUT_ROOT = path.join(WORKSPACE_ROOT, "output");
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_JSON_BYTES = 2 * 1024 * 1024;

const PROJECT_ARTIFACTS = [
  "transcript.txt",
  "storyboard-data.ts",
  "storyboard.json",
  "tts_scenes.json",
  "durations.json",
  "words.json",
  "timeline.json",
  "asset-needs.json",
  "acceptance.json",
  "chunks/global-authoring-report.json",
  "chunks/chunk-plan.json",
  "chunks/chunk-invalidation-report.json",
];

const OUTPUT_ARTIFACTS = [
  "video.mp4",
  "video.production-report.json",
  "video.visual-audit.json",
  "video.audio-audit.json",
  "video.encoding-audit.json",
  "video.publish-report.json",
];

export interface TriageArtifact {
  path: string;
  exists: boolean;
  kind?: "file" | "other";
  bytes?: number;
  json?: {
    valid: boolean;
    status?: unknown;
    failureKind?: unknown;
    phase?: unknown;
    error?: unknown;
    reason?: string;
  };
}

export interface TriageArtifactCollection {
  projectId: string;
  projectPath: string;
  includeHistory: boolean;
  artifacts: TriageArtifact[];
}

export interface TriageStatusReport extends TriageArtifactCollection {
  findings: TriageFinding[];
}

interface ParsedArgs {
  project?: string;
  projectPath?: string;
  reportPath?: string;
  json: boolean;
  includeHistory: boolean;
}

interface ResolvedTriageTarget {
  projectPath: string;
  reportPath?: string;
}

function usage(): string {
  return "Usage: npm run triage -- (--project <id> | --path projects/<id> | --report output/<id>/.runs/<run>/(production-report|visual-audit|audio-audit|encoding-audit).json) [--json] [--include-history]";
}

function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function existingDirectoryInside(candidate: string, allowedParent: string, label: string): string {
  if (!fs.existsSync(candidate)) throw new Error(`${label} does not exist.`);
  if (fs.lstatSync(candidate).isSymbolicLink()) throw new Error(`${label} must not be a symbolic link.`);
  const resolved = fs.realpathSync(candidate);
  if (!isWithin(allowedParent, resolved)) throw new Error(`${label} must be inside ${path.relative(WORKSPACE_ROOT, allowedParent)}.`);
  if (!fs.statSync(resolved).isDirectory()) throw new Error(`${label} must be a directory.`);
  return resolved;
}

export function parseTriageArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = { json: false, includeHistory: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      throw new Error(usage());
    }
    if (arg === "--json") {
      if (parsed.json) throw new Error("--json may only be supplied once.");
      parsed.json = true;
    } else if (arg === "--include-history") {
      if (parsed.includeHistory) throw new Error("--include-history may only be supplied once.");
      parsed.includeHistory = true;
    } else if (arg === "--project" || arg === "--path" || arg === "--report") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--") || value.includes("\0")) throw new Error(`${arg} requires a value.`);
      if (parsed.project || parsed.projectPath || parsed.reportPath) {
        throw new Error("Specify exactly one of --project, --path, or --report.");
      }
      if (arg === "--project") {
        if (!PROJECT_ID.test(value) || value === "." || value === "..") {
          throw new Error("--project must be a project ID, not a path.");
        }
        parsed.project = value;
      } else {
        if (path.isAbsolute(value) || path.win32.isAbsolute(value) || value.split(/[\\/]+/).includes("..")) {
          throw new Error(`${arg} must be a traversal-free workspace-relative path.`);
        }
        if (arg === "--report") parsed.reportPath = value;
        else parsed.projectPath = value;
      }
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!parsed.project && !parsed.projectPath && !parsed.reportPath) {
    throw new Error("Specify one of --project, --path, or --report.");
  }
  return parsed;
}

export function resolveTriageProject(args: Pick<ParsedArgs, "project" | "projectPath">): string {
  if (args.project) return existingDirectoryInside(path.join(PROJECTS_ROOT, args.project), PROJECTS_ROOT, "Project path");
  const candidate = path.resolve(WORKSPACE_ROOT, args.projectPath!);
  return existingDirectoryInside(candidate, PROJECTS_ROOT, "Project path");
}

function resolveExplicitReportPath(workspaceRelativePath: string): ResolvedTriageTarget {
  const candidate = path.resolve(WORKSPACE_ROOT, workspaceRelativePath);
  if (!fs.existsSync(candidate)) throw new Error("Report path does not exist.");
  const initial = fs.lstatSync(candidate);
  if (initial.isSymbolicLink()) throw new Error("Report path must not be a symbolic link.");
  const resolved = fs.realpathSync(candidate);
  if (!initial.isFile() || !isWithin(OUTPUT_ROOT, resolved)) {
    throw new Error("Report path must be a regular output JSON report.");
  }
  if (!/(?:^|\.)(?:production-report|visual-audit|audio-audit|encoding-audit)\.json$/i.test(path.basename(resolved))) {
    throw new Error("Report path may only select a production-report, visual-audit, audio-audit, or encoding-audit JSON artifact.");
  }
  const outputRelative = path.relative(OUTPUT_ROOT, resolved);
  const [projectId] = outputRelative.split(path.sep);
  if (!projectId || !PROJECT_ID.test(projectId)) throw new Error("Output report has no safe project identity.");
  return {
    projectPath: existingDirectoryInside(path.join(PROJECTS_ROOT, projectId), PROJECTS_ROOT, "Project path"),
    reportPath: resolved,
  };
}

/** Resolve either a project directory or one explicit retained output report. */
export function resolveTriageTarget(args: Pick<ParsedArgs, "project" | "projectPath" | "reportPath">): ResolvedTriageTarget {
  if (args.project) return { projectPath: resolveTriageProject(args) };
  if (args.reportPath) return resolveExplicitReportPath(args.reportPath);
  const candidate = path.resolve(WORKSPACE_ROOT, args.projectPath!);
  if (!fs.existsSync(candidate)) throw new Error("Path does not exist.");
  const stat = fs.lstatSync(candidate);
  if (stat.isSymbolicLink()) throw new Error("Path must not be a symbolic link.");
  if (stat.isDirectory()) return { projectPath: existingDirectoryInside(candidate, PROJECTS_ROOT, "Project path") };
  return resolveExplicitReportPath(args.projectPath!);
}

function readJsonSummary(file: string, bytes: number): TriageArtifact["json"] {
  if (bytes > MAX_JSON_BYTES) return { valid: false, reason: `JSON file exceeds ${MAX_JSON_BYTES} byte read limit.` };
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return { valid: true };
    const record = value as Record<string, unknown>;
    return {
      valid: true,
      status: record.status,
      failureKind: record.failureKind,
      phase: record.phase,
      error: record.error,
    };
  } catch (error) {
    return { valid: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

function inspectArtifact(root: string, relativePath: string): TriageArtifact {
  const file = path.join(root, relativePath);
  const displayPath = path.relative(WORKSPACE_ROOT, file).split(path.sep).join("/");
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile()) return { path: displayPath, exists: true, kind: "other" };
    const artifact: TriageArtifact = { path: displayPath, exists: true, kind: "file", bytes: stat.size };
    if (relativePath.endsWith(".json")) artifact.json = readJsonSummary(file, stat.size);
    return artifact;
  } catch (error: any) {
    if (error?.code === "ENOENT") return { path: displayPath, exists: false };
    throw error;
  }
}

function historyReports(projectPath: string): TriageArtifact[] {
  const results: TriageArtifact[] = [];
  const chunksPath = path.join(projectPath, "chunks");
  if (!fs.existsSync(chunksPath)) return results;

  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && /(?:^|\.)production-report\.json$/i.test(entry.name)) {
        results.push(inspectArtifact(projectPath, path.relative(projectPath, fullPath)));
      }
    }
  };
  walk(chunksPath);
  return results.sort((a, b) => a.path.localeCompare(b.path));
}

function outputHistoryReports(outputPath: string): TriageArtifact[] {
  const runsPath = path.join(outputPath, ".runs");
  if (!fs.existsSync(runsPath) || !fs.lstatSync(runsPath).isDirectory()) return [];
  const results: TriageArtifact[] = [];
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.isFile() && /(?:^|\.)production-report\.json$/i.test(entry.name)) {
        results.push(inspectArtifact(outputPath, path.relative(outputPath, fullPath)));
      }
    }
  };
  walk(runsPath);
  return results.sort((a, b) => a.path.localeCompare(b.path));
}

/** Collect known canonical artifacts without writing, spawning, or following links. */
export function collectTriageArtifacts(projectPath: string, includeHistory = false): TriageArtifactCollection {
  const resolvedProjectPath = existingDirectoryInside(projectPath, PROJECTS_ROOT, "Project path");
  const projectId = path.basename(resolvedProjectPath);
  const artifacts = PROJECT_ARTIFACTS.map((artifact) => inspectArtifact(resolvedProjectPath, artifact));
  const outputPath = path.join(OUTPUT_ROOT, projectId);
  if (fs.existsSync(outputPath) && fs.lstatSync(outputPath).isDirectory()) {
    const safeOutputPath = existingDirectoryInside(outputPath, OUTPUT_ROOT, "Output path");
    artifacts.push(...OUTPUT_ARTIFACTS.map((artifact) => inspectArtifact(safeOutputPath, artifact)));
    if (includeHistory) artifacts.push(...outputHistoryReports(safeOutputPath));
  } else {
    artifacts.push(...OUTPUT_ARTIFACTS.map((artifact) => ({
      path: path.relative(WORKSPACE_ROOT, path.join(outputPath, artifact)).split(path.sep).join("/"),
      exists: false,
    })));
  }
  if (includeHistory) artifacts.push(...historyReports(resolvedProjectPath));
  return { projectId, projectPath: resolvedProjectPath, includeHistory, artifacts };
}

function readArtifactJson(file: string): unknown | undefined {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > MAX_JSON_BYTES) return undefined;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/**
 * Classify only explicit failure evidence from the canonical output reports.
 * Missing or successful artifacts are deliberately not invented into failures.
 */
export function collectTriageFindings(collection: TriageArtifactCollection, selectedReportPath?: string): TriageFinding[] {
  const outputPath = path.join(OUTPUT_ROOT, collection.projectId);
  const productionReportPath = selectedReportPath && /production-report\.json$/i.test(selectedReportPath)
    ? selectedReportPath
    : path.join(outputPath, "video.production-report.json");
  const siblingPath = (kind: "visual" | "audio" | "encoding"): string => {
    const directory = path.dirname(productionReportPath);
    const candidates = [path.join(directory, `video.${kind}-audit.json`), path.join(directory, `${kind}-audit.json`)];
    return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
  };
  const selectedKind = selectedReportPath && /(?:production-report|visual-audit|audio-audit|encoding-audit)\.json$/i.test(selectedReportPath)
    ? path.basename(selectedReportPath).replace(/^video\./i, "").replace(/\.json$/i, "")
    : undefined;
  const visualAuditPath = selectedKind === "visual-audit" ? selectedReportPath! : siblingPath("visual");
  const audioAuditPath = selectedKind === "audio-audit" ? selectedReportPath! : siblingPath("audio");
  const encodingAuditPath = selectedKind === "encoding-audit" ? selectedReportPath! : siblingPath("encoding");
  const productionReport = /production-report\.json$/i.test(productionReportPath)
    ? readArtifactJson(productionReportPath)
    : undefined;
  const visualAudit = readArtifactJson(visualAuditPath);
  const audioAudit = readArtifactJson(audioAuditPath);
  const encodingAudit = readArtifactJson(encodingAuditPath);
  const production = object(productionReport);
  const visual = object(visualAudit);
  const audio = object(audioAudit);
  const encoding = object(encodingAudit);
  const reportPath = path.relative(WORKSPACE_ROOT, productionReportPath).split(path.sep).join("/");
  const visualPath = path.relative(WORKSPACE_ROOT, visualAuditPath).split(path.sep).join("/");
  const audioPath = path.relative(WORKSPACE_ROOT, audioAuditPath).split(path.sep).join("/");
  const encodingPath = path.relative(WORKSPACE_ROOT, encodingAuditPath).split(path.sep).join("/");

  if (selectedKind === "production-report") {
    if (production?.status === "candidate-ready") return [];
    return findingsFromProductionReport(productionReport, reportPath, {
      ...(visualAudit === undefined ? {} : { visualAudit, visualAuditPath: visualPath }),
      ...(audioAudit === undefined ? {} : { audioAudit, audioAuditPath: audioPath }),
      ...(encodingAudit === undefined ? {} : { encodingAudit, encodingAuditPath: encodingPath }),
    });
  }
  if (selectedKind === "visual-audit") {
    if (visual?.passed === true && (!Array.isArray(visual.failures) || visual.failures.length === 0)) return [];
    return findingsFromVisualAudit(visualAudit, visualPath);
  }
  if (selectedKind === "audio-audit") {
    if (audio?.passed === true) return [];
    return findingsFromDeliveryAudit(audioAudit, "audio", audioPath);
  }
  if (selectedKind === "encoding-audit") {
    if (encoding?.passed === true) return [];
    return findingsFromDeliveryAudit(encodingAudit, "encoding", encodingPath);
  }
  if (production?.status === "diagnostic") {
    return findingsFromProductionReport(productionReport, reportPath, {
      ...(visualAudit === undefined ? {} : { visualAudit, visualAuditPath: visualPath }),
      ...(audioAudit === undefined ? {} : { audioAudit, audioAuditPath: audioPath }),
      ...(encodingAudit === undefined ? {} : { encodingAudit, encodingAuditPath: encodingPath }),
    });
  }
  if (visual?.passed === false || (Array.isArray(visual?.failures) && visual.failures.length > 0)) {
    return findingsFromVisualAudit(visualAudit, visualPath);
  }
  if (audio?.passed === false) return findingsFromDeliveryAudit(audioAudit, "audio", audioPath);
  if (encoding?.passed === false) return findingsFromDeliveryAudit(encodingAudit, "encoding", encodingPath);
  return [];
}

export function collectTriageStatus(projectPath: string, includeHistory = false, selectedReportPath?: string): TriageStatusReport {
  const collection = collectTriageArtifacts(projectPath, includeHistory);
  if (selectedReportPath) {
    const selected = inspectArtifact(path.dirname(selectedReportPath), path.basename(selectedReportPath));
    if (!collection.artifacts.some((artifact) => artifact.path === selected.path)) collection.artifacts.push(selected);
  }
  return { ...collection, findings: collectTriageFindings(collection, selectedReportPath) };
}

function describeArtifact(artifact: TriageArtifact): string {
  if (!artifact.exists) return `  missing  ${artifact.path}`;
  if (artifact.kind !== "file") return `  other    ${artifact.path}`;
  if (!artifact.json) return `  present  ${artifact.path}`;
  if (!artifact.json.valid) return `  invalid  ${artifact.path} (${artifact.json.reason})`;
  const details = [artifact.json.status, artifact.json.failureKind, artifact.json.phase]
    .filter((value) => value !== undefined && value !== null)
    .map(String);
  return `  present  ${artifact.path}${details.length ? ` (${details.join(", ")})` : ""}`;
}

export function formatTriageArtifactCollection(collection: TriageStatusReport): string {
  const present = collection.artifacts.filter((artifact) => artifact.exists).length;
  const artifactLines = [
    `Triage artifacts: ${collection.projectId}`,
    `Project: ${path.relative(WORKSPACE_ROOT, collection.projectPath).split(path.sep).join("/")}`,
    `Found: ${present}/${collection.artifacts.length}`,
    ...collection.artifacts.map(describeArtifact),
  ];
  if (collection.findings.length) {
    artifactLines.push("", "Failure findings:", formatTriageResult(collection.findings));
  } else {
    artifactLines.push("", "No explicit failure evidence found in the selected or canonical reports.");
  }
  artifactLines.push("This is read-only triage; repair the earliest canonical failure and rerun its required Route A gates.");
  return artifactLines.join("\n");
}

function main(): void {
  try {
    const args = parseTriageArgs(process.argv.slice(2));
    const target = resolveTriageTarget(args);
    const collection = collectTriageStatus(target.projectPath, args.includeHistory, target.reportPath);
    if (args.json) console.log(JSON.stringify(collection, null, 2));
    else console.log(formatTriageArtifactCollection(collection));
  } catch (error) {
    console.error(`Triage input error: ${error instanceof Error ? error.message : String(error)}`);
    console.error(usage());
    process.exitCode = 2;
  }
}

if (require.main === module) main();
