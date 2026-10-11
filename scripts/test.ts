import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";
import { indexTranscript, makeSourceRange, validateStoryboardCoverage, checksumJson } from "../src/ai/transcriptCoverage";
import { Storyboard } from "../src/types/storyboard";
import { resolveAssetRequest, resolveAssetRequests } from "../src/engine/assetResolver";
import { AssetManifest } from "../src/types/assets";
import { compileStoryboard } from "../src/engine/storyboardCompiler";
import { assertStyleInventory, assertTimelineAssetStyle, requestedAssetStyle, styleManifestHash } from "../src/engine/assetStyle";
import {
  measureTeachingTextCoverage,
  runQualityCheck,
  runStoryboardCheck,
  runScopedQualityCheck,
  runScopedStoryboardCheck,
} from "../src/ai/qualityCheck";
import { stageMatchesSetting } from "../src/engine/stageRegistry";
import { critiqueSceneBriefs } from "../src/ai/visualCritic";
import { validateTimeline } from "../src/ai/validateTimeline";
import {
  checkSceneIdAlignment,
  checkCompiledTimings,
  checkTimelineSpansAudio,
  checkRenderMatchesTimeline,
  checkWordAlignment,
  checkTimingProvenance,
  checkSceneBeatTimingSources,
  hasBlocker,
} from "../src/engine/timingIntegrity";
import { canonicalJsonChecksum, verifyArtifactInputs } from "../src/engine/artifactIntegrity";
import { promoteArtifacts, pruneRunHistory, shouldPreserveFailedMp4 } from "../src/engine/promoteArtifacts";
import { acquireRenderLock } from "../src/engine/renderLock";
import {
  acquireProjectChunkLock,
  PROJECT_CHUNK_LOCK_STALE_MS,
  ProjectChunkInterruptedError,
  ProjectChunkLockOwner,
  projectChunkLockPath,
  runWithProjectChunkLock,
} from "../src/engine/projectChunkLock";
import { buildReferenceComparison } from "../src/engine/referenceComparison";
import {
  assertVisualAuditReport,
  assertVisualMeasurementConfiguration,
  expectedVisualSampleSchedule,
  normalizeVisualAuditOffsets,
} from "../src/engine/visualAuditIntegrity";
import { VISUAL_GRAMMARS } from "../src/engine/visualGrammars";
import { compileScenes } from "../src/engine/sceneCompiler";
import { injectLiveliness } from "../src/engine/liveliness";
import { resolveAuthoredAssets } from "../src/engine/authoredAssets";
import { approvedPhotoPaths, isApprovedNoFacePhoto } from "../src/engine/photoPolicy";
import { fitTextToBox } from "../src/engine/textLayout";
import { getPaletteSaturationScale, listManifestAssetPaths, listResolvableRefs } from "../src/engine/assetPaths";
import { buildSystemPrompt, listAvailableAssets, listAvailableBackgrounds } from "../src/ai/systemPrompt";
import { DEFAULT_PROXY_SCALE, getScaledDimensions } from "../src/engine/renderDimensions";
import { checkSpatialIntegrity, visibleAssetBox } from "../src/engine/spatialIntegrity";
import { getEnterAnimation } from "../src/animations";
import { animationForEntranceStyle, normalizeEntranceAnimation, selectEntranceStyle } from "../src/engine/entrancePolicy";
import {
  authoredCadenceIssues,
  authoredTransitionCapabilityIssues,
  containsCanonicalPhrase,
  maximumVisualHold,
  requiredAuthoredTransitions,
} from "../src/engine/visualCadence";
import { estimateStablePaintedRatio } from "../src/engine/compositionDensity";
import {
  isLongVideoWordCount,
  orderedSceneIdsForScope,
  parseQualityScope,
  planSemanticChunks,
  qualityScopeForChunk,
  verifyCanonicalChunkPlan,
} from "../src/types/chunk";
import {
  CHUNK_ASSEMBLY_POLICY_VERSION,
  CHUNK_POLICY_VERSION,
  CHUNK_STAGES,
  checksumArtifact,
  chunkPipelinePaths,
  chunkRunConfigPath,
  computeExpectedChunkStageContract,
  createChunkRunConfig,
  createStageAttestation,
  globalAuthoringReportPath,
  productionToolchainFiles,
  projectAudioIdentity,
  stageAttestationPath,
  validateChunkRunConfig,
  verifyStageAttestation,
  writeStageAttestation,
  readStageAttestation,
} from "../src/engine/chunkAttestations";
import {
  assembleChunkDurations,
  projectStoryboardForChunk,
  projectStoryboardForQualityScope,
  promoteChunkAssemblyArtifacts,
  verifyChunkAssembly,
} from "../src/engine/chunkAssembly";
import {
  computeChunkAssemblyToolchainHashes,
  verifyChunkAssemblyProvenance,
} from "../src/engine/chunkProvenance";
import referenceQuality from "../config/reference-quality.json";
import { resolveStableSceneIds } from "../src/engine/sceneIdentity";
import { ProcessRunError, runProcess, shouldRetryDllInitFailure, STATUS_DLL_INIT_FAILED } from "../src/engine/childProcessRunner";
import { sha256File } from "../src/audio/prepareAudio";
import {
  assertChunkProofBindingUnchanged,
  bindChunkProofToProject,
} from "../src/engine/chunkProofIntegrity";
import {
  assertBoundTimelineIdentity,
  assertCanonicalTimelinePath,
  assertExactManualContactSheetReview,
  assertOutputProjectIdentity,
  buildCanonicalTimelineIdentity,
} from "../src/engine/publicationIntegrity";

type Test = { name: string; run: () => void | Promise<void> };
const tests: Test[] = [];
function test(name: string, run: () => void): void {
  tests.push({ name, run });
}

function writeTestGlobalAuthoringReport(projectDir: string): string {
  const reportPath = globalAuthoringReportPath(projectDir);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify({
    schemaVersion: 1,
    policyVersion: "route-a-global-authoring-v1",
    passed: true,
    testOnly: true,
  }));
  return reportPath;
}

