import * as fs from "fs";
import * as path from "path";
import { checksumJson } from "../ai/transcriptCoverage";
import { isCSSBackground } from "../ai/backgroundResolver";
import { sha256File } from "../audio/prepareAudio";
import {
  ChunkPlan,
  ChunkRunConfig,
  ChunkStage,
  QualityScope,
  SemanticChunk,
  StageAttestation,
  assertSafeLineageId,
  isSafeLineageId,
  qualityScopeForChunk,
} from "../types/chunk";
import { Storyboard } from "../types/storyboard";
import { resolveAssetSrc } from "./assetPaths";

export const CHUNK_POLICY_VERSION = "route-a-chunks-v2";
export const CHUNK_ASSEMBLY_POLICY_VERSION = "sample-exact-chunk-concat-v3";
export const CHUNK_STAGES: ChunkStage[] = ["authoring", "tts", "alignment", "compile", "visual-proof"];
const HASH_PATTERN = /^[a-f0-9]{64}$/;

/** Invocation-local only: never reuse this cache across verification calls. */
export interface ArtifactDigestCache {
  artifactHashes: Map<string, string>;
}

export function createArtifactDigestCache(): ArtifactDigestCache {
  return { artifactHashes: new Map() };
}

export interface ChunkAttestationIssue {
  code:
    | "ATTESTATION_MISSING"
    | "ATTESTATION_MALFORMED"
    | "ATTESTATION_FAILED"
    | "ATTESTATION_STAGE_MISMATCH"
    | "ATTESTATION_CHUNK_MISMATCH"
    | "ATTESTATION_INPUT_DRIFT"
    | "ATTESTATION_OUTPUT_MISSING"
    | "ATTESTATION_OUTPUT_DRIFT";
  message: string;
}

export interface ChunkPipelinePaths {
  chunkDir: string;
  attestationDir: string;
  projection: string;
  scope: string;
  coreScope: string;
  ttsScenes: string;
  audio: string;
  durations: string;
  words: string;
  alignment: string;
  timeline: string;
  proofDir: string;
  proofStoryboard: string;
  proofTtsScenes: string;
  proofAudio: string;
  proofDurations: string;
  proofWords: string;
  proofAlignment: string;
  proofCorePcmVerification: string;
  proofTimeline: string;
  proofVideo: string;
}

export interface ChunkStageContractContext {
  projectDir: string;
  storyboardPath: string;
  planPath: string;
  runConfigPath: string;
  storyboard: Storyboard;
  plan: ChunkPlan;
  runConfig: ChunkRunConfig;
  /** Optional invocation-local cache used only while verifying an immutable snapshot. */
  digestCache?: ArtifactDigestCache;
}

export interface ChunkStageContract {
  chunk: SemanticChunk;
  scope: Extract<QualityScope, { kind: "chunk" }>;
  inputHashes: Record<string, string>;
  outputPaths: Record<string, string>;
  missingInputs: string[];
}

