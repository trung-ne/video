import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";
import {
  checksumJson,
  checksumText,
  indexTranscript,
  makeSourceRange,
  validateStoryboardCoverage,
} from "../src/ai/transcriptCoverage";
import {
  CHUNK_ASSEMBLY_POLICY_VERSION,
  CHUNK_POLICY_VERSION,
  CHUNK_STAGES,
  ChunkStageContractContext,
  checksumArtifact,
  chunkPipelinePaths,
  chunkRunConfigPath,
  computeExpectedChunkStageContract,
  createStageAttestation,
  globalAuthoringReportPath,
  projectAudioIdentity,
  readStageAttestation,
  stageAttestationPath,
  validateChunkRunConfig,
  verifyChunkStage,
  writeStageAttestation,
} from "../src/engine/chunkAttestations";
import { verifyChunkAssemblyProvenance } from "../src/engine/chunkProvenance";
import { projectChunkLockPath } from "../src/engine/projectChunkLock";
import {
  ChunkAssemblyProvenance,
  ChunkPlan,
  ChunkRunConfig,
  ChunkStage,
  orderedSceneIdsForScope,
  qualityScopeForChunk,
} from "../src/types/chunk";
import { AlignedWord, Storyboard } from "../src/types/storyboard";

const ROOT = path.resolve(__dirname, "..");
const TS_NODE = require.resolve("ts-node/dist/bin.js");
const VOICE = "en-US-AvaNeural";
const LANGUAGE = "en";
const ALIGN_MODEL = "base";
const SAMPLE_RATE = 24_000;
const FPS = 30;
const SAMPLES_PER_SCENE = SAMPLE_RATE;
const GAP_SAMPLES = Math.round(SAMPLE_RATE * 0.08);
const FIXED_COMPLETION_DATES = [
  "2000-01-01T00:00:00.000Z",
  "2000-01-01T00:00:01.000Z",
  "2000-01-01T00:00:02.000Z",
  "2000-01-01T00:00:03.000Z",
  "2000-01-01T00:00:04.000Z",
];

type JsonRecord = Record<string, unknown>;
type TtsScene = { id: string; text: string; textSha256: string };
type CliExpectation = { succeeds: boolean; output?: RegExp };

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function combinedOutput(result: ReturnType<typeof spawnSync>): string {
  return `${String(result.stdout ?? "")}\n${String(result.stderr ?? "")}`;
}

