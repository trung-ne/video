/**
 * Assemble only a fully attested semantic-chunk run into canonical Route A
 * measured artifacts. It never concatenates MP4 proofs and never publishes.
 */
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { checksumJson } from "../src/ai/transcriptCoverage";
import {
  CHUNK_ASSEMBLY_POLICY_VERSION,
  CHUNK_POLICY_VERSION,
  CHUNK_STAGES,
  ChunkStageContractContext,
  checksumArtifact,
  chunkPipelinePaths,
  chunkRunConfigPath,
  computeExpectedChunkStageContract,
  computeProductionCodeSnapshotHash,
  createArtifactDigestCache,
  projectAudioIdentity,
  stageAttestationPath,
  validateChunkRunConfig,
} from "../src/engine/chunkAttestations";
import {
  verifyChunkAssembly,
  ChunkMeasuredArtifacts,
  promoteChunkAssemblyArtifacts,
} from "../src/engine/chunkAssembly";
import {
  chunkAssemblyProvenanceShapeIssues,
  computeChunkAssemblyToolchainHashes,
} from "../src/engine/chunkProvenance";
import {
  ChunkAssemblyProvenance,
  ChunkPlan,
  ChunkRunConfig,
  ChunkStage,
  verifyCanonicalChunkPlan,
} from "../src/types/chunk";
import { Storyboard, AlignedWord } from "../src/types/storyboard";
import { runProcessWithDllInitRetry } from "../src/engine/childProcessRunner";
import { ProjectChunkInterruptedError, runWithProjectChunkLock } from "../src/engine/projectChunkLock";
import qualityProfile from "../config/reference-quality.json";

const args = process.argv.slice(2);
const value = (flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
};
const projectArgument = value("--project");
const execute = args.includes("--execute");
if (!projectArgument) {
  console.error("❌ assemble-storyboard-chunks requires --project <id-or-path>.");
  process.exit(1);
}
if (!execute) {
  console.error("❌ Assembly writes canonical measured artifacts and requires explicit --execute.");
  process.exit(1);
}
const projectDir = fs.existsSync(projectArgument) ? path.resolve(projectArgument) : path.resolve("projects", projectArgument);
const canonicalStoryboardPath = path.join(projectDir, "storyboard.json");
const canonicalPlanPath = path.join(projectDir, "chunks", "chunk-plan.json");
const storyboardOverride = value("--storyboard");
const planOverride = value("--plan");
const storyboardPath = canonicalStoryboardPath;
const planPath = canonicalPlanPath;
const python = value("--python") ?? "py";
const requestedLanguage = value("--lang");
const thresholdProfileHash = checksumJson(qualityProfile);

function fail(message: string): never {
  throw new Error(message);
}

function json<T>(filePath: string): T {
  if (!fs.existsSync(filePath)) return fail(`Missing artifact: ${filePath}`);
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")) as T; }
  catch { return fail(`Invalid JSON: ${filePath}`); }
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, filePath);
}

async function nodeScript(
  phase: string,
  script: string,
  scriptArgs: string[],
  timeoutMs: number,
  signal: AbortSignal,
): Promise<void> {
  await runProcessWithDllInitRetry({
    phase,
    executable: process.execPath,
    args: [require.resolve("ts-node/dist/bin.js"), script, ...scriptArgs],
    cwd: path.resolve("."),
    signal,
    timeoutMs,
    retryDllInitFailure: true,
  });
}

async function pythonScript(
  phase: string,
  script: string,
  scriptArgs: string[],
  timeoutMs: number,
  signal: AbortSignal,
): Promise<void> {
  await runProcessWithDllInitRetry({
    phase,
    executable: python,
    args: python.toLowerCase() === "py" ? ["-3.11", script, ...scriptArgs] : [script, ...scriptArgs],
    cwd: path.resolve("."),
    signal,
    timeoutMs,
    retryDllInitFailure: true,
  });
}

function timelineBodyHash(timeline: any): string {
  const body = { ...timeline };
  delete body.chunkAssemblyProvenance;
  return checksumJson(body);
}