export function checksumArtifact(filePath: string, cache?: ArtifactDigestCache): string {
  const absolute = path.resolve(filePath);
  const stat = fs.statSync(absolute);
  const canonicalPath = process.platform === "win32" ? absolute.toLowerCase() : absolute;
  const identity = `${canonicalPath}\0${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  const cached = cache?.artifactHashes.get(identity);
  if (cached) return cached;

  const lower = path.extname(absolute).toLowerCase();
  let digest: string;
  if (lower !== ".json") {
    digest = sha256File(absolute);
  } else {
    try {
      digest = checksumJson(JSON.parse(fs.readFileSync(absolute, "utf8")));
    } catch {
      // A hand-corrupted JSON artifact is drift, not an unhandled verifier crash.
      digest = sha256File(absolute);
    }
  }
  cache?.artifactHashes.set(identity, digest);
  return digest;
}

function isStrictDescendant(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative.length > 0 && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function resolveContained(root: string, ...segments: string[]): string {
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, ...segments);
  if (!isStrictDescendant(resolvedRoot, candidate)) {
    throw new Error(`Resolved chunk path escapes its intended root: ${candidate} is not below ${resolvedRoot}.`);
  }
  return candidate;
}

/**
 * Stable public-audio namespace. Canonical projects/<id> paths retain <id>;
 * external or nested project aliases receive a path-derived suffix so two
 * same-named directories cannot write the same public audio artifacts.
 */
export function projectAudioIdentity(projectDir: string): string {
  const resolvedProject = path.resolve(projectDir);
  const projectsRoot = path.resolve("projects");
  const relative = path.relative(projectsRoot, resolvedProject);
  const isDirectCanonicalProject = relative.length > 0
    && !path.isAbsolute(relative)
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !relative.includes(path.sep)
    && isSafeLineageId(relative);
  if (isDirectCanonicalProject) return relative;

  const basename = path.basename(resolvedProject).toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "project";
  const normalized = process.platform === "win32" ? resolvedProject.toLowerCase() : resolvedProject;
  return `external-${basename}-${checksumJson({ projectPath: normalized }).slice(0, 16)}`;
}

export function chunkRunConfigPath(projectDir: string): string {
  const projectRoot = path.resolve(projectDir);
  const chunksRoot = resolveContained(projectRoot, "chunks");
  return resolveContained(chunksRoot, "chunk-run-config.json");
}

export function globalAuthoringReportPath(projectDir: string): string {
  const projectRoot = path.resolve(projectDir);
  const chunksRoot = resolveContained(projectRoot, "chunks");
  return resolveContained(chunksRoot, "global-authoring-report.json");
}

export function chunkPipelinePaths(projectDir: string, chunkId: string): ChunkPipelinePaths {
  // Reject before using the identifier in any path operation. Containment checks
  // below remain mandatory defense in depth if this validation is weakened later.
  assertSafeLineageId(chunkId, "Chunk id");

  const projectRoot = path.resolve(projectDir);
  const chunksRoot = resolveContained(projectRoot, "chunks");
  const chunkDir = resolveContained(chunksRoot, chunkId);
  const proofDir = resolveContained(chunkDir, "proof");
  const attestationDir = resolveContained(chunkDir, "attestations");

  const publicRoot = path.resolve("public");
  const publicAudioRoot = resolveContained(publicRoot, "audio");
  const publicChunkAudioRoot = resolveContained(publicAudioRoot, "chunks");
  const projectAudioRoot = resolveContained(publicChunkAudioRoot, projectAudioIdentity(projectRoot));
  const chunkAudioRoot = resolveContained(projectAudioRoot, chunkId);
  const chunkProofAudioRoot = resolveContained(chunkAudioRoot, "proof");

  return {
    chunkDir,
    attestationDir,
    projection: resolveContained(chunkDir, "storyboard.json"),
    scope: resolveContained(chunkDir, "quality-scope.json"),
    coreScope: resolveContained(chunkDir, "core-quality-scope.json"),
    ttsScenes: resolveContained(chunkDir, "tts_scenes.json"),
    audio: resolveContained(chunkAudioRoot, "voice.wav"),
    // Durations are deliberately adjacent to the timeline: render's measured
    // artifact-integrity gate resolves them from the timeline directory.
    durations: resolveContained(chunkDir, "durations.json"),
    words: resolveContained(resolveContained(chunkDir, "alignment"), "words.json"),
    alignment: resolveContained(resolveContained(chunkDir, "alignment"), "alignment.json"),
    timeline: resolveContained(chunkDir, "timeline.json"),
    proofDir,
    proofStoryboard: resolveContained(proofDir, "storyboard.json"),
    proofTtsScenes: resolveContained(proofDir, "tts_scenes.json"),
    proofAudio: resolveContained(chunkProofAudioRoot, "voice.wav"),
    proofDurations: resolveContained(proofDir, "durations.json"),
    proofWords: resolveContained(resolveContained(proofDir, "alignment"), "words.json"),
    proofAlignment: resolveContained(resolveContained(proofDir, "alignment"), "alignment.json"),
    proofCorePcmVerification: resolveContained(proofDir, "core-pcm-verification.json"),
    proofTimeline: resolveContained(proofDir, "timeline.json"),
    proofVideo: resolveContained(proofDir, "video.mp4"),
  };
}

export function stageAttestationPath(projectDir: string, chunkId: string, stage: ChunkStage): string {
  assertSafeLineageId(chunkId, "Chunk id");
  if (!CHUNK_STAGES.includes(stage)) throw new Error(`Unsupported chunk stage ${JSON.stringify(stage)}.`);
  const attestationRoot = chunkPipelinePaths(projectDir, chunkId).attestationDir;
  return resolveContained(attestationRoot, `${stage}.json`);
}

export function createChunkRunConfig(input: {
  projectDir: string;
  planPath: string;
  storyboard: Storyboard;
  globalAuthoringReportPath: string;
  ttsEngine?: "edge-tts" | "kokoro";
  voice: string;
  ttsLanguageCode?: string;
  ttsSpeed?: number;
  kokoroModelRevision?: string;
  kokoroModelDir?: string;
  alignModel: string;
  language?: string;
  thresholdProfileHash: string;
}): ChunkRunConfig {
  const engine = input.ttsEngine ?? "edge-tts";
  const tts: ChunkRunConfig["tts"] = engine === "kokoro"
    ? {
      engine,
      voice: input.voice,
      sampleRateHz: 24000,
      languageCode: input.ttsLanguageCode ?? "a",
      speed: input.ttsSpeed ?? 1,
      repoId: "hexgrad/Kokoro-82M",
      modelRevision: input.kokoroModelRevision ?? "main",
      modelDir: input.kokoroModelDir ? path.resolve(input.kokoroModelDir) : null,
      device: "cpu",
      gapPolicyVersion: "kokoro-gap-0.08-v1",
      gapSeconds: 0.08,
      terminalGapPolicy: "all-non-final-chunks",
    }
    : {
      engine,
      voice: input.voice,
      sampleRateHz: 24000,
      rate: "+0%",
      volume: "+0%",
      pitch: "+0Hz",
      gapPolicyVersion: "edge-gap-0.08-v1",
      gapSeconds: 0.08,
      terminalGapPolicy: "all-non-final-chunks",
    };
  return {
    schemaVersion: 1,
    projectId: path.basename(input.projectDir),
    policyVersion: CHUNK_POLICY_VERSION,
    planChecksum: checksumArtifact(input.planPath),
    storyboardChecksum: checksumJson(input.storyboard),
    globalAuthoringReportChecksum: checksumArtifact(input.globalAuthoringReportPath),
    tts,
    alignment: {
      engine: "faster-whisper",
      model: input.alignModel,
      language: input.language ?? null,
      device: "cpu",
      computeType: "int8",
      vadFilter: false,
    },
    compile: {
      policyVersion: "measured-route-a-v1",
      assetStyle: "production",
      scopePolicy: "exact-one-scene-halo-v1",
    },
    proof: {
      artifactRole: "chunk-proof",
      qualityProfileHash: input.thresholdProfileHash,
      scopePolicy: "exact-one-scene-halo-v1",
    },
  };
}

export function validateChunkRunConfig(
  value: unknown,
  expected: Pick<ChunkRunConfig, "projectId" | "policyVersion" | "planChecksum" | "storyboardChecksum">,
): string[] {
  if (!isRecord(value)) return ["Chunk run config must be an object."];
  const config = value as unknown as ChunkRunConfig;
  const issues: string[] = [];
  const rootKeys = ["schemaVersion", "projectId", "policyVersion", "planChecksum", "storyboardChecksum", "globalAuthoringReportChecksum", "tts", "alignment", "compile", "proof"];
  if (!sameKeys(value, Object.fromEntries(rootKeys.map((key) => [key, true])))) issues.push("Chunk run config fields are not exact.");
  if (config.schemaVersion !== 1) issues.push("Unsupported chunk run config schema.");
  if (config.projectId !== expected.projectId) issues.push("Chunk run config belongs to another project.");
  if (config.policyVersion !== expected.policyVersion) issues.push("Chunk run config policy changed.");
  if (config.planChecksum !== expected.planChecksum) issues.push("Chunk run config plan checksum drifted.");
  if (config.storyboardChecksum !== expected.storyboardChecksum) issues.push("Chunk run config storyboard checksum drifted.");
  if (!HASH_PATTERN.test(String(config.planChecksum ?? ""))
    || !HASH_PATTERN.test(String(config.storyboardChecksum ?? ""))
    || !HASH_PATTERN.test(String(config.globalAuthoringReportChecksum ?? ""))) {
    issues.push("Chunk run source hashes are malformed.");
  }
  if (isRecord(config.tts) && config.tts.engine === "edge-tts") {
    const ttsKeys = ["engine", "voice", "sampleRateHz", "rate", "volume", "pitch", "gapPolicyVersion", "gapSeconds", "terminalGapPolicy"];
    if (!sameKeys(config.tts, Object.fromEntries(ttsKeys.map((key) => [key, true])))
      || !nonempty(config.tts.voice) || config.tts.sampleRateHz !== 24000
      || config.tts.rate !== "+0%" || config.tts.volume !== "+0%" || config.tts.pitch !== "+0Hz"
      || config.tts.gapPolicyVersion !== "edge-gap-0.08-v1"
      || config.tts.gapSeconds !== 0.08 || config.tts.terminalGapPolicy !== "all-non-final-chunks") {
      issues.push("Chunk run Edge TTS configuration is malformed.");
    }
  } else if (isRecord(config.tts) && config.tts.engine === "kokoro") {
    const ttsKeys = [
      "engine", "voice", "sampleRateHz", "languageCode", "speed", "repoId", "modelRevision",
      "modelDir", "device", "gapPolicyVersion", "gapSeconds", "terminalGapPolicy",
    ];
    if (!sameKeys(config.tts, Object.fromEntries(ttsKeys.map((key) => [key, true])))
      || !nonempty(config.tts.voice) || config.tts.sampleRateHz !== 24000
      || !nonempty(config.tts.languageCode) || typeof config.tts.speed !== "number"
      || !Number.isFinite(config.tts.speed) || config.tts.speed <= 0
      || config.tts.repoId !== "hexgrad/Kokoro-82M" || !nonempty(config.tts.modelRevision)
      || !(config.tts.modelDir === null || nonempty(config.tts.modelDir)) || config.tts.device !== "cpu"
      || config.tts.gapPolicyVersion !== "kokoro-gap-0.08-v1"
      || config.tts.gapSeconds !== 0.08 || config.tts.terminalGapPolicy !== "all-non-final-chunks") {
      issues.push("Chunk run Kokoro TTS configuration is malformed.");
    }
  } else {
    issues.push("Chunk run TTS engine is unsupported.");
  }
  const alignmentKeys = ["engine", "model", "language", "device", "computeType", "vadFilter"];
  if (!isRecord(config.alignment) || !sameKeys(config.alignment, Object.fromEntries(alignmentKeys.map((key) => [key, true])))
    || config.alignment.engine !== "faster-whisper"
    || !nonempty(config.alignment.model) || !(config.alignment.language === null || nonempty(config.alignment.language))
    || config.alignment.device !== "cpu" || config.alignment.computeType !== "int8" || config.alignment.vadFilter !== false) {
    issues.push("Chunk run alignment configuration is malformed.");
  }
  const compileKeys = ["policyVersion", "assetStyle", "scopePolicy"];
  if (!isRecord(config.compile) || !sameKeys(config.compile, Object.fromEntries(compileKeys.map((key) => [key, true])))
    || config.compile.policyVersion !== "measured-route-a-v1"
    || config.compile.assetStyle !== "production" || config.compile.scopePolicy !== "exact-one-scene-halo-v1") {
    issues.push("Chunk run compile configuration is malformed.");
  }
  const proofKeys = ["artifactRole", "qualityProfileHash", "scopePolicy"];
  if (!isRecord(config.proof) || !sameKeys(config.proof, Object.fromEntries(proofKeys.map((key) => [key, true])))
    || config.proof.artifactRole !== "chunk-proof"
    || !HASH_PATTERN.test(String(config.proof.qualityProfileHash ?? ""))
    || config.proof.scopePolicy !== "exact-one-scene-halo-v1") {
    issues.push("Chunk run proof configuration is malformed.");
  }
  return issues;
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sameKeys(actual: Record<string, unknown>, expected: Record<string, unknown>): boolean {
  const left = Object.keys(actual).sort();
  const right = Object.keys(expected).sort();
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

function digestSemantic(value: unknown): string {
  return checksumJson(value);
}

function digestFile(filePath: string, logicalName: string, missing: string[], cache?: ArtifactDigestCache): string {
  if (!fs.existsSync(filePath)) {
    missing.push(`${logicalName}:${filePath}`);
    return digestSemantic({ missing: logicalName });
  }
  return checksumArtifact(filePath, cache);
}

function walkProductionFiles(root: string, directory: string, accept: (relative: string) => boolean, into: string[]): void {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walkProductionFiles(root, absolute, accept, into);
    } else {
      const relative = path.relative(root, absolute).replace(/\\/g, "/");
      if (accept(relative)) into.push(relative);
    }
  }
}

/**
 * Conservative snapshot of production code/config used by chunk stages. It is
 * intentionally broader than a hand-maintained import whitelist: transitive
 * helpers and orchestration/pass-decision changes must invalidate receipts.
 * Generated project artifacts and receipt directories are never traversed, so
 * the resulting receipt hash is not self-referential.
 */
export function productionToolchainFiles(): string[] {
  const root = path.resolve(__dirname, "../..");
  const files: string[] = [];
  walkProductionFiles(root, path.join(root, "src"), (relative) => /\.(?:ts|tsx|json)$/i.test(relative), files);
  walkProductionFiles(root, path.join(root, "scripts"), (relative) => {
    if (!/\.(?:ts|py)$/i.test(relative)) return false;
    if (relative.includes("/_archive/")) return false;
    return !/^test(?:[._-]|$)/i.test(path.basename(relative));
  }, files);
  walkProductionFiles(root, path.join(root, "config"), (relative) => /\.json$/i.test(relative), files);
  for (const relative of ["package.json", "package-lock.json", "tsconfig.json", "remotion.config.ts"]) {
    if (fs.existsSync(path.join(root, relative))) files.push(relative);
  }
  return [...new Set(files)].sort();
}

export function computeProductionCodeSnapshotHash(cache?: ArtifactDigestCache): string {
  const root = path.resolve(__dirname, "../..");
  const hashes = Object.fromEntries(productionToolchainFiles().map((relative) => [
    relative,
    checksumArtifact(path.join(root, relative), cache),
  ]));
  return digestSemantic(hashes);
}

function toolchainHash(stage: ChunkStage, cache?: ArtifactDigestCache): string {
  return digestSemantic({ stage, productionCodeSnapshot: computeProductionCodeSnapshotHash(cache) });
}

function referencedAssetMaterialHash(
  timelinePath: string,
  missing: string[],
  cache?: ArtifactDigestCache,
): string {
  if (!fs.existsSync(timelinePath)) {
    missing.push(`proofAssetTimeline:${timelinePath}`);
    return digestSemantic({ missing: "proofAssetTimeline" });
  }
  let timeline: any;
  try {
    timeline = JSON.parse(fs.readFileSync(timelinePath, "utf8"));
  } catch {
    missing.push(`proofAssetTimelineMalformed:${timelinePath}`);
    return digestSemantic({ malformed: "proofAssetTimeline" });
  }
  const refs = new Set<string>();
  for (const scene of timeline.scenes ?? []) {
    const background = scene.backgroundSrc;
    if (typeof background === "string" && background && !isCSSBackground(background)) refs.add(background);
    for (const entity of scene.entities ?? []) if (nonempty(entity?.src)) refs.add(entity.src);
    for (const card of scene.cards ?? []) if (nonempty(card?.iconSrc)) refs.add(card.iconSrc);
    for (const frame of scene.frameBoxes ?? []) if (nonempty(frame?.contentSrc)) refs.add(frame.contentSrc);
  }
  const publicRoot = path.resolve("public");
  const hashes: Record<string, string> = {};
  for (const ref of [...refs].sort()) {
    const physical = resolveAssetSrc(ref).replace(/^[/\\]+/, "");
    const absolute = path.join(publicRoot, physical);
    hashes[ref] = digestFile(absolute, `asset:${ref}`, missing, cache);
  }
  return digestSemantic(hashes);
}

export function computeExpectedChunkStageContract(
  context: ChunkStageContractContext,
  chunkId: string,
  stage: ChunkStage,
): ChunkStageContract {
  assertSafeLineageId(chunkId, "Chunk id");
  const index = context.plan.chunks.findIndex((item) => item.id === chunkId);
  if (index < 0) throw new Error(`Unknown planned chunk ${chunkId}.`);
  const chunk = context.plan.chunks[index];
  const scope = qualityScopeForChunk(context.plan, chunkId) as Extract<QualityScope, { kind: "chunk" }>;
  const paths = chunkPipelinePaths(context.projectDir, chunkId);
  const missingInputs: string[] = [];
  const file = (filePath: string, name: string) => digestFile(filePath, name, missingInputs, context.digestCache);
  const receipt = (id: string, priorStage: ChunkStage) => file(stageAttestationPath(context.projectDir, id, priorStage), `${id}:${priorStage}:attestation`);
  const configHash = file(context.runConfigPath, "runConfig");
  const manifestPath = path.resolve("public", "assets.manifest.json");
  const terminalGap = index + 1 < context.plan.chunks.length;

  let inputHashes: Record<string, string>;
  let outputPaths: Record<string, string>;
  switch (stage) {
    case "authoring": {
      const previous = context.plan.chunks[index - 1];
      inputHashes = {
        storyboard: digestSemantic(context.storyboard),
        plan: file(context.planPath, "plan"),
        chunk: digestSemantic(chunk),
        scope: digestSemantic(scope),
        globalAuthoringReport: file(globalAuthoringReportPath(context.projectDir), "globalAuthoringReport"),
        runConfig: configHash,
        previousVisualProof: previous ? receipt(previous.id, "visual-proof") : digestSemantic(null),
        toolchain: toolchainHash(stage, context.digestCache),
      };
      outputPaths = { storyboard: paths.projection, scope: paths.scope, coreScope: paths.coreScope, proofStoryboard: paths.proofStoryboard };
      break;
    }
    case "tts":
      inputHashes = {
        storyboard: file(paths.projection, "storyboard"),
        authoring: receipt(chunkId, "authoring"),
        runConfig: configHash,
        ttsConfig: digestSemantic(context.runConfig.tts),
        terminalGap: digestSemantic(terminalGap),
        toolchain: toolchainHash(stage, context.digestCache),
      };
      outputPaths = { scenes: paths.ttsScenes, audio: paths.audio, durations: paths.durations };
      break;
    case "alignment":
      inputHashes = {
        audio: file(paths.audio, "audio"),
        scenes: file(paths.ttsScenes, "ttsScenes"),
        tts: receipt(chunkId, "tts"),
        runConfig: configHash,
        alignmentConfig: digestSemantic(context.runConfig.alignment),
        toolchain: toolchainHash(stage, context.digestCache),
      };
      outputPaths = { words: paths.words, alignment: paths.alignment };
      break;
    case "compile":
      inputHashes = {
        storyboard: file(paths.projection, "storyboard"),
        audio: file(paths.audio, "audio"),
        durations: file(paths.durations, "durations"),
        words: file(paths.words, "words"),
        alignment: file(paths.alignment, "alignment"),
        alignmentAttestation: receipt(chunkId, "alignment"),
        scope: file(paths.scope, "scope"),
        coreScope: file(paths.coreScope, "coreScope"),
        runConfig: configHash,
        compileConfig: digestSemantic(context.runConfig.compile),
        assetsManifest: file(manifestPath, "assetsManifest"),
        toolchain: toolchainHash(stage, context.digestCache),
      };
      outputPaths = { timeline: paths.timeline };
      break;
    case "visual-proof":
      inputHashes = {
        timeline: file(paths.timeline, "coreTimeline"),
        audio: file(paths.audio, "coreAudio"),
        authoring: receipt(chunkId, "authoring"),
        tts: receipt(chunkId, "tts"),
        alignment: receipt(chunkId, "alignment"),
        compile: receipt(chunkId, "compile"),
        scope: file(paths.scope, "scope"),
        runConfig: configHash,
        proofConfig: digestSemantic(context.runConfig.proof),
        qualityProfile: context.runConfig.proof.qualityProfileHash,
        assetsManifest: file(manifestPath, "assetsManifest"),
        proofAssetMaterial: referencedAssetMaterialHash(paths.proofTimeline, missingInputs, context.digestCache),
        toolchain: toolchainHash(stage, context.digestCache),
      };
      outputPaths = {
        proofStoryboard: paths.proofStoryboard,
        proofTtsScenes: paths.proofTtsScenes,
        proofAudio: paths.proofAudio,
        proofDurations: paths.proofDurations,
        proofWords: paths.proofWords,
        proofAlignment: paths.proofAlignment,
        proofCorePcmVerification: paths.proofCorePcmVerification,
        proofTimeline: paths.proofTimeline,
        video: paths.proofVideo,
        contactSheet: paths.proofVideo.replace(/\.mp4$/i, ".contact.jpg"),
        visualAudit: paths.proofVideo.replace(/\.mp4$/i, ".visual-audit.json"),
        audioAudit: paths.proofVideo.replace(/\.mp4$/i, ".audio-audit.json"),
        encodingAudit: paths.proofVideo.replace(/\.mp4$/i, ".encoding-audit.json"),
        report: paths.proofVideo.replace(/\.mp4$/i, ".production-report.json"),
      };
      break;
  }
  return { chunk, scope, inputHashes, outputPaths, missingInputs };
}

export function createStageAttestation(input: Omit<StageAttestation, "schemaVersion" | "completedAt"> & {
  completedAt?: string;
}): StageAttestation {
  assertSafeLineageId(input.chunkId, "Attested chunk id");
  if (!CHUNK_STAGES.includes(input.stage)) throw new Error(`Unsupported chunk stage ${JSON.stringify(input.stage)}.`);
  return {
    schemaVersion: 2,
    ...input,
    completedAt: input.completedAt ?? new Date().toISOString(),
  };
}

/** Writes atomically so a killed checkpoint never looks complete on resume. */
export function writeStageAttestation(filePath: string, attestation: StageAttestation): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(attestation, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, filePath);
}

export function readStageAttestation(filePath: string): StageAttestation | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as StageAttestation;
  } catch {
    return undefined;
  }
}

export function verifyStageAttestation(
  attestation: StageAttestation | undefined,
  expected: {
    chunkId: string;
    stage: ChunkStage;
    inputHashes: Record<string, string>;
    outputPaths?: Record<string, string>;
    policyVersion: string;
    thresholdProfileHash: string;
    digestCache?: ArtifactDigestCache;
  },
): ChunkAttestationIssue[] {
  if (!attestation) return [{ code: "ATTESTATION_MISSING", message: `Missing ${expected.stage} attestation for ${expected.chunkId}.` }];
  const raw = attestation as unknown;
  const requiredKeys = [
    "schemaVersion", "chunkId", "stage", "inputHashes", "outputHashes", "policyVersion",
    "thresholdProfileHash", "passed", "blockerCount", "majorCount", "completedAt",
  ];
  if (!isRecord(raw) || !sameKeys(raw, Object.fromEntries(requiredKeys.map((key) => [key, true])))
    || raw.schemaVersion !== 2 || !isSafeLineageId(raw.chunkId) || !CHUNK_STAGES.includes(raw.stage as ChunkStage)
    || !nonempty(raw.policyVersion) || typeof raw.thresholdProfileHash !== "string" || !HASH_PATTERN.test(raw.thresholdProfileHash)
    || !nonempty(raw.completedAt) || !Number.isFinite(Date.parse(raw.completedAt))
    || typeof raw.passed !== "boolean" || !Number.isInteger(raw.blockerCount) || Number(raw.blockerCount) < 0
    || !Number.isInteger(raw.majorCount) || Number(raw.majorCount) < 0
    || !isRecord(raw.inputHashes) || !isRecord(raw.outputHashes)
    || Object.values(raw.inputHashes).some((hash) => typeof hash !== "string" || !HASH_PATTERN.test(hash))
    || Object.values(raw.outputHashes).some((hash) => typeof hash !== "string" || !HASH_PATTERN.test(hash))) {
    return [{ code: "ATTESTATION_MALFORMED", message: `Malformed ${expected.stage} attestation for ${expected.chunkId}.` }];
  }
  const checked = raw as unknown as StageAttestation;
  if (checked.chunkId !== expected.chunkId) return [{
    code: "ATTESTATION_CHUNK_MISMATCH",
    message: `Attestation belongs to ${checked.chunkId}, expected ${expected.chunkId}.`,
  }];
  if (checked.stage !== expected.stage) return [{
    code: "ATTESTATION_STAGE_MISMATCH",
    message: `Attestation stage is ${checked.stage}, expected ${expected.stage}.`,
  }];
  if (!checked.passed || checked.blockerCount > 0 || checked.majorCount > 0) return [{
    code: "ATTESTATION_FAILED",
    message: `${expected.stage} attestation for ${expected.chunkId} did not pass.`,
  }];
  if (checked.policyVersion !== expected.policyVersion || checked.thresholdProfileHash !== expected.thresholdProfileHash) return [{
    code: "ATTESTATION_INPUT_DRIFT",
    message: `${expected.stage} policy/profile changed after ${expected.chunkId} was checked.`,
  }];
  if (!sameKeys(checked.inputHashes, expected.inputHashes)) return [{
    code: "ATTESTATION_INPUT_DRIFT",
    message: `${expected.stage} input set changed for ${expected.chunkId}.`,
  }];
  for (const [name, hash] of Object.entries(expected.inputHashes)) {
    if (checked.inputHashes[name] !== hash) return [{
      code: "ATTESTATION_INPUT_DRIFT",
      message: `${expected.stage} input "${name}" changed for ${expected.chunkId} (${checked.inputHashes[name]?.slice(0, 12)} != ${hash.slice(0, 12)}).`,
    }];
  }
  const outputPaths = expected.outputPaths ?? {};
  if (!sameKeys(checked.outputHashes, outputPaths)) return [{
    code: "ATTESTATION_OUTPUT_DRIFT",
    message: `${expected.stage} output set changed for ${expected.chunkId}.`,
  }];
  for (const [name, filePath] of Object.entries(outputPaths)) {
    if (!fs.existsSync(filePath)) return [{
      code: "ATTESTATION_OUTPUT_MISSING",
      message: `${expected.stage} output "${name}" is missing for ${expected.chunkId}.`,
    }];
    const actual = checksumArtifact(filePath, expected.digestCache);
    if (checked.outputHashes[name] !== actual) return [{
      code: "ATTESTATION_OUTPUT_DRIFT",
      message: `${expected.stage} output "${name}" changed after attestation for ${expected.chunkId}.`,
    }];
  }
  return [];
}

export function verifyChunkStage(
  context: ChunkStageContractContext,
  chunkId: string,
  stage: ChunkStage,
): ChunkAttestationIssue[] {
  const contract = computeExpectedChunkStageContract(context, chunkId, stage);
  return verifyStageAttestation(readStageAttestation(stageAttestationPath(context.projectDir, chunkId, stage)), {
    chunkId,
    stage,
    inputHashes: contract.inputHashes,
    outputPaths: contract.outputPaths,
    policyVersion: CHUNK_POLICY_VERSION,
    thresholdProfileHash: context.runConfig.proof.qualityProfileHash,
    digestCache: context.digestCache,
  });
}
