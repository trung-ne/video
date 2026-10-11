import * as fs from "fs";
import * as path from "path";
import { checksumJson } from "../ai/transcriptCoverage";
import type { Storyboard } from "../types/storyboard";
import {
  ChunkPlan,
  ChunkQualityScope,
  ChunkRunConfig,
  parseQualityScope,
  qualityScopeForChunk,
  verifyCanonicalChunkPlan,
} from "../types/chunk";
import {
  CHUNK_POLICY_VERSION,
  checksumArtifact,
  chunkPipelinePaths,
  chunkRunConfigPath,
  validateChunkRunConfig,
} from "./chunkAttestations";
import { projectStoryboardForChunk, projectStoryboardForQualityScope } from "./chunkAssembly";
import { sameResolvedPath } from "./publicationIntegrity";

export interface ChunkProofBinding {
  schemaVersion: 1;
  projectId: string;
  projectPath: string;
  chunkId: string;
  storyboardPath: string;
  storyboardChecksum: string;
  planPath: string;
  planChecksum: string;
  runConfigPath: string;
  runConfigChecksum: string;
  qualityScopePath: string;
  qualityScopeChecksum: string;
  proofTimelinePath: string;
  qualityProfileHash: string;
}

export interface ChunkCompilationBinding extends ChunkProofBinding {
  artifactRole: "chunk-core" | "chunk-proof";
  compiledStoryboardPath: string;
  compiledStoryboardChecksum: string;
  effectiveQualityScope: ChunkQualityScope;
  additionalScopePath?: string;
  additionalScopeChecksum?: string;
  projectOpeningSceneId: string;
}