async function main(signal: AbortSignal): Promise<void> {
  if (storyboardOverride && path.resolve(storyboardOverride) !== canonicalStoryboardPath) {
    fail("--storyboard must resolve to the project's canonical storyboard.json.");
  }
  if (planOverride && path.resolve(planOverride) !== canonicalPlanPath) {
    fail("--plan must resolve to the project's canonical chunks/chunk-plan.json.");
  }
  const storyboard = json<Storyboard>(storyboardPath);
  const plan = json<ChunkPlan>(planPath);
  const canonicalPlanIssues = verifyCanonicalChunkPlan(storyboard, plan, path.basename(projectDir));
  if (canonicalPlanIssues.length) fail(`Chunk plan is not canonical: ${canonicalPlanIssues.map((issue) => issue.message).join(" ")}`);
  if (plan.schemaVersion !== 2 || plan.plannerVersion !== CHUNK_POLICY_VERSION) fail("Unsupported chunk-plan policy.");
  if (plan.projectId !== path.basename(projectDir)) fail("Chunk plan belongs to another project.");
  if (plan.storyboardChecksum !== checksumJson(storyboard)) {
    fail("Chunk plan does not match the complete storyboard. Re-plan and re-prove every affected chunk.");
  }
  const runConfigFile = chunkRunConfigPath(projectDir);
  const runConfig = json<ChunkRunConfig>(runConfigFile);
  const configIssues = validateChunkRunConfig(runConfig, {
    projectId: plan.projectId,
    policyVersion: CHUNK_POLICY_VERSION,
    planChecksum: checksumArtifact(planPath),
    storyboardChecksum: checksumJson(storyboard),
  });
  if (configIssues.length) fail(`Chunk run config is invalid: ${configIssues.join(" ")}`);
  if (runConfig.proof.qualityProfileHash !== thresholdProfileHash) fail("Quality threshold profile changed after chunk proofing.");
  if (requestedLanguage && requestedLanguage !== runConfig.alignment.language) {
    fail("--lang differs from the immutable chunk run alignment language.");
  }
  const language = runConfig.alignment.language ?? "unknown";
  const context: ChunkStageContractContext = {
    projectDir,
    storyboardPath,
    planPath,
    runConfigPath: runConfigFile,
    storyboard,
    plan,
    runConfig,
  };

  const inputs: Array<{
    id: string;
    sceneIds: string[];
    audio: string;
    durations: string;
    words: string;
    alignment: string;
  }> = [];
  const artifacts: ChunkMeasuredArtifacts[] = [];

  const runToken = `${process.pid}-${crypto.randomUUID()}`;
  const candidatePath = (finalPath: string): string => path.join(
    path.dirname(finalPath),
    `.chunk-assembly-${runToken}`,
    path.basename(finalPath),
  );
  const canonical = {
    ttsScenes: path.join(projectDir, "tts_scenes.json"),
    audio: path.resolve("public", `audio/${projectAudioIdentity(projectDir)}/voice.wav`),
    durations: path.join(projectDir, "durations.json"),
    words: path.join(projectDir, "words.json"),
    alignment: path.join(projectDir, "alignment.json"),
    timeline: path.join(projectDir, "timeline.json"),
    provenance: path.join(projectDir, "chunk-assembly-provenance.json"),
  };
  const candidate = Object.fromEntries(Object.entries(canonical).map(([name, finalPath]) => [
    name,
    candidatePath(finalPath),
  ])) as typeof canonical;
  const stagingDirectories = [...new Set(Object.values(candidate).map((filePath) => path.dirname(filePath)))];
  for (const directory of stagingDirectories) fs.mkdirSync(directory, { recursive: true });

  try {
    for (const chunk of plan.chunks) {
      const paths = chunkPipelinePaths(projectDir, chunk.id);
      inputs.push({
        id: chunk.id,
        sceneIds: chunk.sceneIds,
        audio: paths.audio,
        durations: paths.durations,
        words: paths.words,
        alignment: paths.alignment,
      });
    }

    const inputManifest = path.join(path.dirname(candidate.ttsScenes), "assembly-inputs.json");
    writeJsonAtomic(inputManifest, inputs);
    await nodeScript("assembly:tts-scenes", "scripts/storyboard-to-tts.ts", [
      "--storyboard", storyboardPath,
      "--out", candidate.ttsScenes,
    ], 5 * 60_000, signal);
    const audioRelative = `audio/${projectAudioIdentity(projectDir)}/voice.wav`;
    await pythonScript("assembly:audio", "scripts/assemble-chunk-audio.py", [
      "--inputs", inputManifest,
      "--out-audio", candidate.audio,
      "--out-durations", candidate.durations,
      "--out-words", candidate.words,
      "--out-alignment", candidate.alignment,
      "--tts-scenes", candidate.ttsScenes,
      "--language", language,
      "--policy-version", CHUNK_ASSEMBLY_POLICY_VERSION,
    ], 30 * 60_000, signal);
    await nodeScript("assembly:compile", "scripts/compile-storyboard.ts", [
      "--storyboard", storyboardPath,
      "--out", candidate.timeline,
      "--durations", candidate.durations,
      "--words", candidate.words,
      "--alignment", candidate.alignment,
      "--audio", audioRelative,
      "--audio-file", candidate.audio,
    ], 20 * 60_000, signal);

    // Re-read all mutable lineage only after candidate generation. Each stage
    // contract is then computed and verified exactly once with one invocation-
    // local digest cache before any canonical destination is touched.
    const currentStoryboard = json<Storyboard>(storyboardPath);
    const currentPlan = json<ChunkPlan>(planPath);
    const currentRunConfig = json<ChunkRunConfig>(runConfigFile);
    if (checksumJson(currentStoryboard) !== checksumJson(storyboard)
      || checksumJson(currentPlan) !== checksumJson(plan)
      || checksumJson(currentRunConfig) !== checksumJson(runConfig)) {
      fail("Chunk plan, storyboard, or immutable run config changed during candidate assembly.");
    }
    const finalPlanIssues = verifyCanonicalChunkPlan(currentStoryboard, currentPlan, path.basename(projectDir));
    if (finalPlanIssues.length) fail(`Chunk plan changed during assembly: ${finalPlanIssues.map((entry) => entry.message).join(" ")}`);
    const digestCache = createArtifactDigestCache();
    const finalConfigIssues = validateChunkRunConfig(currentRunConfig, {
      projectId: currentPlan.projectId,
      policyVersion: CHUNK_POLICY_VERSION,
      planChecksum: checksumArtifact(planPath, digestCache),
      storyboardChecksum: checksumJson(currentStoryboard),
    });
    if (finalConfigIssues.length || currentRunConfig.proof.qualityProfileHash !== thresholdProfileHash) {
      fail(`Chunk run config changed during assembly: ${finalConfigIssues.join(" ")}`);
    }

    const finalContext: ChunkStageContractContext = {
      ...context,
      storyboard: currentStoryboard,
      plan: currentPlan,
      runConfig: currentRunConfig,
      digestCache,
    };
    const verifiedProductionCodeSnapshot = computeProductionCodeSnapshotHash(digestCache);
    const contracts: Record<string, Partial<Record<ChunkStage, ReturnType<typeof computeExpectedChunkStageContract>>>> = {};
    for (const chunk of currentPlan.chunks) {
      const paths = chunkPipelinePaths(projectDir, chunk.id);
      const durationManifest = json<{ scenes?: Array<{ id: string; startFrame: number; frames: number }> }>(paths.durations);
      if (!Array.isArray(durationManifest.scenes)) fail(`${chunk.id} durations manifest has no scenes array.`);
      artifacts.push({
        chunkId: chunk.id,
        durations: durationManifest.scenes,
        words: json<AlignedWord[]>(paths.words),
        attestationPaths: Object.fromEntries(CHUNK_STAGES.map((stage) => [stage, stageAttestationPath(projectDir, chunk.id, stage)])),
        hashes: {},
        outputs: {},
      });
      contracts[chunk.id] = {};
      for (const stage of CHUNK_STAGES) {
        const contract = computeExpectedChunkStageContract(finalContext, chunk.id, stage);
        if (contract.missingInputs.length) {
          fail(`${chunk.id} ${stage} contract has missing inputs: ${contract.missingInputs.join(", ")}`);
        }
        contracts[chunk.id][stage] = contract;
      }
    }

    const assemblyIssues = verifyChunkAssembly(
      currentPlan,
      currentStoryboard,
      artifacts,
      CHUNK_STAGES.map((stage) => ({
        stage,
        policyVersion: CHUNK_POLICY_VERSION,
        thresholdProfileHash,
        digestCache,
        inputHashes: (artifact: ChunkMeasuredArtifacts) => contracts[artifact.chunkId][stage]!.inputHashes,
        outputPaths: (artifact: ChunkMeasuredArtifacts) => contracts[artifact.chunkId][stage]!.outputPaths,
      })),
    );
    if (assemblyIssues.length) fail(`Chunk assembly gate failed: ${assemblyIssues.map((issue) => issue.message).join(" ")}`);
    const verifiedOutputHashes = new Map<string, string>();
    for (const chunk of currentPlan.chunks) {
      for (const stage of CHUNK_STAGES) {
        for (const filePath of Object.values(contracts[chunk.id][stage]!.outputPaths)) {
          verifiedOutputHashes.set(path.resolve(filePath), checksumArtifact(filePath, digestCache));
        }
      }
    }

    const attestationHashes: Record<string, Record<ChunkStage, string>> = {};
    const timelineHashes: Record<string, string> = {};
    const audioHashes: Record<string, string> = {};
    for (const chunk of currentPlan.chunks) {
      const paths = chunkPipelinePaths(projectDir, chunk.id);
      attestationHashes[chunk.id] = Object.fromEntries(CHUNK_STAGES.map((stage) => [
        stage,
        checksumArtifact(stageAttestationPath(projectDir, chunk.id, stage), digestCache),
      ])) as Record<ChunkStage, string>;
      timelineHashes[chunk.id] = checksumArtifact(paths.timeline, digestCache);
      audioHashes[chunk.id] = checksumArtifact(paths.audio, digestCache);
    }

    const timeline = json<any>(candidate.timeline);
    const assemblyToolchainHashes = computeChunkAssemblyToolchainHashes(digestCache);
    const provenance: ChunkAssemblyProvenance = {
      schemaVersion: 3,
      projectId: currentPlan.projectId,
      storyboardChecksum: checksumJson(currentStoryboard),
      planChecksum: checksumArtifact(planPath, digestCache),
      runConfigChecksum: checksumArtifact(runConfigFile, digestCache),
      chunkOrder: currentPlan.chunks.map((chunk) => chunk.id),
      chunkTimelineChecksums: timelineHashes,
      chunkAudioChecksums: audioHashes,
      chunkAttestationChecksums: attestationHashes,
      assemblyToolchainHashes,
      canonicalOutputHashes: {
        ttsScenes: checksumArtifact(candidate.ttsScenes, digestCache),
        audio: checksumArtifact(candidate.audio, digestCache),
        durations: checksumArtifact(candidate.durations, digestCache),
        words: checksumArtifact(candidate.words, digestCache),
        alignment: checksumArtifact(candidate.alignment, digestCache),
        timelineBody: timelineBodyHash(timeline),
      },
      assemblyPolicyVersion: CHUNK_ASSEMBLY_POLICY_VERSION,
    };
    const provenanceShapeIssues = chunkAssemblyProvenanceShapeIssues(provenance);
    if (provenanceShapeIssues.length) fail(`Candidate assembly provenance is malformed: ${provenanceShapeIssues.join(" ")}`);
    writeJsonAtomic(candidate.provenance, provenance);
    timeline.chunkAssemblyProvenance = provenance;
    writeJsonAtomic(candidate.timeline, timeline);

    if (computeProductionCodeSnapshotHash(digestCache) !== verifiedProductionCodeSnapshot
      || checksumJson(computeChunkAssemblyToolchainHashes(digestCache)) !== checksumJson(assemblyToolchainHashes)) {
      fail("Production or deterministic assembly code changed during canonical candidate verification.");
    }
    if (checksumArtifact(storyboardPath, digestCache) !== provenance.storyboardChecksum
      || checksumArtifact(planPath, digestCache) !== provenance.planChecksum
      || checksumArtifact(runConfigFile, digestCache) !== provenance.runConfigChecksum) {
      fail("Storyboard, plan, or run config changed after canonical candidate verification.");
    }
    for (const [filePath, verifiedHash] of verifiedOutputHashes) {
      if (!fs.existsSync(filePath) || checksumArtifact(filePath, digestCache) !== verifiedHash) {
        fail(`Attested chunk output changed before canonical commit: ${filePath}`);
      }
    }
    for (const chunk of currentPlan.chunks) {
      const paths = chunkPipelinePaths(projectDir, chunk.id);
      if (checksumArtifact(paths.timeline, digestCache) !== timelineHashes[chunk.id]
        || checksumArtifact(paths.audio, digestCache) !== audioHashes[chunk.id]) {
        fail(`${chunk.id} core artifact changed before canonical commit.`);
      }
      for (const stage of CHUNK_STAGES) {
        if (checksumArtifact(stageAttestationPath(projectDir, chunk.id, stage), digestCache)
          !== attestationHashes[chunk.id][stage]) {
          fail(`${chunk.id} ${stage} receipt changed before canonical commit.`);
        }
      }
    }
    const candidateHashPaths = {
      ttsScenes: candidate.ttsScenes,
      audio: candidate.audio,
      durations: candidate.durations,
      words: candidate.words,
      alignment: candidate.alignment,
    } as const;
    for (const [name, filePath] of Object.entries(candidateHashPaths)) {
      if (checksumArtifact(filePath, digestCache)
        !== provenance.canonicalOutputHashes[name as keyof typeof candidateHashPaths]) {
        fail(`Canonical assembly candidate ${name} changed before commit.`);
      }
    }
    const finalCandidateTimeline = json<any>(candidate.timeline);
    const finalCandidateProvenance = json<ChunkAssemblyProvenance>(candidate.provenance);
    if (timelineBodyHash(finalCandidateTimeline) !== provenance.canonicalOutputHashes.timelineBody
      || checksumJson(finalCandidateTimeline.chunkAssemblyProvenance) !== checksumJson(provenance)
      || checksumJson(finalCandidateProvenance) !== checksumJson(provenance)) {
      fail("Canonical assembly timeline or provenance candidate changed before commit.");
    }

    promoteChunkAssemblyArtifacts([
      { name: "ttsScenes", candidatePath: candidate.ttsScenes, finalPath: canonical.ttsScenes },
      { name: "audio", candidatePath: candidate.audio, finalPath: canonical.audio },
      { name: "durations", candidatePath: candidate.durations, finalPath: canonical.durations },
      { name: "words", candidatePath: candidate.words, finalPath: canonical.words },
      { name: "alignment", candidatePath: candidate.alignment, finalPath: canonical.alignment },
      { name: "provenance", candidatePath: candidate.provenance, finalPath: canonical.provenance },
      // The embedded provenance timeline is the commit record and moves last.
      { name: "timeline", candidatePath: candidate.timeline, finalPath: canonical.timeline },
    ], { signal, transactionId: runToken });

    console.log(`✅ Assembled ${currentPlan.chunks.length} fully proven chunks into canonical Route A artifacts.`);
    console.log(`   Final rendering remains mandatory: npx ts-node scripts/render.ts --project ${path.basename(projectDir)}`);
  } finally {
    for (const directory of stagingDirectories) fs.rmSync(directory, { recursive: true, force: true });
  }
}

void runWithProjectChunkLock(projectDir, {
  operation: "assemble-storyboard-chunks",
  mode: "execute",
}, main).catch((error) => {
  console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = error instanceof ProjectChunkInterruptedError ? error.exitCode : 1;
});
