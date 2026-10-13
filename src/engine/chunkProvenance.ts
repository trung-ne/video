import * as fs from "fs";
import * as path from "path";
import { checksumJson, indexTranscript } from "../ai/transcriptCoverage";
import {
  ChunkAssemblyProvenance,
  ChunkAssemblyToolchainHashes,
  ChunkPlan,
  ChunkRunConfig,
  isLongVideoWordCount,
  isSafeLineageId,
  verifyCanonicalChunkPlan,
} from "../types/chunk";
import { Storyboard } from "../types/storyboard";
import {
  CHUNK_ASSEMBLY_POLICY_VERSION,
  CHUNK_POLICY_VERSION,
  CHUNK_STAGES,
  ArtifactDigestCache,
  ChunkStageContractContext,
  checksumArtifact,
  chunkPipelinePaths,
  chunkRunConfigPath,
  globalAuthoringReportPath,
  computeProductionCodeSnapshotHash,
  createArtifactDigestCache,
  projectAudioIdentity,
  stageAttestationPath,
  validateChunkRunConfig,
  verifyChunkStage,
} from "./chunkAttestations";
import qualityProfile from "../../config/reference-quality.json";

const PROFILE_HASH = checksumJson(qualityProfile);
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const ASSEMBLY_TOOLCHAIN_FILES = {
  assemblyOrchestrator: "scripts/assemble-storyboard-chunks.ts",
  audioAssembler: "scripts/assemble-chunk-audio.py",
  ttsSceneBuilder: "scripts/storyboard-to-tts.ts",
  timelineCompiler: "scripts/compile-storyboard.ts",
} as const;

/** Direct entrypoint hashes plus the broad transitive production-code snapshot. */
export function computeChunkAssemblyToolchainHashes(cache?: ArtifactDigestCache): ChunkAssemblyToolchainHashes {
  const root = path.resolve(__dirname, "../..");
  return {
    productionCodeSnapshot: computeProductionCodeSnapshotHash(cache),
    assemblyOrchestrator: checksumArtifact(path.join(root, ASSEMBLY_TOOLCHAIN_FILES.assemblyOrchestrator), cache),
    audioAssembler: checksumArtifact(path.join(root, ASSEMBLY_TOOLCHAIN_FILES.audioAssembler), cache),
    ttsSceneBuilder: checksumArtifact(path.join(root, ASSEMBLY_TOOLCHAIN_FILES.ttsSceneBuilder), cache),
    timelineCompiler: checksumArtifact(path.join(root, ASSEMBLY_TOOLCHAIN_FILES.timelineCompiler), cache),
  };
}

export interface ChunkProvenanceIssue { code: string; message: string; }

function issue(code: string, message: string): ChunkProvenanceIssue[] {
  return [{ code, message }];
}