function runTypeScriptCli(relativeScript: string, args: string[], expectation: CliExpectation): string {
  const result = spawnSync(process.execPath, [TS_NODE, path.join(ROOT, relativeScript), ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 180_000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  const output = combinedOutput(result);
  if (expectation.succeeds) {
    assert.strictEqual(result.status, 0, `${relativeScript} failed unexpectedly.\n${output}`);
  } else {
    assert.notStrictEqual(result.status, 0, `${relativeScript} unexpectedly succeeded.\n${output}`);
  }
  if (expectation.output) assert.match(output, expectation.output);
  return output;
}

function resolvePythonExecutable(): string {
  const candidates: Array<{ command: string; prefix: string[] }> = [];
  if (process.env.PYTHON) candidates.push({ command: process.env.PYTHON, prefix: [] });
  if (process.platform === "win32") candidates.push({ command: "py", prefix: ["-3.11"] });
  candidates.push({ command: "python", prefix: [] }, { command: "python3", prefix: [] });
  for (const candidate of candidates) {
    const result = spawnSync(candidate.command, [...candidate.prefix, "-c", "import sys; print(sys.executable)"], {
      cwd: ROOT,
      encoding: "utf8",
      windowsHide: true,
    });
    const executable = String(result.stdout ?? "").trim();
    if (result.status === 0 && executable) return executable;
  }
  throw new Error("This regression needs a local Python interpreter for the production sample-exact assembly helper.");
}

function runPythonCli(python: string, relativeScript: string, args: string[]): string {
  const result = spawnSync(python, [path.join(ROOT, relativeScript), ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 180_000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  const output = combinedOutput(result);
  assert.strictEqual(result.status, 0, `${relativeScript} failed unexpectedly.\n${output}`);
  return output;
}

function pythonJsonSha256(python: string, value: unknown): string {
  const code = [
    "import hashlib, json, sys",
    "value = json.load(sys.stdin)",
    "payload = json.dumps(value, ensure_ascii=False, sort_keys=True).encode('utf-8')",
    "print(hashlib.sha256(payload).hexdigest())",
  ].join("; ");
  const result = spawnSync(python, ["-c", code], {
    cwd: ROOT,
    encoding: "utf8",
    input: JSON.stringify(value),
    windowsHide: true,
  });
  if (result.error) throw result.error;
  const digest = String(result.stdout ?? "").trim();
  assert.strictEqual(result.status, 0, `Python JSON digest failed.\n${combinedOutput(result)}`);
  assert.match(digest, /^[a-f0-9]{64}$/);
  return digest;
}

function syntheticSceneSampleValue(sceneId: string): number {
  let hash = 17;
  for (const character of sceneId) hash = (hash * 31 + character.charCodeAt(0)) % 400;
  return (hash + 1) * 64;
}

function writeSyntheticPcmWav(filePath: string, sceneIds: string[], gapsAfter: number[]): void {
  assert.strictEqual(gapsAfter.length, sceneIds.length);
  const sampleWidth = 2;
  const channels = 1;
  const totalSamples = sceneIds.length * SAMPLES_PER_SCENE + gapsAfter.reduce((sum, gap) => sum + gap, 0);
  const dataBytes = totalSamples * sampleWidth * channels;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(SAMPLE_RATE, 24);
  wav.writeUInt32LE(SAMPLE_RATE * channels * sampleWidth, 28);
  wav.writeUInt16LE(channels * sampleWidth, 32);
  wav.writeUInt16LE(sampleWidth * 8, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(dataBytes, 40);
  let sampleOffset = 0;
  for (const [sceneIndex, sceneId] of sceneIds.entries()) {
    const value = syntheticSceneSampleValue(sceneId);
    for (let localSample = 0; localSample < SAMPLES_PER_SCENE; localSample++) {
      const sample = sampleOffset + localSample;
      wav.writeInt16LE(localSample % 997 === 0 ? value : 0, 44 + sample * sampleWidth);
    }
    sampleOffset += SAMPLES_PER_SCENE + gapsAfter[sceneIndex];
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, wav);
}

function materializeMeasuredArtifacts(input: {
  storyboard: string;
  ttsScenes: string;
  audio: string;
  durations: string;
  words: string;
  alignment: string;
  python: string;
  terminalGap: boolean;
}): void {
  runTypeScriptCli("scripts/storyboard-to-tts.ts", [
    "--storyboard", input.storyboard,
    "--out", input.ttsScenes,
  ], { succeeds: true });
  const ttsScenes = readJson<TtsScene[]>(input.ttsScenes);
  assert.ok(ttsScenes.length > 0);

  const gapsAfter = ttsScenes.map((_, index) =>
    index + 1 < ttsScenes.length || input.terminalGap ? GAP_SAMPLES : 0);
  let cumulativeSamples = 0;
  const frameBoundary = (samples: number) => Math.floor(
    (2 * samples * FPS + SAMPLE_RATE) / (2 * SAMPLE_RATE),
  );
  const durationScenes = ttsScenes.map((scene, index) => {
    const startSample = cumulativeSamples;
    const gapSamples = gapsAfter[index];
    const samples = SAMPLES_PER_SCENE + gapSamples;
    cumulativeSamples += samples;
    const startFrame = frameBoundary(startSample);
    const endFrame = frameBoundary(cumulativeSamples);
    return {
      id: scene.id,
      startSample,
      samples,
      speechSamples: SAMPLES_PER_SCENE,
      gapSamples,
      gapPlacement: gapSamples === 0 ? "none" : index + 1 < ttsScenes.length ? "inter-scene" : "terminal",
      startFrame,
      frames: endFrame - startFrame,
    };
  });
  const totalSamples = cumulativeSamples;
  const totalFrames = frameBoundary(totalSamples);
  writeSyntheticPcmWav(input.audio, ttsScenes.map((scene) => scene.id), gapsAfter);
  const gapCount = gapsAfter.filter((samples) => samples > 0).length;
  const interSceneGapCount = Math.max(0, ttsScenes.length - 1);
  writeJson(input.durations, {
    fps: FPS,
    sampleRate: SAMPLE_RATE,
    totalSamples,
    totalSec: totalSamples / SAMPLE_RATE,
    totalFrames,
    frameBoundaryPolicy: "cumulative-samples-js-round-v1",
    gapPolicy: {
      version: "edge-gap-0.08-v1",
      rawClipIncludesGap: false,
      configuredSeconds: 0.08,
      effectiveSamples: GAP_SAMPLES,
      effectiveSeconds: GAP_SAMPLES / SAMPLE_RATE,
    },
    ttsMetrics: {
      chunkCount: ttsScenes.length,
      gapCount,
      interSceneGapCount,
      terminalGapCount: input.terminalGap ? 1 : 0,
      maxInterSceneGapSeconds: interSceneGapCount > 0 ? GAP_SAMPLES / SAMPLE_RATE : 0,
      totalGapSeconds: gapsAfter.reduce((sum, samples) => sum + samples, 0) / SAMPLE_RATE,
      gapShare: gapsAfter.reduce((sum, samples) => sum + samples, 0) / totalSamples,
      wallClockSeconds: 0.1,
    },
    scenes: durationScenes,
    testOnlySyntheticTiming: true,
  });

  let canonicalWordIndex = 0;
  const words: Array<AlignedWord & { interpolated: boolean }> = [];
  for (const [sceneIndex, scene] of ttsScenes.entries()) {
    const tokens = indexTranscript(scene.text).map((word) => word.text);
    assert.ok(tokens.length > 0, `${scene.id} has no alignable fixture tokens.`);
    const sceneStartSec = durationScenes[sceneIndex].startSample / SAMPLE_RATE;
    for (const [sceneWordIndex, word] of tokens.entries()) {
      words.push({
        scene: scene.id,
        sceneWordIndex,
        canonicalWordIndex: canonicalWordIndex++,
        word,
        startSec: sceneStartSec + sceneWordIndex / tokens.length,
        endSec: sceneStartSec + (sceneWordIndex + 1) / tokens.length,
        confidence: 1,
        interpolated: false,
      });
    }
  }
  writeJson(input.words, words);
  writeJson(input.alignment, {
    schemaVersion: 1,
    source: "canonical-tts-scenes",
    canonicalWordCount: words.length,
    matchedWordCount: words.length,
    interpolatedWordCount: 0,
    coverage: 1,
    matchedCoverage: 1,
    sceneCount: ttsScenes.length,
    ttsScenesSha256: pythonJsonSha256(input.python, ttsScenes),
    language: LANGUAGE,
    testOnlySyntheticAlignment: true,
  });
}

function publicAudioReference(audioPath: string): string {
  const relative = path.relative(path.join(ROOT, "public"), audioPath);
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative), `${audioPath} is not under public/.`);
  return relative.replace(/\\/g, "/");
}

function compileMeasuredTimeline(input: {
  storyboard: string;
  timeline: string;
  durations: string;
  words: string;
  alignment: string;
  audio: string;
  qualityScope?: string;
  role: "chunk-core" | "chunk-proof";
  projectOpeningSceneId: string;
  expectedSceneIds: string[];
}): void {
  assert.strictEqual(Boolean(input.qualityScope), input.role === "chunk-proof");
  const scopedArgs = input.role === "chunk-proof"
    ? ["--quality-scope", input.qualityScope!]
    : ["--chunk-core"];
  runTypeScriptCli("scripts/compile-storyboard.ts", [
    "--storyboard", input.storyboard,
    "--out", input.timeline,
    "--durations", input.durations,
    "--words", input.words,
    "--alignment", input.alignment,
    "--audio", publicAudioReference(input.audio),
    ...scopedArgs,
  ], { succeeds: true });
  const timeline = readJson<any>(input.timeline);
  assert.strictEqual(timeline.artifactRole, input.role);
  assert.strictEqual(timeline.projectOpeningSceneId, input.projectOpeningSceneId);
  assert.deepStrictEqual(timeline.scenes.map((scene: any) => scene.id), input.expectedSceneIds);
}

function makeCompleteStoryboard(): { transcript: string; storyboard: Storyboard } {
  const transcript = "Rates move first. Budgets answer next.";
  const words = indexTranscript(transcript);
  const firstRange = makeSourceRange(words, 0, 2);
  const secondRange = makeSourceRange(words, 3, 5);
  const storyboard: Storyboard = {
    schemaVersion: 2,
    transcriptChecksum: checksumText(transcript),
    promptVersion: "test-only-route-a-chunk-integration-v1",
    fps: FPS,
    width: 1920,
    height: 1080,
    sections: [
      {
        id: "signal",
        sourceRange: firstRange,
        thesis: "The leading signal moves before the response.",
        emotionalTurn: "recognition",
        energyCurve: "build",
        targetDurationSeconds: 1,
        treatmentSequence: ["evidence"],
        heroConcept: "leading signal",
        noCharacterOpportunity: true,
      },
      {
        id: "response",
        sourceRange: secondRange,
        thesis: "The budget responds after the signal.",
        emotionalTurn: "resolution",
        energyCurve: "release",
        targetDurationSeconds: 1,
        treatmentSequence: ["evidence"],
        heroConcept: "measured response",
        noCharacterOpportunity: true,
        visualContrastFromPreviousSection: "cool signal card becomes a warm response card",
      },
    ],
    claims: [],
    visualTreatmentPlan: {
      registerTargets: { evidence: 1 },
      characterFreeTarget: 1,
      heroConcepts: ["leading signal", "measured response"],
      visualMotifs: ["paired evidence cards"],
      forbiddenRepeats: ["decorative presenter"],
      usageBudgets: {
        maximumAssetUses: 2,
        maximumStageRatio: 0.05,
        maximumPoseRatio: 0.08,
        maximumConsecutiveSameStage: 2,
        maximumPhotoTreatmentRatio: 0.35,
        maximumStatRevealRatio: 0.08,
      },
      requiredVisualModes: ["evidence-card", "cold-open", "cause", "response", "contrast", "resolution"],
      heroCadenceSeconds: 45,
      paletteProfile: "editorial-muted-v2",
    },
    authoringDecision: {
      policyVersion: "scene-density-v1",
      transcriptWords: words.length,
      minimumScenes: Math.ceil(words.length / 40),
      authoredScenes: 2,
      longVideo: false,
      sectionsRequired: false,
      passed: true,
    },
    generation: {
      provider: "test-only-offline-fixture",
      model: "none",
      passIds: ["controlled-semantic-plan"],
    },
    scenes: [
      {
        id: "scene-signal",
        narration: "Rates move first.",
        purpose: "Establish the leading signal.",
        emotion: "urgent",
        viewerFocus: "The first evidence card.",
        visualGrammar: "EVIDENCE",
        sectionId: "signal",
        sourceRange: firstRange,
        visualRegister: "evidence",
        semanticVisual: {
          subject: "signal evidence card",
          action: "appears before the response",
          object: "rate movement",
          takeaway: "Rates move first.",
        },
        heroVisual: true,
        focalType: "evidence",
        characterRequired: false,
        visualFingerprint: "test-only:cool-leading-signal-document",
        silentFrameTakeaway: "The signal leads.",
        focalOccupancyTarget: 0.6,
        noveltyFromPrevious: ["cold-open document evidence"],
        unresolvedAssetRequests: [],
        captionTreatment: "source-label",
        evidenceTreatment: "document",
        slots: {
          title: "LEADING SIGNAL",
          body: "Rates move first.",
          source: "TEST-ONLY FIXTURE",
          date: "2000-01-01",
        },
      },
      {
        id: "scene-response",
        narration: "Budgets answer next.",
        purpose: "Resolve the relationship with the response.",
        emotion: "hopeful",
        viewerFocus: "The second evidence card.",
        visualGrammar: "EVIDENCE",
        sectionId: "response",
        sourceRange: secondRange,
        visualRegister: "evidence",
        semanticVisual: {
          subject: "budget evidence card",
          action: "answers after the signal",
          object: "budget response",
          takeaway: "Budgets answer next.",
        },
        heroVisual: false,
        focalType: "evidence",
        characterRequired: false,
        visualFingerprint: "test-only:warm-budget-response-document",
        silentFrameTakeaway: "The response follows.",
        focalOccupancyTarget: 0.6,
        noveltyFromPrevious: ["new evidence subject", "release energy", "warm treatment"],
        unresolvedAssetRequests: [],
        captionTreatment: "source-label",
        evidenceTreatment: "document",
        slots: {
          title: "MEASURED RESPONSE",
          body: "Budgets answer next.",
          source: "TEST-ONLY FIXTURE",
          date: "2000-01-02",
        },
      },
    ],
  };
  return { transcript, storyboard };
}

function assertLockReleased(projectDir: string): void {
  assert.ok(!fs.existsSync(projectChunkLockPath(projectDir)), "The shared process/assembly project writer lock leaked.");
}

function processArgs(projectDir: string): string[] {
  return [
    "--project", projectDir,
    "--voice", VOICE,
    "--align-model", ALIGN_MODEL,
    "--lang", LANGUAGE,
  ];
}

function assertExactProjection(context: ChunkStageContractContext, chunkIndex: number): void {
  const chunk = context.plan.chunks[chunkIndex];
  const paths = chunkPipelinePaths(context.projectDir, chunk.id);
  const scope = qualityScopeForChunk(context.plan, chunk.id);
  const coreScope = { ...scope, haloBeforeSceneIds: [], haloAfterSceneIds: [] };
  const orderedProofIds = orderedSceneIdsForScope(scope);
  assert.strictEqual(chunk.sceneIds.length, 1, `${chunk.id} must have one core scene.`);
  assert.strictEqual(scope.haloBeforeSceneIds.length + scope.haloAfterSceneIds.length, 1, `${chunk.id} must have one exact seam halo.`);
  assert.deepStrictEqual(readJson(paths.scope), scope);
  assert.deepStrictEqual(readJson(paths.coreScope), coreScope);
  assert.deepStrictEqual(readJson<Storyboard>(paths.projection).scenes.map((scene) => scene.id), chunk.sceneIds);
  assert.deepStrictEqual(readJson<Storyboard>(paths.proofStoryboard).scenes.map((scene) => scene.id), orderedProofIds);
}

function sealStage(context: ChunkStageContractContext, chunkId: string, stage: ChunkStage): void {
  const contract = computeExpectedChunkStageContract(context, chunkId, stage);
  assert.deepStrictEqual(contract.missingInputs, [], `${chunkId} ${stage} has missing bound inputs.`);
  for (const [name, outputPath] of Object.entries(contract.outputPaths)) {
    assert.ok(fs.existsSync(outputPath), `${chunkId} ${stage} output ${name} is missing.`);
  }
  const receipt = createStageAttestation({
    chunkId,
    stage,
    inputHashes: { ...contract.inputHashes },
    outputHashes: Object.fromEntries(
      Object.entries(contract.outputPaths).map(([name, outputPath]) => [name, checksumArtifact(outputPath)]),
    ),
    policyVersion: CHUNK_POLICY_VERSION,
    thresholdProfileHash: context.runConfig.proof.qualityProfileHash,
    passed: true,
    blockerCount: 0,
    majorCount: 0,
    completedAt: FIXED_COMPLETION_DATES[CHUNK_STAGES.indexOf(stage)],
  });
  writeStageAttestation(stageAttestationPath(context.projectDir, chunkId, stage), receipt);
  assert.deepStrictEqual(verifyChunkStage(context, chunkId, stage), []);
}

function writeFakeProofOutputs(context: ChunkStageContractContext, chunkId: string): void {
  const contract = computeExpectedChunkStageContract(context, chunkId, "visual-proof");
  const created: string[] = [];
  for (const [name, outputPath] of Object.entries(contract.outputPaths)) {
    if (fs.existsSync(outputPath)) continue;
    created.push(name);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    if (path.extname(outputPath).toLowerCase() === ".json") {
      writeJson(outputPath, {
        schemaVersion: 0,
        testOnly: true,
        fixtureKind: `FAKE_${name.toUpperCase()}_AUDIT_PAYLOAD`,
        passed: true,
        notice: "Hash-lineage regression only; no production audit tool ran.",
      });
    } else {
      fs.writeFileSync(outputPath, Buffer.from(`TEST-ONLY FAKE ${name.toUpperCase()} MEDIA PLACEHOLDER\n`, "utf8"));
    }
  }
  assert.deepStrictEqual(created.sort(), ["audioAudit", "contactSheet", "encodingAudit", "report", "video", "visualAudit"].sort());
}

function materializeChunk(context: ChunkStageContractContext, chunkIndex: number, python: string): void {
  const chunk = context.plan.chunks[chunkIndex];
  const paths = chunkPipelinePaths(context.projectDir, chunk.id);
  const scope = qualityScopeForChunk(context.plan, chunk.id);
  const proofSceneIds = orderedSceneIdsForScope(scope);
  assertExactProjection(context, chunkIndex);
  sealStage(context, chunk.id, "authoring");

  materializeMeasuredArtifacts({
    storyboard: paths.projection,
    ttsScenes: paths.ttsScenes,
    audio: paths.audio,
    durations: paths.durations,
    words: paths.words,
    alignment: paths.alignment,
    python,
    terminalGap: chunkIndex + 1 < context.plan.chunks.length,
  });
  sealStage(context, chunk.id, "tts");
  sealStage(context, chunk.id, "alignment");
  compileMeasuredTimeline({
    storyboard: paths.projection,
    timeline: paths.timeline,
    durations: paths.durations,
    words: paths.words,
    alignment: paths.alignment,
    audio: paths.audio,
    role: "chunk-core",
    projectOpeningSceneId: context.storyboard.scenes[0].id,
    expectedSceneIds: chunk.sceneIds,
  });
  sealStage(context, chunk.id, "compile");

  materializeMeasuredArtifacts({
    storyboard: paths.proofStoryboard,
    ttsScenes: paths.proofTtsScenes,
    audio: paths.proofAudio,
    durations: paths.proofDurations,
    words: paths.proofWords,
    alignment: paths.proofAlignment,
    python,
    terminalGap: false,
  });
  runPythonCli(python, "scripts/verify_proof_core_pcm.py", [
    "--core-audio", paths.audio,
    "--core-durations", paths.durations,
    "--proof-audio", paths.proofAudio,
    "--proof-durations", paths.proofDurations,
    "--out", paths.proofCorePcmVerification,
  ]);
  const pcmVerification = readJson<any>(paths.proofCorePcmVerification);
  assert.strictEqual(pcmVerification.policy, "proof-core-pcm-identity-v1");
  assert.deepStrictEqual(pcmVerification.coreSceneIds, chunk.sceneIds);
  assert.strictEqual(pcmVerification.samples, readJson<any>(paths.durations).totalSamples);
  assert.match(pcmVerification.pcmSha256, /^[a-f0-9]{64}$/);

  compileMeasuredTimeline({
    storyboard: paths.proofStoryboard,
    timeline: paths.proofTimeline,
    durations: paths.proofDurations,
    words: paths.proofWords,
    alignment: paths.proofAlignment,
    audio: paths.proofAudio,
    qualityScope: paths.scope,
    role: "chunk-proof",
    projectOpeningSceneId: context.storyboard.scenes[0].id,
    expectedSceneIds: proofSceneIds,
  });
  writeFakeProofOutputs(context, chunk.id);
  sealStage(context, chunk.id, "visual-proof");
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => path.resolve(value).replace(/\\/g, "/").toLowerCase();
  return normalize(left) === normalize(right);
}

function main(): void {
  const python = resolvePythonExecutable();
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cat-route-a-chunk-integration-"));
  const projectDir = path.join(fixtureRoot, "route-a-two-section-fixture");
  const projectId = path.basename(projectDir);
  const audioIdentity = projectAudioIdentity(projectDir);
  const chunkAudioRoot = path.join(ROOT, "public", "audio", "chunks", audioIdentity);
  const canonicalAudioRoot = path.join(ROOT, "public", "audio", audioIdentity);
  fs.rmSync(chunkAudioRoot, { recursive: true, force: true });
  fs.rmSync(canonicalAudioRoot, { recursive: true, force: true });
  fs.mkdirSync(projectDir, { recursive: true });

  try {
    const { transcript, storyboard } = makeCompleteStoryboard();
    const storyboardPath = path.join(projectDir, "storyboard.json");
    fs.writeFileSync(path.join(projectDir, "transcript.txt"), `${transcript}\n`, "utf8");
    writeJson(storyboardPath, storyboard);
    const coverage = validateStoryboardCoverage(transcript, storyboard);
    assert.strictEqual(coverage.valid, true, JSON.stringify(coverage.issues));
    assert.strictEqual(storyboard.authoringDecision?.passed, true);
    assert.ok(storyboard.visualTreatmentPlan, "Fixture must carry a complete semantic visual treatment plan.");

    runTypeScriptCli("scripts/plan-chunks.ts", [
      "--project", projectDir,
      "--target-seconds", "1",
      "--maximum-seconds", "1",
    ], { succeeds: true, output: /Chunk plan: 2 chunk\(s\)/ });
    const planPath = path.join(projectDir, "chunks", "chunk-plan.json");
    const plan = readJson<ChunkPlan>(planPath);
    assert.strictEqual(plan.schemaVersion, 2);
    assert.strictEqual(plan.plannerVersion, CHUNK_POLICY_VERSION);
    assert.strictEqual(plan.storyboardChecksum, checksumJson(storyboard));
    assert.deepStrictEqual(plan.chunks.map((chunk) => chunk.sectionIds), [["signal"], ["response"]]);
    assert.deepStrictEqual(plan.chunks.map((chunk) => chunk.sceneIds), [["scene-signal"], ["scene-response"]]);

    const firstChunk = plan.chunks[0];
    const secondChunk = plan.chunks[1];
    runTypeScriptCli("scripts/process-storyboard-chunks.ts", [
      ...processArgs(projectDir),
      "--chunk", firstChunk.id,
    ], { succeeds: false, output: /needs TTS/ });
    assertLockReleased(projectDir);

    const runConfigPath = chunkRunConfigPath(projectDir);
    const authoringReportPath = globalAuthoringReportPath(projectDir);
    assert.ok(fs.existsSync(authoringReportPath), "Global authoring checkpoint was not persisted before TTS.");
    const authoringReportChecksum = checksumArtifact(authoringReportPath);
    const runConfig = readJson<ChunkRunConfig>(runConfigPath);
    assert.strictEqual(runConfig.globalAuthoringReportChecksum, authoringReportChecksum);
    assert.deepStrictEqual(validateChunkRunConfig(runConfig, {
      projectId,
      policyVersion: CHUNK_POLICY_VERSION,
      planChecksum: checksumArtifact(planPath),
      storyboardChecksum: checksumJson(storyboard),
    }), []);
    assert.strictEqual(runConfig.alignment.language, LANGUAGE);
    const immutableRunConfigChecksum = checksumArtifact(runConfigPath);
    const context: ChunkStageContractContext = {
      projectDir,
      storyboardPath,
      planPath,
      runConfigPath,
      storyboard,
      plan,
      runConfig,
    };
    assert.ok(
      computeExpectedChunkStageContract(context, firstChunk.id, "authoring")
        .inputHashes.chunkSource,
    );

    materializeChunk(context, 0, python);
    runTypeScriptCli("scripts/process-storyboard-chunks.ts", [
      ...processArgs(projectDir),
      "--chunk", secondChunk.id,
    ], { succeeds: false, output: /needs TTS/ });
    assertLockReleased(projectDir);
    materializeChunk(context, 1, python);

    let receiptCount = 0;
    for (const chunk of plan.chunks) {
      for (const stage of CHUNK_STAGES) {
        const receipt = readStageAttestation(stageAttestationPath(projectDir, chunk.id, stage));
        assert.ok(receipt, `${chunk.id} ${stage} receipt is missing.`);
        assert.deepStrictEqual(receipt!.inputHashes, computeExpectedChunkStageContract(context, chunk.id, stage).inputHashes);
        assert.deepStrictEqual(verifyChunkStage(context, chunk.id, stage), []);
        receiptCount++;
      }
    }
    assert.strictEqual(receiptCount, plan.chunks.length * CHUNK_STAGES.length);

    const predecessorReceiptPath = stageAttestationPath(projectDir, firstChunk.id, "visual-proof");
    const secondAuthoringContract = computeExpectedChunkStageContract(context, secondChunk.id, "authoring");
    assert.ok(secondAuthoringContract.inputHashes.chunkSource);
    assert.ok(!secondAuthoringContract.inputHashes.previousVisualProof);
    const predecessorReceiptBytes = fs.readFileSync(predecessorReceiptPath);
    const driftedPredecessor = readJson<any>(predecessorReceiptPath);
    driftedPredecessor.passed = false;
    writeJson(predecessorReceiptPath, driftedPredecessor);
    runTypeScriptCli("scripts/process-storyboard-chunks.ts", [
      ...processArgs(projectDir),
      "--chunk", secondChunk.id,
    ], { succeeds: false, output: /is locked/ });
    assertLockReleased(projectDir);
    fs.writeFileSync(predecessorReceiptPath, predecessorReceiptBytes);
    assert.deepStrictEqual(verifyChunkStage(context, firstChunk.id, "visual-proof"), []);
    assert.deepStrictEqual(verifyChunkStage(context, secondChunk.id, "authoring"), []);

    runTypeScriptCli("scripts/process-storyboard-chunks.ts", [
      "--project", projectDir,
      "--voice", "en-US-GuyNeural",
      "--align-model", ALIGN_MODEL,
      "--lang", LANGUAGE,
      "--chunk", firstChunk.id,
    ], { succeeds: false, output: /settings changed/ });
    assertLockReleased(projectDir);
    assert.strictEqual(checksumArtifact(runConfigPath), immutableRunConfigChecksum, "A rejected resume mutated the immutable run config.");

    runTypeScriptCli("scripts/process-storyboard-chunks.ts", processArgs(projectDir), {
      succeeds: true,
      output: /Dry checkpoint pass only/,
    });
    assertLockReleased(projectDir);
    for (const chunk of plan.chunks) {
      for (const stage of CHUNK_STAGES) assert.deepStrictEqual(verifyChunkStage(context, chunk.id, stage), []);
    }

    const priorCanonical = new Map<string, Buffer>([
      [path.join(projectDir, "tts_scenes.json"), Buffer.from("prior-tts")],
      [path.join(canonicalAudioRoot, "voice.wav"), Buffer.from("prior-audio")],
      [path.join(projectDir, "durations.json"), Buffer.from("prior-durations")],
      [path.join(projectDir, "words.json"), Buffer.from("prior-words")],
      [path.join(projectDir, "alignment.json"), Buffer.from("prior-alignment")],
      [path.join(projectDir, "chunk-assembly-provenance.json"), Buffer.from("prior-provenance")],
      [path.join(projectDir, "timeline.json"), Buffer.from("prior-timeline")],
    ]);
    for (const [filePath, bytes] of priorCanonical) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, bytes);
    }
    const corruptedDurationPath = chunkPipelinePaths(projectDir, firstChunk.id).durations;
    const measuredDurationBytes = fs.readFileSync(corruptedDurationPath);
    const corruptedDurations = readJson<any>(corruptedDurationPath);
    corruptedDurations.scenes = [];
    writeJson(corruptedDurationPath, corruptedDurations);
    runTypeScriptCli("scripts/assemble-storyboard-chunks.ts", [
      "--project", projectDir,
      "--execute",
      "--python", python,
      "--lang", LANGUAGE,
    ], { succeeds: false, output: /stale chunks/i });
    assertLockReleased(projectDir);
    for (const [filePath, bytes] of priorCanonical) {
      assert.deepStrictEqual(fs.readFileSync(filePath), bytes, `Failed candidate assembly changed ${filePath}.`);
    }
    assert.ok(!fs.readdirSync(projectDir).some((name) => name.startsWith(".chunk-assembly-")));
    assert.ok(!fs.readdirSync(canonicalAudioRoot).some((name) => name.startsWith(".chunk-assembly-")));
    fs.writeFileSync(corruptedDurationPath, measuredDurationBytes);
    assert.deepStrictEqual(verifyChunkStage(context, firstChunk.id, "tts"), []);

    runTypeScriptCli("scripts/assemble-storyboard-chunks.ts", [
      "--project", projectDir,
      "--execute",
      "--python", python,
      "--lang", LANGUAGE,
    ], { succeeds: true, output: /Assembled 2 fully proven chunks/ });
    assertLockReleased(projectDir);

    assert.ok(
      !fs.existsSync(path.join(projectDir, "chunks", "assembly-inputs.json")),
      "Ephemeral assembly input manifest escaped the transactional staging directory.",
    );

    const canonicalDurations = readJson<any>(path.join(projectDir, "durations.json"));
    assert.strictEqual(canonicalDurations.totalSamples, 2 * SAMPLES_PER_SCENE + GAP_SAMPLES);
    assert.deepStrictEqual(canonicalDurations.scenes.map((scene: any) => ({
      id: scene.id,
      startSample: scene.startSample,
      samples: scene.samples,
      startFrame: scene.startFrame,
      frames: scene.frames,
    })), [
      { id: "scene-signal", startSample: 0, samples: SAMPLES_PER_SCENE + GAP_SAMPLES, startFrame: 0, frames: 32 },
      { id: "scene-response", startSample: SAMPLES_PER_SCENE + GAP_SAMPLES, samples: SAMPLES_PER_SCENE, startFrame: 32, frames: FPS },
    ]);
    const canonicalWords = readJson<AlignedWord[]>(path.join(projectDir, "words.json"));
    assert.deepStrictEqual(canonicalWords.map((word) => word.canonicalWordIndex), canonicalWords.map((_, index) => index));
    assert.ok(canonicalWords.find((word) => word.scene === "scene-response")!.startSec >= 1.08);

    const timelinePath = path.join(projectDir, "timeline.json");
    const timeline = readJson<any>(timelinePath);
    assert.deepStrictEqual(timeline.scenes.map((scene: any) => scene.id), storyboard.scenes.map((scene) => scene.id));
    const sidecar = readJson<ChunkAssemblyProvenance>(path.join(projectDir, "chunk-assembly-provenance.json"));
    assert.strictEqual(sidecar.schemaVersion, 3);
    assert.strictEqual(sidecar.assemblyPolicyVersion, CHUNK_ASSEMBLY_POLICY_VERSION);
    assert.deepStrictEqual(sidecar.chunkOrder, plan.chunks.map((chunk) => chunk.id));
    assert.deepStrictEqual(timeline.chunkAssemblyProvenance, sidecar);
    assert.deepStrictEqual(verifyChunkAssemblyProvenance(projectDir, timeline), []);

    const driftTarget = chunkPipelinePaths(projectDir, firstChunk.id).timeline;
    const originalCoreTimeline = fs.readFileSync(driftTarget);
    const driftedCoreTimeline = readJson<JsonRecord>(driftTarget);
    driftedCoreTimeline.testOnlyDeliberateDrift = true;
    writeJson(driftTarget, driftedCoreTimeline);
    const driftIssues = verifyChunkAssemblyProvenance(projectDir, timeline);
    assert.ok(driftIssues.some((issue) => issue.code === "CHUNK_ARTIFACT_DRIFT"), JSON.stringify(driftIssues));
    assert.ok(driftIssues.some((issue) => issue.code === "CHUNK_ATTESTATION_INVALID"), JSON.stringify(driftIssues));
    fs.writeFileSync(driftTarget, originalCoreTimeline);
    assert.deepStrictEqual(verifyChunkAssemblyProvenance(projectDir, timeline), []);

    console.log("PASS: controlled two-section Route A chunk integration (10 receipts, dry resume, core-only assembly, v3 provenance, drift rejection).");
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
    fs.rmSync(chunkAudioRoot, { recursive: true, force: true });
    fs.rmSync(canonicalAudioRoot, { recursive: true, force: true });
  }
}

main();
