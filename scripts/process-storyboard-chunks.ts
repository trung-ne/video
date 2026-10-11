/**
 * Strict Route A semantic-chunk checkpoint runner.
 *
 * It consumes a complete built storyboard and deterministic chunk plan. Core
 * artifacts are the only assembly inputs; the one-scene-halo proof plane is
 * derived, non-promotable evidence.
 */
import * as fs from "fs";
import * as path from "path";
import {
  checksumJson,
  checksumText,
  indexTranscript,
  validateStoryboardCoverage,
} from "../src/ai/transcriptCoverage";
import {
  CHUNK_POLICY_VERSION,
  CHUNK_STAGES,
  ChunkStageContractContext,
  chunkPipelinePaths,
  chunkRunConfigPath,
  checksumArtifact,
  computeExpectedChunkStageContract,
  createChunkRunConfig,
  createStageAttestation,
  globalAuthoringReportPath,
  stageAttestationPath,
  validateChunkRunConfig,
  verifyChunkStage,
  writeStageAttestation,
} from "../src/engine/chunkAttestations";
import { projectStoryboardForChunk, projectStoryboardForQualityScope } from "../src/engine/chunkAssembly";
import { checkSpatialIntegrity } from "../src/engine/spatialIntegrity";
import { loadTimeline } from "../src/engine/loadTimeline";
import { runScopedQualityCheck, runScopedStoryboardCheck, runStoryboardCheck } from "../src/ai/qualityCheck";
import { validateTimeline } from "../src/ai/validateTimeline";
import {
  ChunkPlan,
  ChunkRunConfig,
  ChunkStage,
  isSafeLineageId,
  isLongVideoWordCount,
  minimumAuthoredScenesForWordCount,
  orderedSceneIdsForScope,
  qualityScopeForChunk,
  verifyCanonicalChunkPlan,
} from "../src/types/chunk";
import { Storyboard } from "../src/types/storyboard";
import { runProcessWithDllInitRetry } from "../src/engine/childProcessRunner";
import { ProjectChunkInterruptedError, runWithProjectChunkLock } from "../src/engine/projectChunkLock";
import qualityProfile from "../config/reference-quality.json";

const args = process.argv.slice(2);
const value = (flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
};
const execute = args.includes("--execute");
const projectArgument = value("--project");
if (!projectArgument) {
  console.error("❌ process-storyboard-chunks requires --project <id-or-path>.");
  process.exit(1);
}
const projectDir = fs.existsSync(projectArgument) ? path.resolve(projectArgument) : path.resolve("projects", projectArgument);
const canonicalStoryboardPath = path.join(projectDir, "storyboard.json");
const canonicalPlanPath = path.join(projectDir, "chunks", "chunk-plan.json");
const storyboardOverride = value("--storyboard");
const planOverride = value("--plan");
const storyboardPath = canonicalStoryboardPath;
const planPath = canonicalPlanPath;
const requestedChunk = value("--chunk");
const requestedTtsEngine = value("--tts-engine") ?? "edge-tts";
if (requestedTtsEngine !== "edge-tts" && requestedTtsEngine !== "kokoro") {
  console.error(`❌ Unsupported --tts-engine ${JSON.stringify(requestedTtsEngine)}; use edge-tts or kokoro.`);
  process.exit(1);
}
const ttsEngine = requestedTtsEngine as "edge-tts" | "kokoro";
const voice = value("--voice") ?? (ttsEngine === "kokoro" ? "af_heart" : "vi-VN-NamMinhNeural");
const ttsLanguageCode = value("--tts-lang") ?? "a";
const ttsSpeed = Number(value("--tts-speed") ?? 1);
const kokoroModelRevision = value("--kokoro-model-revision") ?? "main";
const kokoroModelDir = value("--kokoro-model-dir");
if (ttsEngine === "kokoro" && (!Number.isFinite(ttsSpeed) || ttsSpeed <= 0)) {
  console.error("❌ --tts-speed must be a finite positive number.");
  process.exit(1);
}
const language = value("--lang") ?? (ttsEngine === "edge-tts" ? "vi" : undefined);
const alignModel = value("--align-model") ?? "small";
const python = value("--python") ?? "py";
const thresholdProfileHash = checksumJson(qualityProfile);