function readJson<T>(filePath: string): T | undefined {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")) as T; }
  catch { return undefined; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sameKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function hashMap(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every((hash) => typeof hash === "string" && HASH_PATTERN.test(hash));
}

function timelineBodyHash(timeline: any): string {
  const body = { ...timeline };
  delete body.chunkAssemblyProvenance;
  return checksumJson(body);
}

function maximumDeclaredSourceWordCount(storyboard: Storyboard | undefined): number {
  let maximum = 0;
  const sections = Array.isArray(storyboard?.sections) ? storyboard.sections : [];
  const scenes = Array.isArray(storyboard?.scenes) ? storyboard.scenes : [];
  for (const item of [...sections, ...scenes]) {
    const endWord = item.sourceRange?.endWord;
    if (Number.isInteger(endWord) && Number(endWord) >= 0) maximum = Math.max(maximum, Number(endWord) + 1);
  }
  return maximum;
}

function narrationWordCount(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  const narration = value
    .map((item) => isRecord(item) && typeof item.narration === "string" ? item.narration : "")
    .join("\n");
  return indexTranscript(narration).length;
}

/** Marker deletion cannot turn current long-form authored content into a short project. */
function hasLongVideoMarker(projectDir: string, timeline: any): boolean {
  if (timeline?.chunkAssemblyProvenance) return true;
  if (fs.existsSync(chunkRunConfigPath(projectDir)) || fs.existsSync(path.join(projectDir, "chunk-assembly-provenance.json"))) return true;

  const storyboard = readJson<Storyboard>(path.join(projectDir, "storyboard.json"));
  const decision = storyboard?.authoringDecision;
  if (decision?.longVideo === true || decision?.sectionsRequired === true) return true;

  const transcriptPath = path.join(projectDir, "transcript.txt");
  let transcriptWords = 0;
  if (fs.existsSync(transcriptPath)) {
    try { transcriptWords = indexTranscript(fs.readFileSync(transcriptPath, "utf8")).length; }
    catch { transcriptWords = 0; }
  }
  const decisionTranscriptWords = Number(decision?.transcriptWords);
  const candidates = [
    Number.isInteger(decisionTranscriptWords) && decisionTranscriptWords >= 0 ? decisionTranscriptWords : 0,
    maximumDeclaredSourceWordCount(storyboard),
    narrationWordCount(storyboard?.scenes),
    narrationWordCount(timeline?.scenes),
    transcriptWords,
  ];
  return candidates.some((wordCount) => isLongVideoWordCount(wordCount));
}

export function chunkAssemblyProvenanceShapeIssues(value: unknown): string[] {
  if (!isRecord(value)) return ["Assembly provenance must be an object."];
  const provenance = value as unknown as ChunkAssemblyProvenance;
  const issues: string[] = [];
  const rootKeys = [
    "schemaVersion", "projectId", "storyboardChecksum", "planChecksum", "runConfigChecksum",
    "chunkOrder", "chunkTimelineChecksums", "chunkAudioChecksums", "chunkAttestationChecksums",
    "assemblyToolchainHashes", "canonicalOutputHashes", "assemblyPolicyVersion",
  ];
  if (!sameKeys(value, rootKeys)) issues.push("Assembly provenance fields are not exact.");
  if (provenance.schemaVersion !== 3) issues.push("Unsupported assembly provenance schema.");
  if (provenance.assemblyPolicyVersion !== CHUNK_ASSEMBLY_POLICY_VERSION) issues.push("Unsupported assembly policy.");
  if (typeof provenance.projectId !== "string" || !provenance.projectId
    || !HASH_PATTERN.test(String(provenance.storyboardChecksum ?? ""))
    || !HASH_PATTERN.test(String(provenance.planChecksum ?? ""))
    || !HASH_PATTERN.test(String(provenance.runConfigChecksum ?? ""))) {
    issues.push("Assembly identity hashes are malformed.");
  }
  const chunkOrderValid = Array.isArray(provenance.chunkOrder)
    && provenance.chunkOrder.length > 0
    && provenance.chunkOrder.every((id) => isSafeLineageId(id))
    && new Set(provenance.chunkOrder).size === provenance.chunkOrder.length;
  if (!chunkOrderValid) {
    issues.push("Assembly chunk order is malformed.");
  }
  const chunkOrder = chunkOrderValid ? provenance.chunkOrder : [];
  if (!isRecord(provenance.chunkTimelineChecksums)
    || !sameKeys(provenance.chunkTimelineChecksums, chunkOrder)
    || !hashMap(provenance.chunkTimelineChecksums)
    || !isRecord(provenance.chunkAudioChecksums)
    || !sameKeys(provenance.chunkAudioChecksums, chunkOrder)
    || !hashMap(provenance.chunkAudioChecksums)) {
    issues.push("Assembly chunk checksum maps are malformed.");
  }
  if (!isRecord(provenance.chunkAttestationChecksums)
    || !sameKeys(provenance.chunkAttestationChecksums, chunkOrder)
    || Object.values(provenance.chunkAttestationChecksums).some((receipts) => !isRecord(receipts)
      || !sameKeys(receipts, CHUNK_STAGES) || !hashMap(receipts))) {
    issues.push("Assembly attestation checksum map is malformed.");
  }
  const toolchainKeys = [
    "productionCodeSnapshot", "assemblyOrchestrator", "audioAssembler", "ttsSceneBuilder", "timelineCompiler",
  ];
  if (!isRecord(provenance.assemblyToolchainHashes)
    || !sameKeys(provenance.assemblyToolchainHashes, toolchainKeys)
    || !hashMap(provenance.assemblyToolchainHashes)) {
    issues.push("Assembly toolchain hashes are malformed.");
  }
  const canonicalKeys = ["ttsScenes", "audio", "durations", "words", "alignment", "timelineBody"];
  if (!isRecord(provenance.canonicalOutputHashes)
    || !sameKeys(provenance.canonicalOutputHashes, canonicalKeys)
    || !hashMap(provenance.canonicalOutputHashes)) {
    issues.push("Assembly canonical output hashes are malformed.");
  }
  return issues;
}

/** A canonical render fails closed whenever long-video lineage is absent or stale. */
export function verifyChunkAssemblyProvenance(projectDir: string, timeline: any): ChunkProvenanceIssue[] {
  const digestCache = createArtifactDigestCache();
  const planPath = path.join(projectDir, "chunks", "chunk-plan.json");
  if (!fs.existsSync(planPath)) {
    return hasLongVideoMarker(projectDir, timeline)
      ? issue("CHUNK_PLAN_MISSING", "Long-video chunk lineage exists or is required, but chunk-plan.json is missing.")
      : [];
  }
  const storyboardPath = path.join(projectDir, "storyboard.json");
  const runConfigFile = chunkRunConfigPath(projectDir);
  const sidecarPath = path.join(projectDir, "chunk-assembly-provenance.json");
  if (!fs.existsSync(runConfigFile)) return issue("CHUNK_RUN_CONFIG_MISSING", "Chunk run config is missing.");
  if (!fs.existsSync(sidecarPath)) return issue("CHUNK_PROVENANCE_MISSING", "Chunk assembly provenance sidecar is missing.");

  const plan = readJson<ChunkPlan>(planPath);
  const storyboard = readJson<Storyboard>(storyboardPath);
  const runConfig = readJson<ChunkRunConfig>(runConfigFile);
  const sidecar = readJson<ChunkAssemblyProvenance>(sidecarPath);
  const embedded = timeline?.chunkAssemblyProvenance as ChunkAssemblyProvenance | undefined;
  if (!plan || !storyboard || !runConfig || !sidecar || !embedded) {
    return issue("CHUNK_PROVENANCE_MALFORMED", "Chunk plan, storyboard, run config, or assembly provenance is unreadable.");
  }
  const shape = [...chunkAssemblyProvenanceShapeIssues(sidecar), ...chunkAssemblyProvenanceShapeIssues(embedded)];
  if (shape.length) return issue("CHUNK_PROVENANCE_MALFORMED", shape.join(" "));
  if (checksumJson(sidecar) !== checksumJson(embedded)) {
    return issue("CHUNK_PROVENANCE_MISMATCH", "Embedded timeline provenance differs from the assembly sidecar.");
  }
  if (plan.schemaVersion !== 2 || plan.plannerVersion !== CHUNK_POLICY_VERSION || plan.projectId !== path.basename(projectDir)) {
    return issue("CHUNK_PROVENANCE_POLICY", "Chunk plan belongs to another project or uses an unsupported policy.");
  }
  if (checksumJson(storyboard) !== plan.storyboardChecksum) {
    return issue("CHUNK_PROVENANCE_SOURCE_DRIFT", "The complete storyboard changed after chunk planning or assembly.");
  }
  const canonicalPlanIssues = verifyCanonicalChunkPlan(storyboard, plan, path.basename(path.resolve(projectDir)));
  if (canonicalPlanIssues.length) {
    return issue("CHUNK_PLAN_NONCANONICAL", canonicalPlanIssues.map((entry) => entry.message).join(" "));
  }
  const configIssues = validateChunkRunConfig(runConfig, {
    projectId: plan.projectId,
    policyVersion: CHUNK_POLICY_VERSION,
    planChecksum: checksumArtifact(planPath, digestCache),
    storyboardChecksum: checksumJson(storyboard),
  });
  if (configIssues.length || runConfig.proof.qualityProfileHash !== PROFILE_HASH) {
    return issue("CHUNK_RUN_CONFIG_DRIFT", [...configIssues, "Current quality profile must match the proof run."].join(" "));
  }
  const authoringReportPath = globalAuthoringReportPath(projectDir);
  if (!fs.existsSync(authoringReportPath)
    || runConfig.globalAuthoringReportChecksum !== checksumArtifact(authoringReportPath, digestCache)) {
    return issue("CHUNK_RUN_CONFIG_DRIFT", "The global authoring checkpoint changed after canonical assembly.");
  }
  if (sidecar.projectId !== plan.projectId
    || sidecar.storyboardChecksum !== checksumJson(storyboard)
    || sidecar.planChecksum !== checksumArtifact(planPath, digestCache)
    || sidecar.runConfigChecksum !== checksumArtifact(runConfigFile, digestCache)
    || sidecar.assemblyPolicyVersion !== CHUNK_ASSEMBLY_POLICY_VERSION
    || JSON.stringify(sidecar.chunkOrder) !== JSON.stringify(plan.chunks.map((chunk) => chunk.id))) {
    return issue("CHUNK_PROVENANCE_MISSING", "Canonical timeline lacks matching complete chunk assembly provenance.");
  }
  const currentAssemblyToolchain = computeChunkAssemblyToolchainHashes(digestCache);
  if (checksumJson(sidecar.assemblyToolchainHashes) !== checksumJson(currentAssemblyToolchain)) {
    return issue("CHUNK_ASSEMBLY_TOOLCHAIN_DRIFT", "Deterministic assembly code changed after canonical assembly.");
  }

  const context: ChunkStageContractContext = {
    projectDir,
    storyboardPath,
    planPath,
    runConfigPath: runConfigFile,
    storyboard,
    plan,
    runConfig,
    digestCache,
  };
  const issues: ChunkProvenanceIssue[] = [];
  for (const chunk of plan.chunks) {
    const paths = chunkPipelinePaths(projectDir, chunk.id);
    if (!fs.existsSync(paths.audio) || !fs.existsSync(paths.timeline)
      || sidecar.chunkAudioChecksums[chunk.id] !== checksumArtifact(paths.audio, digestCache)
      || sidecar.chunkTimelineChecksums[chunk.id] !== checksumArtifact(paths.timeline, digestCache)) {
      issues.push({ code: "CHUNK_ARTIFACT_DRIFT", message: `${chunk.id} core audio or timeline changed after assembly.` });
    }
    const receiptHashes = sidecar.chunkAttestationChecksums[chunk.id];
    if (!isRecord(receiptHashes) || Object.keys(receiptHashes).sort().join("|") !== [...CHUNK_STAGES].sort().join("|")) {
      issues.push({ code: "CHUNK_ATTESTATION_SET", message: `${chunk.id} has an incomplete attestation set in assembly provenance.` });
      continue;
    }
    for (const stage of CHUNK_STAGES) {
      const recordPath = stageAttestationPath(projectDir, chunk.id, stage);
      if (!fs.existsSync(recordPath) || receiptHashes[stage] !== checksumArtifact(recordPath, digestCache)) {
        issues.push({ code: "CHUNK_ATTESTATION_DRIFT", message: `${chunk.id} ${stage} attestation changed after assembly.` });
        continue;
      }
      const validation = verifyChunkStage(context, chunk.id, stage);
      if (validation.length) {
        issues.push({ code: "CHUNK_ATTESTATION_INVALID", message: validation.map((item) => item.message).join(" ") });
      }
    }
  }

  const expectedAudioRelative = `audio/${projectAudioIdentity(projectDir)}/voice.wav`;
  if (timeline?.audio !== expectedAudioRelative) {
    issues.push({
      code: "CHUNK_CANONICAL_ARTIFACT_DRIFT",
      message: `Canonical timeline audio path must be ${expectedAudioRelative}.`,
    });
  }
  const canonicalPaths = {
    ttsScenes: path.join(projectDir, "tts_scenes.json"),
    audio: path.resolve("public", expectedAudioRelative),
    durations: path.join(projectDir, "durations.json"),
    words: path.join(projectDir, "words.json"),
    alignment: path.join(projectDir, "alignment.json"),
  };
  for (const [name, filePath] of Object.entries(canonicalPaths)) {
    const expected = sidecar.canonicalOutputHashes[name as keyof typeof canonicalPaths];
    if (!fs.existsSync(filePath) || expected !== checksumArtifact(filePath, digestCache)) {
      issues.push({ code: "CHUNK_CANONICAL_ARTIFACT_DRIFT", message: `Canonical assembled ${name} changed after assembly.` });
    }
  }
  if (sidecar.canonicalOutputHashes.timelineBody !== timelineBodyHash(timeline)) {
    issues.push({ code: "CHUNK_CANONICAL_ARTIFACT_DRIFT", message: "Canonical timeline body changed after assembly." });
  }
  return issues;
}