function readJson(filePath: string, label: string): unknown {
  if (!fs.existsSync(filePath)) throw new Error(`${label} is missing: ${filePath}`);
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${(error as Error).message}`);
  }
}

function nearestChunksRoot(filePath: string): string | null {
  let current = path.dirname(path.resolve(filePath));
  while (true) {
    if (path.basename(current).toLowerCase() === "chunks") return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return checksumJson(left) === checksumJson(right);
}

/**
 * Bind a canonical project chunk proof to the deterministic plan and immutable
 * run config. Standalone proof fixtures outside a chunks/ tree have no project
 * context and return null; once either path enters chunks/, lineage is required.
 */
export function bindChunkProofToProject(options: {
  timelinePath: string;
  scopePath: string;
  outputPath: string;
  scope: ChunkQualityScope;
  qualityProfile: unknown;
}): ChunkProofBinding | null {
  const timelineChunksRoot = nearestChunksRoot(options.timelinePath);
  const scopeChunksRoot = nearestChunksRoot(options.scopePath);
  if (!timelineChunksRoot && !scopeChunksRoot) return null;
  if (!timelineChunksRoot || !scopeChunksRoot || !sameResolvedPath(timelineChunksRoot, scopeChunksRoot)) {
    throw new Error("Chunk proof timeline and quality scope do not belong to the same chunks/ tree.");
  }

  const chunksRoot = fs.realpathSync(timelineChunksRoot);
  const projectPath = fs.realpathSync(path.dirname(chunksRoot));
  const projectId = path.basename(projectPath);
  const relativeTimeline = path.relative(chunksRoot, path.resolve(options.timelinePath)).split(path.sep);
  if (relativeTimeline.length !== 3
      || relativeTimeline[1].toLowerCase() !== "proof"
      || relativeTimeline[2].toLowerCase() !== "timeline.json") {
    throw new Error("Chunk proof timeline must use <project>/chunks/<chunkId>/proof/timeline.json.");
  }
  const chunkId = relativeTimeline[0];
  if (chunkId !== options.scope.chunkId) {
    throw new Error(`Chunk proof path identifies ${chunkId}, but the scope identifies ${options.scope.chunkId}.`);
  }

  const paths = chunkPipelinePaths(projectPath, chunkId);
  const planPath = path.join(chunksRoot, "chunk-plan.json");
  const runConfigPath = chunkRunConfigPath(projectPath);
  const storyboardPath = path.join(projectPath, "storyboard.json");
  for (const [actual, expected, label] of [
    [options.timelinePath, paths.proofTimeline, "timeline"],
    [options.scopePath, paths.scope, "quality scope"],
    [options.outputPath, paths.proofVideo, "output"],
  ] as const) {
    if (!sameResolvedPath(actual, expected)) {
      throw new Error(`Chunk proof ${label} path is noncanonical: expected ${expected}; got ${path.resolve(actual)}.`);
    }
  }

  const storyboard = readJson(storyboardPath, "Complete project storyboard") as Storyboard;
  const plan = readJson(planPath, "Chunk plan") as ChunkPlan;
  const runConfig = readJson(runConfigPath, "Chunk run config") as ChunkRunConfig;
  const persistedScope = parseQualityScope(readJson(paths.scope, "Chunk quality scope"));
  if (persistedScope.kind !== "chunk") throw new Error("Canonical chunk quality scope must have kind=chunk.");

  const planIssues = verifyCanonicalChunkPlan(storyboard, plan, projectId);
  if (planIssues.length) {
    throw new Error(`Chunk plan is not canonical: ${planIssues.map((issue) => issue.message).join(" ")}`);
  }
  const storyboardChecksum = checksumJson(storyboard);
  const planChecksum = checksumArtifact(planPath);
  const runIssues = validateChunkRunConfig(runConfig, {
    projectId,
    policyVersion: CHUNK_POLICY_VERSION,
    planChecksum,
    storyboardChecksum,
  });
  if (runIssues.length) throw new Error(`Chunk run config is invalid: ${runIssues.join(" ")}`);

  const expectedScope = qualityScopeForChunk(plan, chunkId);
  if (!sameJson(options.scope, expectedScope) || !sameJson(persistedScope, expectedScope)) {
    throw new Error("Chunk proof quality scope differs from the scope derived from the canonical plan.");
  }
  const qualityProfileHash = checksumJson(options.qualityProfile);
  if (runConfig.proof.qualityProfileHash !== qualityProfileHash) {
    throw new Error("Chunk proof quality profile differs from the immutable run config.");
  }

  return {
    schemaVersion: 1,
    projectId,
    projectPath,
    chunkId,
    storyboardPath,
    storyboardChecksum,
    planPath,
    planChecksum,
    runConfigPath,
    runConfigChecksum: checksumArtifact(runConfigPath),
    qualityScopePath: paths.scope,
    qualityScopeChecksum: checksumJson(expectedScope),
    proofTimelinePath: paths.proofTimeline,
    qualityProfileHash,
  };
}

function projectPathForScopedCompilation(outputPath: string): string {
  const chunksRoot = nearestChunksRoot(outputPath);
  if (!chunksRoot) {
    throw new Error("Scoped compilation is reserved for a canonical project chunks/ artifact.");
  }
  if (!fs.existsSync(chunksRoot)) {
    throw new Error(`Canonical chunks directory is missing: ${chunksRoot}`);
  }
  return fs.realpathSync(path.dirname(fs.realpathSync(chunksRoot)));
}

function exactProjectedStoryboard(
  actualPath: string,
  expectedPath: string,
  expected: Storyboard,
  label: string,
): string {
  if (!sameResolvedPath(actualPath, expectedPath)) {
    throw new Error(`${label} path is noncanonical: expected ${expectedPath}; got ${path.resolve(actualPath)}.`);
  }
  const actual = readJson(actualPath, label);
  if (!sameJson(actual, expected)) {
    throw new Error(`${label} differs from the deterministic projection of the complete project storyboard.`);
  }
  return checksumJson(actual);
}

/**
 * Compile-time binding for the only caller-supplied quality scope: the exact
 * halo proof projection under <project>/chunks/<chunkId>/proof/. Canonical
 * project timelines and standalone subsets intentionally have no scoped mode.
 */
export function bindChunkProofCompilationToProject(options: {
  storyboardPath: string;
  outputPath: string;
  scopePath: string;
  scope: ChunkQualityScope;
  qualityProfile: unknown;
}): ChunkCompilationBinding {
  const projectPath = projectPathForScopedCompilation(options.outputPath);
  const paths = chunkPipelinePaths(projectPath, options.scope.chunkId);
  if (!sameResolvedPath(options.outputPath, paths.proofTimeline)) {
    throw new Error(`Scoped chunk-proof output path is noncanonical: expected ${paths.proofTimeline}; got ${path.resolve(options.outputPath)}.`);
  }

  const binding = bindChunkProofToProject({
    timelinePath: options.outputPath,
    scopePath: options.scopePath,
    outputPath: paths.proofVideo,
    scope: options.scope,
    qualityProfile: options.qualityProfile,
  });
  if (!binding) throw new Error("Scoped compilation must be bound to a canonical project chunk plan and run config.");

  const completeStoryboard = readJson(binding.storyboardPath, "Complete project storyboard") as Storyboard;
  const expectedProjection = projectStoryboardForQualityScope(completeStoryboard, options.scope);
  const compiledStoryboardChecksum = exactProjectedStoryboard(
    options.storyboardPath,
    paths.proofStoryboard,
    expectedProjection,
    "Chunk proof storyboard",
  );
  const projectOpeningSceneId = completeStoryboard.scenes?.[0]?.id;
  if (!projectOpeningSceneId) throw new Error("Complete project storyboard has no opening scene identity.");

  return {
    ...binding,
    artifactRole: "chunk-proof",
    compiledStoryboardPath: paths.proofStoryboard,
    compiledStoryboardChecksum,
    effectiveQualityScope: options.scope,
    projectOpeningSceneId,
  };
}

/**
 * The chunk-core compiler mode is internal to the checkpoint runner. It derives
 * its scene-local scope from the canonical plan instead of accepting a caller's
 * --quality-scope, while keeping video-level checks on the full project gates.
 */
export function bindChunkCoreCompilationToProject(options: {
  storyboardPath: string;
  outputPath: string;
  qualityProfile: unknown;
}): ChunkCompilationBinding {
  const projectPath = projectPathForScopedCompilation(options.outputPath);
  const chunksRoot = path.join(projectPath, "chunks");
  const relativeOutput = path.relative(chunksRoot, path.resolve(options.outputPath)).split(path.sep);
  if (relativeOutput.length !== 2 || relativeOutput[1].toLowerCase() !== "timeline.json") {
    throw new Error("Chunk-core output must use <project>/chunks/<chunkId>/timeline.json.");
  }
  const chunkId = relativeOutput[0];
  const paths = chunkPipelinePaths(projectPath, chunkId);
  if (!sameResolvedPath(options.outputPath, paths.timeline)) {
    throw new Error(`Chunk-core output path is noncanonical: expected ${paths.timeline}; got ${path.resolve(options.outputPath)}.`);
  }

  const persistedScope = parseQualityScope(readJson(paths.scope, "Chunk quality scope"));
  if (persistedScope.kind !== "chunk") throw new Error("Canonical chunk quality scope must have kind=chunk.");
  const binding = bindChunkProofToProject({
    timelinePath: paths.proofTimeline,
    scopePath: paths.scope,
    outputPath: paths.proofVideo,
    scope: persistedScope,
    qualityProfile: options.qualityProfile,
  });
  if (!binding) throw new Error("Chunk-core compilation must be bound to a canonical project chunk plan and run config.");

  const completeStoryboard = readJson(binding.storyboardPath, "Complete project storyboard") as Storyboard;
  const plan = readJson(binding.planPath, "Chunk plan") as ChunkPlan;
  const chunk = plan.chunks.find((candidate) => candidate.id === chunkId);
  if (!chunk) throw new Error(`Canonical chunk plan does not contain ${chunkId}.`);
  const expectedProjection = projectStoryboardForChunk(completeStoryboard, chunk);
  const compiledStoryboardChecksum = exactProjectedStoryboard(
    options.storyboardPath,
    paths.projection,
    expectedProjection,
    "Chunk core storyboard",
  );

  const expectedFullScope = qualityScopeForChunk(plan, chunkId);
  const expectedCoreScope: ChunkQualityScope = {
    ...expectedFullScope,
    haloBeforeSceneIds: [],
    haloAfterSceneIds: [],
  };
  const persistedCoreScope = parseQualityScope(readJson(paths.coreScope, "Chunk core quality scope"));
  if (persistedCoreScope.kind !== "chunk" || !sameJson(persistedCoreScope, expectedCoreScope)) {
    throw new Error("Chunk core quality scope differs from the scope derived from the canonical plan.");
  }
  const projectOpeningSceneId = completeStoryboard.scenes?.[0]?.id;
  if (!projectOpeningSceneId) throw new Error("Complete project storyboard has no opening scene identity.");

  return {
    ...binding,
    artifactRole: "chunk-core",
    compiledStoryboardPath: paths.projection,
    compiledStoryboardChecksum,
    effectiveQualityScope: expectedCoreScope,
    additionalScopePath: paths.coreScope,
    additionalScopeChecksum: checksumJson(expectedCoreScope),
    projectOpeningSceneId,
  };
}

export function assertChunkCompilationBindingUnchanged(binding: ChunkCompilationBinding): void {
  assertChunkProofBindingUnchanged(binding);
  if (!fs.existsSync(binding.compiledStoryboardPath)
      || checksumArtifact(binding.compiledStoryboardPath) !== binding.compiledStoryboardChecksum) {
    throw new Error(`Chunk ${binding.artifactRole} storyboard changed while compiling.`);
  }
  if (binding.additionalScopePath && binding.additionalScopeChecksum
      && (!fs.existsSync(binding.additionalScopePath)
        || checksumArtifact(binding.additionalScopePath) !== binding.additionalScopeChecksum)) {
    throw new Error(`Chunk ${binding.artifactRole} quality scope changed while compiling.`);
  }
}

export function assertChunkProofBindingUnchanged(binding: ChunkProofBinding): void {
  const checks: Array<[string, string, string]> = [
    [binding.storyboardPath, binding.storyboardChecksum, "storyboard"],
    [binding.planPath, binding.planChecksum, "chunk plan"],
    [binding.runConfigPath, binding.runConfigChecksum, "chunk run config"],
    [binding.qualityScopePath, binding.qualityScopeChecksum, "quality scope"],
  ];
  for (const [filePath, expected, label] of checks) {
    if (!fs.existsSync(filePath) || checksumArtifact(filePath) !== expected) {
      throw new Error(`Chunk proof ${label} changed while rendering.`);
    }
  }
}