test("Route B entry point is an import-free exit-2 tombstone", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "scripts", "generate-timeline.ts"), "utf8");
  assert.doesNotMatch(source, /^\s*import\s/m);
  const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
  assert.ok(!packageJson.dependencies?.["@anthropic-ai/sdk"]);
  assert.ok(!packageJson.dependencies?.["@google/genai"]);
  assert.ok(!packageJson.dependencies?.["@google/generative-ai"]);
  const run = spawnSync(process.execPath, [require.resolve("ts-node/dist/bin.js"), "scripts/generate-timeline.ts", "--idea", "ignored"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ANTHROPIC_API_KEY: "must-not-be-read" },
  });
  assert.strictEqual(run.status, 2);
  assert.match(`${run.stdout}\n${run.stderr}`, /Route B is locked/);

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cat-auto-tombstone-"));
  try {
    const auto = spawnSync(process.execPath, [
      require.resolve("ts-node/dist/bin.js"), path.resolve("scripts", "new-project.ts"),
      "--auto", "--name", "must-not-exist",
    ], { cwd: temp, encoding: "utf8" });
    assert.strictEqual(auto.status, 2);
    assert.match(`${auto.stdout}\n${auto.stderr}`, /--auto is locked/);
    assert.ok(!fs.existsSync(path.join(temp, "projects")), "--auto wrote project state before failing closed");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("chunk planning partitions authored semantic sections with seam halos", () => {
  const range = (startWord: number, endWord: number) => ({ startWord, endWord, quoteChecksum: `${startWord}-${endWord}` });
  const storyboard: Storyboard = {
    fps: 30, width: 1920, height: 1080, transcriptChecksum: "transcript", sections: [
      { id: "hook", sourceRange: range(0, 4), thesis: "Shock", emotionalTurn: "alarm", energyCurve: "build", targetDurationSeconds: 60, treatmentSequence: ["full_tableau"] },
      { id: "why", sourceRange: range(5, 9), thesis: "Why", emotionalTurn: "pressure", energyCurve: "sustain", targetDurationSeconds: 60, treatmentSequence: ["infographic"] },
      { id: "close", sourceRange: range(10, 14), thesis: "Close", emotionalTurn: "release", energyCurve: "release", targetDurationSeconds: 60, treatmentSequence: ["photo_broll"] },
    ],
    scenes: [
      { id: "s1", narration: "one", purpose: "x", emotion: "neutral", viewerFocus: "x", visualGrammar: "TABLEAU", sourceRange: range(0, 4) },
      { id: "s2", narration: "two", purpose: "x", emotion: "neutral", viewerFocus: "x", visualGrammar: "TABLEAU", sourceRange: range(5, 9) },
      { id: "s3", narration: "three", purpose: "x", emotion: "neutral", viewerFocus: "x", visualGrammar: "TABLEAU", sourceRange: range(10, 14) },
    ],
  };
  const planned = planSemanticChunks(storyboard, { projectId: "fixture", storyboardChecksum: "storyboard", targetChunkSeconds: 120 });
  assert.deepStrictEqual(planned.issues, []);
  assert.strictEqual(planned.plan?.chunks.length, 2);
  assert.deepStrictEqual(planned.plan?.chunks[0].sceneIds, ["s1", "s2"]);
  const scope = qualityScopeForChunk(planned.plan!, planned.plan!.chunks[1].id);
  assert.deepStrictEqual(scope, {
    kind: "chunk", chunkId: planned.plan!.chunks[1].id, coreSceneIds: ["s3"], haloBeforeSceneIds: ["s2"], haloAfterSceneIds: [],
  });
});

test("chunk planning and path helpers reject traversal identifiers", () => {
  const range = { startWord: 0, endWord: 0, quoteChecksum: "range" };
  const base: Storyboard = {
    fps: 30,
    width: 1920,
    height: 1080,
    sections: [{
      id: "safe-section", sourceRange: range, thesis: "x", emotionalTurn: "x",
      energyCurve: "build", targetDurationSeconds: 10, treatmentSequence: ["evidence"],
    }],
    scenes: [{
      id: "safe-scene", narration: "one", purpose: "x", emotion: "neutral", viewerFocus: "x",
      visualGrammar: "EVIDENCE", sourceRange: range,
    }],
  };
  for (const unsafe of ["../escape", "..\\escape", "a/b", "a\\b", ".", "a..b", "UPPER", "a\0b"]) {
    const sectionResult = planSemanticChunks({
      ...base,
      sections: [{ ...base.sections![0], id: unsafe }],
    }, { projectId: "fixture", storyboardChecksum: "storyboard" });
    assert.ok(sectionResult.issues.some((issue) => issue.code === "SECTION_ID_UNSAFE"), unsafe);
    assert.throws(() => chunkPipelinePaths(path.resolve("projects", "fixture"), unsafe), /must be lowercase alphanumeric/i);
    assert.throws(() => stageAttestationPath(path.resolve("projects", "fixture"), unsafe, "compile"), /must be lowercase alphanumeric/i);
  }
  const unsafeScene = planSemanticChunks({
    ...base,
    scenes: [{ ...base.scenes[0], id: "..\\scene" }],
  }, { projectId: "fixture", storyboardChecksum: "storyboard" });
  assert.ok(unsafeScene.issues.some((issue) => issue.code === "SCENE_ID_UNSAFE"));
  assert.throws(
    () => stageAttestationPath(path.resolve("projects", "fixture"), "chunk-001-safe", "../compile" as any),
    /Unsupported chunk stage/,
  );

  const paths = chunkPipelinePaths(path.resolve("projects", "fixture"), "chunk-001-safe");
  const chunksRoot = path.resolve("projects", "fixture", "chunks");
  assert.ok(!path.relative(chunksRoot, paths.chunkDir).startsWith(".."));
  const publicChunkRoot = path.resolve("public", "audio", "chunks", "fixture");
  assert.ok(!path.relative(publicChunkRoot, paths.audio).startsWith(".."));
});

test("storyboard-to-tts rejects unsafe and duplicate scene ids before artifact generation", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cat-tts-scene-id-"));
  try {
    const storyboardPath = path.join(temp, "storyboard.json");
    const outPath = path.join(temp, "tts_scenes.json");
    for (const scenes of [
      [{ id: "..\\escape", narration: "unsafe" }],
      [{ id: "safe-scene", narration: "first" }, { id: "safe-scene", narration: "second" }],
    ]) {
      fs.writeFileSync(storyboardPath, JSON.stringify({ scenes }));
      fs.rmSync(outPath, { force: true });
      const result = spawnSync(process.execPath, [
        require.resolve("ts-node/dist/bin.js"), "scripts/storyboard-to-tts.ts",
        "--storyboard", storyboardPath, "--out", outPath,
      ], { cwd: process.cwd(), encoding: "utf8" });
      assert.notStrictEqual(result.status, 0);
      assert.ok(!fs.existsSync(outPath), "unsafe TTS scene ids produced an artifact");
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("external project audio identities cannot collide by basename", () => {
  const firstRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cat-audio-key-a-"));
  const secondRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cat-audio-key-b-"));
  const first = path.join(firstRoot, "same-project");
  const second = path.join(secondRoot, "same-project");
  fs.mkdirSync(first);
  fs.mkdirSync(second);
  try {
    assert.notStrictEqual(projectAudioIdentity(first), projectAudioIdentity(second));
    assert.notStrictEqual(chunkPipelinePaths(first, "chunk-001-safe").audio, chunkPipelinePaths(second, "chunk-001-safe").audio);
    assert.strictEqual(projectAudioIdentity(path.resolve("projects", "video-123-safe")), "video-123-safe");
  } finally {
    fs.rmSync(firstRoot, { recursive: true, force: true });
    fs.rmSync(secondRoot, { recursive: true, force: true });
  }
});

test("canonical chunk plans are re-derived including options, adjacency, and claims", () => {
  const range = (value: number) => ({ startWord: value, endWord: value, quoteChecksum: String(value) });
  const storyboard: Storyboard = {
    fps: 30, width: 1920, height: 1080, transcriptChecksum: "transcript",
    sections: [
      { id: "first", sourceRange: range(0), thesis: "first", emotionalTurn: "build", energyCurve: "build", targetDurationSeconds: 10, treatmentSequence: ["evidence"] },
      { id: "second", sourceRange: range(1), thesis: "second", emotionalTurn: "release", energyCurve: "release", targetDurationSeconds: 10, treatmentSequence: ["infographic"] },
    ],
    claims: [{ id: "claim-one", text: "one", sourceRange: range(0), evidencePolicy: "data", sceneIds: ["scene-one"] }],
    scenes: [
      { id: "scene-one", narration: "one", purpose: "x", emotion: "neutral", viewerFocus: "x", visualGrammar: "EVIDENCE", sourceRange: range(0), claimIds: ["claim-one"] },
      { id: "scene-two", narration: "two", purpose: "x", emotion: "neutral", viewerFocus: "x", visualGrammar: "EVIDENCE", sourceRange: range(1) },
    ],
  };
  const plan = planSemanticChunks(storyboard, {
    projectId: "fixture", storyboardChecksum: checksumJson(storyboard), targetChunkSeconds: 10, maximumChunkTargetSeconds: 10,
  }).plan!;
  assert.deepStrictEqual(verifyCanonicalChunkPlan(storyboard, plan, "fixture"), []);
  for (const mutate of [
    (value: any) => {
      value.planningOptions.targetChunkSeconds = 20;
      value.planningOptions.maximumChunkTargetSeconds = 20;
    },
    (value: any) => { value.chunks[0].nextChunkId = undefined; },
    (value: any) => { value.chunks[0].claimIds = []; },
    (value: any) => { value.chunks[1].previousChunkId = "chunk-999-forged"; },
  ]) {
    const edited = JSON.parse(JSON.stringify(plan));
    mutate(edited);
    assert.ok(verifyCanonicalChunkPlan(storyboard, edited, "fixture")
      .some((issue) => issue.code === "PLAN_NONCANONICAL"));
  }
});

test("cross-chunk claims follow actual scene references rather than optional claim metadata", () => {
  const range = (value: number) => ({ startWord: value, endWord: value, quoteChecksum: String(value) });
  const storyboard: Storyboard = {
    fps: 30,
    width: 1920,
    height: 1080,
    sections: [
      { id: "first", sourceRange: range(0), thesis: "first", emotionalTurn: "build", energyCurve: "build", targetDurationSeconds: 10, treatmentSequence: ["evidence"] },
      { id: "second", sourceRange: range(1), thesis: "second", emotionalTurn: "release", energyCurve: "release", targetDurationSeconds: 10, treatmentSequence: ["evidence"] },
    ],
    // Deliberately stale descriptive metadata: actual scene claimIds are authoritative.
    claims: [{ id: "shared-claim", text: "shared", sourceRange: range(0), evidencePolicy: "data", sceneIds: ["scene-one"] }],
    scenes: [
      { id: "scene-one", narration: "one", purpose: "x", emotion: "neutral", viewerFocus: "x", visualGrammar: "EVIDENCE", sourceRange: range(0), claimIds: ["shared-claim"] },
      { id: "scene-two", narration: "two", purpose: "x", emotion: "neutral", viewerFocus: "x", visualGrammar: "EVIDENCE", sourceRange: range(1), claimIds: ["shared-claim"] },
    ],
  };
  const result = planSemanticChunks(storyboard, {
    projectId: "fixture",
    storyboardChecksum: checksumJson(storyboard),
    targetChunkSeconds: 10,
    maximumChunkTargetSeconds: 10,
  });
  assert.strictEqual(result.plan, undefined);
  assert.ok(result.issues.some((issue) => issue.code === "CLAIM_CROSS_CHUNK"));
});

test("stage receipts bind the broad production snapshot and chunk orchestrator", () => {
  const files = productionToolchainFiles();
  assert.ok(files.includes("scripts/process-storyboard-chunks.ts"));
  assert.ok(files.includes("scripts/assemble-storyboard-chunks.ts"));
  assert.ok(files.includes("scripts/assemble-chunk-audio.py"));
  assert.ok(files.includes("src/engine/chunkAttestations.ts"));
  assert.ok(!files.some((file) => /(?:^|\/)test(?:[._-]|$)/i.test(file)));
  assert.ok(!files.some((file) => file.includes("/chunks/")), "receipt snapshot included generated chunk artifacts");
});

test("storyboard builder fails density before TTS and records a passing authoring decision", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cat-storyboard-density-"));
  const transcriptPath = path.join(temp, "transcript.txt");
  const dataPath = path.join(temp, "storyboard-data.ts");
  const outPath = path.join(temp, "storyboard.json");
  const authoredScene = {
    marker: "word0", grammar: "SOLO", emotion: "neutral", purpose: "explain",
    viewerFocus: "keyword", slots: { who: "characters/cat", keyword: "Keyword" },
    visualRegister: "character_action", focalType: "character_action",
    semanticVisual: { subject: "cat", action: "points", takeaway: "the keyword matters" },
    silentFrameTakeaway: "the keyword matters", focalOccupancyTarget: 0.3,
  };
  fs.writeFileSync(dataPath, `module.exports = ${JSON.stringify({ SCENES: [authoredScene] })};\n`);
  const runBuilder = () => spawnSync(process.execPath, [
    require.resolve("ts-node/dist/bin.js"), "scripts/build-storyboard.ts",
    "--project", temp, "--transcript", transcriptPath, "--data", dataPath, "--out", outPath,
  ], { cwd: process.cwd(), encoding: "utf8" });
  try {
    fs.writeFileSync(transcriptPath, Array.from({ length: 81 }, (_, index) => `word${index}`).join(" "));
    const failed = runBuilder();
    assert.notStrictEqual(failed.status, 0);
    assert.match(`${failed.stdout}\n${failed.stderr}`, /81 transcript words require at least 3 authored scenes.*found 1/s);
    assert.ok(!fs.existsSync(outPath), "a density failure wrote a downstream storyboard artifact");

    fs.writeFileSync(transcriptPath, "word0 word1 word2 word3 word4");
    const passed = runBuilder();
    assert.strictEqual(passed.status, 0, `${passed.stdout}\n${passed.stderr}`);
    const storyboard = JSON.parse(fs.readFileSync(outPath, "utf8"));
    assert.deepStrictEqual(storyboard.authoringDecision, {
      policyVersion: "scene-density-v1", transcriptWords: 5, minimumScenes: 1,
      authoredScenes: 1, longVideo: false, sectionsRequired: false, passed: true,
    });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("long-form storyboard builder requires semantic sections before chunk planning", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cat-storyboard-sections-"));
  const transcriptPath = path.join(temp, "transcript.txt");
  const dataPath = path.join(temp, "storyboard-data.ts");
  const outPath = path.join(temp, "storyboard.json");
  const words = Array.from({ length: 281 }, (_, index) => `word${index}`);
  const scenes = Array.from({ length: 8 }, (_, index) => ({
    marker: `word${index * 36}`, grammar: "SOLO", emotion: "neutral", purpose: `beat ${index}`,
    viewerFocus: `keyword ${index}`, slots: { who: "characters/cat", keyword: `Keyword ${index}` },
    visualRegister: "character_action", focalType: "character_action",
    semanticVisual: { subject: "cat", action: "points", takeaway: `beat ${index}` },
    silentFrameTakeaway: `beat ${index}`, focalOccupancyTarget: 0.3,
  }));
  fs.writeFileSync(transcriptPath, words.join(" "));
  fs.writeFileSync(dataPath, `module.exports = ${JSON.stringify({ SCENES: scenes })};\n`);
  try {
    const result = spawnSync(process.execPath, [
      require.resolve("ts-node/dist/bin.js"), "scripts/build-storyboard.ts",
      "--project", temp, "--transcript", transcriptPath, "--data", dataPath, "--out", outPath,
    ], { cwd: process.cwd(), encoding: "utf8" });
    assert.notStrictEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /long-form authoring.*requires ordered semantic SECTIONS/s);
    assert.ok(!fs.existsSync(outPath));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("stable scene identity preserves only unambiguous source-range matches", () => {
  const ranges = [
    { startWord: 0, endWord: 1, quoteChecksum: "first" },
    { startWord: 2, endWord: 3, quoteChecksum: "changed" },
  ];
  const result = resolveStableSceneIds([{}, {}], ranges, [
    { id: "stable-hook", sourceRange: { quoteChecksum: "first" } },
    { id: "unrelated", sourceRange: { quoteChecksum: "old" } },
  ], "scene-");
  assert.deepStrictEqual(result.issues, []);
  assert.deepStrictEqual(result.ids, ["stable-hook", "scene-002"]);
});

test("explicit scene identity wins and all resolved duplicates fail", () => {
  const ranges = [
    { startWord: 0, endWord: 0, quoteChecksum: "one" },
    { startWord: 1, endWord: 1, quoteChecksum: "two" },
  ];
  const result = resolveStableSceneIds([{ id: "prior-two" }, {}], ranges, [
    { id: "prior-one", sourceRange: { quoteChecksum: "one" } },
    { id: "prior-two", sourceRange: { quoteChecksum: "two" } },
  ], "scene-");
  assert.deepStrictEqual(result.ids, ["prior-two", "prior-two"]);
  assert.ok(result.issues.some((issue) => issue.includes("duplicate scene id")));
});

test("repeated narration checksums never guess a prior scene identity", () => {
  const ranges = [
    { startWord: 0, endWord: 0, quoteChecksum: "same" },
    { startWord: 4, endWord: 4, quoteChecksum: "same" },
  ];
  const result = resolveStableSceneIds([{}, {}], ranges, [
    { id: "old-one", sourceRange: { quoteChecksum: "same" } },
  ], "fresh-");
  assert.deepStrictEqual(result.issues, []);
  assert.deepStrictEqual(result.ids, ["fresh-001", "fresh-002"]);
});

test("Kokoro chunk run settings are accepted, hash-stable, and malformed providers fail closed", () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "cat-kokoro-run-config-"));
  try {
    const storyboard: Storyboard = {
      schemaVersion: 2,
      fps: 30,
      width: 1920,
      height: 1080,
      transcriptChecksum: "fixture",
      scenes: [],
    };
    const planPath = path.join(projectDir, "chunks", "chunk-plan.json");
    fs.mkdirSync(path.dirname(planPath), { recursive: true });
    fs.writeFileSync(planPath, JSON.stringify({ schemaVersion: 2, fixture: true }));
    const reportPath = writeTestGlobalAuthoringReport(projectDir);
    const create = (speed: number) => createChunkRunConfig({
      projectDir,
      planPath,
      storyboard,
      globalAuthoringReportPath: reportPath,
      ttsEngine: "kokoro",
      voice: "af_heart",
      ttsLanguageCode: "a",
      ttsSpeed: speed,
      kokoroModelRevision: "fixture-revision",
      kokoroModelDir: path.join(projectDir, "kokoro-model"),
      alignModel: "base",
      language: "en",
      thresholdProfileHash: checksumJson(referenceQuality),
    });
    const config = create(1);
    const expected = {
      projectId: path.basename(projectDir),
      policyVersion: CHUNK_POLICY_VERSION,
      planChecksum: checksumArtifact(planPath),
      storyboardChecksum: checksumJson(storyboard),
    };
    assert.deepStrictEqual(validateChunkRunConfig(config, expected), []);
    assert.strictEqual(config.tts.engine, "kokoro");
    if (config.tts.engine !== "kokoro") throw new Error("Expected Kokoro config.");
    assert.deepStrictEqual({
      voice: config.tts.voice,
      languageCode: config.tts.languageCode,
      speed: config.tts.speed,
      repoId: config.tts.repoId,
      modelRevision: config.tts.modelRevision,
      modelDir: config.tts.modelDir,
      device: config.tts.device,
    }, {
      voice: "af_heart",
      languageCode: "a",
      speed: 1,
      repoId: "hexgrad/Kokoro-82M",
      modelRevision: "fixture-revision",
      modelDir: path.resolve(projectDir, "kokoro-model"),
      device: "cpu",
    });
    assert.strictEqual(checksumJson(create(1)), checksumJson(config));
    assert.notStrictEqual(checksumJson(create(1.1)), checksumJson(config), "A synthesis-affecting change did not invalidate immutable settings.");

    const unsupported: any = JSON.parse(JSON.stringify(config));
    unsupported.tts.engine = "unknown-provider";
    assert.ok(validateChunkRunConfig(unsupported, expected).includes("Chunk run TTS engine is unsupported."));

    const malformed: any = JSON.parse(JSON.stringify(config));
    malformed.tts.speed = 0;
    assert.ok(validateChunkRunConfig(malformed, expected).includes("Chunk run Kokoro TTS configuration is malformed."));
    malformed.tts.speed = 1;
    malformed.tts.unexpected = true;
    assert.ok(validateChunkRunConfig(malformed, expected).includes("Chunk run Kokoro TTS configuration is malformed."));
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test("canonical chunk provenance independently re-hashes every input and output", () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "cat-chunk-provenance-"));
  const projectId = path.basename(projectDir);
  const audioIdentity = projectAudioIdentity(projectDir);
  const canonicalAudioDir = path.resolve("public", "audio", audioIdentity);
  const chunkAudioRoot = path.resolve("public", "audio", "chunks", audioIdentity);
  try {
    const range = { startWord: 0, endWord: 0, quoteChecksum: "range" };
    const completeStoryboard: Storyboard = {
      schemaVersion: 2,
      fps: 30,
      width: 1920,
      height: 1080,
      transcriptChecksum: "transcript",
      sections: [{
        id: "hook", sourceRange: range, thesis: "Hook", emotionalTurn: "alarm",
        energyCurve: "build", targetDurationSeconds: 10, treatmentSequence: ["evidence"],
      }],
      scenes: [{
        id: "s1", narration: "one", purpose: "one", emotion: "neutral", viewerFocus: "one",
        visualGrammar: "EVIDENCE", sourceRange: range, sectionId: "hook",
      }],
    };
    const storyboardPath = path.join(projectDir, "storyboard.json");
    fs.writeFileSync(storyboardPath, JSON.stringify(completeStoryboard));
    const plan = planSemanticChunks(completeStoryboard, {
      projectId,
      storyboardChecksum: checksumJson(completeStoryboard),
      targetChunkSeconds: 10,
      maximumChunkTargetSeconds: 10,
    }).plan!;
    const chunkId = plan.chunks[0].id;
    const planPath = path.join(projectDir, "chunks", "chunk-plan.json");
    fs.mkdirSync(path.dirname(planPath), { recursive: true });
    fs.writeFileSync(planPath, JSON.stringify(plan));
    const config = createChunkRunConfig({
      projectDir,
      planPath,
      storyboard: completeStoryboard,
      globalAuthoringReportPath: writeTestGlobalAuthoringReport(projectDir),
      voice: "en-US-AvaNeural",
      alignModel: "base",
      thresholdProfileHash: checksumJson(referenceQuality),
    });
    const configPath = chunkRunConfigPath(projectDir);
    fs.writeFileSync(configPath, JSON.stringify(config));
    const context = { projectDir, storyboardPath, planPath, runConfigPath: configPath, storyboard: completeStoryboard, plan, runConfig: config };
    const paths = chunkPipelinePaths(projectDir, chunkId);
    const writeArtifact = (filePath: string, content?: string) => {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const body = content ?? (path.extname(filePath) === ".json" ? JSON.stringify({ scenes: [] }) : "artifact");
      fs.writeFileSync(filePath, body);
    };
    for (const stage of CHUNK_STAGES) {
      const contract = computeExpectedChunkStageContract(context, chunkId, stage);
      for (const filePath of Object.values(contract.outputPaths)) writeArtifact(filePath);
      const finalContract = computeExpectedChunkStageContract(context, chunkId, stage);
      assert.deepStrictEqual(finalContract.missingInputs, []);
      writeStageAttestation(stageAttestationPath(projectDir, chunkId, stage), createStageAttestation({
        chunkId,
        stage,
        inputHashes: finalContract.inputHashes,
        outputHashes: Object.fromEntries(Object.entries(finalContract.outputPaths).map(([key, filePath]) => [key, checksumArtifact(filePath)])),
        policyVersion: CHUNK_POLICY_VERSION,
        thresholdProfileHash: checksumJson(referenceQuality),
        passed: true,
        blockerCount: 0,
        majorCount: 0,
      }));
    }

    fs.mkdirSync(canonicalAudioDir, { recursive: true });
    const canonical = {
      ttsScenes: path.join(projectDir, "tts_scenes.json"),
      audio: path.join(canonicalAudioDir, "voice.wav"),
      durations: path.join(projectDir, "durations.json"),
      words: path.join(projectDir, "words.json"),
      alignment: path.join(projectDir, "alignment.json"),
    };
    Object.values(canonical).forEach((filePath) => writeArtifact(filePath));
    const timeline: any = { audio: `audio/${audioIdentity}/voice.wav`, scenes: [], durationInFrames: 1 };
    const provenance = {
      schemaVersion: 3,
      projectId,
      storyboardChecksum: checksumJson(completeStoryboard),
      planChecksum: checksumArtifact(planPath),
      runConfigChecksum: checksumArtifact(configPath),
      chunkOrder: [chunkId],
      chunkTimelineChecksums: { [chunkId]: checksumArtifact(paths.timeline) },
      chunkAudioChecksums: { [chunkId]: checksumArtifact(paths.audio) },
      chunkAttestationChecksums: {
        [chunkId]: Object.fromEntries(CHUNK_STAGES.map((stage) => [stage, checksumArtifact(stageAttestationPath(projectDir, chunkId, stage))])),
      },
      assemblyToolchainHashes: computeChunkAssemblyToolchainHashes(),
      canonicalOutputHashes: {
        ttsScenes: checksumArtifact(canonical.ttsScenes),
        audio: checksumArtifact(canonical.audio),
        durations: checksumArtifact(canonical.durations),
        words: checksumArtifact(canonical.words),
        alignment: checksumArtifact(canonical.alignment),
        timelineBody: checksumJson(timeline),
      },
      assemblyPolicyVersion: CHUNK_ASSEMBLY_POLICY_VERSION,
    };
    fs.writeFileSync(path.join(projectDir, "chunk-assembly-provenance.json"), JSON.stringify(provenance));
    timeline.chunkAssemblyProvenance = provenance;
    assert.deepStrictEqual(verifyChunkAssemblyProvenance(projectDir, timeline), []);

    const globalReportPath = globalAuthoringReportPath(projectDir);
    const globalReportBytes = fs.readFileSync(globalReportPath);
    fs.writeFileSync(globalReportPath, JSON.stringify({ passed: false, drifted: true }));
    assert.ok(verifyChunkAssemblyProvenance(projectDir, timeline).some((entry) =>
      entry.code === "CHUNK_ATTESTATION_DRIFT" || entry.code === "CHUNK_ATTESTATION_INVALID"));
    fs.writeFileSync(globalReportPath, globalReportBytes);
    assert.deepStrictEqual(verifyChunkAssemblyProvenance(projectDir, timeline), []);

    const proofPcmReceiptPath = paths.proofCorePcmVerification;
    const proofPcmReceiptBytes = fs.readFileSync(proofPcmReceiptPath);
    fs.rmSync(proofPcmReceiptPath);
    assert.ok(verifyChunkAssemblyProvenance(projectDir, timeline).some((entry) =>
      entry.code === "CHUNK_ATTESTATION_INVALID"));
    fs.writeFileSync(proofPcmReceiptPath, proofPcmReceiptBytes);
    assert.deepStrictEqual(verifyChunkAssemblyProvenance(projectDir, timeline), []);

    const editedPlan = JSON.parse(JSON.stringify(plan));
    editedPlan.chunks[0].nextChunkId = "chunk-999-forged";
    fs.writeFileSync(planPath, JSON.stringify(editedPlan));
    assert.ok(verifyChunkAssemblyProvenance(projectDir, timeline)
      .some((entry) => entry.code === "CHUNK_PLAN_NONCANONICAL"));
    fs.writeFileSync(planPath, JSON.stringify(plan));

    const assertMalformedProvenance = (mutate: (value: any) => void) => {
      const malformed = JSON.parse(JSON.stringify(provenance));
      mutate(malformed);
      fs.writeFileSync(path.join(projectDir, "chunk-assembly-provenance.json"), JSON.stringify(malformed));
      timeline.chunkAssemblyProvenance = malformed;
      assert.ok(verifyChunkAssemblyProvenance(projectDir, timeline)
        .some((entry) => entry.code === "CHUNK_PROVENANCE_MALFORMED"));
    };
    assertMalformedProvenance((value) => { value.unexpected = true; });
    assertMalformedProvenance((value) => { value.planChecksum = "not-a-sha256"; });
    assertMalformedProvenance((value) => { value.canonicalOutputHashes.extra = "0".repeat(64); });
    assertMalformedProvenance((value) => { delete value.assemblyToolchainHashes.audioAssembler; });
    assertMalformedProvenance((value) => { value.assemblyToolchainHashes.extra = "0".repeat(64); });
    assertMalformedProvenance((value) => { delete value.chunkAttestationChecksums[chunkId].compile; });
    assertMalformedProvenance((value) => { value.chunkAudioChecksums = null; });
    fs.writeFileSync(path.join(projectDir, "chunk-assembly-provenance.json"), JSON.stringify(provenance));
    timeline.chunkAssemblyProvenance = provenance;

    const staleToolchain = JSON.parse(JSON.stringify(provenance));
    staleToolchain.assemblyToolchainHashes.audioAssembler = "0".repeat(64);
    fs.writeFileSync(path.join(projectDir, "chunk-assembly-provenance.json"), JSON.stringify(staleToolchain));
    timeline.chunkAssemblyProvenance = staleToolchain;
    assert.ok(verifyChunkAssemblyProvenance(projectDir, timeline)
      .some((entry) => entry.code === "CHUNK_ASSEMBLY_TOOLCHAIN_DRIFT"));
    fs.writeFileSync(path.join(projectDir, "chunk-assembly-provenance.json"), JSON.stringify(provenance));
    timeline.chunkAssemblyProvenance = provenance;

    fs.writeFileSync(paths.proofVideo.replace(/\.mp4$/i, ".contact.jpg"), "edited proof");
    assert.ok(verifyChunkAssemblyProvenance(projectDir, timeline).some((entry) =>
      entry.code === "CHUNK_ATTESTATION_DRIFT" || entry.code === "CHUNK_ATTESTATION_INVALID"));
    fs.writeFileSync(paths.proofVideo.replace(/\.mp4$/i, ".contact.jpg"), "artifact");
    const compileReceipt = readStageAttestation(stageAttestationPath(projectDir, chunkId, "compile"))!;
    compileReceipt.inputHashes = {};
    writeStageAttestation(stageAttestationPath(projectDir, chunkId, "compile"), compileReceipt);
    assert.ok(verifyChunkAssemblyProvenance(projectDir, timeline).some((entry) => entry.code === "CHUNK_ATTESTATION_DRIFT"));

    fs.writeFileSync(storyboardPath, JSON.stringify({ ...completeStoryboard, scenes: [] }));
    assert.ok(verifyChunkAssemblyProvenance(projectDir, timeline).some((entry) => entry.code === "CHUNK_PROVENANCE_SOURCE_DRIFT"));
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(chunkAudioRoot, { recursive: true, force: true });
    fs.rmSync(canonicalAudioDir, { recursive: true, force: true });
  }
});
test("chunk proof mode rejects diagnostic bypasses before rendering", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cat-chunk-proof-cli-"));
  try {
    const scope = path.join(temp, "scope.json");
    fs.writeFileSync(scope, JSON.stringify({ kind: "chunk", chunkId: "chunk-001", coreSceneIds: ["s1"], haloBeforeSceneIds: [], haloAfterSceneIds: [] }));
    const run = spawnSync(process.execPath, [require.resolve("ts-node/dist/bin.js"), "scripts/render.ts",
      "--timeline", path.join(temp, "timeline.json"), "--out", path.join(temp, "proof.mp4"),
      "--quality-scope", scope, "--chunk-proof", "--skip-quality"], { encoding: "utf8", cwd: process.cwd() });
    assert.notStrictEqual(run.status, 0);
    assert.match(`${run.stdout}\n${run.stderr}`, /--chunk-proof rejects diagnostic bypasses/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
test("chunk proof CLI rejects a core-only timeline when the declared halo is absent", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cat-chunk-proof-scope-"));
  try {
    const scope = path.join(temp, "scope.json");
    const timeline = path.join(temp, "timeline.json");
    fs.writeFileSync(scope, JSON.stringify({ kind: "chunk", chunkId: "chunk-002", coreSceneIds: ["core"], haloBeforeSceneIds: ["prior"], haloAfterSceneIds: [] }));
    fs.writeFileSync(timeline, JSON.stringify({ artifactRole: "chunk-proof", scenes: [{ id: "core" }] }));
    const run = spawnSync(process.execPath, [require.resolve("ts-node/dist/bin.js"), "scripts/render.ts",
      "--timeline", timeline, "--out", path.join(temp, "proof", "video.mp4"),
      "--quality-scope", scope, "--chunk-proof"], { encoding: "utf8", cwd: process.cwd() });
    assert.notStrictEqual(run.status, 0);
    assert.match(`${run.stdout}\n${run.stderr}`, /must contain exactly the declared halo\/core scope/i);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("quality scope parser rejects missing, malformed, duplicate, and extraneous fields", () => {
  const valid = parseQualityScope({
    kind: "chunk",
    chunkId: "chunk-001",
    coreSceneIds: ["core"],
    haloBeforeSceneIds: ["before"],
    haloAfterSceneIds: ["after"],
  });
  assert.strictEqual(valid.kind, "chunk");
  if (valid.kind === "chunk") {
    assert.deepStrictEqual(orderedSceneIdsForScope(valid), ["before", "core", "after"]);
  }
  const invalid: unknown[] = [
    null,
    [],
    { kind: "chunk" },
    { kind: "chunk", chunkId: "chunk-001", coreSceneIds: ["core"], haloBeforeSceneIds: [] },
    { kind: "chunk", chunkId: "chunk-001", coreSceneIds: "core", haloBeforeSceneIds: [], haloAfterSceneIds: [] },
    { kind: "chunk", chunkId: "chunk-001", coreSceneIds: [1], haloBeforeSceneIds: [], haloAfterSceneIds: [] },
    { kind: "chunk", chunkId: "chunk-001", coreSceneIds: [], haloBeforeSceneIds: [], haloAfterSceneIds: [] },
    { kind: "chunk", chunkId: "chunk-001", coreSceneIds: ["same"], haloBeforeSceneIds: ["same"], haloAfterSceneIds: [] },
    { kind: "chunk", chunkId: "chunk-001", coreSceneIds: ["core"], haloBeforeSceneIds: [], haloAfterSceneIds: [], unexpected: true },
    { kind: "global", extra: true },
  ];
  for (const value of invalid) assert.throws(() => parseQualityScope(value));
});

test("compile storyboard accepts scoped quality only for a canonical plan-bound chunk proof", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cat-scoped-compile-"));
  const projectDir = path.join(temp, "scoped-compile-project");
  const runCompile = (cliArgs: string[]) => spawnSync(process.execPath, [
    require.resolve("ts-node/dist/bin.js"),
    "scripts/compile-storyboard.ts",
    ...cliArgs,
  ], { cwd: process.cwd(), encoding: "utf8", timeout: 120_000 });
  const outputOf = (result: ReturnType<typeof spawnSync>) => `${result.stdout}\n${result.stderr}`;
  try {
    const range = (word: number) => ({ startWord: word, endWord: word, quoteChecksum: `word-${word}` });
    const evidenceScene = (id: string, sectionId: string, word: number): Storyboard["scenes"][number] => ({
      id,
      narration: `Evidence ${word + 1}.`,
      purpose: `Show evidence ${word + 1}.`,
      emotion: "neutral",
      viewerFocus: `Evidence card ${word + 1}`,
      visualGrammar: "EVIDENCE",
      sectionId,
      sourceRange: range(word),
      visualRegister: "evidence",
      semanticVisual: {
        subject: `evidence card ${word + 1}`,
        action: "shows the stated evidence",
        takeaway: `Evidence ${word + 1} is visible.`,
      },
      focalType: "evidence",
      characterRequired: false,
      visualFingerprint: `fixture:evidence-${word + 1}`,
      silentFrameTakeaway: `Evidence ${word + 1} is visible.`,
      focalOccupancyTarget: 0.8,
      noveltyFromPrevious: word === 0 ? ["opening evidence"] : ["new evidence"],
      unresolvedAssetRequests: [],
      slots: { body: `Evidence ${word + 1}.` },
    });
    const storyboard: Storyboard = {
      schemaVersion: 2,
      fps: 30,
      width: 1920,
      height: 1080,
      transcriptChecksum: "fixture-transcript",
      sections: [
        {
          id: "first-section",
          sourceRange: range(0),
          thesis: "First evidence",
          emotionalTurn: "recognition",
          energyCurve: "build",
          targetDurationSeconds: 1,
          treatmentSequence: ["evidence"],
        },
        {
          id: "second-section",
          sourceRange: range(1),
          thesis: "Second evidence",
          emotionalTurn: "resolution",
          energyCurve: "release",
          targetDurationSeconds: 1,
          treatmentSequence: ["evidence"],
        },
      ],
      claims: [],
      scenes: [
        evidenceScene("scene-first", "first-section", 0),
        evidenceScene("scene-second", "second-section", 1),
      ],
    };
    fs.mkdirSync(path.join(projectDir, "chunks"), { recursive: true });
    const storyboardPath = path.join(projectDir, "storyboard.json");
    fs.writeFileSync(storyboardPath, JSON.stringify(storyboard));
    const plan = planSemanticChunks(storyboard, {
      projectId: path.basename(projectDir),
      storyboardChecksum: checksumJson(storyboard),
      targetChunkSeconds: 1,
      maximumChunkTargetSeconds: 1,
    }).plan!;
    assert.ok(plan);
    const planPath = path.join(projectDir, "chunks", "chunk-plan.json");
    fs.writeFileSync(planPath, JSON.stringify(plan));
    const runConfig = createChunkRunConfig({
      projectDir,
      planPath,
      storyboard,
      globalAuthoringReportPath: writeTestGlobalAuthoringReport(projectDir),
      voice: "fixture-voice",
      alignModel: "fixture-model",
      thresholdProfileHash: checksumJson(referenceQuality),
    });
    fs.writeFileSync(chunkRunConfigPath(projectDir), JSON.stringify(runConfig));

    const chunk = plan.chunks[1];
    const scope = qualityScopeForChunk(plan, chunk.id);
    const paths = chunkPipelinePaths(projectDir, chunk.id);
    fs.mkdirSync(paths.proofDir, { recursive: true });
    fs.writeFileSync(paths.scope, JSON.stringify(scope));
    fs.writeFileSync(paths.proofStoryboard, JSON.stringify(projectStoryboardForQualityScope(storyboard, scope)));

    const malformedScopePath = path.join(temp, "malformed-scope.json");
    fs.writeFileSync(malformedScopePath, JSON.stringify({ ...scope, unexpected: true }));
    const malformed = runCompile([
      "--storyboard", storyboardPath,
      "--out", path.join(projectDir, "timeline.json"),
      "--quality-scope", malformedScopePath,
    ]);
    assert.notStrictEqual(malformed.status, 0);
    assert.match(outputOf(malformed), /--quality-scope is invalid:.*unexpected/i);

    for (const forgedScope of [
      { ...scope, haloBeforeSceneIds: [] },
      { ...scope, haloAfterSceneIds: ["scene-invented"] },
    ]) {
      fs.writeFileSync(paths.scope, JSON.stringify(forgedScope));
      const forged = runCompile([
        "--storyboard", paths.proofStoryboard,
        "--out", paths.proofTimeline,
        "--quality-scope", paths.scope,
      ]);
      assert.notStrictEqual(forged.status, 0);
      assert.match(outputOf(forged), /Scoped chunk compile rejected:.*differs from the scope derived/i);
    }
    fs.writeFileSync(paths.scope, JSON.stringify(scope));

    const global = runCompile([
      "--storyboard", storyboardPath,
      "--out", path.join(projectDir, "timeline.json"),
    ]);
    const globalOutput = outputOf(global);
    assert.notStrictEqual(global.status, 0, "The preflight-only fixture must still fail measured timing.");
    assert.match(globalOutput, /TIMING INTEGRITY/);
    assert.doesNotMatch(globalOutput, /Scoped chunk compile rejected|--quality-scope is invalid/);

    const canonical = runCompile([
      "--storyboard", storyboardPath,
      "--out", path.join(projectDir, "timeline.json"),
      "--quality-scope", paths.scope,
    ]);
    assert.notStrictEqual(canonical.status, 0);
    assert.match(outputOf(canonical), /Scoped chunk compile rejected:.*reserved.*chunks/i);
    assert.ok(!fs.existsSync(path.join(projectDir, "timeline.json")));

    const proof = runCompile([
      "--storyboard", paths.proofStoryboard,
      "--out", paths.proofTimeline,
      "--quality-scope", paths.scope,
    ]);
    const proofOutput = outputOf(proof);
    assert.notStrictEqual(proof.status, 0, "The preflight-only fixture must still fail measured timing.");
    assert.match(proofOutput, /TIMING INTEGRITY/);
    assert.doesNotMatch(proofOutput, /Scoped chunk compile rejected|--quality-scope is invalid/);
    assert.ok(!fs.existsSync(paths.proofTimeline));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("chunk proof binding derives the complete halo scope from canonical plan and run config", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cat-proof-binding-"));
  const projectDir = path.join(temp, "proof-project");
  try {
    const range = (startWord: number, endWord: number) => ({ startWord, endWord, quoteChecksum: `${startWord}-${endWord}` });
    const storyboard: Storyboard = {
      fps: 30,
      width: 1920,
      height: 1080,
      transcriptChecksum: "transcript",
      sections: [
        { id: "first", sourceRange: range(0, 4), thesis: "first", emotionalTurn: "build", energyCurve: "build", targetDurationSeconds: 60, treatmentSequence: ["full_tableau"] },
        { id: "second", sourceRange: range(5, 9), thesis: "second", emotionalTurn: "release", energyCurve: "release", targetDurationSeconds: 60, treatmentSequence: ["infographic"] },
      ],
      scenes: [
        { id: "scene-first", narration: "first", purpose: "first", emotion: "neutral", viewerFocus: "first", visualGrammar: "TABLEAU", sourceRange: range(0, 4) },
        { id: "scene-second", narration: "second", purpose: "second", emotion: "neutral", viewerFocus: "second", visualGrammar: "TABLEAU", sourceRange: range(5, 9) },
      ],
    };
    fs.mkdirSync(path.join(projectDir, "chunks"), { recursive: true });
    const storyboardPath = path.join(projectDir, "storyboard.json");
    fs.writeFileSync(storyboardPath, JSON.stringify(storyboard));
    const planned = planSemanticChunks(storyboard, {
      projectId: path.basename(projectDir),
      storyboardChecksum: checksumJson(storyboard),
      targetChunkSeconds: 60,
      maximumChunkTargetSeconds: 180,
    });
    assert.ok(planned.plan);
    const plan = planned.plan!;
    const planPath = path.join(projectDir, "chunks", "chunk-plan.json");
    fs.writeFileSync(planPath, JSON.stringify(plan));
    const runConfig = createChunkRunConfig({
      projectDir,
      planPath,
      storyboard,
      globalAuthoringReportPath: writeTestGlobalAuthoringReport(projectDir),
      voice: "fixture-voice",
      alignModel: "fixture-model",
      thresholdProfileHash: checksumJson(referenceQuality),
    });
    fs.writeFileSync(chunkRunConfigPath(projectDir), JSON.stringify(runConfig));

    const chunk = plan.chunks[1];
    const scope = qualityScopeForChunk(plan, chunk.id);
    const paths = chunkPipelinePaths(projectDir, chunk.id);
    fs.mkdirSync(paths.proofDir, { recursive: true });
    fs.writeFileSync(paths.scope, JSON.stringify(scope));
    fs.writeFileSync(paths.proofTimeline, JSON.stringify({ artifactRole: "chunk-proof", scenes: orderedSceneIdsForScope(scope).map((id) => ({ id })) }));

    const binding = bindChunkProofToProject({
      timelinePath: paths.proofTimeline,
      scopePath: paths.scope,
      outputPath: paths.proofVideo,
      scope,
      qualityProfile: referenceQuality,
    });
    assert.ok(binding);
    assert.strictEqual(binding?.projectId, path.basename(projectDir));
    assert.doesNotThrow(() => assertChunkProofBindingUnchanged(binding!));

    const reduced = { ...scope, haloBeforeSceneIds: [] };
    assert.throws(() => bindChunkProofToProject({
      timelinePath: paths.proofTimeline,
      scopePath: paths.scope,
      outputPath: paths.proofVideo,
      scope: reduced,
      qualityProfile: referenceQuality,
    }), /differs from the scope derived/i);

    fs.writeFileSync(paths.scope, JSON.stringify(reduced));
    assert.throws(() => assertChunkProofBindingUnchanged(binding!), /quality scope changed/i);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("render reports malformed chunk scope cleanly before dereferencing arrays", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cat-chunk-scope-shape-"));
  try {
    const scope = path.join(temp, "scope.json");
    fs.writeFileSync(scope, JSON.stringify({ kind: "chunk" }));
    const run = spawnSync(process.execPath, [
      require.resolve("ts-node/dist/bin.js"), "scripts/render.ts",
      "--timeline", path.join(temp, "timeline.json"),
      "--out", path.join(temp, "proof.mp4"),
      "--quality-scope", scope,
      "--chunk-proof",
    ], { encoding: "utf8", cwd: process.cwd() });
    const output = `${run.stdout}\n${run.stderr}`;
    assert.notStrictEqual(run.status, 0);
    assert.match(output, /Quality scope is invalid/);
    assert.doesNotMatch(output, /is not iterable|Cannot read propert|TypeError/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("canonical publication identity binds path, project, and exact timeline bytes", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cat-publication-lineage-"));
  try {
    const projectA = path.join(temp, "project-a");
    const projectB = path.join(temp, "project-b");
    fs.mkdirSync(projectA, { recursive: true });
    fs.mkdirSync(projectB, { recursive: true });
    const timelineA = path.join(projectA, "timeline.json");
    const timelineB = path.join(projectB, "timeline.json");
    fs.writeFileSync(timelineA, JSON.stringify({ scenes: [{ id: "a" }] }));
    fs.writeFileSync(timelineB, JSON.stringify({ scenes: [{ id: "b" }] }));
    const identityA = buildCanonicalTimelineIdentity({ timelinePath: timelineA, projectId: "project-a", projectPath: projectA });
    const identityB = buildCanonicalTimelineIdentity({ timelinePath: timelineB, projectId: "project-b", projectPath: projectB });
    const candidateA = {
      projectId: identityA.projectId,
      projectPath: identityA.projectPath,
      timeline: identityA.timelinePath,
      timelineSha256: identityA.timelineSha256,
    };
    assert.doesNotThrow(() => assertBoundTimelineIdentity(candidateA, identityA, "Candidate"));
    assert.throws(() => assertBoundTimelineIdentity(candidateA, identityB, "Candidate"), /timeline|project/i);

    fs.writeFileSync(timelineA, JSON.stringify({ scenes: [{ id: "a-edited" }] }));
    const editedIdentityA = buildCanonicalTimelineIdentity({ timelinePath: timelineA, projectId: "project-a", projectPath: projectA });
    assert.throws(() => assertBoundTimelineIdentity(candidateA, editedIdentityA, "Candidate"), /hash/i);

    const derived = path.join(projectA, "chunks", "chunk-001", "timeline.json");
    fs.mkdirSync(path.dirname(derived), { recursive: true });
    fs.writeFileSync(derived, JSON.stringify({ scenes: [{ id: "a" }] }));
    assert.throws(() => assertCanonicalTimelinePath(derived, projectA), /chunks.*non-promotable/i);
    const derivedAlias = path.join(projectA, "derived-alias");
    try {
      fs.symlinkSync(path.dirname(derived), derivedAlias, process.platform === "win32" ? "junction" : "dir");
      assert.throws(
        () => assertCanonicalTimelinePath(path.join(derivedAlias, "timeline.json"), projectA),
        /chunks.*non-promotable/i,
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "EACCES" && code !== "ENOTSUP") throw error;
    }

    const checkoutBelowChunks = path.join(temp, "chunks", "repo", "projects", "project-c");
    fs.mkdirSync(checkoutBelowChunks, { recursive: true });
    const genuineTimeline = path.join(checkoutBelowChunks, "timeline.json");
    fs.writeFileSync(genuineTimeline, JSON.stringify({ scenes: [{ id: "c" }] }));
    assert.doesNotThrow(() => assertCanonicalTimelinePath(genuineTimeline, checkoutBelowChunks));
    assert.throws(
      () => assertOutputProjectIdentity(path.resolve("output", "project-b", "video.mp4"), "project-a"),
      /identity mismatch/i,
    );
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("standard render rejects metadata-stripped timelines under chunks and borrowed output ids", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cat-render-lineage-cli-"));
  const projectId = `integrity-${path.basename(temp).toLowerCase().replace(/[^a-z0-9-]/g, "")}`;
  const borrowedOutput = path.resolve("output", `${projectId}-other`, "video.mp4");
  try {
    const chunkTimeline = path.join(temp, "chunks", "chunk-001", "timeline.json");
    fs.mkdirSync(path.dirname(chunkTimeline), { recursive: true });
    fs.writeFileSync(chunkTimeline, JSON.stringify({ scenes: [{ id: "core" }] }));
    const chunkRun = spawnSync(process.execPath, [
      require.resolve("ts-node/dist/bin.js"), "scripts/render.ts",
      "--timeline", chunkTimeline,
      "--out", path.join(temp, "candidate.mp4"),
    ], { encoding: "utf8", cwd: process.cwd() });
    assert.notStrictEqual(chunkRun.status, 0);
    assert.match(`${chunkRun.stdout}\n${chunkRun.stderr}`, /chunks.*non-promotable/i);

    const project = path.join(temp, projectId);
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(path.join(project, "timeline.json"), JSON.stringify({ scenes: [] }));
    const outputRun = spawnSync(process.execPath, [
      require.resolve("ts-node/dist/bin.js"), "scripts/render.ts",
      "--project", project,
      "--out", borrowedOutput,
    ], { encoding: "utf8", cwd: process.cwd() });
    assert.notStrictEqual(outputRun.status, 0);
    assert.match(`${outputRun.stdout}\n${outputRun.stderr}`, /Output project identity mismatch/i);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
    fs.rmSync(path.dirname(borrowedOutput), { recursive: true, force: true });
  }
});

test("manual contact-sheet review requires exactly the five boolean true decisions", () => {
  const valid = {
    noRecognizableHumanFaces: true,
    noTextClipping: true,
    noBubbleOverlap: true,
    noEmptyScenes: true,
    noCameraCrop: true,
  };
  assert.doesNotThrow(() => assertExactManualContactSheetReview(valid));
  for (const value of [
    undefined,
    {},
    { ...valid, noTextClipping: false },
    { ...valid, noTextClipping: "true" },
    { ...valid, extraDecision: true },
    Object.fromEntries(Object.entries(valid).filter(([key]) => key !== "noCameraCrop")),
  ]) {
    assert.throws(() => assertExactManualContactSheetReview(value));
  }
});

test("accept-render binds acceptance to exact project timeline and candidate bytes", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cat-accept-integrity-"));
  const projectId = `accept-${path.basename(temp).toLowerCase().replace(/[^a-z0-9-]/g, "")}`;
  const project = path.join(temp, projectId);
  const outputDir = path.resolve("output", projectId);
  try {
    fs.mkdirSync(project, { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });
    const timeline = path.join(project, "timeline.json");
    fs.writeFileSync(timeline, JSON.stringify({ scenes: [{ id: "scene-1" }] }));
    const identity = buildCanonicalTimelineIdentity({ timelinePath: timeline, projectId, projectPath: project });
    const video = path.join(outputDir, "video.mp4");
    const contact = path.join(outputDir, "video.contact.jpg");
    const visual = path.join(outputDir, "video.visual-audit.json");
    const report = path.join(outputDir, "video.production-report.json");
    fs.writeFileSync(video, "candidate video");
    fs.writeFileSync(contact, "candidate contact sheet");
    fs.writeFileSync(visual, JSON.stringify({ passed: true }));
    const candidate = {
      schemaVersion: 2,
      status: "candidate-ready",
      video: path.resolve(video),
      projectId: identity.projectId,
      projectPath: identity.projectPath,
      timeline: identity.timelinePath,
      timelineSha256: identity.timelineSha256,
      timingAudit: { expectedSeconds: 1, scope: "full timeline" },
      artifacts: {
        videoSha256: sha256File(video),
        contactSheetSha256: sha256File(contact),
        visualAuditSha256: sha256File(visual),
      },
    };
    const runAccept = () => spawnSync(process.execPath, [
      require.resolve("ts-node/dist/bin.js"), "scripts/accept-render.ts",
      "--project", project,
      "--confirm-manual-review",
    ], { cwd: process.cwd(), encoding: "utf8" });
    fs.writeFileSync(report, JSON.stringify(candidate));
    const accepted = runAccept();
    assert.strictEqual(accepted.status, 0, `${accepted.stdout}\n${accepted.stderr}`);
    const acceptance = JSON.parse(fs.readFileSync(path.join(project, "acceptance.json"), "utf8"));
    assert.strictEqual(acceptance.schemaVersion, 3);
    assert.strictEqual(acceptance.projectId, projectId);
    assert.strictEqual(acceptance.timelineSha256, identity.timelineSha256);
    assert.strictEqual(acceptance.artifactSha256, sha256File(video));
    assertExactManualContactSheetReview(acceptance.manualContactSheetReview);

    const borrowedTimeline = path.join(temp, "borrowed-timeline.json");
    fs.copyFileSync(timeline, borrowedTimeline);
    fs.writeFileSync(report, JSON.stringify({ ...candidate, timeline: borrowedTimeline }));
    const borrowed = runAccept();
    assert.notStrictEqual(borrowed.status, 0);
    assert.match(`${borrowed.stdout}\n${borrowed.stderr}`, /different canonical timeline path/i);

    fs.writeFileSync(report, JSON.stringify(candidate));
    fs.writeFileSync(timeline, JSON.stringify({ scenes: [{ id: "scene-1-edited" }] }));
    const stale = runAccept();
    assert.notStrictEqual(stale.status, 0);
    assert.match(`${stale.stdout}\n${stale.stderr}`, /hash does not match/i);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("publish CLI rejects empty review, stale timeline hash, and a candidate from another project", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cat-publish-integrity-"));
  try {
    const projectA = path.join(temp, "project-a");
    const projectB = path.join(temp, "project-b");
    const artifactDir = path.join(temp, "artifacts");
    fs.mkdirSync(projectA, { recursive: true });
    fs.mkdirSync(projectB, { recursive: true });
    fs.mkdirSync(artifactDir, { recursive: true });
    const timelineA = path.join(projectA, "timeline.json");
    const timelineB = path.join(projectB, "timeline.json");
    fs.writeFileSync(timelineA, JSON.stringify({ scenes: [{ id: "a" }] }));
    fs.writeFileSync(timelineB, JSON.stringify({ scenes: [{ id: "b" }] }));
    const video = path.join(artifactDir, "video.mp4");
    const contact = path.join(artifactDir, "video.contact.jpg");
    const visual = path.join(artifactDir, "video.visual-audit.json");
    const report = path.join(artifactDir, "video.production-report.json");
    fs.writeFileSync(video, "video");
    fs.writeFileSync(contact, "contact");
    fs.writeFileSync(visual, JSON.stringify({ passed: true }));

    const identityA = buildCanonicalTimelineIdentity({ timelinePath: timelineA, projectId: "project-a", projectPath: projectA });
    const identityB = buildCanonicalTimelineIdentity({ timelinePath: timelineB, projectId: "project-b", projectPath: projectB });
    const manualReview = {
      noRecognizableHumanFaces: true,
      noTextClipping: true,
      noBubbleOverlap: true,
      noEmptyScenes: true,
      noCameraCrop: true,
    };
    const writeCandidate = (identity: ReturnType<typeof buildCanonicalTimelineIdentity>) => {
      fs.writeFileSync(report, JSON.stringify({
        schemaVersion: 2,
        status: "candidate-ready",
        video: path.resolve(video),
        projectId: identity.projectId,
        projectPath: identity.projectPath,
        timeline: identity.timelinePath,
        timelineSha256: identity.timelineSha256,
        timingAudit: { scope: "full timeline" },
        visualAudit: path.resolve(visual),
        audioAudit: { passed: true },
        encodingAudit: { passed: true },
        artifacts: {
          videoSha256: sha256File(video),
          contactSheetSha256: sha256File(contact),
          visualAuditSha256: sha256File(visual),
        },
      }));
    };
    const writeAcceptance = (identity: ReturnType<typeof buildCanonicalTimelineIdentity>, review: unknown) => {
      fs.writeFileSync(path.join(projectB, "acceptance.json"), JSON.stringify({
        schemaVersion: 3,
        result: "pass",
        artifact: path.resolve(video),
        artifactSha256: sha256File(video),
        contactSheetSha256: sha256File(contact),
        visualAuditSha256: sha256File(visual),
        productionReportSha256: sha256File(report),
        projectId: identity.projectId,
        projectPath: identity.projectPath,
        timeline: identity.timelinePath,
        timelineSha256: identity.timelineSha256,
        manualContactSheetReview: review,
      }));
    };
    const runPublish = () => spawnSync(process.execPath, [
      require.resolve("ts-node/dist/bin.js"), "scripts/publish.ts",
      "--project", projectB,
      "--out", video,
    ], { cwd: process.cwd(), encoding: "utf8" });

    writeCandidate(identityB);
    writeAcceptance(identityB, {});
    let run = runPublish();
    assert.notStrictEqual(run.status, 0);
    assert.match(`${run.stdout}\n${run.stderr}`, /Manual contact-sheet review/i);

    writeAcceptance(identityB, manualReview);
    fs.writeFileSync(timelineB, JSON.stringify({ scenes: [{ id: "b-edited" }] }));
    run = runPublish();
    assert.notStrictEqual(run.status, 0);
    assert.match(`${run.stdout}\n${run.stderr}`, /timeline hash/i);

    fs.writeFileSync(timelineB, JSON.stringify({ scenes: [{ id: "b" }] }));
    writeCandidate(identityB);
    writeAcceptance(identityB, manualReview);
    run = runPublish();
    assert.strictEqual(run.status, 0, `${run.stdout}\n${run.stderr}`);
    assert.strictEqual(
      JSON.parse(fs.readFileSync(path.join(artifactDir, "video.publish-report.json"), "utf8")).timelineSha256,
      identityB.timelineSha256,
    );

    writeCandidate(identityA);
    writeAcceptance(identityA, manualReview);
    run = runPublish();
    assert.notStrictEqual(run.status, 0);
    assert.match(`${run.stdout}\n${run.stderr}`, /different canonical timeline|project/i);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});


test("process runner refuses a pre-aborted stage without spawning it", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runProcess({ phase: "pre-aborted", executable: process.execPath, args: ["-e", "process.exit(0)"], signal: controller.signal }),
    (error: unknown) => error instanceof ProcessRunError && error.result.terminationReason === "aborted",
  );
});

test("DLL initialization retry is bounded and never retries cancellation", () => {
  const failure: any = { windowsStatus: STATUS_DLL_INIT_FAILED, terminationReason: null };
  assert.strictEqual(shouldRetryDllInitFailure(failure, 1, true), true);
  assert.strictEqual(shouldRetryDllInitFailure(failure, 2, true), false);
  assert.strictEqual(shouldRetryDllInitFailure(failure, 1, false), false);
  assert.strictEqual(shouldRetryDllInitFailure({ ...failure, terminationReason: "aborted" }, 1, true), false);
});

test("process timeout terminates the complete descendant tree", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cat-process-tree-"));
  const orphanMarker = path.join(temp, "orphan.txt");
  try {
    const childCode = `setTimeout(() => require('fs').writeFileSync(${JSON.stringify(orphanMarker)}, 'orphan'), 700)`;
    const parentCode = `require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childCode)}], {stdio:'ignore'}); setTimeout(() => {}, 5000)`;
    await assert.rejects(
      runProcess({ phase: "tree-timeout", executable: process.execPath, args: ["-e", parentCode], timeoutMs: 200 }),
      (error: unknown) => error instanceof ProcessRunError && error.result.terminationReason === "timeout",
    );
    await new Promise((resolve) => setTimeout(resolve, 900));
    assert.ok(!fs.existsSync(orphanMarker), "a descendant survived the timed-out process tree");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("chunk planning refuses an oversized section rather than mechanically splitting it", () => {
  const range = { startWord: 0, endWord: 4, quoteChecksum: "x" };
  const result = planSemanticChunks({
    fps: 30, width: 1920, height: 1080, sections: [{ id: "too-long", sourceRange: range, thesis: "x", emotionalTurn: "x", energyCurve: "build", targetDurationSeconds: 181, treatmentSequence: ["full_tableau"] }],
    scenes: [{ id: "s", narration: "x", purpose: "x", emotion: "neutral", viewerFocus: "x", visualGrammar: "TABLEAU", sourceRange: range }],
  }, { projectId: "fixture", storyboardChecksum: "x" });
  assert.ok(result.issues.some((issue) => issue.code === "SECTION_TOO_LARGE"));
});
test("chunk attestations fail closed when a checked output changes", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cat-chunk-attestation-"));
  try {
    const output = path.join(temp, "timeline.json");
    fs.writeFileSync(output, JSON.stringify({ scene: "first" }));
    const inputHash = checksumJson("source");
    const profileHash = checksumJson("profile");
    const attestation = createStageAttestation({
      chunkId: "chunk-001-hook", stage: "compile", inputHashes: { storyboard: inputHash },
      outputHashes: { timeline: checksumArtifact(output) }, policyVersion: "v1", thresholdProfileHash: profileHash,
      passed: true, blockerCount: 0, majorCount: 0,
    });
    const record = path.join(temp, "attestation.json");
    writeStageAttestation(record, attestation);
    assert.deepStrictEqual(verifyStageAttestation(readStageAttestation(record), {
      chunkId: "chunk-001-hook", stage: "compile", inputHashes: { storyboard: inputHash },
      outputPaths: { timeline: output }, policyVersion: "v1", thresholdProfileHash: profileHash,
    }), []);
    fs.writeFileSync(output, JSON.stringify({ scene: "edited" }));
    assert.ok(verifyStageAttestation(readStageAttestation(record), {
      chunkId: "chunk-001-hook", stage: "compile", inputHashes: { storyboard: inputHash },
      outputPaths: { timeline: output }, policyVersion: "v1", thresholdProfileHash: profileHash,
    }).some((issue) => issue.code === "ATTESTATION_OUTPUT_DRIFT"));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("chunk assembly preserves order and rejects a changed required proof", () => {
  const range = { startWord: 0, endWord: 0, quoteChecksum: "one" };
  const storyboard: Storyboard = {
    fps: 30, width: 1920, height: 1080,
    sections: [
      { id: "a", sourceRange: range, thesis: "a", emotionalTurn: "a", energyCurve: "build", targetDurationSeconds: 60, treatmentSequence: ["full_tableau"] },
      { id: "b", sourceRange: { ...range, startWord: 1, endWord: 1, quoteChecksum: "two" }, thesis: "b", emotionalTurn: "b", energyCurve: "release", targetDurationSeconds: 60, treatmentSequence: ["infographic"] },
    ],
    scenes: [
      { id: "s1", narration: "one", purpose: "a", emotion: "neutral", viewerFocus: "a", visualGrammar: "TABLEAU", sourceRange: range },
      { id: "s2", narration: "two", purpose: "b", emotion: "neutral", viewerFocus: "b", visualGrammar: "TABLEAU", sourceRange: { ...range, startWord: 1, endWord: 1, quoteChecksum: "two" } },
    ],
  };
  const planned = planSemanticChunks(storyboard, { projectId: "fixture", storyboardChecksum: "storyboard", targetChunkSeconds: 60 }).plan!;
  assert.deepStrictEqual(projectStoryboardForChunk(storyboard, planned.chunks[0]).scenes.map((scene) => scene.id), ["s1"]);
  assert.deepStrictEqual(assembleChunkDurations([
    { chunkId: planned.chunks[0].id, durations: [{ id: "s1", startFrame: 0, frames: 30 }] },
    { chunkId: planned.chunks[1].id, durations: [{ id: "s2", startFrame: 0, frames: 45 }] },
  ]), [{ id: "s1", startFrame: 0, frames: 30 }, { id: "s2", startFrame: 30, frames: 45 }]);
  const inputHash = checksumJson("storyboard");
  const profileHash = checksumJson("profile");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cat-chunk-assembly-"));
  try {
    const artifacts = planned.chunks.map((chunk, index) => {
      const timeline = path.join(temp, `${chunk.id}.json`);
      fs.writeFileSync(timeline, JSON.stringify({ id: chunk.id }));
      const record = path.join(temp, `${chunk.id}-compile.json`);
      writeStageAttestation(record, createStageAttestation({
        chunkId: chunk.id, stage: "compile", inputHashes: { storyboard: inputHash },
        outputHashes: { timeline: checksumArtifact(timeline) }, policyVersion: "policy", thresholdProfileHash: profileHash,
        passed: true, blockerCount: 0, majorCount: 0,
      }));
      return {
        chunkId: chunk.id,
        durations: [{ id: `s${index + 1}`, startFrame: 0, frames: 30 }], words: [],
        hashes: { storyboard: inputHash }, attestationPaths: { compile: record }, outputs: { timeline },
        timeline,
      };
    });
    const requirement = [{
      stage: "compile" as const, policyVersion: "policy", thresholdProfileHash: profileHash,
      inputHashes: (artifact: { hashes: Record<string, string> }) => artifact.hashes,
      outputPaths: (artifact) => ({ timeline: artifact.outputs.timeline }),
    }];
    assert.deepStrictEqual(verifyChunkAssembly(planned, storyboard, artifacts, requirement), []);
    fs.writeFileSync(artifacts[1].timeline, "edited");
    assert.ok(verifyChunkAssembly(planned, storyboard, artifacts, requirement).some((issue) => issue.code === "ASSEMBLY_ATTESTATION"));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("chunk scopes materialize exactly one adjacent scene without contaminating core projection", () => {
  const range = (value: number) => ({ startWord: value, endWord: value, quoteChecksum: String(value) });
  const storyboard: Storyboard = {
    fps: 30, width: 1920, height: 1080,
    sections: [
      { id: "a", sourceRange: { startWord: 0, endWord: 1, quoteChecksum: "a" }, thesis: "a", emotionalTurn: "a", energyCurve: "build", targetDurationSeconds: 10, treatmentSequence: ["evidence"] },
      { id: "b", sourceRange: { startWord: 2, endWord: 3, quoteChecksum: "b" }, thesis: "b", emotionalTurn: "b", energyCurve: "sustain", targetDurationSeconds: 10, treatmentSequence: ["infographic"] },
      { id: "c", sourceRange: { startWord: 4, endWord: 5, quoteChecksum: "c" }, thesis: "c", emotionalTurn: "c", energyCurve: "release", targetDurationSeconds: 10, treatmentSequence: ["photo_broll"] },
    ],
    scenes: Array.from({ length: 6 }, (_, index) => ({
      id: `s${index}`, narration: `word${index}`, purpose: "x", emotion: "neutral" as const,
      viewerFocus: "x", visualGrammar: "EVIDENCE" as const, sourceRange: range(index),
      sectionId: ["a", "a", "b", "b", "c", "c"][index],
    })),
  };
  const plan = planSemanticChunks(storyboard, {
    projectId: "fixture", storyboardChecksum: checksumJson(storyboard), targetChunkSeconds: 10, maximumChunkTargetSeconds: 10,
  }).plan!;
  const scope = qualityScopeForChunk(plan, plan.chunks[1].id);
  assert.deepStrictEqual(scope.haloBeforeSceneIds, ["s1"]);
  assert.deepStrictEqual(scope.coreSceneIds, ["s2", "s3"]);
  assert.deepStrictEqual(scope.haloAfterSceneIds, ["s4"]);
  assert.deepStrictEqual(projectStoryboardForChunk(storyboard, plan.chunks[1]).scenes.map((scene) => scene.id), ["s2", "s3"]);
  assert.deepStrictEqual(projectStoryboardForQualityScope(storyboard, scope).scenes.map((scene) => scene.id), ["s1", "s2", "s3", "s4"]);
});

test("scoped timeline quality fails closed when a declared halo is absent", () => {
  const report = runScopedQualityCheck({ scenes: [{ id: "core" }] }, {
    kind: "chunk", chunkId: "chunk-002", coreSceneIds: ["core"], haloBeforeSceneIds: ["prior"], haloAfterSceneIds: [],
  }, "fixture");
  assert.ok(report.blockers > 0);
  assert.ok(report.checks.flatMap((check) => check.issues).some((entry) => entry.rule === "CHUNK_SCOPE_MISSING"));
});

test("chunk-local scene zero receives no project-opening rewrite when the true opening is outside its proof", () => {
  const base: any = {
    fps: 30, width: 1920, height: 1080, durationInFrames: 30,
    scenes: [{ id: "halo", startFrame: 0, durationFrames: 30, backgroundSrc: "#050505", layout: "SOLO", entities: [], texts: [] }],
  };
  const inferred = compileScenes(base);
  const scoped = compileScenes({ ...base, artifactRole: "chunk-proof", projectOpeningSceneId: "actual-opening" });
  assert.strictEqual((inferred.events.find((event) => event.type === "background") as any).src, "#FAFAF8");
  assert.strictEqual((scoped.events.find((event) => event.type === "background") as any).src, "#050505");
});

test("strict attestation validation rejects malformed maps and unexpected keys without throwing", () => {
  const digest = checksumJson("digest");
  const base: any = createStageAttestation({
    chunkId: "chunk", stage: "compile", inputHashes: { source: digest }, outputHashes: {},
    policyVersion: "policy", thresholdProfileHash: digest, passed: true, blockerCount: 0, majorCount: 0,
  });
  for (const malformed of [
    { ...base, inputHashes: null },
    { ...base, outputHashes: [] },
    { ...base, inputHashes: { source: "not-a-hash" } },
    { ...base, blockerCount: -1 },
    { ...base, completedAt: "not-a-date" },
    { ...base, extra: true },
  ]) {
    assert.doesNotThrow(() => verifyStageAttestation(malformed, {
      chunkId: "chunk", stage: "compile", inputHashes: { source: digest }, outputPaths: {},
      policyVersion: "policy", thresholdProfileHash: digest,
    }));
    assert.ok(verifyStageAttestation(malformed, {
      chunkId: "chunk", stage: "compile", inputHashes: { source: digest }, outputPaths: {},
      policyVersion: "policy", thresholdProfileHash: digest,
    }).some((entry) => entry.code === "ATTESTATION_MALFORMED"));
  }
  const unexpectedInput = { ...base, inputHashes: { source: digest, forged: digest } };
  assert.ok(verifyStageAttestation(unexpectedInput, {
    chunkId: "chunk", stage: "compile", inputHashes: { source: digest }, outputPaths: {},
    policyVersion: "policy", thresholdProfileHash: digest,
  }).some((entry) => entry.code === "ATTESTATION_INPUT_DRIFT"));
});

test("stage contracts bind predecessor proof, alignment receipt, and quality scope independently", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cat-stage-contract-"));
  const projectId = path.basename(temp);
  const audioRoot = path.resolve("public", "audio", "chunks", projectAudioIdentity(temp));
  try {
    const range = (value: number) => ({ startWord: value, endWord: value, quoteChecksum: String(value) });
    const storyboard: Storyboard = {
      fps: 30, width: 1920, height: 1080, transcriptChecksum: "x",
      sections: [
        { id: "a", sourceRange: range(0), thesis: "a", emotionalTurn: "a", energyCurve: "build", targetDurationSeconds: 10, treatmentSequence: ["evidence"] },
        { id: "b", sourceRange: range(1), thesis: "b", emotionalTurn: "b", energyCurve: "release", targetDurationSeconds: 10, treatmentSequence: ["evidence"] },
      ],
      scenes: [0, 1].map((index) => ({ id: `s${index}`, narration: `w${index}`, purpose: "x", emotion: "neutral" as const, viewerFocus: "x", visualGrammar: "EVIDENCE" as const, sourceRange: range(index), sectionId: index ? "b" : "a" })),
    };
    const storyboardPath = path.join(temp, "storyboard.json");
    fs.writeFileSync(storyboardPath, JSON.stringify(storyboard));
    const plan = planSemanticChunks(storyboard, { projectId, storyboardChecksum: checksumJson(storyboard), targetChunkSeconds: 10, maximumChunkTargetSeconds: 10 }).plan!;
    const planPath = path.join(temp, "chunks", "chunk-plan.json");
    fs.mkdirSync(path.dirname(planPath), { recursive: true });
    fs.writeFileSync(planPath, JSON.stringify(plan));
    const config = createChunkRunConfig({
      projectDir: temp,
      planPath,
      storyboard,
      globalAuthoringReportPath: writeTestGlobalAuthoringReport(temp),
      voice: "voice",
      alignModel: "base",
      thresholdProfileHash: checksumJson(referenceQuality),
    });
    const configPath = chunkRunConfigPath(temp);
    fs.writeFileSync(configPath, JSON.stringify(config));
    const previousReceipt = stageAttestationPath(temp, plan.chunks[0].id, "visual-proof");
    fs.mkdirSync(path.dirname(previousReceipt), { recursive: true });
    fs.writeFileSync(previousReceipt, JSON.stringify({ version: 1 }));
    const context = { projectDir: temp, storyboardPath, planPath, runConfigPath: configPath, storyboard, plan, runConfig: config };
    const first = computeExpectedChunkStageContract(context, plan.chunks[1].id, "authoring").inputHashes.previousVisualProof;
    fs.writeFileSync(previousReceipt, JSON.stringify({ version: 2 }));
    const second = computeExpectedChunkStageContract(context, plan.chunks[1].id, "authoring").inputHashes.previousVisualProof;
    assert.notStrictEqual(first, second);
    const paths = chunkPipelinePaths(temp, plan.chunks[1].id);
    [paths.projection, paths.audio, paths.durations, paths.words, paths.alignment, paths.scope, paths.coreScope].forEach((filePath) => {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, path.extname(filePath) === ".json" ? "{}" : "audio");
    });
    const alignmentReceipt = stageAttestationPath(temp, plan.chunks[1].id, "alignment");
    fs.mkdirSync(path.dirname(alignmentReceipt), { recursive: true });
    fs.writeFileSync(alignmentReceipt, "{}");
    const compile = computeExpectedChunkStageContract(context, plan.chunks[1].id, "compile");
    assert.ok(compile.inputHashes.alignmentAttestation);
    assert.ok(compile.inputHashes.coreScope);
    fs.mkdirSync(path.dirname(paths.proofTimeline), { recursive: true });
    fs.writeFileSync(paths.proofTimeline, JSON.stringify({ scenes: [{ backgroundSrc: "rgba(12, 34, 56, 0.5)", entities: [] }] }));
    const proof = computeExpectedChunkStageContract(context, plan.chunks[1].id, "visual-proof");
    assert.ok(proof.inputHashes.scope);
    assert.ok(!proof.missingInputs.some((entry) => entry.includes("rgba")), "CSS rgb/rgba background was treated as an asset path");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
    fs.rmSync(audioRoot, { recursive: true, force: true });
  }
});

test("a deleted chunk plan cannot disable an existing provenance gate", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cat-plan-deletion-"));
  try {
    assert.ok(verifyChunkAssemblyProvenance(temp, { chunkAssemblyProvenance: {} })
      .some((entry) => entry.code === "CHUNK_PLAN_MISSING"));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("stripped lineage cannot downgrade a 4600-word storyboard", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cat-long-lineage-deletion-"));
  try {
    const narration = Array.from({ length: 4600 }, (_, index) => `word${index}`).join(" ");
    const storyboard: Storyboard = {
      fps: 30,
      width: 1920,
      height: 1080,
      scenes: [{
        id: "long-scene", narration, purpose: "long", emotion: "neutral", viewerFocus: "long",
        visualGrammar: "EVIDENCE",
      }],
    };
    fs.writeFileSync(path.join(temp, "storyboard.json"), JSON.stringify(storyboard));
    assert.strictEqual(isLongVideoWordCount(4600), true);
    assert.ok(verifyChunkAssemblyProvenance(temp, { scenes: [] })
      .some((entry) => entry.code === "CHUNK_PLAN_MISSING"));

    storyboard.scenes[0].narration = "short narration";
    storyboard.sections = [{
      id: "long-section",
      sourceRange: { startWord: 0, endWord: 4599, quoteChecksum: "range" },
      thesis: "long", emotionalTurn: "long", energyCurve: "build",
      targetDurationSeconds: 100, treatmentSequence: ["evidence"],
    }];
    fs.writeFileSync(path.join(temp, "storyboard.json"), JSON.stringify(storyboard));
    assert.ok(verifyChunkAssemblyProvenance(temp, { scenes: [] })
      .some((entry) => entry.code === "CHUNK_PLAN_MISSING"));

    delete storyboard.sections;
    fs.writeFileSync(path.join(temp, "storyboard.json"), JSON.stringify(storyboard));
    assert.deepStrictEqual(verifyChunkAssemblyProvenance(temp, { scenes: [] }), []);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("scoped storyboard quality attributes seam context only to core scenes", () => {
  const report = runScopedStoryboardCheck({
    scenes: [
      { id: "halo", visualGrammar: "NOT_A_GRAMMAR" },
      { id: "core", visualGrammar: "NOT_A_GRAMMAR" },
    ],
  }, { kind: "chunk", chunkId: "chunk-002", coreSceneIds: ["core"], haloBeforeSceneIds: ["halo"], haloAfterSceneIds: [] });
  const issues = report.checks.flatMap((check) => check.issues);
  assert.ok(issues.some((issue) => issue.scene === "core"));
  assert.ok(!issues.some((issue) => issue.scene === "halo"));
  assert.ok(!issues.some((issue) => !issue.scene));
});

test("scoped storyboard quality attributes scene-less claim failures to core ownership", () => {
  const makeBrief = (id: string, claimId?: string) => ({
    id, narration: "A documented claim.", purpose: "show evidence", emotion: "neutral" as const,
    viewerFocus: "the evidence", visualGrammar: "EVIDENCE" as const,
    sourceRange: { startWord: 0, endWord: 2, quoteChecksum: id },
    visualRegister: "evidence" as const,
    semanticVisual: { subject: "claim", action: "appears", takeaway: "the claim is documented" },
    focalType: "evidence" as const, silentFrameTakeaway: "the claim is documented",
    focalOccupancyTarget: 0.4, noveltyFromPrevious: ["evidence"],
    visualFingerprint: `${id}|evidence`, slots: { body: "A documented claim." },
    claimIds: claimId ? [claimId] : [],
  });
  const report = runScopedStoryboardCheck({
    fps: 30, width: 1920, height: 1080,
    visualTreatmentPlan: { registerTargets: { evidence: 0 } },
    scenes: [
      makeBrief("halo"),
      makeBrief("core", "claim-core"),
      makeBrief("outside", "claim-outside"),
    ],
    claims: [{
      id: "claim-core", text: "Core claim", sourceRange: { startWord: 0, endWord: 2, quoteChecksum: "core" },
      evidencePolicy: "data", sceneIds: ["core"],
    }, {
      id: "claim-outside", text: "Outside claim", sourceRange: { startWord: 3, endWord: 5, quoteChecksum: "outside" },
      evidencePolicy: "data", sceneIds: ["outside"],
    }],
  }, {
    kind: "chunk", chunkId: "chunk-002", coreSceneIds: ["core"],
    haloBeforeSceneIds: ["halo"], haloAfterSceneIds: [],
  });
  const issues = report.checks.flatMap((check) => check.issues);
  const metadataIssue = issues.find((issue) => issue.rule === "CLAIM_SOURCE_METADATA_MISSING");
  assert.strictEqual(metadataIssue?.claimId, "claim-core");
  assert.strictEqual(metadataIssue?.scene, "core");
  assert.ok(!issues.some((issue) => issue.message.includes("claim-outside")));
  assert.ok(!issues.some((issue) => issue.rule === "REGISTER_TARGET_DRIFT"),
    "global-only distribution findings must stay out of chunk authoring proofs");
});

test("canonical beat matching tolerates CRLF and punctuation but rejects reordered phrases", () => {
  assert.strictEqual(containsCanonicalPhrase("Một câu\r\nquan trọng, ở đây.", "câu quan trọng ở đây"), true);
  assert.strictEqual(containsCanonicalPhrase("Một câu quan trọng ở đây.", "quan trọng câu"), false);
  assert.deepStrictEqual(authoredCadenceIssues("s", "Một câu\r\nquan trọng, ở đây.", [{
    text: "câu quan trọng ở đây", importance: 0.8, kind: "turn", action: "swap_pose", targetSlot: "who", targetAssetId: "characters/cat_think",
  }]), []);
});

test("authoring cadence rejects long narration without persistent semantic beats", () => {
  const narration = Array.from({ length: 57 }, (_, index) => `word${index}`).join(" ");
  assert.strictEqual(requiredAuthoredTransitions(narration), 2);
  assert.ok(authoredCadenceIssues("scene-x", narration, undefined)[0]?.includes("needs 2"));
  const beats: any[] = [
    { text: "word20", importance: 0.7, kind: "turn", action: "swap_pose", targetSlot: "who", targetAssetId: "characters/cat_think" },
    { text: "word45", importance: 0.8, kind: "turn", action: "focus_asset", targetSlot: "prop" },
  ];
  assert.deepStrictEqual(authoredCadenceIssues("scene-x", narration, beats), []);
});

test("authoring cadence rejects duplicate beat phrases as one visual moment", () => {
  const narration = Array.from({ length: 57 }, (_, index) => `word${index}`).join(" ");
  const duplicateMoment: any[] = [
    { text: "word20", importance: 0.7, kind: "turn", action: "swap_pose", targetSlot: "who", targetAssetId: "characters/cat_think" },
    { text: "word20", importance: 0.8, kind: "turn", action: "focus_asset", targetSlot: "prop" },
  ];
  const issues = authoredCadenceIssues("scene-x", narration, duplicateMoment);
  assert.ok(issues.some((issue) => issue.includes("needs 2 distinct") && issue.includes("found 1")));
});

test("authoring rejects oversized scenes and beats the grammar cannot render", () => {
  const narration = Array.from({ length: 61 }, (_, index) => `word${index}`).join(" ");
  assert.ok(authoredCadenceIssues("scene-x", narration, [
    { text: "word20", importance: 0.8, kind: "turn", action: "advance", targetSlot: "next" },
    { text: "word40", importance: 0.8, kind: "turn", action: "advance", targetSlot: "next" },
  ])[0]?.includes("hard maximum"));
  assert.ok(authoredTransitionCapabilityIssues("scene-x", "EVIDENCE", {}, [
    { text: "word20", importance: 0.8, kind: "turn", action: "advance", targetSlot: "next" },
  ])[0]?.includes("no authored teaching layer"));
  assert.deepStrictEqual(authoredTransitionCapabilityIssues("scene-x", "COMPARE", {}, [
    { text: "word20", importance: 0.8, kind: "turn", action: "advance", targetSlot: "next" },
  ]), []);
});

test("measured cadence ignores temporary emphasis and catches a static tail", () => {
  const scene: any = {
    durationFrames: 720,
    entities: [{ enterDelay: 0, emphasize: { delay: 240, duration: 20 } }],
    cards: [{ delay: 180 }],
  };
  assert.deepStrictEqual(maximumVisualHold(scene), { frames: 540, start: 180 });
});

test("stable density derives from compiled geometry, never declared occupancy", () => {
  const sparse = {
    backgroundSrc: "#FFFFFF",
    focalOccupancyTarget: 0.9,
    cards: [{ width: 280, height: 200 }],
  };
  const dense = {
    backgroundSrc: "#FFFFFF",
    focalOccupancyTarget: 0.1,
    paperCards: [{ variant: "evidence", width: 1560 }],
  };
  assert.ok((estimateStablePaintedRatio(sparse) ?? 1) < 0.1);
  assert.ok((estimateStablePaintedRatio(dense) ?? 0) > 0.6);
  assert.strictEqual(
    estimateStablePaintedRatio({ ...sparse, focalOccupancyTarget: 0.1 }),
    estimateStablePaintedRatio(sparse),
  );
});

test("proxy render scale always produces integer 1080p dimensions", () => {
  assert.deepStrictEqual(getScaledDimensions(1920, 1080, DEFAULT_PROXY_SCALE), {
    width: 960,
    height: 540,
  });
  assert.throws(() => getScaledDimensions(1920, 1080, 0.333), /non-integer dimensions/);
});

test("all six entrance styles finish at authored size without overshoot", () => {
  const styles = ["fade", "rise", "slide", "softScale", "reveal", "cut"] as const;
  for (const style of styles) {
    const values = Array.from({ length: 61 }, (_, frame) =>
      getEnterAnimation(animationForEntranceStyle(style, { x: 0.25, y: 0.5 }), frame, 18, 30)
    );
    assert.ok(values.every((value) => value.scale <= 1 && value.scale > 0));
    assert.strictEqual(values.at(-1)?.scale, 1);
  }
});

test("entrance policy respects explicit direction and semantic fallback", () => {
  assert.strictEqual(selectEntranceStyle({ requested: "cut", grammar: "EVIDENCE", emotion: "sad" }), "cut");
  assert.strictEqual(selectEntranceStyle({ grammar: "EVIDENCE", emotion: "neutral" }), "reveal");
  assert.strictEqual(selectEntranceStyle({ grammar: "DIALOGUE_QA", emotion: "sad" }), "slide");
  assert.strictEqual(selectEntranceStyle({ grammar: "SOLO", emotion: "happy" }), "rise");
  assert.strictEqual(animationForEntranceStyle("slide", { x: 0.2, y: 0.5 }), "slideRight");
  assert.strictEqual(animationForEntranceStyle("slide", { x: 0.8, y: 0.5 }), "slideLeft");
  assert.strictEqual(normalizeEntranceAnimation("popIn"), "softScaleIn");
});

test("spatial integrity blocks undeclared asset overlap and permits an authored held prop", () => {
  const base: any = {
    fps: 30, width: 1920, height: 1080, durationInFrames: 120,
    events: [
      { frame: 0, type: "enter", assetId: "cat", src: "characters/cat", position: { x: 0.5, y: 0.5 }, scale: 1.5, animation: "none" },
      { frame: 0, type: "enter", assetId: "prop", src: "finance/money", position: { x: 0.5, y: 0.5 }, scale: 1, animation: "none" },
    ],
  };
  assert.ok(checkSpatialIntegrity(base).issues.some((issue) => issue.code === "UNDECLARED_ASSET_OVERLAP"));
  base.events[1].allowOverlapWith = ["cat"];
  assert.strictEqual(checkSpatialIntegrity(base).passed, true);
});

test("stage-anchored fixed assets receive no automatic spatial move", () => {
  const timeline: any = {
    fps: 30, width: 1920, height: 1080, durationInFrames: 360,
    events: [{ frame: 0, type: "enter", assetId: "cat", src: "characters/cat", position: { x: 0.4, y: 0.54 }, scale: 1.8, animation: "none", motionPolicy: "fixed" }],
  };
  injectLiveliness(timeline, { sceneSpans: [{ start: 0, end: 360, narrationBeatFrames: [100, 240] }] });
  assert.strictEqual(timeline.events.filter((event: any) => event.type === "move").length, 0);
});

test("visible asset geometry stays inside its real alpha bounds", () => {
  const box = visibleAssetBox({ assetId: "x", src: "characters/cat", position: { x: 0.5, y: 0.5 }, scale: 1, opacity: 1, zIndex: 1, visible: true }, 1920, 1080);
  assert.ok(box.x0 < box.x1 && box.y0 < box.y1);
  assert.ok(box.x0 >= 0 && box.x1 <= 1920);
});

test("canonical JSON checksums ignore formatting but detect semantic changes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cat-artifact-test-"));
  try {
    const artifact = path.join(dir, "artifact.json");
    fs.writeFileSync(artifact, '{\n  "a": 1,\n  "b": [2, 3]\n}\n');
    const expected = canonicalJsonChecksum(artifact);
    fs.writeFileSync(artifact, '{"a":1,"b":[2,3]}');
    assert.strictEqual(canonicalJsonChecksum(artifact), expected);
    fs.writeFileSync(artifact, '{"b":[2,3],"a":1}');
    assert.strictEqual(canonicalJsonChecksum(artifact), expected);
    fs.writeFileSync(artifact, '{"a":2,"b":[2,3]}');
    const issues = verifyArtifactInputs([{ kind: "storyboard", filePath: artifact, expected }]);
    assert.strictEqual(issues[0]?.code, "TIMING_STORYBOARD_HASH_MISMATCH");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("artifact promotion archives the previous canonical set and publishes report last", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cat-promotion-test-"));
  const finalDir = path.join(dir, "output");
  const stagingDir = path.join(finalDir, ".runs", "run-test");
  fs.mkdirSync(stagingDir, { recursive: true });
  fs.writeFileSync(path.join(finalDir, "video.mp4"), "old-video");
  fs.writeFileSync(path.join(finalDir, "video.production-report.json"), "old-report");
  fs.writeFileSync(path.join(finalDir, "video.visual-audit.json"), "stale-audit");
  fs.writeFileSync(path.join(stagingDir, "video.mp4"), "new-video");
  fs.writeFileSync(path.join(stagingDir, "video.contact.jpg"), "contact");
  for (const name of ["video.encoding-audit.json", "video.audio-audit.json", "video.visual-audit.json"]) {
    fs.writeFileSync(path.join(stagingDir, name), JSON.stringify({ passed: true }));
  }
  fs.writeFileSync(
    path.join(stagingDir, "video.production-report.json"),
    JSON.stringify({ status: "candidate-ready" }),
  );
  try {
    const archive = promoteArtifacts(stagingDir, finalDir, "run-test");
    assert.strictEqual(fs.readFileSync(path.join(finalDir, "video.mp4"), "utf8"), "new-video");
    assert.strictEqual(
      JSON.parse(fs.readFileSync(path.join(finalDir, "video.production-report.json"), "utf8")).status,
      "candidate-ready"
    );
    assert.ok(archive);
    assert.strictEqual(fs.readFileSync(path.join(archive!, "video.mp4"), "utf8"), "old-video");
    assert.strictEqual(
      JSON.parse(fs.readFileSync(path.join(finalDir, "video.visual-audit.json"), "utf8")).passed,
      true,
    );
    assert.strictEqual(
      fs.readFileSync(path.join(archive!, "video.visual-audit.json"), "utf8"),
      "stale-audit"
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("chunk proof promotion is transactional, report-last, and removes successful staging copies", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cat-proof-promotion-test-"));
  const finalDir = path.join(dir, "proof");
  const stagingDir = path.join(finalDir, ".runs", "run-proof");
  fs.mkdirSync(stagingDir, { recursive: true });
  fs.writeFileSync(path.join(finalDir, "video.mp4"), "old-proof");
  fs.writeFileSync(path.join(finalDir, "video.production-report.json"), JSON.stringify({ status: "chunk-proof-ready" }));
  fs.writeFileSync(path.join(stagingDir, "video.mp4"), "new-proof");
  fs.writeFileSync(path.join(stagingDir, "video.contact.jpg"), "contact");
  for (const name of ["video.encoding-audit.json", "video.audio-audit.json", "video.visual-audit.json"]) {
    fs.writeFileSync(path.join(stagingDir, name), JSON.stringify({ passed: true }));
  }
  fs.writeFileSync(
    path.join(stagingDir, "video.production-report.json"),
    JSON.stringify({ status: "chunk-proof-ready" }),
  );
  try {
    const archive = promoteArtifacts(stagingDir, finalDir, "run-proof", {
      requiredReportStatus: "chunk-proof-ready",
    });
    assert.ok(archive);
    assert.strictEqual(fs.readFileSync(path.join(finalDir, "video.mp4"), "utf8"), "new-proof");
    assert.strictEqual(
      JSON.parse(fs.readFileSync(path.join(finalDir, "video.production-report.json"), "utf8")).status,
      "chunk-proof-ready",
    );
    assert.ok(!fs.existsSync(stagingDir), "successful proof staging directory was retained");
    pruneRunHistory(finalDir, { preservePreviousMp4: false });
    assert.ok(!fs.existsSync(path.join(archive!, "video.mp4")), "previous successful proof MP4 was duplicated in history");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("canonical chunk assembly promotion rolls back the complete prior set", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cat-chunk-assembly-promotion-"));
  try {
    const staging = path.join(dir, "staging");
    fs.mkdirSync(staging);
    const firstFinal = path.join(dir, "durations.json");
    const secondFinal = path.join(dir, "timeline.json");
    const firstCandidate = path.join(staging, "durations.json");
    const secondCandidate = path.join(staging, "timeline.json");
    fs.writeFileSync(firstFinal, "old-durations");
    fs.writeFileSync(secondFinal, "old-timeline");
    fs.writeFileSync(firstCandidate, "new-durations");
    fs.writeFileSync(secondCandidate, "new-timeline");
    let injected = false;
    assert.throws(() => promoteChunkAssemblyArtifacts([
      { name: "durations", candidatePath: firstCandidate, finalPath: firstFinal },
      { name: "timeline", candidatePath: secondCandidate, finalPath: secondFinal },
    ], {
      transactionId: "rollback-test",
      renameFile: (source, destination) => {
        if (!injected && path.resolve(source) === path.resolve(secondCandidate)) {
          injected = true;
          throw new Error("injected promotion failure");
        }
        fs.renameSync(source, destination);
      },
    }), /injected promotion failure/);
    assert.strictEqual(fs.readFileSync(firstFinal, "utf8"), "old-durations");
    assert.strictEqual(fs.readFileSync(secondFinal, "utf8"), "old-timeline");
    assert.strictEqual(fs.readFileSync(firstCandidate, "utf8"), "new-durations");
    assert.strictEqual(fs.readFileSync(secondCandidate, "utf8"), "new-timeline");
    assert.ok(!fs.readdirSync(dir).some((name) => name.includes("assembly-backup")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("diagnostic artifact sets cannot alter canonical files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cat-promotion-guard-test-"));
  const finalDir = path.join(dir, "output");
  const stagingDir = path.join(finalDir, ".runs", "run-test");
  fs.mkdirSync(stagingDir, { recursive: true });
  fs.writeFileSync(path.join(finalDir, "video.mp4"), "old-video");
  fs.writeFileSync(path.join(stagingDir, "video.mp4"), "diagnostic-video");
  fs.writeFileSync(path.join(stagingDir, "video.contact.jpg"), "contact");
  for (const name of ["video.encoding-audit.json", "video.audio-audit.json", "video.visual-audit.json"]) {
    fs.writeFileSync(path.join(stagingDir, name), JSON.stringify({ passed: true }));
  }
  fs.writeFileSync(
    path.join(stagingDir, "video.production-report.json"),
    JSON.stringify({ status: "diagnostic" }),
  );
  try {
    assert.throws(() => promoteArtifacts(stagingDir, finalDir, "run-test"), /candidate-ready/i);
    assert.strictEqual(fs.readFileSync(path.join(finalDir, "video.mp4"), "utf8"), "old-video");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("failed visual audits preserve the staged MP4 for re-audit", () => {
  assert.strictEqual(shouldPreserveFailedMp4("Command failed: visual-audit.py"), true);
  assert.strictEqual(shouldPreserveFailedMp4("storyboard quality gate failed"), false);
});

test("render lock cannot be stolen from a live PID with an old heartbeat", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cat-render-lock-heartbeat-test-"));
  const lock = acquireRenderLock(dir, "first");
  try {
    const ownerPath = path.join(dir, ".runs", ".lock", "owner.json");
    const stale = new Date(Date.now() - 10 * 60 * 1000);
    fs.utimesSync(ownerPath, stale, stale);
    assert.throws(() => acquireRenderLock(dir, "second"), /live local owner/i);
  } finally {
    lock.release();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("render lock reclaims a dead local owner", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cat-render-lock-dead-test-"));
  const lockDir = path.join(dir, ".runs", ".lock");
  fs.mkdirSync(lockDir, { recursive: true });
  fs.writeFileSync(path.join(lockDir, "owner.json"), JSON.stringify({
    schemaVersion: 1,
    pid: 2_147_483_647,
    procStart: 0,
    runId: "dead",
    host: os.hostname(),
    acquiredAt: new Date(0).toISOString(),
    heartbeatSeconds: 30,
  }));
  const lock = acquireRenderLock(dir, "replacement");
  try {
    const owner = JSON.parse(fs.readFileSync(path.join(lockDir, "owner.json"), "utf8"));
    assert.strictEqual(owner.runId, "replacement");
  } finally {
    lock.release();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("render lock refuses a concurrent writer and names the absolute lock", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cat-render-lock-test-"));
  const lock = acquireRenderLock(dir, "first");
  try {
    assert.throws(
      () => acquireRenderLock(dir, "second"),
      (error: Error) => error.message.includes(path.resolve(dir, ".runs", ".lock"))
        && /already in progress/.test(error.message)
    );
  } finally {
    lock.release();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("chunk processor and assembler share one project writer lock with useful owner metadata", () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "cat-project-chunk-lock-"));
  const lock = acquireProjectChunkLock(projectDir, {
    operation: "process-storyboard-chunks",
    mode: "execute",
    requestedChunk: "chunk-002",
    runId: "processor-owner",
  });
  try {
    const lockPath = projectChunkLockPath(projectDir);
    const owner = JSON.parse(fs.readFileSync(path.join(lockPath, "owner.json"), "utf8"));
    assert.deepStrictEqual({
      operation: owner.operation,
      mode: owner.mode,
      requestedChunk: owner.requestedChunk,
      projectId: owner.projectId,
      projectDir: owner.projectDir,
      runId: owner.runId,
      pid: owner.pid,
      host: owner.host,
    }, {
      operation: "process-storyboard-chunks",
      mode: "execute",
      requestedChunk: "chunk-002",
      projectId: path.basename(projectDir),
      projectDir: path.resolve(projectDir),
      runId: "processor-owner",
      pid: process.pid,
      host: os.hostname(),
    });

    assert.throws(
      () => acquireProjectChunkLock(projectDir, { operation: "process-storyboard-chunks", mode: "check" }),
      (error: Error) => error.message.includes(lockPath)
        && error.message.includes("operation=process-storyboard-chunks")
        && /already in progress/.test(error.message),
    );
    assert.throws(
      () => acquireProjectChunkLock(projectDir, { operation: "assemble-storyboard-chunks", mode: "execute" }),
      /already in progress/,
    );
    assert.throws(
      () => acquireProjectChunkLock(projectDir, { operation: "compile-storyboard", mode: "execute" }),
      /already in progress/,
    );

    const canonicalStoryboardPath = path.join(projectDir, "storyboard.json");
    const canonicalTimelinePath = path.join(projectDir, "timeline.json");
    fs.writeFileSync(canonicalStoryboardPath, "{}\n", "utf8");
    fs.writeFileSync(path.join(projectDir, "chunks", "chunk-plan.json"), "{}\n", "utf8");
    const compiler = spawnSync(process.execPath, [
      require.resolve("ts-node/dist/bin.js"),
      "scripts/compile-storyboard.ts",
      "--storyboard", canonicalStoryboardPath,
      "--out", canonicalTimelinePath,
    ], { cwd: process.cwd(), encoding: "utf8" });
    assert.notStrictEqual(compiler.status, 0);
    assert.match(`${compiler.stdout}\n${compiler.stderr}`, /Canonical long-project compile rejected.*already in progress/s);
    assert.ok(!fs.existsSync(canonicalTimelinePath), "blocked canonical compile wrote a timeline");

    const processor = spawnSync(process.execPath, [
      require.resolve("ts-node/dist/bin.js"),
      "scripts/process-storyboard-chunks.ts",
      "--project", projectDir,
    ], { cwd: process.cwd(), encoding: "utf8" });
    assert.notStrictEqual(processor.status, 0);
    assert.match(`${processor.stdout}\n${processor.stderr}`, /Chunk project mutation already in progress/);

    const assembler = spawnSync(process.execPath, [
      require.resolve("ts-node/dist/bin.js"),
      "scripts/assemble-storyboard-chunks.ts",
      "--project", projectDir,
      "--execute",
    ], { cwd: process.cwd(), encoding: "utf8" });
    assert.notStrictEqual(assembler.status, 0);
    assert.match(`${assembler.stdout}\n${assembler.stderr}`, /Chunk project mutation already in progress/);
  } finally {
    lock.release();
  }

  try {
    assert.ok(!fs.existsSync(projectChunkLockPath(projectDir)), "release left the project writer lock behind");
    const replacement = acquireProjectChunkLock(projectDir, {
      operation: "assemble-storyboard-chunks",
      mode: "execute",
      runId: "assembly-owner",
    });
    replacement.release();
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test("chunk project lock uses process identity and stale foreign-heartbeat liveness policy", () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "cat-project-chunk-liveness-"));
  const lockPath = projectChunkLockPath(projectDir);
  const ownerFile = path.join(lockPath, "owner.json");
  const writeOwner = (owner: ProjectChunkLockOwner, ageMs = 0) => {
    fs.mkdirSync(lockPath, { recursive: true });
    fs.writeFileSync(ownerFile, `${JSON.stringify(owner, null, 2)}\n`, "utf8");
    if (ageMs > 0) {
      const staleTime = new Date(Date.now() - ageMs);
      fs.utimesSync(ownerFile, staleTime, staleTime);
    }
  };

  const live = acquireProjectChunkLock(projectDir, {
    operation: "process-storyboard-chunks",
    mode: "execute",
    runId: "live-local",
  });
  const ownerTemplate = live.owner;
  try {
    const staleTime = new Date(Date.now() - PROJECT_CHUNK_LOCK_STALE_MS - 10_000);
    fs.utimesSync(ownerFile, staleTime, staleTime);
    assert.throws(
      () => acquireProjectChunkLock(projectDir, { operation: "process-storyboard-chunks", mode: "check" }),
      /local owner pid=.*is alive/i,
    );
  } finally {
    live.release();
  }

  try {
    writeOwner({
      ...ownerTemplate,
      token: "recycled-local-owner",
      procStart: ownerTemplate.procStart - 60_000,
      runId: "recycled-local",
      acquiredAt: new Date().toISOString(),
    });
    const afterRecycledOwner = acquireProjectChunkLock(projectDir, {
      operation: "compile-storyboard",
      mode: "execute",
      runId: "after-recycled-local",
    });
    assert.strictEqual(afterRecycledOwner.owner.runId, "after-recycled-local");
    afterRecycledOwner.release();

    writeOwner({
      ...ownerTemplate,
      token: "dead-local-owner",
      pid: 2_147_483_647,
      runId: "dead-local",
      acquiredAt: new Date().toISOString(),
    });
    const afterDeadOwner = acquireProjectChunkLock(projectDir, {
      operation: "process-storyboard-chunks",
      mode: "check",
      runId: "after-dead-local",
    });
    assert.strictEqual(afterDeadOwner.owner.runId, "after-dead-local");
    afterDeadOwner.release();

    writeOwner({
      ...ownerTemplate,
      token: "fresh-foreign-owner",
      host: "another-host.invalid",
      runId: "fresh-foreign",
      acquiredAt: new Date().toISOString(),
    });
    assert.throws(
      () => acquireProjectChunkLock(projectDir, { operation: "assemble-storyboard-chunks", mode: "execute" }),
      /foreign-host heartbeat is only/i,
    );
    const oldTime = new Date(Date.now() - PROJECT_CHUNK_LOCK_STALE_MS - 10_000);
    fs.utimesSync(ownerFile, oldTime, oldTime);
    const afterForeignOwner = acquireProjectChunkLock(projectDir, {
      operation: "assemble-storyboard-chunks",
      mode: "execute",
      runId: "after-stale-foreign",
    });
    assert.strictEqual(afterForeignOwner.owner.runId, "after-stale-foreign");
    afterForeignOwner.release();
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test("chunk project lock leaves malformed stale metadata intact", () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "cat-project-chunk-malformed-"));
  const lockPath = projectChunkLockPath(projectDir);
  const ownerFile = path.join(lockPath, "owner.json");
  fs.mkdirSync(lockPath, { recursive: true });
  fs.writeFileSync(ownerFile, "{not-json", "utf8");
  const staleTime = new Date(Date.now() - PROJECT_CHUNK_LOCK_STALE_MS - 10_000);
  fs.utimesSync(ownerFile, staleTime, staleTime);
  try {
    assert.throws(
      () => acquireProjectChunkLock(projectDir, { operation: "process-storyboard-chunks", mode: "execute" }),
      /cannot be recovered safely.*left intact/s,
    );
    assert.strictEqual(fs.readFileSync(ownerFile, "utf8"), "{not-json");
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test("chunk project lock releases in exception and signal-controlled finally paths", async () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "cat-project-chunk-finally-"));
  const lockPath = projectChunkLockPath(projectDir);
  try {
    await assert.rejects(
      runWithProjectChunkLock(projectDir, {
        operation: "process-storyboard-chunks",
        mode: "check",
      }, async () => {
        throw new Error("fixture failure");
      }),
      /fixture failure/,
    );
    assert.ok(!fs.existsSync(lockPath), "exception path left the project writer lock behind");

    const baselineSigtermListeners = new Set(process.listeners("SIGTERM"));
    let observedAbort = false;
    await assert.rejects(
      runWithProjectChunkLock(projectDir, {
        operation: "assemble-storyboard-chunks",
        mode: "execute",
      }, async (signal) => {
        const installed = process.listeners("SIGTERM").filter((listener) => !baselineSigtermListeners.has(listener));
        assert.strictEqual(installed.length, 1, "signal lifecycle did not install exactly one SIGTERM listener");
        (installed[0] as () => void)();
        observedAbort = signal.aborted;
      }),
      (error: unknown) => error instanceof ProjectChunkInterruptedError
        && error.signalName === "SIGTERM"
        && error.exitCode === 143,
    );
    assert.strictEqual(observedAbort, true);
    assert.ok(!fs.existsSync(lockPath), "signal path left the project writer lock behind");
    assert.deepStrictEqual(new Set(process.listeners("SIGTERM")), baselineSigtermListeners);
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test("visual measurement configuration rejects stale hashes and invalid phase sets", () => {
  const baseline = JSON.parse(fs.readFileSync(
    path.join(process.cwd(), "config", "reference-visual-baseline.json"),
    "utf8",
  ));
  const contract = assertVisualMeasurementConfiguration(referenceQuality.visualAudit, baseline);
  assert.strictEqual(contract.hash, referenceQuality.visualAudit.measurementSpecHash);
  assert.deepStrictEqual(contract.sampleOffsets, [0, 2.5]);
  assert.deepStrictEqual(expectedVisualSampleSchedule(contract.sampleOffsets, 5, 10), [0, 2.5, 5, 7.5]);
  assert.throws(
    () => assertVisualMeasurementConfiguration(
      { ...referenceQuality.visualAudit, measurementSpecHash: "0".repeat(64) },
      baseline,
    ),
    /different measurement specifications/i,
  );
  for (const offsets of [[], [0, 0], [-1], [5], [0, Number.NaN]]) {
    assert.throws(() => normalizeVisualAuditOffsets(offsets, 5));
  }
  assert.throws(() => normalizeVisualAuditOffsets([2.5], 5, 2), /requested duration/i);
});

test("visual audit readiness requires complete global and chunk evidence", () => {
  const baseline = JSON.parse(fs.readFileSync(
    path.join(process.cwd(), "config", "reference-visual-baseline.json"),
    "utf8",
  ));
  const contract = assertVisualMeasurementConfiguration(referenceQuality.visualAudit, baseline);
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
  const applicability = (distribution: boolean, seam: boolean) => ({
    saturation: { applies: distribution, category: "distribution" },
    nearWhiteMean: { applies: distribution, category: "distribution" },
    whiteDominantRatio: { applies: distribution, category: "distribution" },
    flatFrameRatio: { applies: distribution, category: "distribution" },
    nearDuplicateRatio: { applies: distribution, category: "distribution" },
    edgeDensity: { applies: true, category: "local-frame-detail" },
    focalOccupancy: { applies: true, category: "local-frame-detail" },
    withinSceneNearDuplicateRatio: { applies: true, category: "within-scene-temporal" },
    longestStaticRun: { applies: true, category: "within-scene-temporal" },
    seamNearDuplicateRatio: { applies: seam, category: "seam-temporal" },
    minimumEvidence: { applies: true, category: "evidence-integrity" },
  });
  const row = (scheduledSeconds: number, sceneId: string, sampleRole: string, seconds = scheduledSeconds) => ({
    seconds,
    scheduledSeconds,
    sceneId,
    sampleRole,
    white: 0.4,
    saturation: 0.18,
    edges: 0.2,
    dominantColor: 0.3,
    flat: false,
    focalOccupancy: 0.4,
    focalOccupancyTarget: null,
    focalOccupancyDelta: null,
  });
  const pair = (left: any, right: any) => ({
    fromSceneId: left.sceneId,
    toSceneId: right.sceneId,
    fromSeconds: left.seconds,
    toSeconds: right.seconds,
    deltaSeconds: right.seconds - left.seconds,
    pairKind: left.sceneId === right.sceneId ? "within-scene" : "seam",
    difference: 0.04,
    nearDuplicate: false,
  });
  const reportFor = (kind: "global" | "chunk") => {
    const samples = kind === "global"
      ? [0, 2.5, 5, 7.5].map((seconds) => row(seconds, "only", "global"))
      : [
          row(0, "before", "halo-before"),
          row(2.5, "core", "core"),
          row(5, "core", "core"),
          row(7.5, "after", "halo-after"),
        ];
    const temporalPairs = samples.slice(1).map((right, index) => pair(samples[index], right))
      .filter((_item, index) => kind === "global" || [0, 1].includes(index));
    const chunk = kind === "chunk";
    return {
      schemaVersion: 2,
      measurementSpecVersion: contract.version,
      measurementSpecHash: contract.hash,
      measurementSpec: contract.specification,
      video: "candidate.mp4",
      contactSheet: "candidate.contact.jpg",
      auditScope: {
        kind,
        chunkId: chunk ? "chunk-001" : null,
        coreSceneIds: chunk ? ["core"] : null,
        scalarOwnership: chunk ? "core-only" : "all-samples",
        temporalOwnership: chunk ? "destination-core" : "all-destinations",
        seamExpected: chunk,
      },
      sampleSeconds: 5,
      sampleOffsets: [0, 2.5],
      sampleOffsetSeconds: null,
      expectedDurationSeconds: 10,
      probedDurationSeconds: 10,
      durationSource: "caller-expected-and-probe-verified",
      durationToleranceSeconds: 1 / 30 + 1024 / 48_000 + 0.005,
      expectedSampleCount: 4,
      timelineOffsetSeconds: 0,
      subtitleBandMaskedFrom: 0.76,
      sampledFrames: 4,
      gatingSampledFrames: chunk ? 2 : 4,
      gatingCoreSceneIds: chunk ? ["core"] : null,
      nearWhiteMean: 0.4,
      whiteDominantRatio: 0,
      flatFrameRatio: 0,
      saturation: { mean: 0.18, p10: 0.18, p50: 0.18 },
      edgeDensity: { mean: 0.2, p10: 0.2, p50: 0.2 },
      nearDuplicateRatio: 0,
      edgeNearDuplicateRatio: 0,
      withinSceneNearDuplicateRatio: 0,
      withinSceneEdgeNearDuplicateRatio: 0,
      seamNearDuplicateRatio: chunk ? 0 : null,
      seamEdgeNearDuplicateRatio: chunk ? 0 : null,
      crossSceneNearDuplicateRatio: chunk ? 0 : null,
      ownedPairCount: temporalPairs.length,
      withinScenePairCount: chunk ? 1 : 3,
      withinSceneDuplicateCount: 0,
      withinScenePairCountsByScene: chunk ? { core: 1 } : { only: 3 },
      seamPairCount: chunk ? 1 : 0,
      seamDuplicateCount: 0,
      crossScenePairCount: chunk ? 1 : 0,
      crossSceneDuplicateCount: 0,
      longestNearDuplicateRunSeconds: 0,
      longestWithinSceneNearDuplicateRunSeconds: 0,
      structuralChangeMean: 0.04,
      focalOccupancy: {
        mean: 0.4,
        p10: 0.4,
        declaredTargetSamples: 0,
        belowDeclaredTargetRatio: null,
      },
      samples,
      temporalPairs,
      gateApplicability: applicability(!chunk, chunk),
      minimumEvidence: {
        ...contract.specification.minimumEvidence,
        observedScalarFrames: chunk ? 2 : 4,
        observedOwnedTemporalPairs: temporalPairs.length,
        observedWithinScenePairs: chunk ? 1 : 3,
        observedSeamPairs: chunk ? 1 : 0,
        sufficient: true,
      },
      failures: [],
      passed: true,
    };
  };
  const globalExpectation = {
    contract,
    expectedDurationSeconds: 10,
    probedDurationSeconds: 10,
    sampleOffsets: [0, 2.5],
    frameRate: 30,
    timelineOffsetSeconds: 0,
    subtitleBandTopRatio: 0.76,
    sceneIds: ["only"],
    qualityScope: { kind: "global" as const },
  };
  const globalReport = reportFor("global");
  assert.doesNotThrow(() => assertVisualAuditReport(globalReport, globalExpectation));
  const decodedPtsReport = clone(globalReport);
  decodedPtsReport.samples.forEach((sample: any) => { sample.seconds += 0.4; });
  decodedPtsReport.temporalPairs.forEach((pair: any) => {
    pair.fromSeconds += 0.4;
    pair.toSeconds += 0.4;
  });
  assert.doesNotThrow(() => assertVisualAuditReport(decodedPtsReport, globalExpectation));
  assert.throws(() => assertVisualAuditReport({ passed: true }, globalExpectation), /schemaVersion 2/i);
  for (const mutate of [
    (value: any) => { value.schemaVersion = 1; },
    (value: any) => { value.measurementSpecHash = "0".repeat(64); },
    (value: any) => { value.sampleOffsets = [0]; },
    (value: any) => { value.expectedDurationSeconds = 9.9; },
    (value: any) => { value.durationToleranceSeconds = 1; },
    (value: any) => { value.expectedSampleCount = 3; },
    (value: any) => { value.samples[1].scheduledSeconds = 2.4; },
    (value: any) => { value.samples[1].seconds = 2.4; },
    (value: any) => { value.samples[1].sceneId = "borrowed"; },
    (value: any) => { value.saturation.mean = Number.NaN; },
    (value: any) => { value.structuralChangeMean = 0.9; },
    (value: any) => { value.temporalPairs.pop(); },
    (value: any) => { value.gateApplicability.flatFrameRatio.applies = false; },
  ]) {
    const malformed = clone(globalReport);
    mutate(malformed);
    assert.throws(() => assertVisualAuditReport(malformed, globalExpectation));
  }

  const chunkReport = reportFor("chunk");
  const chunkExpectation = {
    ...globalExpectation,
    sceneIds: ["before", "core", "after"],
    qualityScope: {
      kind: "chunk" as const,
      chunkId: "chunk-001",
      haloBeforeSceneIds: ["before"],
      coreSceneIds: ["core"],
      haloAfterSceneIds: ["after"],
    },
  };
  assert.doesNotThrow(() => assertVisualAuditReport(chunkReport, chunkExpectation));
  const wrongChunkRole = clone(chunkReport);
  wrongChunkRole.samples[1].sampleRole = "halo-before";
  assert.throws(() => assertVisualAuditReport(wrongChunkRole, chunkExpectation), /wrong ownership role/i);
  const wrongChunkCore = clone(chunkReport);
  wrongChunkCore.auditScope.coreSceneIds = ["after"];
  assert.throws(() => assertVisualAuditReport(wrongChunkCore, chunkExpectation), /core scope/i);
});

test("reference comparison requires compatible pooled multiphase measurements and finite metrics", () => {
  const baseline = JSON.parse(fs.readFileSync(
    path.join(process.cwd(), "config", "reference-visual-baseline.json"),
    "utf8",
  ));
  const candidate = {
    schemaVersion: 2,
    measurementSpecVersion: baseline.measurementSpecVersion,
    measurementSpecHash: baseline.measurementSpecHash,
    measurementSpec: baseline.measurementSpec,
    sampleSeconds: baseline.sampleSeconds,
    sampleOffsets: baseline.offsetsSeconds,
    flatFrameRatio: 0.6,
    edgeDensity: { mean: 0.14 },
    nearDuplicateRatio: 0.3,
    longestNearDuplicateRunSeconds: 15,
    saturation: { mean: 0.2 },
    nearWhiteMean: 0.2,
    whiteDominantRatio: 0.1,
    temporalPairs: [{ deltaSeconds: 2.5 }, { deltaSeconds: 2.5 }],
    structuralChangeMean: 0.04,
    ownedPairCount: 2,
  };
  const result = buildReferenceComparison(candidate, baseline);
  assert.strictEqual(result.baseline, "pooledBaseline");
  assert.strictEqual(result.measurementSpecHash, referenceQuality.visualAudit.measurementSpecHash);
  assert.deepStrictEqual(result.structuralChange.actualPairDeltaSeconds, [2.5]);
  assert.strictEqual(result.structuralChange.candidateMean, 0.04);
  assert.strictEqual(result.deltaCandidateMinusReference.flatFrameRatio, 0.1468);
  assert.strictEqual(result.deltaCandidateMinusReference.edgeDensity, -0.052);
  assert.strictEqual(result.deltaCandidateMinusReference.nearWhiteMean, -0.2464);
  assert.strictEqual(result.deltaCandidateMinusReference.longestNearDuplicateRunSeconds, -2.5);

  assert.throws(
    () => buildReferenceComparison({ ...candidate, measurementSpecHash: "0".repeat(64) }, baseline),
    /not comparable/i,
  );
  assert.throws(
    () => buildReferenceComparison({ ...candidate, sampleOffsets: [0] }, baseline),
    /different sampling phases/i,
  );
  assert.throws(
    () => buildReferenceComparison({ ...candidate, saturation: { mean: Number.NaN } }, baseline),
    /finite number/i,
  );
  assert.throws(
    () => buildReferenceComparison(candidate, { ...baseline, pooledBaseline: { ...baseline.pooledBaseline, edgeDensity: Infinity } }),
    /finite number/i,
  );
});

test("video-004 representative acceptance stays inside reference deltas", () => {
  const acceptance = JSON.parse(fs.readFileSync(
    path.join(process.cwd(), "projects", "video-004-han-quoc-dau-tu", "acceptance.json"),
    "utf8",
  ));
  assert.strictEqual(acceptance.result, "pass");
  assert.ok(acceptance.metrics.saturation >= 0.17 && acceptance.metrics.saturation <= 0.205);
  assert.ok(acceptance.referenceDeltas.saturation <= 0.025);
  assert.ok(acceptance.metrics.flatFrameRatio <= 0.50);
  assert.ok(acceptance.metrics.edgeDensity >= 0.16);
  assert.ok(acceptance.metrics.nearDuplicateRatio <= 0.22);
  assert.ok(acceptance.metrics.withinSceneNearDuplicateRatio <= 0.15);
  assert.ok(acceptance.directionCoverage.visualModes >= 6);
  assert.ok(acceptance.directionCoverage.photoTreatments >= 5);
  assert.ok(Object.values(acceptance.manualContactSheetReview).every(Boolean));
});

test("palette normalization mutes only assets above the editorial source target", () => {
  const saturatedPhoto = getPaletteSaturationScale("backgrounds/trading_workstation.jpg");
  const editorialStage = getPaletteSaturationScale("assets/scenes/office_desk.svg");
  assert.ok(saturatedPhoto >= 0.5 && saturatedPhoto <= 0.55);
  assert.strictEqual(editorialStage, 1);
});

test("occupancy pilot grammars emit semantic frame-filling components", () => {
  const ctx = { cast: {}, index: 0, strict: true };
  const cause = VISUAL_GRAMMARS.CAUSE_EFFECT({
    id: "cause", narration: "Debt causes stress", purpose: "mechanism", emotion: "concern",
    viewerFocus: "stress", visualGrammar: "CAUSE_EFFECT",
    slots: {
      cause: "Debt", effect: "Stress",
      causeIcon: "finance/debt", effectIcon: "props/brain",
    },
  }, ctx);
  assert.strictEqual(cause.layout, "CAUSE_EFFECT");
  assert.strictEqual(cause.cards?.length, 2);
  assert.ok((cause.cards?.[0].width ?? 0) >= 600);

  const solo = VISUAL_GRAMMARS.SOLO({
    id: "solo", narration: "Think about the budget", purpose: "direct address", emotion: "curious",
    viewerFocus: "budget", visualGrammar: "SOLO",
    slots: { who: "characters/cat_think", action: "points", keyword: "Your budget", prop: "finance/budget" },
  }, ctx);
  assert.strictEqual(solo.cards?.[0].iconSrc, "finance/budget");
  assert.ok((solo.cards?.[0].width ?? 0) >= 700);

  const stat = VISUAL_GRAMMARS.STAT_REVEAL({
    id: "stat", narration: "It fell 30 percent", purpose: "reveal", emotion: "surprise",
    viewerFocus: "30%", visualGrammar: "STAT_REVEAL",
    slots: { stat: "30%", anchor: "finance/chart_down", who: "characters/cat_surprised" },
  }, ctx);
  assert.ok((stat.texts[0].fontSize ?? 0) >= 200);
  assert.strictEqual(stat.cards?.[0].iconSrc, "finance/chart_down");
});

test("STAT is light by default, dark only when authored, with separated measure card", () => {
  const ctx = { cast: {}, index: 0, strict: true };
  const brief: any = {
    id: "stat", narration: "The market fell 18%.", purpose: "show the fall",
    emotion: "urgent", viewerFocus: "18%", visualGrammar: "STAT_REVEAL",
    slots: {
      stat: "-18%", anchor: "finance/chart_down",
      caption: "KOSPI in a few days", who: "characters/cat_surprised",
    },
  };
  const light = VISUAL_GRAMMARS.STAT_REVEAL(brief, ctx);
  const dark = VISUAL_GRAMMARS.STAT_REVEAL({
    ...brief, slots: { ...brief.slots, tone: "dramatic" },
  }, ctx);
  assert.strictEqual(light.backgroundSrc, "#FFFFFF");
  assert.ok(String(dark.backgroundSrc).includes("0d0d1a"));
  assert.strictEqual(light.texts.length, 1);
  assert.strictEqual(light.cards?.[0].label, "KOSPI in a few days");
  assert.ok(Math.abs((light.cards?.[0].position.x ?? 0) - (light.texts[0].position?.x ?? 0)) > 0.16);
});

test("DIALOGUE_QA hands off between non-overlapping bubbles", () => {
  const result = VISUAL_GRAMMARS.DIALOGUE_QA({
    id: "qa", narration: "Why? Because debt.", purpose: "teach through dialogue",
    emotion: "curious", viewerFocus: "the answer", visualGrammar: "DIALOGUE_QA",
    slots: {
      asker: "characters/cat_talk", answerer: "characters/cat_think",
      askerText: "Why?", answererText: "Because debt.",
    },
  } as any, { cast: {}, index: 0, strict: true });
  assert.strictEqual(result.speechBubbles?.length, 2);
  assert.strictEqual(result.speechBubbles?.[0].duration, 48);
  assert.strictEqual(result.speechBubbles?.[1].duration, undefined);
  assert.ok(
    (result.speechBubbles?.[0].delay ?? 0) + (result.speechBubbles?.[0].duration ?? 0)
      < (result.speechBubbles?.[1].delay ?? 0),
  );
});

test("word-safe text fitting keeps Vietnamese words intact", () => {
  const fit = fitTextToBox("và tiền vay cộng lãi vay vẫn phải trả đủ", 44, 24, 390, 150, 3);
  assert.ok(fit.fits);
  assert.ok(fit.lines.some((line) => line.endsWith("đủ")));
  assert.ok(!fit.lines.some((line) => line === "đ" || line === "ủ"));
});

test("DIALOGUE_QA consumes its authored stage and anchors", () => {
  const result = VISUAL_GRAMMARS.DIALOGUE_QA({
    id: "qa-stage", narration: "A asks B.", purpose: "acted exchange",
    emotion: "curious", viewerFocus: "the handoff", visualGrammar: "DIALOGUE_QA",
    slots: {
      asker: "characters/cat_talk", answerer: "characters/cat_think",
      askerText: "Why?", answererText: "Because.",
      stage: "assets/scenes/cafe.svg",
      anchorA: "counter_left", anchorB: "counter_right",
    },
  } as any, { cast: {}, index: 0, strict: true });
  assert.strictEqual(result.backgroundSrc, "assets/scenes/cafe.svg");
  assert.strictEqual(result.entities[0].anchor, "counter_left");
  assert.strictEqual(result.entities[1].anchor, "counter_right");
});

test("narrator cast roles preserve identity while following the authored emotion pose", () => {
  const result = VISUAL_GRAMMARS.CHAR_PROP({
    id: "pose-family", narration: "This is bad.", purpose: "show concern",
    emotion: "sad", viewerFocus: "the sad host", visualGrammar: "CHAR_PROP",
    slots: { who: "host", prop: "finance/loss" },
  } as any, {
    cast: { host: { src: "characters/cat_explain", poseFamily: "narrator" } },
    index: 0,
    strict: true,
  });
  assert.strictEqual(result.entities[0].src, "characters/cat_sad");
});

test("QA_REVEAL may omit its optional character role in strict mode", () => {
  const result = VISUAL_GRAMMARS.QA_REVEAL({
    id: "qa-fallback", narration: "Why? Because.", purpose: "reveal an answer",
    emotion: "curious", viewerFocus: "the answer", visualGrammar: "QA_REVEAL",
    slots: { q: "Why?", a: "Because." },
  } as any, { cast: {}, index: 0, strict: true });
  assert.strictEqual(result.entities[0].src, "characters/cat_think");
});

test("multi-card scenes advance only on an authored narration phrase", () => {
  const storyboard = timingFixture(["scene-001"]);
  storyboard.scenes[0].visualGrammar = "CAUSE_EFFECT";
  storyboard.scenes[0].slots = {
    cause: "Debt", effect: "Stress",
    causeIcon: "finance/debt", effectIcon: "props/brain",
  };
  storyboard.scenes[0].beats = [{
    text: "three", importance: 0.8, kind: "turn", action: "advance", targetSlot: "next",
  }];
  const timeline = compileStoryboard(storyboard, {
    durations: [{ id: "scene-001", startFrame: 0, frames: 360 }],
    words: [{ scene: "scene-001", word: "three", startSec: 4, endSec: 4.2 }],
  });
  // The first focal lands on the cut frame. The second card follows the
  // storyboard phrase, never a component-level or compiler-level timer.
  assert.strictEqual(timeline.scenes[0].cards?.[0].delay, 0);
  assert.strictEqual(timeline.scenes[0].cards?.[1].delay, 120);
  assert.deepStrictEqual(transitionReceipt(timeline.scenes[0], "advance", "next"), {
    beatText: "three",
    action: "advance",
    targetSlot: "next",
    frame: 120,
    renderedComponentIds: ["scene-001-effect"],
    fromState: "visible-at:38",
    toState: "visible-at:120",
  });
  assert.deepStrictEqual(timeline.timingProvenance?.beatTimingSummary, {
    "aligned-words": 1,
  });
  assert.deepStrictEqual(
    checkSceneBeatTimingSources(timeline.scenes, timeline.timingProvenance),
    []
  );
});

test("scene-end text hold survives beyond legacy hardcoded durations", () => {
  const scene = {
    id: "hold", label: "hold", startFrame: 0, durationFrames: 300,
    layout: "STAT_DRAMA" as const, narration: "Thirty percent.",
    entities: [], backgroundSrc: "#111111",
    texts: [{ id: "stat", content: "30%", style: "STAT" as const, delay: 10, duration: 30, hold: "scene-end" as const }],
  };
  const compiled = compileScenes({
    fps: 30, width: 1920, height: 1080, durationInFrames: 300, scenes: [scene],
  });
  const text = compiled.events.find((event: any) => event.type === "text") as any;
  assert.strictEqual(text.exitFrame, 299);
});

test("hard scene clears do not crossfade through a blank background", () => {
  const scene = {
    id: "cut", label: "cut", startFrame: 0, durationFrames: 150,
    layout: "TABLEAU" as const, narration: "A new place.",
    entities: [], texts: [], backgroundSrc: "assets/scenes/park.svg",
    clearPrevious: true,
  };
  const compiled = compileScenes({
    fps: 30, width: 1920, height: 1080, durationInFrames: 150, scenes: [scene],
  });
  const background = compiled.events.find((event: any) => event.type === "background") as any;
  assert.strictEqual(background.duration, 1);
});

test("teaching text coverage counts persistent cards but exempts title tails", () => {
  // `label` is the only text channel ConceptCard renders — this fixture used
  // `title`, a field SceneConceptCard does not define, so it was asserting that a
  // card which draws nothing still counts as teaching coverage. That is the same
  // confusion that let DIALOGUE_QA's blank backdrop panels silence this gate.
  const persistent = measureTeachingTextCoverage({
    durationFrames: 300,
    texts: [],
    cards: [{ id: "answer", label: "Answer", delay: 30 }],
  });
  assert.strictEqual(persistent.layerCount, 1);
  assert.strictEqual(persistent.coverageRatio, 0.9);

  // A card with no renderable content must not be credited.
  const blankPanel = measureTeachingTextCoverage({
    durationFrames: 300,
    texts: [],
    cards: [{ id: "panel", delay: 4 }],
  });
  assert.strictEqual(blankPanel.layerCount, 0);
  assert.strictEqual(blankPanel.coverageRatio, 0);

  const titleOnly = measureTeachingTextCoverage({
    durationFrames: 300,
    texts: [{ id: "title", content: "Hook", delay: 0, hold: "title" }],
  });
  assert.strictEqual(titleOnly.coveredFrames, 120);
  assert.strictEqual(titleOnly.coverageRatio, 0.4);
});

test("a keywordless SOLO is refused on every route, not just schema v2", () => {
  // SOLO used to require nothing in the version-agnostic table, so route A could
  // ship a scene that compiles to a bare character on a flat field — the state
  // that measured 100% flat frames. The registry's v2-only list did demand slots,
  // but also demanded `action`, which no grammar reads.
  const withKeyword = runStoryboardCheck({
    schemaVersion: 1,
    scenes: [{ id: "ok", visualGrammar: "SOLO", narration: "a b.", slots: { who: "characters/cat", keyword: "Face" } }],
  });
  const without = runStoryboardCheck({
    schemaVersion: 1,
    scenes: [{ id: "bare", visualGrammar: "SOLO", narration: "a b.", slots: { who: "characters/cat" } }],
  });
  const slotIssues = (report: any) => report.checks
    .flatMap((c: any) => c.issues ?? [])
    .filter((i: any) => /slot/i.test(i.message));
  assert.strictEqual(slotIssues(withKeyword).length, 0);
  assert.ok(slotIssues(without).some((i: any) => /keyword/.test(i.message)));
});

test("authored asset bookkeeping resolves cast roles and excludes stage anchors", () => {
  const resolved = resolveAuthoredAssets({
    who: "host",
    seatB: "characters/cat_worker",
    stage: "assets/scenes/cafe.svg",
    anchorA: "seat_left",
    anchorB: "seat_right",
    prop: "finance/money",
  }, {
    host: { src: "characters/cat_explain" },
  });
  assert.deepStrictEqual(resolved, {
    who: "characters/cat_explain",
    seatB: "characters/cat_worker",
    prop: "finance/money",
    stage: "assets/scenes/cafe.svg",
  });
  assert.ok(!Object.values(resolved).includes("seat_left"));
  assert.ok(!Object.values(resolved).includes("host"));
});

test("component-backed evidence does not need a decorative asset request", () => {
  const report = runStoryboardCheck({
    schemaVersion: 2,
    scenes: [{
      id: "evidence", narration: "A documented claim.", purpose: "show the claim",
      emotion: "neutral", viewerFocus: "the evidence card", visualGrammar: "EVIDENCE",
      slots: { body: "A documented claim." },
      sourceRange: { startWord: 0, endWord: 2, quoteChecksum: "x" },
      visualRegister: "evidence", focalType: "evidence",
      semanticVisual: { subject: "claim", action: "appears on a paper card", takeaway: "the claim is documented" },
      silentFrameTakeaway: "the claim is documented", focalOccupancyTarget: 0.4,
      noveltyFromPrevious: ["opening"], visualFingerprint: "EVIDENCE|evidence|card",
      assetRequests: [], resolvedAssets: {},
    }],
  });
  const issues = report.checks.flatMap((check) => check.issues ?? []);
  assert.ok(!issues.some((issue) => issue.rule === "ASSET_REQUEST"));
});

test("quality gate catches a blank scene opening and card-icon text collision", () => {
  const report = runQualityCheck({
    schemaVersion: 2, fps: 30, width: 1920, height: 1080, durationInFrames: 300,
    audio: "audio/test.wav",
    scenes: [{
      id: "scene", label: "collision", startFrame: 0, durationFrames: 300,
      layout: "STAT_DRAMA", narration: "A number.", backgroundSrc: "#FFFFFF",
      clearPrevious: true,
      entities: [], paperCards: [], frameBoxes: [], speechBubbles: [],
      cards: [{
        id: "panel", position: { x: 0.5, y: 0.45 }, background: "#333333",
        iconSrc: "finance/money", width: 1000, height: 600, delay: 8,
      }],
      texts: [{
        id: "stat", content: "100", style: "STAT",
        position: { x: 0.5, y: 0.45 }, delay: 10, duration: 100,
      }],
      sourceRange: { startWord: 0, endWord: 1, quoteChecksum: "x" },
      visualRegister: "infographic", visualGrammar: "STAT_REVEAL",
      semanticTakeaway: "a number", semanticAction: "number appears",
      semanticAssetIds: ["finance/money"], focalType: "diagram",
      visualFingerprint: "stat", silentFrameTakeaway: "a number",
      focalOccupancyTarget: 0.3, noveltyFromPrevious: ["opening"],
    }],
  });
  const rules = report.checks.flatMap((check) => check.issues ?? []).map((issue) => issue.rule);
  assert.ok(rules.includes("BLANK_SCENE_OPENING"));
  assert.ok(rules.includes("CARD_ICON_TEXT_COLLISION"));
});

test("photo policy exposes reviewed no-face images and rejects unreviewed files", () => {
  assert.strictEqual(isApprovedNoFacePhoto("backgrounds/korea_apartments.jpg"), true);
  assert.strictEqual(isApprovedNoFacePhoto("backgrounds/kitchen.jpg"), false);
  assert.strictEqual(isApprovedNoFacePhoto("backgrounds/airport.jpg"), false);
  assert.ok(approvedPhotoPaths().includes("backgrounds/mobile_trading_flatlay.jpg"));
  assert.ok(approvedPhotoPaths().length >= 40);
});

test("systemPrompt compatibility lists assets and approved backgrounds from the manifest", () => {
  assert.deepStrictEqual(listAvailableAssets(), listResolvableRefs());
  assert.deepStrictEqual(
    listAvailableBackgrounds(),
    listManifestAssetPaths({ styleFamily: "photo" }).filter(isApprovedNoFacePhoto),
  );
  assert.throws(() => buildSystemPrompt([], 60), /Route B\/API prompt generation is locked/);
});

test("quality gate blocks unreviewed photos and repeated photo wallpaper", () => {
  const makeScene = (id: string, startFrame: number, backgroundSrc: string) => ({
    id, label: id, startFrame, durationFrames: 150, layout: "BEAT",
    narration: "A deliberate photo beat.", backgroundSrc, clearPrevious: true,
    entities: [], texts: [], cards: [], paperCards: [], frameBoxes: [],
    speechBubbles: [], sourceRange: { startWord: 0, endWord: 1, quoteChecksum: "x" },
    visualRegister: "photo_broll", visualGrammar: "PHOTO_EVIDENCE",
    semanticTakeaway: "the photo is evidence", semanticAction: "photo fills the frame",
    semanticAssetIds: [backgroundSrc], focalType: "photo",
    visualFingerprint: `${id}|photo`, silentFrameTakeaway: "the photo is evidence",
    focalOccupancyTarget: 0.8, noveltyFromPrevious: ["new photo"],
  });
  const embeddedUnreviewed = makeScene("p1", 0, "backgrounds/kitchen.jpg");
  embeddedUnreviewed.backgroundSrc = "assets/scenes/cafe.svg";
  embeddedUnreviewed.semanticAssetIds = ["backgrounds/kitchen.jpg"];
  const report = runQualityCheck({
    schemaVersion: 2, fps: 30, width: 1920, height: 1080, durationInFrames: 600,
    audio: "audio/test.wav",
    scenes: [
      embeddedUnreviewed,
      makeScene("p2", 150, "backgrounds/office_trading.jpg"),
      makeScene("p3", 300, "backgrounds/office_trading.jpg"),
      makeScene("p4", 450, "backgrounds/office_trading.jpg"),
    ],
  });
  const rules = report.checks.flatMap((check) => check.issues ?? []).map((issue) => issue.rule);
  const faceIssue = report.checks.flatMap((check) => check.issues ?? [])
    .find((issue) => issue.rule === "PHOTO_FACE_POLICY");
  assert.ok(rules.includes("PHOTO_FACE_POLICY"));
  assert.ok(rules.includes("PHOTO_REPEAT"));
  assert.ok(faceIssue?.message.includes("backgrounds/kitchen.jpg"));
  assert.ok(!faceIssue?.message.includes("assets/scenes/cafe.svg"));
});

test("storyboard photo reuse follows manifest identity across authored carriers", () => {
  const makeBrief = (id: string, fields: Record<string, unknown>) => ({
    id, narration: "A deliberate visual beat.", purpose: "show the visual",
    emotion: "neutral" as const, viewerFocus: "the visual", visualGrammar: "FREEFORM" as const,
    ...fields,
  });
  const photo = "backgrounds/office_trading.jpg";
  const aliasOfSamePhoto = "backgrounds/stock_chart.jpg";
  const repeated = runStoryboardCheck({
    fps: 30, width: 1920, height: 1080,
    scenes: [
      makeBrief("photo-background", {
        slots: { background: photo },
        resolvedAssets: { background: photo },
      }),
      makeBrief("photo-request", {
        assetRequests: [{ preferredAssetId: photo, lockedAssetId: aliasOfSamePhoto }],
      }),
      makeBrief("photo-freeform", {
        freeform: { backgroundSrc: aliasOfSamePhoto },
      }),
    ],
  });
  const repeatedIssues = repeated.checks.flatMap((check) => check.issues);
  assert.ok(repeatedIssues.some((issue) =>
    issue.rule === "PHOTO_REPEAT" && issue.message.includes(photo) && issue.message.includes("3")));

  const nonPhotos = runStoryboardCheck({
    fps: 30, width: 1920, height: 1080,
    scenes: ["one", "two", "three"].map((id) => makeBrief(id, {
      slots: { stage: "assets/scenes/cafe.svg", background: "linear-gradient(#FFFFFF, #FAFAF8)" },
      freeform: { backgroundSrc: "#FFFFFF" },
    })),
  });
  assert.ok(!nonPhotos.checks.flatMap((check) => check.issues)
    .some((issue) => issue.rule === "PHOTO_REPEAT"),
  "CSS fills and manifest stage art must not be classified as photos");
});

test("liveliness never invents motion beyond storyboard-authored beats", () => {
  const timeline: any = {
    fps: 30,
    width: 1920,
    height: 1080,
    durationInFrames: 500,
    events: [{
      frame: 0,
      type: "enter",
      assetId: "cat",
      src: "characters/cat",
      position: { x: 0.5, y: 0.5 },
      scale: 1,
      animation: "softScaleIn",
    }],
  };
  const result = injectLiveliness(timeline, {
    availablePoses: new Set([
      "characters/cat",
      "characters/cat_talk",
      "characters/cat_explain",
      "characters/cat_think",
    ]),
    sceneSpans: [{
      start: 0,
      end: 500,
      narrationBeatFrames: [90, 180, 300],
    }],
  });
  const swaps = timeline.events.filter((event: any) => event.type === "swap");
  const moves = timeline.events.filter((event: any) => event.type === "move");
  assert.strictEqual(result.swapsAdded, 0);
  assert.strictEqual(result.movesAdded, 0);
  assert.strictEqual(result.cameraMovesAdded, 0);
  assert.strictEqual(swaps.length, 0);
  assert.strictEqual(moves.length, 0);

  const costumed: any = {
    ...timeline,
    events: [{
      frame: 0,
      type: "enter",
      assetId: "worker",
      src: "characters/cat_worker",
      position: { x: 0.5, y: 0.5 },
      scale: 1,
      animation: "softScaleIn",
    }],
  };
  const costumedResult = injectLiveliness(costumed);
  assert.strictEqual(costumedResult.movesAdded, 0);
  assert.strictEqual(costumedResult.cameraMovesAdded, 0);
  assert.strictEqual(costumed.events.filter((event: any) => event.type === "move").length, 0);
});

test("liveliness preserves authored camera events without adding resets", () => {
  const timeline: any = {
    fps: 30,
    width: 1920,
    height: 1080,
    durationInFrames: 600,
    events: [{
      frame: 120,
      type: "camera",
      zoom: 1.04,
      centerX: 0.5,
      centerY: 0.5,
      duration: 20,
    }],
  };
  const result = injectLiveliness(timeline, {
    sceneSpans: [
      { start: 0, end: 300, narrationBeatFrames: [120, 260] },
      { start: 300, end: 600, narrationBeatFrames: [420, 560] },
    ],
  });
  const cameraFrames = timeline.events
    .filter((event: any) => event.type === "camera")
    .map((event: any) => event.frame);
  assert.deepStrictEqual(cameraFrames, [120]);
  assert.strictEqual(result.cameraMovesAdded, 0);
});

test("liveliness never washes a stage background to influence an audit", () => {
  const timeline: any = {
    fps: 30,
    width: 1920,
    height: 1080,
    durationInFrames: 360,
    events: [{
      frame: 0,
      type: "background",
      src: "assets/scenes/street.svg",
      duration: 1,
    }],
  };
  const result = injectLiveliness(timeline, {
    sceneSpans: [{ start: 0, end: 360, narrationBeatFrames: [90, 210] }],
  });
  const backgrounds = timeline.events.filter((event: any) => event.type === "background");
  assert.strictEqual(result.backgroundBeatsAdded, 0);
  assert.deepStrictEqual(backgrounds.map((event: any) => event.frame), [0]);
});

test("indexes Unicode words with stable indices", () => {
  const words = indexTranscript("Tại sao cats don't panic?");
  assert.deepStrictEqual(words.map((word) => word.text), ["Tại", "sao", "cats", "don't", "panic"]);
  assert.deepStrictEqual(words.map((word) => word.index), [0, 1, 2, 3, 4]);
});

test("accepts complete non-overlapping storyboard coverage", () => {
  const transcript = "one two three four";
  const words = indexTranscript(transcript);
  const storyboard: Storyboard = {
    schemaVersion: 2,
    fps: 30,
    width: 1920,
    height: 1080,
    scenes: [
      {
        id: "s1", narration: "one two", purpose: "first", emotion: "neutral",
        viewerFocus: "one", visualGrammar: "SOLO", sourceRange: makeSourceRange(words, 0, 1),
      },
      {
        id: "s2", narration: "three four", purpose: "second", emotion: "neutral",
        viewerFocus: "three", visualGrammar: "SOLO", sourceRange: makeSourceRange(words, 2, 3),
      },
    ],
  };
  assert.strictEqual(validateStoryboardCoverage(transcript, storyboard).valid, true);
});

test("rejects gaps, overlaps and modified source checksums", () => {
  const transcript = "one two three four five";
  const words = indexTranscript(transcript);
  const first = makeSourceRange(words, 0, 1);
  first.quoteChecksum = "bad";
  const storyboard = {
    scenes: [
      { id: "s1", sourceRange: first },
      { id: "s2", sourceRange: makeSourceRange(words, 1, 3) },
    ],
  } as Pick<Storyboard, "scenes">;
  const codes = validateStoryboardCoverage(transcript, storyboard).issues.map((issue) => issue.code);
  assert.ok(codes.includes("CHECKSUM_MISMATCH"));
  assert.ok(codes.includes("OVERLAP"));
  assert.ok(codes.includes("GAP"));
});

test("semantic asset resolver prefers the original lead character", () => {
  const manifest: AssetManifest = {
    schemaVersion: 1,
    generatedAt: "test",
    entries: [
      {
        id: "legacy.cat", path: "characters/cat", sha256: "1", kind: "character",
        styleFamily: "legacy", action: ["explain"],
      },
      {
        id: "lead.explain", path: "generated-assets/characters/cat_explain.png", sha256: "2",
        kind: "character", styleFamily: "editorial_cat_v1", characterId: "lead-teal-cat",
        action: ["explain"],
      },
    ],
  };
  const result = resolveAssetRequest({
    role: "character", slot: "who", query: "lead cat explain", requiredTags: ["explain"], allowGenerate: false,
  }, manifest);
  assert.strictEqual(result.asset?.id, "lead.explain");
});

test("semantic asset resolver never silently falls back", () => {
  const manifest: AssetManifest = { schemaVersion: 1, generatedAt: "test", entries: [] };
  const result = resolveAssetRequest({
    role: "prop", slot: "prop", query: "population map", requiredTags: ["population"], allowGenerate: true,
  }, manifest);
  assert.strictEqual(result.asset, undefined);
  assert.match(result.unresolvedReason ?? "", /generation queue/);
});

test("schema v2 compiler preserves semantic background and resolved assets", () => {
  const storyboard: Storyboard = {
    schemaVersion: 2, fps: 30, width: 1920, height: 1080,
    scenes: [{
      id: "compare", narration: "one versus two", purpose: "contrast", emotion: "neutral",
      viewerFocus: "difference", visualGrammar: "COMPARE", visualRegister: "infographic",
      semanticVisual: { subject: "two values", action: "contrast", takeaway: "the values differ" },
      focalType: "diagram", characterRequired: false,
      visualFingerprint: "compare|diagram|0|none|contrast",
      silentFrameTakeaway: "two values visibly differ",
      focalOccupancyTarget: 0.4,
      noveltyFromPrevious: ["first scene"],
      slots: {
        left: "one", right: "two",
        leftAsset: "finance/money", rightAsset: "finance/house",
      },
      resolvedAssets: { leftAsset: "finance/money", rightAsset: "finance/house" },
      unresolvedAssetRequests: [],
    }],
  };
  // No sourceRange and no durations: this fixture is genuinely estimate-timed and
  // only exercises grammar expansion, so it opts out of the timing invariant.
  const timeline = compileStoryboard(storyboard, { allowEstimatedTiming: true });
  assert.strictEqual(timeline.scenes[0].backgroundSrc, "#FFFFFF");
  assert.deepStrictEqual(timeline.scenes[0].semanticAssetIds, ["finance/money", "finance/house"]);
  assert.strictEqual(timeline.scenes[0].visualFingerprint, "COMPARE|infographic|graphic|0a:0p|none|card:house:2:1,card:money:1:1|none|none");
  assert.strictEqual(timeline.scenes[0].semanticAction, "contrast");
  assert.strictEqual(timeline.scenes[0].visualGrammar, "COMPARE");
});

test("schema v2 compiler rejects missing semantic assets instead of using cats", () => {
  const storyboard: Storyboard = {
    schemaVersion: 2, fps: 30, width: 1920, height: 1080,
    scenes: [{
      id: "bad", narration: "cause and effect", purpose: "mechanism", emotion: "neutral",
      viewerFocus: "effect", visualGrammar: "CAUSE_EFFECT",
      slots: { cause: "cause", effect: "effect" },
    }],
  };
  // allowEstimatedTiming so the asset assertion is what fails, not the timing gate.
  assert.throws(() => compileStoryboard(storyboard, { allowEstimatedTiming: true }), /Missing semantic asset/);
});

test("semantic storyboard gate rejects generic or unresolved planning", () => {
  const report = runStoryboardCheck({
    schemaVersion: 2,
    scenes: [{
      id: "bad", narration: "two cats", visualGrammar: "SOLO", slots: {},
      sourceRange: { startWord: 0, endWord: 1, quoteChecksum: "x" },
      visualRegister: "character_action",
      semanticVisual: { subject: "cat", action: "", takeaway: "" },
      assetRequests: [],
      unresolvedAssetRequests: ["who: missing"],
    }],
  });
  assert.ok(report.blockers > 0);
  assert.ok(report.majors > 0);
});

test("word alignment controls schema v2 scene timing and subtitle cues", () => {
  const storyboard: Storyboard = {
    schemaVersion: 2, fps: 30, width: 1920, height: 1080,
    scenes: [
      {
        id: "one", narration: "one two", purpose: "first", emotion: "neutral",
        viewerFocus: "money", visualGrammar: "CHAR_PROP",
        sourceRange: { startWord: 0, endWord: 1, quoteChecksum: "x" },
        slots: { who: "generated-assets/characters/cat_explain.png", prop: "finance/money" },
      },
      {
        id: "two", narration: "three four", purpose: "second", emotion: "neutral",
        viewerFocus: "house", visualGrammar: "CHAR_PROP",
        sourceRange: { startWord: 2, endWord: 3, quoteChecksum: "y" },
        slots: { who: "generated-assets/characters/cat_explain.png", prop: "finance/house" },
      },
    ],
  };
  const timeline = compileStoryboard(storyboard, {
    words: [
      { wordIndex: 0, scene: "one", sceneWordIndex: 0, word: "one", startSec: 0.1, endSec: 0.3 },
      { wordIndex: 1, scene: "one", sceneWordIndex: 1, word: "two", startSec: 0.4, endSec: 0.6 },
      // The subtitle contract has a one-second minimum cue lifetime. Keep the
      // fixture above that floor so it exercises canonical cue generation.
      { wordIndex: 2, scene: "two", sceneWordIndex: 0, word: "three", startSec: 1.0, endSec: 1.5 },
      { wordIndex: 3, scene: "two", sceneWordIndex: 1, word: "four", startSec: 1.6, endSec: 2.1 },
    ],
  });
  assert.strictEqual(timeline.scenes[0].startFrame, 0);
  assert.strictEqual(timeline.scenes[0].durationFrames, 30);
  assert.strictEqual(timeline.scenes[1].startFrame, 30);
  assert.ok((timeline.scenes[1].subtitleCues?.length ?? 0) > 0);
});

test("schema v2 timeline gate rejects flat generic character pairs", () => {
  const timeline = {
    schemaVersion: 2, fps: 30, width: 1920, height: 1080, durationInFrames: 2400,
    scenes: Array.from({ length: 8 }, (_, index) => ({
      id: `s${index}`, startFrame: index * 300, durationFrames: 300,
      layout: "DIALOGUE", narration: "generic", backgroundSrc: "#ffffff",
      visualRegister: "character_action", semanticTakeaway: "two cats exist",
      semanticAssetIds: ["generated-assets/characters/cat.png"],
      entities: [
        { assetId: `a${index}`, src: "generated-assets/characters/cat.png" },
        { assetId: `b${index}`, src: "generated-assets/characters/cat.png" },
      ],
      texts: [],
    })),
  };
  const report = runQualityCheck(timeline);
  const semantic = report.checks.find((check) => check.name.includes("Semantic production"));
  const rules = semantic?.issues.map((issue) => issue.rule) ?? [];
  assert.ok(rules.includes("GENERIC_CHARACTER_PAIR"));
  assert.ok(rules.includes("SOLID_BACKGROUND_RATIO"));
  assert.ok(rules.includes("REGISTER_DIVERSITY"));
});

test("stage registry validates narration settings without banning continuity reuse", () => {
  assert.strictEqual(stageMatchesSetting("assets/scenes/office_desk.svg", "corporate office"), true);
  assert.strictEqual(stageMatchesSetting("assets/scenes/beach.svg", "corporate office"), false);
  assert.strictEqual(stageMatchesSetting("assets/scenes/office_desk.svg", undefined), true);
});

test("asset resolver applies a usage budget instead of repeating the top match", () => {
  const manifest: AssetManifest = {
    schemaVersion: 1, generatedAt: "test",
    entries: [
      { id: "money-a", path: "finance/money-a", sha256: "a", kind: "prop", styleFamily: "editorial_cat_v1", topics: ["money"] },
      { id: "money-b", path: "finance/money-b", sha256: "b", kind: "prop", styleFamily: "editorial_cat_v1", topics: ["money"] },
    ],
  };
  const request = { role: "prop" as const, slot: "prop", query: "money", requiredTags: ["money"], allowGenerate: false };
  const result = resolveAssetRequest(request, manifest, undefined, {
    usage: new Map([["finance/money-a", 3]]), maximumUses: 2,
  });
  assert.strictEqual(result.asset?.path, "finance/money-b");
});

test("preferred assets remain budgeted while continuity locks require a reason", () => {
  const manifest: AssetManifest = {
    schemaVersion: 1, generatedAt: "test",
    entries: [
      { id: "money-a", path: "finance/money-a", sha256: "a", kind: "prop", styleFamily: "flat_icon_v2", topics: ["money"] },
      { id: "money-b", path: "finance/money-b", sha256: "b", kind: "prop", styleFamily: "flat_icon_v2", topics: ["money"] },
    ],
  };
  const base = { role: "prop" as const, slot: "prop", query: "money", requiredTags: ["money"], allowGenerate: false };
  const preferred = resolveAssetRequest({ ...base, preferredAssetId: "money-a" }, manifest, undefined, {
    usage: new Map([["finance/money-a", 2]]), maximumUses: 2,
  });
  assert.strictEqual(preferred.asset?.id, "money-b");
  const invalidLock = resolveAssetRequest({ ...base, lockedAssetId: "money-a" }, manifest);
  assert.match(invalidLock.unresolvedReason ?? "", /continuityReason/);
  const validLock = resolveAssetRequest({ ...base, lockedAssetId: "money-a", continuityReason: "same ledger in a two-scene sequence" }, manifest, undefined, {
    usage: new Map([["finance/money-a", 9]]), maximumUses: 2,
  });
  assert.strictEqual(validLock.asset?.id, "money-a");
});

test("batch asset resolution updates usage between requests", () => {
  const manifest: AssetManifest = {
    schemaVersion: 1, generatedAt: "test",
    entries: [
      { id: "a", path: "finance/a", sha256: "a", kind: "prop", styleFamily: "flat_icon_v2", topics: ["money"] },
      { id: "b", path: "finance/b", sha256: "b", kind: "prop", styleFamily: "flat_icon_v2", topics: ["money"] },
    ],
  };
  const request = { role: "prop" as const, slot: "prop", query: "money", requiredTags: ["money"], allowGenerate: false };
  const results = resolveAssetRequests([request, request], manifest, { maximumUses: 1 });
  assert.deepStrictEqual(results.map((result) => result.asset?.id), ["a", "b"]);
});

test("visual critic rejects a generic heading and metadata-only hero", () => {
  const critiques = critiqueSceneBriefs([{
    id: "generic", narration: "specific narration", purpose: "explain", emotion: "neutral",
    viewerFocus: "money", visualGrammar: "CHAR_PROP", visualRegister: "character_action",
    focalType: "character_action", heroVisual: true, characterRequired: true,
    semanticVisual: { subject: "cat", action: "shows", object: "coin", takeaway: "money exists" },
    silentFrameTakeaway: "cat and coin", visualFingerprint: "char-prop", noveltyFromPrevious: [],
    focalOccupancyTarget: 0.3, slots: { label: "MONEY", prop: "finance/money" },
    assetRequests: [{ role: "prop", slot: "prop", query: "money", requiredTags: ["money"], allowGenerate: false }],
  }]);
  assert.ok(critiques[0].score < 8);
  assert.ok(critiques[0].issues.some((issue) => issue.includes("metadata-only")));
  assert.ok(critiques[0].issues.some((issue) => issue.includes("taxonomy")));
});

test("rendered-intent gate rejects one-cat-one-prop template loops", () => {
  const scenes = Array.from({ length: 40 }, (_, index) => ({
    id: `loop-${index}`, startFrame: index * 180, durationFrames: 180,
    layout: "CHAR_PROP", narration: "specific narration",
    backgroundSrc: index % 2 ? "#ffffff" : "assets/scenes/office_desk.svg",
    visualRegister: "character_action", semanticTakeaway: "cat looks at money",
    semanticAction: "looks", semanticAssetIds: ["finance/money"],
    focalType: "character_action", characterRequired: true,
    visualFingerprint: "char_prop|character_action|1|office|looks",
    silentFrameTakeaway: "cat looks at money", focalOccupancyTarget: 0.3,
    noveltyFromPrevious: ["color"],
    entities: [
      { assetId: `cat-${index}`, src: "generated-assets/characters/cat_explain.png" },
      { assetId: `prop-${index}`, src: "finance/money" },
    ],
    texts: [{ id: `text-${index}`, text: "MONEY", content: "MONEY" }],
  }));
  const report = runQualityCheck({
    schemaVersion: 2, fps: 30, width: 1920, height: 1080,
    durationInFrames: scenes.length * 180, scenes,
  });
  const proxy = report.checks.find((check) => check.name === "Rendered-intent proxies");
  const rules = proxy?.issues.map((issue) => issue.rule) ?? [];
  assert.ok(rules.includes("TEMPLATE_SHAPE_DOMINANCE"));
  assert.ok(rules.includes("CHARACTER_ALWAYS_PRESENT"));
  assert.ok(rules.includes("POSE_REUSE"));
  assert.ok(rules.includes("VISUAL_FINGERPRINT_REUSE"));
});

test("schema v2 validation requires rendered-intent metadata", () => {
  const result = validateTimeline({
    schemaVersion: 2, fps: 30, width: 1920, height: 1080, durationInFrames: 90,
    scenes: [{
      id: "missing", label: "missing", startFrame: 0, durationFrames: 90,
      layout: "SOLO", sourceRange: { startWord: 0, endWord: 0, quoteChecksum: "x" },
      visualRegister: "character_action", semanticTakeaway: "x", semanticAssetIds: [],
      entities: [], texts: [],
    }],
  });
  assert.ok(result.errors.some((error) => error.includes("visualFingerprint")));
  assert.ok(result.errors.some((error) => error.includes("focalOccupancyTarget")));
});

// ── Timing integrity (P0) ───────────────────────────────────
// Regression guard for the v5-codex bug: durations keyed `v4-NNN` against a
// storyboard rebuilt as `scene-NNN` meant every scene compiled from a word-count
// estimate — timeline 1124s vs a 1513s voice track, rendered and shipped
// out-of-sync while every other gate reported green.

test("blocks a stale durations.json whose scene ids do not match the storyboard", () => {
  const issues = checkSceneIdAlignment(
    ["scene-001", "scene-002", "scene-003"],
    ["v4-001", "v4-002", "v4-003"],
  );
  assert.ok(hasBlocker(issues), "id scheme mismatch must be a blocker");
  assert.strictEqual(issues[0].code, "TIMING_ID_MISSING");
  assert.match(issues[0].hint ?? "", /stale/i);
});

test("blocks compiling with no TTS durations at all", () => {
  const issues = checkSceneIdAlignment(["scene-001"], []);
  assert.ok(hasBlocker(issues));
  assert.strictEqual(issues[0].code, "TIMING_NO_DURATIONS");
});

test("accepts matching scene ids across storyboard, durations and timeline", () => {
  const ids = ["scene-001", "scene-002"];
  assert.deepStrictEqual(checkSceneIdAlignment(ids, ids, ids), []);
});

test("flags durations entries that match no storyboard scene", () => {
  const issues = checkSceneIdAlignment(["scene-001"], ["scene-001", "scene-999"]);
  assert.ok(hasBlocker(issues));
  assert.strictEqual(issues[0].code, "TIMING_ID_ORPHAN");
});

test("blocks a timeline shorter than its narration track", () => {
  const issues = checkTimelineSpansAudio(1124.27, 1513.14, { sceneCount: 139 });
  assert.ok(hasBlocker(issues));
  assert.strictEqual(issues[0].code, "TIMING_TIMELINE_SHORT");
  assert.match(issues[0].message, /25\.7%/);
});

test("tolerates accumulated per-scene rounding, but not a real desync", () => {
  // Measured drift on video-003-tai-sao-eng-v5-claude: 0.237s over 145 scenes.
  assert.deepStrictEqual(checkTimelineSpansAudio(1434.23, 1434.47, { sceneCount: 145 }), []);
  // The scene-count budget is 15 frames (0.5s) here, so a ~1s end-of-video
  // desync is caught — a flat 1.0s tolerance would have passed it.
  assert.ok(hasBlocker(checkTimelineSpansAudio(1433.5, 1434.47, { sceneCount: 145 })));
});

test("blocks a rendered MP4 that does not match its timeline", () => {
  assert.ok(hasBlocker(checkRenderMatchesTimeline(1124.31, 1513.14)));
  assert.deepStrictEqual(checkRenderMatchesTimeline(1434.28, 1434.23), []);
});

test("blocks word alignment that belongs to a different audio file", () => {
  const issues = checkWordAlignment([{ startSec: 0, endSec: 1600, wordIndex: 0 }], 1434.47);
  assert.ok(hasBlocker(issues));
  assert.strictEqual(issues[0].code, "TIMING_WORDS_OVERRUN");
});

test("word alignment severity follows the axis it feeds", () => {
  const short = [{ startSec: 0, endSec: 700, wordIndex: 0 }];
  // Words are the scene-boundary source → short coverage is fatal.
  assert.ok(hasBlocker(checkWordAlignment(short, 1434.47, { wordsProvideTiming: true })));
  // Words only anchor beats → degraded beats, not a broken video.
  const beatsOnly = checkWordAlignment(short, 1434.47, { wordsProvideTiming: false });
  assert.ok(beatsOnly.length > 0 && !hasBlocker(beatsOnly));
});

test("flags aligned words that carry no transcript index", () => {
  // The real defect in every words.json on disk: 99.95% endSec coverage but
  // 0-2.2% usable wordIndex, so buildAlignedSceneTimings returns an empty map.
  const unindexed = Array.from({ length: 100 }, (_, i) => ({
    startSec: i * 14, endSec: i * 14 + 13, wordIndex: null,
  }));
  const codes = checkWordAlignment(unindexed, 1400).map((i) => i.code);
  assert.ok(codes.includes("TIMING_WORDS_UNINDEXED"));
});

test("accepts word alignment covering the whole track", () => {
  assert.deepStrictEqual(checkWordAlignment([{ startSec: 0, endSec: 1430, wordIndex: 0 }], 1434.47), []);
});

test("warns on proportional drift that stays inside the absolute budget", () => {
  // Short track: 0.4s is within the 0.5s budget but 0.4% of a 100s video.
  const issues = checkTimelineSpansAudio(99.6, 100.0, { sceneCount: 20 });
  assert.strictEqual(issues.length, 1);
  assert.strictEqual(issues[0].severity, "WARNING");
  assert.strictEqual(issues[0].code, "TIMING_TIMELINE_DRIFT_PROPORTIONAL");
});

test("detects duplicate ids inside durations.json", () => {
  // Set comparison alone cannot see this: two entries for one id look like one.
  const issues = checkSceneIdAlignment(["a", "b"], ["a", "a", "b"]);
  assert.ok(hasBlocker(issues));
  assert.ok(issues.some((i) => i.code === "TIMING_DURATION_ID_DUPLICATE"));
});

test("detects gaps, overlaps and a wrong total in compiled timings", () => {
  const ids = ["a", "b"];
  assert.deepStrictEqual(
    checkCompiledTimings([{ id: "a", startFrame: 0, frames: 30 }, { id: "b", startFrame: 30, frames: 20 }], ids, 50),
    [],
  );
  const gap = checkCompiledTimings(
    [{ id: "a", startFrame: 0, frames: 30 }, { id: "b", startFrame: 45, frames: 20 }], ids, 65);
  assert.ok(gap.some((i) => i.code === "TIMING_GAP"));
  const overlap = checkCompiledTimings(
    [{ id: "a", startFrame: 0, frames: 30 }, { id: "b", startFrame: 20, frames: 20 }], ids, 40);
  assert.ok(overlap.some((i) => i.code === "TIMING_OVERLAP"));
  const badTotal = checkCompiledTimings(
    [{ id: "a", startFrame: 0, frames: 30 }, { id: "b", startFrame: 30, frames: 20 }], ids, 999);
  assert.ok(badTotal.some((i) => i.code === "TIMING_TOTAL_MISMATCH"));
});

test("detects scenes reordered after TTS, which keeps their old start frames", () => {
  const issues = checkCompiledTimings(
    [{ id: "b", startFrame: 0, frames: 30 }, { id: "a", startFrame: 30, frames: 20 }], ["a", "b"], 50);
  assert.ok(issues.some((i) => i.code === "TIMING_ORDER_MISMATCH"));
});

// ── Compiler-level enforcement (the invariant lives in the engine) ───────────

function timingFixture(ids: string[]): Storyboard {
  return {
    schemaVersion: 2, fps: 30, width: 1920, height: 1080,
    scenes: ids.map((id) => ({
      id, narration: "one two three four five", purpose: "p", emotion: "neutral",
      viewerFocus: "f", visualGrammar: "SOLO",
      slots: { who: "characters/cat", keyword: "k" },
      visualRegister: "character_action", focalType: "character_action",
      semanticVisual: { subject: "cat", action: "points at the keyword", takeaway: "t" },
      silentFrameTakeaway: "t", focalOccupancyTarget: 0.3, noveltyFromPrevious: ["opening"],
      visualFingerprint: `SOLO|character_action|${id}`,
      assetRequests: [{ role: "character", slot: "who", query: "characters/cat", requiredTags: [], allowGenerate: false }],
      resolvedAssets: { who: "characters/cat" },
    })),
  } as Storyboard;
}

function transitionReceipt(scene: any, action: string, targetSlot: string): any {
  const receipt = scene.authoredTransitionReceipts?.find(
    (candidate: any) => candidate.action === action && candidate.targetSlot === targetSlot,
  );
  assert.ok(receipt, `missing ${action}:${targetSlot} transition receipt`);
  assert.ok(Number.isInteger(receipt.frame));
  assert.ok(receipt.renderedComponentIds.length > 0);
  assert.notStrictEqual(receipt.fromState, receipt.toState);
  return receipt;
}

test("compiler never invents sentence-aligned pose swaps", () => {
  const storyboard = timingFixture(["scene-001"]);
  storyboard.scenes[0].narration = "The cat explains the risk. Then the cat reacts to the result.";
  const timeline = compileStoryboard(storyboard, {
    durations: [{ id: "scene-001", startFrame: 0, frames: 300 }],
  });
  const cats = timeline.scenes[0].entities.filter((entity) => entity.assetId === "scene-001-cat");
  assert.strictEqual(cats.length, 1, "pose changes must come from authored semantic beats");
});

test("compiler refuses estimated timing by default (the v5-codex signature)", () => {
  // Storyboard keyed scene-NNN, durations keyed v4-NNN: the exact incident.
  assert.throws(
    () => compileStoryboard(timingFixture(["scene-001", "scene-002"]), {
      durations: [
        { id: "v4-001", startFrame: 0, frames: 300 },
        { id: "v4-002", startFrame: 300, frames: 300 },
      ],
    }),
    /no measured audio timing/,
  );
});

test("compiler accepts durations and words together — they are different axes", () => {
  const timeline = compileStoryboard(timingFixture(["scene-001", "scene-002"]), {
    durations: [
      { id: "scene-001", startFrame: 0, frames: 300 },
      { id: "scene-002", startFrame: 300, frames: 240 },
    ],
    words: [{ wordIndex: 0, word: "one", startSec: 0.1, endSec: 0.3 }],
  });
  assert.strictEqual(timeline.durationInFrames, 540);
});

test("authored reveal and dialogue handoff beats create held semantic states", () => {
  const tableau = timingFixture(["scene-001"]);
  tableau.scenes[0] = {
    ...tableau.scenes[0],
    narration: "First we establish the problem. The key takeaway arrives now.",
    visualGrammar: "TABLEAU",
    captionTreatment: "chapter-pill",
    slots: {
      stage: "assets/scenes/cafe.svg", who: "characters/cat_explain",
      caption: "The key takeaway",
    },
    beats: [{ text: "key takeaway", importance: 0.8, kind: "turn", action: "reveal", targetSlot: "caption" }],
  };
  const tableauTimeline = compileStoryboard(tableau, {
    durations: [{ id: "scene-001", startFrame: 0, frames: 300 }],
    words: [{ scene: "scene-001", word: "key", startSec: 4, endSec: 4.2 }],
  });
  const caption = tableauTimeline.scenes[0].texts.find((text) => text.id === "scene-001-cap");
  assert.strictEqual(caption?.delay, 120);
  assert.strictEqual(caption?.hold, "scene-end");
  assert.deepStrictEqual(transitionReceipt(tableauTimeline.scenes[0], "reveal", "caption"), {
    beatText: "key takeaway",
    action: "reveal",
    targetSlot: "caption",
    frame: 120,
    renderedComponentIds: ["scene-001-cap"],
    fromState: "visible-at:12:scene-end",
    toState: "visible-at:120:scene-end",
  });

  const dialogue = timingFixture(["scene-002"]);
  dialogue.scenes[0] = {
    ...dialogue.scenes[0],
    narration: "Why is this difficult? Because the cost keeps rising.",
    visualGrammar: "DIALOGUE_QA",
    slots: {
      asker: "characters/cat_talk", answerer: "characters/cat_think",
      askerText: "Why is this difficult?", answererText: "Because the cost keeps rising.",
    },
    beats: [{
      text: "Because", importance: 0.85, kind: "turn", action: "handoff",
      targetSlot: "answerer", targetAssetId: "characters/cat_explain",
    }],
  };
  const dialogueTimeline = compileStoryboard(dialogue, {
    durations: [{ id: "scene-002", startFrame: 0, frames: 300 }],
    words: [{ scene: "scene-002", word: "Because", startSec: 4, endSec: 4.2 }],
  });
  const bubbles = dialogueTimeline.scenes[0].speechBubbles!;
  const question = bubbles.find((bubble) => bubble.id === "scene-002-qa")!;
  const answer = bubbles.find((bubble) => bubble.id === "scene-002-qb")!;
  assert.ok((question.delay ?? 0) + (question.duration ?? 0) < (answer.delay ?? 0));
  assert.strictEqual(answer.delay, 120);
  assert.strictEqual(answer.duration, undefined);
  const answererStates = dialogueTimeline.scenes[0].entities
    .filter((entity) => entity.assetId === "scene-002-b");
  assert.strictEqual(answererStates.length, 2);
  assert.strictEqual(answererStates[1].src, "characters/cat_explain");
  assert.strictEqual(answererStates[1].enterDelay, 120);
  assert.strictEqual(answererStates[1].enterAnimation, "none");
  assert.deepStrictEqual(answererStates[1].clearPrevious, ["scene-002-b"]);
  assert.deepStrictEqual(answererStates[1].position, answererStates[0].position);
  assert.strictEqual(answererStates[1].scale, answererStates[0].scale);
  assert.strictEqual(dialogueTimeline.scenes[0].beatTimingSource, "aligned-words");
  assert.deepStrictEqual(transitionReceipt(dialogueTimeline.scenes[0], "handoff", "answerer"), {
    beatText: "Because",
    action: "handoff",
    targetSlot: "answerer",
    frame: 120,
    renderedComponentIds: ["scene-002-qa", "scene-002-qb", "scene-002-b"],
    fromState: "question:Why is this difficult?:characters/cat_think",
    toState: "answer:Because the cost keeps rising.:characters/cat_explain",
  });
});

test("an authored beat cannot silently target a component its grammar did not create", () => {
  const storyboard = timingFixture(["scene-001"]);
  storyboard.scenes[0].beats = [
    { text: "one", importance: 0.8, kind: "keyword", action: "reveal", targetSlot: "caption" },
  ];
  assert.throws(
    () => compileStoryboard(storyboard, { durations: [{ id: "scene-001", startFrame: 0, frames: 300 }] }),
    /does not author a chapter-pill caption/,
  );
});

test("an authored cutaway is phrase-aligned, persistent and fully specified", () => {
  const storyboard = timingFixture(["scene-001"]);
  storyboard.scenes[0].visualGrammar = "TABLEAU";
  storyboard.scenes[0].slots = {
    stage: "assets/scenes/cafe.svg", who: "characters/cat_explain",
  };
  storyboard.scenes[0].beats = [{
    text: "three", importance: 0.85, kind: "turn", action: "reveal",
    targetSlot: "cutaway", targetAssetId: "backgrounds/stock_chart.jpg",
    targetLabel: "Market evidence", holdState: "evidence-cutaway",
  }];
  const timeline = compileStoryboard(storyboard, {
    durations: [{ id: "scene-001", startFrame: 0, frames: 300 }],
    words: [{ scene: "scene-001", word: "three", startSec: 4, endSec: 4.2 }],
  });
  const cutaway = timeline.scenes[0].frameBoxes?.find((frame) => frame.id === "scene-001-cutaway");
  assert.strictEqual(cutaway?.contentSrc, "backgrounds/stock_chart.jpg");
  assert.strictEqual(cutaway?.caption, "Market evidence");
  assert.strictEqual(cutaway?.delay, 120);
  assert.strictEqual(cutaway?.duration, undefined);
  assert.deepStrictEqual(transitionReceipt(timeline.scenes[0], "reveal", "cutaway"), {
    beatText: "three",
    action: "reveal",
    targetSlot: "cutaway",
    frame: 120,
    renderedComponentIds: ["scene-001-cutaway"],
    fromState: "absent",
    toState: "cutaway:backgrounds/stock_chart.jpg:Market evidence",
  });

  // Multiple reveals in one scene must remain distinct persisted states rather
  // than collide under one frame-box ID.
  storyboard.scenes[0].beats = [
    { text: "two", importance: 0.85, kind: "turn", action: "reveal", targetSlot: "cutaway", targetAssetId: "backgrounds/stock_chart.jpg", targetLabel: "First state", holdState: "first" },
    { text: "three", importance: 0.85, kind: "turn", action: "reveal", targetSlot: "cutaway", targetAssetId: "backgrounds/market_monitor.jpg", targetLabel: "Second state", holdState: "second" },
  ];
  const multiCutawayTimeline = compileStoryboard(storyboard, {
    durations: [{ id: "scene-001", startFrame: 0, frames: 300 }],
    words: [
      { scene: "scene-001", word: "two", startSec: 2, endSec: 2.2 },
      { scene: "scene-001", word: "three", startSec: 4, endSec: 4.2 },
    ],
  });
  assert.deepStrictEqual(
    multiCutawayTimeline.scenes[0].frameBoxes?.map((frame) => frame.id),
    ["scene-001-cutaway", "scene-001-cutaway-2"],
  );
  assert.deepStrictEqual(
    (multiCutawayTimeline.scenes[0] as any).authoredTransitionReceipts
      ?.filter((receipt: any) => receipt.action === "reveal")
      .map((receipt: any) => receipt.renderedComponentIds),
    [["scene-001-cutaway"], ["scene-001-cutaway-2"]],
  );

  // Cutaways may use a logical production asset alias, not only a raw photo
  // filename. The renderer resolves this to its generated PNG at load time.
  storyboard.scenes[0].beats = [{
    text: "three", importance: 0.85, kind: "turn", action: "reveal",
    targetSlot: "cutaway", targetAssetId: "finance/investment",
    targetLabel: "Market evidence", holdState: "evidence-cutaway",
  }];
  const logicalAssetTimeline = compileStoryboard(storyboard, {
    durations: [{ id: "scene-001", startFrame: 0, frames: 300 }],
    words: [{ scene: "scene-001", word: "three", startSec: 4, endSec: 4.2 }],
  });
  assert.strictEqual(logicalAssetTimeline.scenes[0].frameBoxes?.find((frame) => frame.id === "scene-001-cutaway")?.contentSrc, "finance/investment");

  storyboard.scenes[0].beats![0].targetLabel = "";
  assert.throws(
    () => compileStoryboard(storyboard, {
      durations: [{ id: "scene-001", startFrame: 0, frames: 300 }],
    }),
    /without an authored on-screen label/,
  );
});

test("authored focus cuts change shot geometry without camera motion", () => {
  const dialogue = timingFixture(["scene-001"]);
  dialogue.scenes[0].narration = "First comes the question, then the cost becomes clear.";
  dialogue.scenes[0].visualGrammar = "DIALOGUE_QA";
  dialogue.scenes[0].slots = {
    stage: "assets/scenes/cafe.svg", asker: "characters/cat_talk",
    answerer: "characters/cat_think", askerText: "Question?", answererText: "The cost is clear.",
  };
  dialogue.scenes[0].beats = [{
    text: "cost", importance: 0.85, kind: "turn", action: "focus_actor",
    targetSlot: "answerer", targetAssetId: "characters/cat_surprised",
  }];
  const dialogueTimeline = compileStoryboard(dialogue, {
    durations: [{ id: "scene-001", startFrame: 0, frames: 300 }],
    words: [{ scene: "scene-001", word: "cost", startSec: 6, endSec: 6.2 }],
  });
  const answererStates = dialogueTimeline.scenes[0].entities
    .filter((entity) => entity.assetId === "scene-001-b");
  assert.strictEqual(answererStates.length, 2);
  assert.strictEqual(answererStates[1].src, "characters/cat_surprised");
  assert.strictEqual(answererStates[1].enterDelay, 180);
  assert.strictEqual(answererStates[1].anchor, undefined);
  assert.strictEqual(answererStates[1].slot, undefined);
  assert.deepStrictEqual(answererStates[1].position, { x: 0.64, y: 0.58 });
  assert.strictEqual(answererStates[1].scale, 2.75);
  assert.deepStrictEqual([...(answererStates[1].clearPrevious ?? [])].sort(), ["scene-001-a", "scene-001-b"]);
  assert.strictEqual(dialogueTimeline.scenes[0].camera, undefined);
  const actorFocusReceipt = transitionReceipt(dialogueTimeline.scenes[0], "focus_actor", "answerer");
  assert.strictEqual(actorFocusReceipt.frame, 180);
  assert.deepStrictEqual([...actorFocusReceipt.renderedComponentIds].sort(), ["scene-001-a", "scene-001-b"]);
  assert.strictEqual(JSON.parse(actorFocusReceipt.toState).src, "characters/cat_surprised");
  assert.deepStrictEqual(JSON.parse(actorFocusReceipt.toState).position, { x: 0.64, y: 0.58 });

  const charProp = timingFixture(["scene-002"]);
  charProp.scenes[0].narration = "The risk finally becomes visible.";
  charProp.scenes[0].visualGrammar = "CHAR_PROP";
  charProp.scenes[0].slots = { who: "characters/cat_sad", prop: "finance/loss" };
  charProp.scenes[0].beats = [{
    text: "risk", importance: 0.85, kind: "turn", action: "focus_asset",
    targetSlot: "prop", targetAssetId: "finance/trending_down",
  }];
  const propTimeline = compileStoryboard(charProp, {
    durations: [{ id: "scene-002", startFrame: 0, frames: 300 }],
    words: [{ scene: "scene-002", word: "risk", startSec: 5, endSec: 5.2 }],
  });
  const propStates = propTimeline.scenes[0].entities
    .filter((entity) => entity.assetId === "scene-002-prop");
  assert.strictEqual(propStates.length, 2);
  assert.strictEqual(propStates[1].src, "finance/trending_down");
  assert.deepStrictEqual(propStates[1].position, { x: 0.5, y: 0.47 });
  assert.strictEqual(propStates[1].scale, 3.2);
  assert.deepStrictEqual([...(propStates[1].clearPrevious ?? [])].sort(), ["scene-002-cat", "scene-002-prop"]);
  assert.strictEqual(propTimeline.scenes[0].camera, undefined);
  const assetFocusReceipt = transitionReceipt(propTimeline.scenes[0], "focus_asset", "prop");
  assert.strictEqual(assetFocusReceipt.frame, 150);
  assert.deepStrictEqual([...assetFocusReceipt.renderedComponentIds].sort(), ["scene-002-cat", "scene-002-prop"]);
  assert.strictEqual(JSON.parse(assetFocusReceipt.toState).src, "finance/trending_down");
  assert.deepStrictEqual(JSON.parse(assetFocusReceipt.toState).position, { x: 0.5, y: 0.47 });

  charProp.scenes[0].beats![0].targetAssetId = "finance/loss";
  const sameAssetFocus = compileStoryboard(charProp, {
    durations: [{ id: "scene-002", startFrame: 0, frames: 300 }],
    words: [{ scene: "scene-002", word: "risk", startSec: 5, endSec: 5.2 }],
  });
  assert.strictEqual(
    sameAssetFocus.scenes[0].semanticAssetIds?.filter((asset) => asset === "finance/loss").length,
    1,
    "a persistent re-entry of the same semantic asset is one scene-level use",
  );
});

test("an authored pose beat swaps only its declared rendered actor and holds the new pose", () => {
  const storyboard = timingFixture(["scene-001"]);
  storyboard.scenes[0].visualGrammar = "CHAR_PROP";
  storyboard.scenes[0].slots = { who: "characters/cat_homebuyer", prop: "finance/house" };
  storyboard.scenes[0].beats = [
    {
      text: "three", importance: 0.8, kind: "turn", action: "swap_pose",
      targetSlot: "who", targetAssetId: "characters/cat_sad", holdState: "realizes-the-gap",
    },
    {
      text: "three", importance: 0.8, kind: "turn", action: "swap_asset",
      targetSlot: "prop", targetAssetId: "finance/loss", holdState: "shows-the-gap",
    },
  ];
  const timeline = compileStoryboard(storyboard, {
    durations: [{ id: "scene-001", startFrame: 0, frames: 300 }],
    words: [{ scene: "scene-001", word: "three", startSec: 4, endSec: 4.2 }],
  });
  const cats = timeline.scenes[0].entities.filter((entity) => entity.assetId === "scene-001-cat");
  assert.strictEqual(cats.length, 2);
  assert.strictEqual(cats[1].src, "characters/cat_sad");
  assert.strictEqual(cats[1].enterDelay, 120);
  assert.deepStrictEqual(cats[1].clearPrevious, ["scene-001-cat"]);
  const props = timeline.scenes[0].entities.filter((entity) => entity.assetId === "scene-001-prop");
  assert.strictEqual(props.length, 2);
  assert.strictEqual(props[1].src, "finance/loss");
  assert.strictEqual(props[1].enterDelay, 120);
  assert.strictEqual(props[1].enterAnimation, "none");
  assert.deepStrictEqual(props[1].position, props[0].position);
  assert.strictEqual(props[1].scale, props[0].scale);
  assert.deepStrictEqual(props[1].clearPrevious, ["scene-001-prop"]);
  assert.deepStrictEqual(transitionReceipt(timeline.scenes[0], "swap_pose", "who"), {
    beatText: "three",
    action: "swap_pose",
    targetSlot: "who",
    frame: 120,
    renderedComponentIds: ["scene-001-cat"],
    fromState: "characters/cat_homebuyer",
    toState: "characters/cat_sad",
  });
  assert.deepStrictEqual(transitionReceipt(timeline.scenes[0], "swap_asset", "prop"), {
    beatText: "three",
    action: "swap_asset",
    targetSlot: "prop",
    frame: 120,
    renderedComponentIds: ["scene-001-prop"],
    fromState: "finance/house",
    toState: "finance/loss",
  });
});

test("compiler rejects authored transitions that preserve rendered state", () => {
  const charProp = timingFixture(["scene-001"]);
  charProp.scenes[0].visualGrammar = "CHAR_PROP";
  charProp.scenes[0].slots = { who: "characters/cat_homebuyer", prop: "finance/house" };

  charProp.scenes[0].beats = [{
    text: "three", importance: 0.8, kind: "turn", action: "swap_pose",
    targetSlot: "who", targetAssetId: "characters/cat_homebuyer",
  }];
  assert.throws(
    () => compileStoryboard(charProp, { durations: [{ id: "scene-001", startFrame: 0, frames: 300 }] }),
    /keeps the same rendered pose/,
  );

  charProp.scenes[0].beats = [{
    text: "three", importance: 0.8, kind: "turn", action: "swap_asset",
    targetSlot: "prop", targetAssetId: "finance/house",
  }];
  assert.throws(
    () => compileStoryboard(charProp, { durations: [{ id: "scene-001", startFrame: 0, frames: 300 }] }),
    /keeps the same rendered prop/,
  );

  const advance = timingFixture(["scene-002"]);
  advance.scenes[0].visualGrammar = "CAUSE_EFFECT";
  advance.scenes[0].slots = {
    cause: "Debt", effect: "Stress", causeIcon: "finance/debt", effectIcon: "props/brain",
  };
  advance.scenes[0].beats = [{
    text: "three", importance: 0.8, kind: "turn", action: "advance", targetSlot: "next",
  }];
  assert.throws(
    () => compileStoryboard(advance, {
      durations: [{ id: "scene-002", startFrame: 0, frames: 300 }],
      words: [{ scene: "scene-002", word: "three", startSec: 38 / 30, endSec: 1.4 }],
    }),
    /keeps teaching layer .* existing reveal frame 38/,
  );

  const dialogue = timingFixture(["scene-003"]);
  dialogue.scenes[0].visualGrammar = "DIALOGUE_QA";
  dialogue.scenes[0].slots = {
    asker: "characters/cat_talk", answerer: "characters/cat_think",
    askerText: "Why?", answererText: "Because.",
  };
  dialogue.scenes[0].beats = [{
    text: "three", importance: 0.8, kind: "turn", action: "handoff", targetSlot: "answerer",
  }];
  assert.throws(
    () => compileStoryboard(dialogue, {
      durations: [{ id: "scene-003", startFrame: 0, frames: 300 }],
      words: [{ scene: "scene-003", word: "three", startSec: 72 / 30, endSec: 2.6 }],
    }),
    /keeps the answer at its existing reveal frame 72/,
  );
});

test("compiler rejects a prop swap when the grammar has no authored prop state", () => {
  const storyboard = timingFixture(["scene-001"]);
  storyboard.scenes[0].visualGrammar = "DIALOGUE_QA";
  storyboard.scenes[0].slots = {
    asker: "characters/cat_talk", answerer: "characters/cat_think",
    askerText: "Question", answererText: "Answer",
  };
  storyboard.scenes[0].beats = [{
    text: "three", importance: 0.8, kind: "turn", action: "swap_asset",
    targetSlot: "prop", targetAssetId: "finance/loss",
  }];
  assert.throws(
    () => compileStoryboard(storyboard, {
      durations: [{ id: "scene-001", startFrame: 0, frames: 300 }],
    }),
    /does not support a persistent prop state/,
  );
});

test("compiler rejects interleaving two absolute-frame timing systems", () => {
  const sb = timingFixture(["s1", "s2"]);
  sb.scenes[0].sourceRange = { startWord: 0, endWord: 1, quoteChecksum: "x" };
  sb.scenes[1].sourceRange = { startWord: 2, endWord: 3, quoteChecksum: "y" };
  assert.throws(
    () => compileStoryboard(sb, {
      // s2 measured by TTS, s1 only derivable from words → two boundary systems.
      durations: [{ id: "s2", startFrame: 300, frames: 240 }],
      words: [
        { wordIndex: 0, word: "one", startSec: 0.1, endSec: 0.3 },
        { wordIndex: 1, word: "two", startSec: 0.4, endSec: 0.6 },
        { wordIndex: 2, word: "three", startSec: 1.0, endSec: 1.2 },
        { wordIndex: 3, word: "four", startSec: 1.3, endSec: 1.6 },
      ],
    }),
    /Mixed scene-boundary timing sources/,
  );
});

test("compiler stamps provenance describing how it was timed", () => {
  const timeline = compileStoryboard(timingFixture(["scene-001"]), {
    durations: [{ id: "scene-001", startFrame: 0, frames: 300 }],
    provenance: { audioSeconds: 10, audioSha256: "abc", storyboardChecksum: "def" },
  });
  assert.deepStrictEqual(timeline.timingProvenance, {
    mode: "measured",
    sceneTimingSource: "durations",
    beatTimingSource: "proportional",
    beatTimingSummary: { "source-range-proportional": 1 },
    measuredSceneCount: 1,
    audioSeconds: 10,
    audioSha256: "abc",
    storyboardChecksum: "def",
  });
  // A preview build must own up to being estimated.
  const preview = compileStoryboard(timingFixture(["scene-001"]), { allowEstimatedTiming: true });
  assert.strictEqual(preview.timingProvenance?.mode, "estimated");
  assert.strictEqual(preview.timingProvenance?.measuredSceneCount, 0);
});

test("provenance gate fails closed on a legacy timeline with no stamp", () => {
  assert.ok(hasBlocker(checkTimingProvenance(undefined)));
  const allowed = checkTimingProvenance(undefined, { allowUnprovenanced: true });
  assert.ok(allowed.length === 1 && !hasBlocker(allowed));
});

test("provenance gate rejects estimated, malformed and self-contradictory stamps", () => {
  const good = {
    mode: "measured", sceneTimingSource: "durations",
    beatTimingSource: "proportional", measuredSceneCount: 3,
  };
  assert.deepStrictEqual(checkTimingProvenance(good), []);
  assert.ok(hasBlocker(checkTimingProvenance({ ...good, mode: "estimated", sceneTimingSource: "estimated" })));
  assert.ok(hasBlocker(checkTimingProvenance({ ...good, beatTimingSource: "vibes" })));
  // Claims measured while admitting the source was a guess.
  assert.ok(checkTimingProvenance({ ...good, sceneTimingSource: "estimated" })
    .some((i) => i.code === "TIMING_PROVENANCE_INCONSISTENT"));
});

test("schema validation treats provenance as a checked field, not an extra", () => {
  const base = {
    fps: 30, width: 1920, height: 1080, durationInFrames: 100,
    scenes: [{
      id: "s1", layout: "SOLO", backgroundSrc: "#FFFFFF", startFrame: 0, durationFrames: 100,
      narration: "n", entities: [], texts: [],
      sourceRange: { startWord: 0, endWord: 1, quoteChecksum: "x" },
      visualRegister: "character_action", semanticTakeaway: "t", semanticAction: "a",
      semanticAssetIds: [], focalType: "character_action", visualFingerprint: "fp",
      silentFrameTakeaway: "t", focalOccupancyTarget: 0.3, noveltyFromPrevious: [],
    }],
  };
  assert.ok(validateTimeline({ ...base }).valid);
  const bad = validateTimeline({
    ...base,
    timingProvenance: { mode: "measured", sceneTimingSource: "estimated", beatTimingSource: "proportional", measuredSceneCount: 1 },
  });
  assert.ok(!bad.valid);
  assert.ok(bad.errors.some((e) => /measured.*estimated/.test(e)));

  const badReceipt = validateTimeline({
    ...base,
    scenes: [{
      ...base.scenes[0],
      authoredTransitionReceipts: [{
        beatText: "n", action: "invented_transition", targetSlot: "who", frame: 12.5,
        renderedComponentIds: [42], fromState: "same", toState: "same",
      }],
    }],
  });
  assert.ok(badReceipt.errors.some((error) => error.includes("unsupported action")));
  assert.ok(badReceipt.errors.some((error) => error.includes("integer after scene start")));
  assert.ok(badReceipt.errors.some((error) => error.includes("renderedComponentIds must be a non-empty string array")));
  assert.ok(!badReceipt.errors.some((error) => error.includes("non-rendered component")));
  assert.ok(!badReceipt.errors.some((error) => error.includes("non-no-op state change")));

  const semanticReceiptTimeline = {
    ...base,
    scenes: [{
      ...base.scenes[0],
      texts: [{ id: "receipt-target", content: "Visible", style: "BODY", delay: 4 }],
      authoredTransitionReceipts: [{
        beatText: "n", action: "reveal", targetSlot: "caption", frame: 5,
        renderedComponentIds: ["receipt-target"], fromState: "hidden", toState: "visible",
      }, {
        beatText: "n", action: "reveal", targetSlot: "caption", frame: 4,
        renderedComponentIds: ["receipt-target"], fromState: "visible", toState: "visible",
      }],
    }],
  };
  assert.ok(validateTimeline(semanticReceiptTimeline).valid,
    "schema validation must not make directorial transition-realization judgments");
  const semanticReceiptRules = runQualityCheck(semanticReceiptTimeline)
    .checks.flatMap((check) => check.issues)
    .map((issue) => issue.rule);
  assert.ok(semanticReceiptRules.includes("AUTHORED_TRANSITION_REALIZATION"));
  assert.ok(semanticReceiptRules.includes("AUTHORED_TRANSITION_NOOP"));

  const hash = "0".repeat(64);
  const chunkId = "chunk-001";
  const provenance = {
    schemaVersion: 3,
    projectId: "schema-fixture",
    storyboardChecksum: hash,
    planChecksum: hash,
    runConfigChecksum: hash,
    chunkOrder: [chunkId],
    chunkTimelineChecksums: { [chunkId]: hash },
    chunkAudioChecksums: { [chunkId]: hash },
    chunkAttestationChecksums: {
      [chunkId]: Object.fromEntries(CHUNK_STAGES.map((stage) => [stage, hash])),
    },
    assemblyToolchainHashes: {
      productionCodeSnapshot: hash,
      assemblyOrchestrator: hash,
      audioAssembler: hash,
      ttsSceneBuilder: hash,
      timelineCompiler: hash,
    },
    canonicalOutputHashes: {
      ttsScenes: hash,
      audio: hash,
      durations: hash,
      words: hash,
      alignment: hash,
      timelineBody: hash,
    },
    assemblyPolicyVersion: CHUNK_ASSEMBLY_POLICY_VERSION,
  };
  assert.ok(validateTimeline({ ...base, chunkAssemblyProvenance: provenance }).valid);
  const assertMalformedChunkProvenance = (mutate: (value: any) => void) => {
    const malformed = JSON.parse(JSON.stringify(provenance));
    mutate(malformed);
    const result = validateTimeline({ ...base, chunkAssemblyProvenance: malformed });
    assert.ok(!result.valid);
    assert.ok(result.errors.some((error) => error.startsWith("chunkAssemblyProvenance:")));
  };
  assertMalformedChunkProvenance((value) => { value.unexpected = true; });
  assertMalformedChunkProvenance((value) => { value.planChecksum = "not-a-sha256"; });
  assertMalformedChunkProvenance((value) => { value.canonicalOutputHashes.extra = hash; });
  assertMalformedChunkProvenance((value) => { delete value.canonicalOutputHashes.audio; });
  assertMalformedChunkProvenance((value) => { delete value.assemblyToolchainHashes.audioAssembler; });
  assertMalformedChunkProvenance((value) => { value.assemblyToolchainHashes.extra = hash; });
  assertMalformedChunkProvenance((value) => { delete value.chunkAttestationChecksums[chunkId].compile; });
  assertMalformedChunkProvenance((value) => { value.chunkAudioChecksums = null; });
});

test("compiler derives durationInFrames from max end, not array order", () => {
  const timeline = compileStoryboard(timingFixture(["a", "b"]), {
    durations: [
      { id: "a", startFrame: 0, frames: 100 },
      { id: "b", startFrame: 100, frames: 50 },
    ],
  });
  assert.strictEqual(timeline.durationInFrames, 150);
});

test("complete style inventories resolve every production ref", () => {
  for (const style of ["c", "d", "f"] as const) {
    const resolved = assertStyleInventory(style, ["characters/cat", "finance/money"]);
    assert.ok(resolved["characters/cat"]);
    assert.ok(resolved["finance/money"]);
  }
});

test("style provenance rejects an environment-style or manifest mismatch", () => {
  const provenance = { assetStyle: "c", assetStyleManifestHash: styleManifestHash("c") };
  assert.strictEqual(assertTimelineAssetStyle(provenance, "c"), "c");
  assert.throws(() => assertTimelineAssetStyle(provenance, "d"), /does not match timeline style/);
  assert.throws(
    () => assertTimelineAssetStyle({ ...provenance, assetStyleManifestHash: "stale" }, "c"),
    /manifest changed after compile/,
  );
});

test("asset style defaults to f and rejects unknown environment values", () => {
  const saved = process.env.ASSET_STYLE;
  delete process.env.ASSET_STYLE;
  assert.strictEqual(requestedAssetStyle(), "f");
  process.env.ASSET_STYLE = "not-a-style";
  assert.throws(() => requestedAssetStyle(), /ASSET_STYLE must be one of/);
  if (saved === undefined) delete process.env.ASSET_STYLE;
  else process.env.ASSET_STYLE = saved;
});

async function runTests(): Promise<void> {
  let failures = 0;
  for (const item of tests) {
    try {
      await item.run();
      console.log(`PASS ${item.name}`);
    } catch (error) {
      failures++;
      console.error(`FAIL ${item.name}`);
      console.error(error);
    }
  }
  if (failures > 0) process.exitCode = 1;
  else console.log(`\n${tests.length} tests passed.`);
}

void runTests();