function fatal(message: string): never {
  throw new Error(message);
}

function readJson<T>(filePath: string): T {
  if (!fs.existsSync(filePath)) fatal(`Missing required artifact: ${filePath}`);
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")) as T; }
  catch { return fatal(`Invalid JSON artifact: ${filePath}`); }
}

function writeJson(filePath: string, valueToWrite: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(valueToWrite, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, filePath);
}

async function runNodeScript(
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

async function runPython(
  phase: string,
  script: string,
  scriptArgs: string[],
  timeoutMs: number,
  signal: AbortSignal,
): Promise<void> {
  const pythonArgs = python.toLowerCase() === "py" ? ["-3.11", script, ...scriptArgs] : [script, ...scriptArgs];
  await runProcessWithDllInitRetry({
    phase,
    executable: python,
    args: pythonArgs,
    cwd: path.resolve("."),
    signal,
    timeoutMs,
    retryDllInitFailure: true,
  });
}

async function runConfiguredTts(
  phase: string,
  config: ChunkRunConfig["tts"],
  scenesPath: string,
  outDir: string,
  terminalGap: boolean,
  signal: AbortSignal,
): Promise<void> {
  const common = [
    "--scenes", scenesPath,
    "--outdir", outDir,
    "--voice", config.voice,
    "--gap", String(config.gapSeconds),
  ];
  let script: string;
  let scriptArgs: string[];
  if (config.engine === "edge-tts") {
    script = "scripts/tts_edge.py";
    scriptArgs = [
      ...common,
      "--rate", config.rate,
      "--volume", config.volume,
      "--pitch", config.pitch,
    ];
  } else {
    script = "scripts/tts_kokoro.py";
    scriptArgs = [
      ...common,
      "--lang", config.languageCode,
      "--speed", String(config.speed),
      "--repo-id", config.repoId,
      "--model-revision", config.modelRevision,
      "--device", config.device,
    ];
    if (config.modelDir) scriptArgs.push("--model-dir", config.modelDir);
  }
  if (terminalGap) scriptArgs.push("--terminal-gap");
  await runPython(phase, script, scriptArgs, 2 * 60 * 60_000, signal);
}

interface GlobalAuthoringCheckpoint {
  schemaVersion: 1;
  policyVersion: "route-a-global-authoring-v1";
  projectId: string;
  storyboardChecksum: string;
  planChecksum: string;
  transcriptChecksum: string;
  qualityProfileHash: string;
  authoringDecision: Storyboard["authoringDecision"];
  coverage: {
    valid: true;
    transcriptWords: number;
    minimumScenes: number;
    authoredScenes: number;
  };
  quality: {
    scorePercent: number;
    grade: string;
    blockers: 0;
    majors: 0;
    minors: number;
  };
  passed: true;
}

function writeGlobalAuthoringCheckpoint(storyboard: Storyboard, plan: ChunkPlan): string {
  const transcriptPath = path.join(projectDir, "transcript.txt");
  if (!fs.existsSync(transcriptPath)) fatal(`Missing complete transcript required by the global authoring gate: ${transcriptPath}`);
  const transcript = fs.readFileSync(transcriptPath, "utf8");
  const indexedWords = indexTranscript(transcript);
  const coverage = validateStoryboardCoverage(transcript, storyboard);
  const minimumScenes = minimumAuthoredScenesForWordCount(indexedWords.length);
  const decision = storyboard.authoringDecision;
  const decisionMatches = Boolean(decision?.passed)
    && decision?.policyVersion === "scene-density-v1"
    && decision?.transcriptWords === indexedWords.length
    && decision?.minimumScenes === minimumScenes
    && decision?.authoredScenes === storyboard.scenes.length
    && decision?.longVideo === isLongVideoWordCount(indexedWords.length)
    && decision?.sectionsRequired === isLongVideoWordCount(indexedWords.length);
  const report = runStoryboardCheck(storyboard);
  if (!coverage.valid || !decisionMatches || report.blockers > 0 || report.majors > 0) {
    const reasons = [
      ...coverage.issues.map((issue) => `${issue.code}: ${issue.message}`),
      ...(!decisionMatches ? ["the persisted authoringDecision does not match the complete transcript/storyboard"] : []),
      ...(report.blockers || report.majors
        ? [`global storyboard quality has ${report.blockers} blocker(s) and ${report.majors} major issue(s)`]
        : []),
    ];
    fatal(`Global authoring gate failed before TTS: ${reasons.join("; ")}`);
  }
  const checkpoint: GlobalAuthoringCheckpoint = {
    schemaVersion: 1,
    policyVersion: "route-a-global-authoring-v1",
    projectId: path.basename(projectDir),
    storyboardChecksum: checksumJson(storyboard),
    planChecksum: checksumArtifact(planPath),
    transcriptChecksum: checksumText(transcript),
    qualityProfileHash: thresholdProfileHash,
    authoringDecision: decision,
    coverage: {
      valid: true,
      transcriptWords: indexedWords.length,
      minimumScenes,
      authoredScenes: storyboard.scenes.length,
    },
    quality: {
      scorePercent: report.scorePercent,
      grade: report.grade,
      blockers: 0,
      majors: 0,
      minors: report.minors,
    },
    passed: true,
  };
  const reportPath = globalAuthoringReportPath(projectDir);
  writeJson(reportPath, checkpoint);
  return reportPath;
}

function ensureRunConfig(storyboard: Storyboard, plan: ChunkPlan, authoringReportPath: string): { path: string; value: ChunkRunConfig } {
  const configPath = chunkRunConfigPath(projectDir);
  const desired = createChunkRunConfig({
    projectDir,
    planPath,
    storyboard,
    globalAuthoringReportPath: authoringReportPath,
    ttsEngine,
    voice,
    ttsLanguageCode,
    ttsSpeed,
    kokoroModelRevision,
    kokoroModelDir,
    alignModel,
    language,
    thresholdProfileHash,
  });
  if (!fs.existsSync(configPath)) {
    writeJson(configPath, desired);
    return { path: configPath, value: desired };
  }
  const existing = readJson<ChunkRunConfig>(configPath);
  const issues = validateChunkRunConfig(existing, {
    projectId: path.basename(projectDir),
    policyVersion: CHUNK_POLICY_VERSION,
    planChecksum: desired.planChecksum,
    storyboardChecksum: desired.storyboardChecksum,
  });
  if (issues.length) fatal(`Chunk run config is invalid: ${issues.join(" ")}`);
  if (checksumJson(existing) !== checksumJson(desired)) {
    fatal("Chunk run synthesis/alignment/proof settings changed. Start a new derived chunk run instead of reusing prior attestations.");
  }
  if (plan.projectId !== existing.projectId) fatal("Chunk plan and run config project identities differ.");
  return { path: configPath, value: existing };
}

function stageIsValid(context: ChunkStageContractContext, chunkId: string, stage: ChunkStage): boolean {
  return verifyChunkStage(context, chunkId, stage).length === 0;
}

function attest(context: ChunkStageContractContext, chunkId: string, stage: ChunkStage): void {
  // Recompute every input after the subprocess has finished. This closes the
  // pre-check/write gap and prevents a receipt from sealing pre-run values.
  const contract = computeExpectedChunkStageContract(context, chunkId, stage);
  if (contract.missingInputs.length) {
    fatal(`${chunkId} ${stage} cannot attest missing inputs: ${contract.missingInputs.join(", ")}`);
  }
  for (const [name, filePath] of Object.entries(contract.outputPaths)) {
    if (!fs.existsSync(filePath)) fatal(`${chunkId} ${stage} output is missing: ${name} (${filePath})`);
  }
  writeStageAttestation(stageAttestationPath(projectDir, chunkId, stage), createStageAttestation({
    chunkId,
    stage,
    inputHashes: contract.inputHashes,
    outputHashes: Object.fromEntries(Object.entries(contract.outputPaths).map(([name, filePath]) => [name, checksumArtifact(filePath)])),
    policyVersion: CHUNK_POLICY_VERSION,
    thresholdProfileHash,
    passed: true,
    blockerCount: 0,
    majorCount: 0,
  }));
}

function requirePriorProof(context: ChunkStageContractContext, chunkIndex: number): void {
  if (chunkIndex === 0) return;
  const previous = context.plan.chunks[chunkIndex - 1];
  for (const stage of CHUNK_STAGES) {
    const issues = verifyChunkStage(context, previous.id, stage);
    if (issues.length) {
      fatal(`${previous.id} ${stage} lineage is invalid; ${context.plan.chunks[chunkIndex].id} is locked: ${issues.map((issue) => issue.message).join(" ")}`);
    }
  }
}

function readBoundChunkTimeline(filePath: string, role: "chunk-core" | "chunk-proof", projectOpeningSceneId: string): any {
  const timeline = readJson<any>(filePath);
  if (timeline.artifactRole !== role || timeline.projectOpeningSceneId !== projectOpeningSceneId) {
    fatal(`Compiled ${role} timeline is missing its bound non-promotable artifact identity.`);
  }
  return timeline;
}

async function main(signal: AbortSignal): Promise<void> {
  if (storyboardOverride && path.resolve(storyboardOverride) !== canonicalStoryboardPath) {
    fatal("--storyboard must resolve to the project's canonical storyboard.json.");
  }
  if (planOverride && path.resolve(planOverride) !== canonicalPlanPath) {
    fatal("--plan must resolve to the project's canonical chunks/chunk-plan.json.");
  }
  if (requestedChunk && !isSafeLineageId(requestedChunk)) fatal(`Unsafe requested chunk id: ${JSON.stringify(requestedChunk)}.`);
  const storyboard = readJson<Storyboard>(storyboardPath);
  const plan = readJson<ChunkPlan>(planPath);
  const completeStoryboardChecksum = checksumJson(storyboard);
  const canonicalPlanIssues = verifyCanonicalChunkPlan(storyboard, plan, path.basename(projectDir));
  if (canonicalPlanIssues.length) fatal(`Chunk plan is not canonical: ${canonicalPlanIssues.map((issue) => issue.message).join(" ")}`);
  if (plan.schemaVersion !== 2 || plan.plannerVersion !== CHUNK_POLICY_VERSION) fatal("Unsupported chunk-plan version.");
  if (plan.projectId !== path.basename(projectDir)) fatal("Chunk plan belongs to another project.");
  if (plan.storyboardChecksum !== completeStoryboardChecksum) {
    fatal("Chunk plan no longer matches the complete storyboard; regenerate it after the full authoring build.");
  }
  const authoringReportPath = writeGlobalAuthoringCheckpoint(storyboard, plan);
  console.log("✅ global authoring checkpoint");
  const runConfig = ensureRunConfig(storyboard, plan, authoringReportPath);
  const context: ChunkStageContractContext = {
    projectDir,
    storyboardPath,
    planPath,
    runConfigPath: runConfig.path,
    storyboard,
    plan,
    runConfig: runConfig.value,
  };
  const chunks = requestedChunk ? plan.chunks.filter((chunk) => chunk.id === requestedChunk) : plan.chunks;
  if (requestedChunk && !chunks.length) fatal(`Unknown planned chunk: ${requestedChunk}`);

  for (const chunk of chunks) {
    const index = plan.chunks.findIndex((item) => item.id === chunk.id);
    requirePriorProof(context, index);
    const paths = chunkPipelinePaths(projectDir, chunk.id);
    const scope = qualityScopeForChunk(plan, chunk.id);
    const coreScope = { ...scope, haloBeforeSceneIds: [], haloAfterSceneIds: [] };
    const projected = projectStoryboardForChunk(storyboard, chunk);
    const proofProjected = projectStoryboardForQualityScope(storyboard, scope);

    writeJson(paths.projection, projected);
    writeJson(paths.scope, scope);
    writeJson(paths.coreScope, coreScope);
    writeJson(paths.proofStoryboard, proofProjected);
    if (!stageIsValid(context, chunk.id, "authoring")) {
      const report = runScopedStoryboardCheck(proofProjected, scope);
      if (report.blockers || report.majors) {
        fatal(`${chunk.id} authoring quality failed (${report.blockers} blocker(s), ${report.majors} major issue(s)).`);
      }
      attest(context, chunk.id, "authoring");
    }
    console.log(`✅ ${chunk.id} authoring checkpoint`);

    if (!stageIsValid(context, chunk.id, "tts")) {
      if (!execute) fatal(`${chunk.id} needs TTS. Re-run with --execute after reviewing its authoring checkpoint.`);
      await runNodeScript(`${chunk.id}:tts-scenes`, "scripts/storyboard-to-tts.ts", ["--storyboard", paths.projection, "--out", paths.ttsScenes], 5 * 60_000, signal);
      const audioDir = path.dirname(paths.audio);
      await runConfiguredTts(
        `${chunk.id}:tts`,
        runConfig.value.tts,
        paths.ttsScenes,
        audioDir,
        index + 1 < plan.chunks.length,
        signal,
      );
      const generatedDurations = path.join(audioDir, "durations.json");
      if (!fs.existsSync(generatedDurations)) fatal(`${chunk.id} TTS did not write durations.json.`);
      fs.copyFileSync(generatedDurations, paths.durations);
      attest(context, chunk.id, "tts");
    }
    console.log(`✅ ${chunk.id} TTS checkpoint`);

    if (!stageIsValid(context, chunk.id, "alignment")) {
      if (!execute) fatal(`${chunk.id} needs alignment. Re-run with --execute after reviewing its TTS checkpoint.`);
      fs.mkdirSync(path.dirname(paths.words), { recursive: true });
      const alignArgs = [
        "--wav", paths.audio,
        "--outdir", path.dirname(paths.words),
        "--model", runConfig.value.alignment.model,
        "--scenes", paths.ttsScenes,
        "--durations", paths.durations,
      ];
      if (runConfig.value.alignment.language) alignArgs.push("--lang", runConfig.value.alignment.language);
      await runPython(`${chunk.id}:alignment`, "scripts/align_words.py", alignArgs, 2 * 60 * 60_000, signal);
      attest(context, chunk.id, "alignment");
    }
    console.log(`✅ ${chunk.id} alignment checkpoint`);

    if (!stageIsValid(context, chunk.id, "compile")) {
      if (!execute) fatal(`${chunk.id} needs compile. Re-run with --execute after reviewing its alignment checkpoint.`);
      const audioPublicPath = path.relative(path.resolve("public"), paths.audio).replace(/\\/g, "/");
      await runNodeScript(`${chunk.id}:compile`, "scripts/compile-storyboard.ts", [
        "--storyboard", paths.projection,
        "--out", paths.timeline,
        "--durations", paths.durations,
        "--words", paths.words,
        "--alignment", paths.alignment,
        "--audio", audioPublicPath,
        "--chunk-core",
      ], 15 * 60_000, signal);
      const raw = readBoundChunkTimeline(paths.timeline, "chunk-core", storyboard.scenes[0].id);
      const validation = validateTimeline(raw);
      const quality = runScopedQualityCheck(raw, coreScope, paths.timeline);
      const loaded = loadTimeline(raw);
      const spatial = checkSpatialIntegrity(loaded.timeline, raw.scenes.map((scene: any) => ({
        id: scene.id,
        start: scene.startFrame,
        end: scene.startFrame + scene.durationFrames,
      })));
      if (!validation.valid || quality.blockers || quality.majors || !spatial.passed) {
        fatal(`${chunk.id} compile quality failed (schema=${validation.valid}, quality=${quality.blockers}/${quality.majors}, spatial=${spatial.passed}).`);
      }
      attest(context, chunk.id, "compile");
    }
    console.log(`✅ ${chunk.id} compile checkpoint`);

    if (!stageIsValid(context, chunk.id, "visual-proof")) {
      if (!execute) fatal(`${chunk.id} needs visual proof. Re-run with --execute after reviewing its compile checkpoint.`);
      await runNodeScript(`${chunk.id}:proof-tts-scenes`, "scripts/storyboard-to-tts.ts", [
        "--storyboard", paths.proofStoryboard,
        "--out", paths.proofTtsScenes,
      ], 5 * 60_000, signal);
      const proofAudioDir = path.dirname(paths.proofAudio);
      await runConfiguredTts(
        `${chunk.id}:proof-tts`,
        runConfig.value.tts,
        paths.proofTtsScenes,
        proofAudioDir,
        false,
        signal,
      );
      const generatedProofDurations = path.join(proofAudioDir, "durations.json");
      if (!fs.existsSync(generatedProofDurations)) fatal(`${chunk.id} proof TTS did not write durations.json.`);
      fs.copyFileSync(generatedProofDurations, paths.proofDurations);
      await runPython(`${chunk.id}:proof-core-pcm`, "scripts/verify_proof_core_pcm.py", [
        "--core-audio", paths.audio,
        "--core-durations", paths.durations,
        "--proof-audio", paths.proofAudio,
        "--proof-durations", paths.proofDurations,
        "--out", paths.proofCorePcmVerification,
      ], 5 * 60_000, signal);
      fs.mkdirSync(path.dirname(paths.proofWords), { recursive: true });
      const proofAlignArgs = [
        "--wav", paths.proofAudio,
        "--outdir", path.dirname(paths.proofWords),
        "--model", runConfig.value.alignment.model,
        "--scenes", paths.proofTtsScenes,
        "--durations", paths.proofDurations,
      ];
      if (runConfig.value.alignment.language) proofAlignArgs.push("--lang", runConfig.value.alignment.language);
      await runPython(`${chunk.id}:proof-alignment`, "scripts/align_words.py", proofAlignArgs, 2 * 60 * 60_000, signal);
      const proofAudioPublicPath = path.relative(path.resolve("public"), paths.proofAudio).replace(/\\/g, "/");
      await runNodeScript(`${chunk.id}:proof-compile`, "scripts/compile-storyboard.ts", [
        "--storyboard", paths.proofStoryboard,
        "--out", paths.proofTimeline,
        "--durations", paths.proofDurations,
        "--words", paths.proofWords,
        "--alignment", paths.proofAlignment,
        "--audio", proofAudioPublicPath,
        "--quality-scope", paths.scope,
      ], 15 * 60_000, signal);
      const proofRaw = readBoundChunkTimeline(paths.proofTimeline, "chunk-proof", storyboard.scenes[0].id);
      const expectedProofIds = orderedSceneIdsForScope(scope);
      if (proofRaw.scenes.map((scene: any) => scene.id).join("\0") !== expectedProofIds.join("\0")) {
        fatal(`${chunk.id} proof timeline does not contain the exact declared seam scope.`);
      }
      await runNodeScript(`${chunk.id}:proof-render`, "scripts/render.ts", [
        "--timeline", paths.proofTimeline,
        "--out", paths.proofVideo,
        "--quality-scope", paths.scope,
        "--chunk-proof",
      ], 4 * 60 * 60_000, signal);
      attest(context, chunk.id, "visual-proof");
    }
    console.log(`✅ ${chunk.id} visual-proof checkpoint`);
  }

  if (!execute) console.log("ℹ️  Dry checkpoint pass only; --execute is required to synthesize, align, compile, or render missing chunk artifacts.");
}

void runWithProjectChunkLock(projectDir, {
  operation: "process-storyboard-chunks",
  mode: execute ? "execute" : "check",
  requestedChunk,
}, main).catch((error) => {
  console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = error instanceof ProjectChunkInterruptedError ? error.exitCode : 1;
});
