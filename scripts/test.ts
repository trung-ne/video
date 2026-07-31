import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { indexTranscript, makeSourceRange, validateStoryboardCoverage } from "../src/ai/transcriptCoverage";
import { Storyboard } from "../src/types/storyboard";
import { resolveAssetRequest } from "../src/engine/assetResolver";
import { AssetManifest } from "../src/types/assets";
import { compileStoryboard } from "../src/engine/storyboardCompiler";
import {
  measureTeachingTextCoverage,
  runQualityCheck,
  runStoryboardCheck,
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
import { promoteArtifacts, shouldPreserveFailedMp4 } from "../src/engine/promoteArtifacts";
import { acquireRenderLock } from "../src/engine/renderLock";
import { buildReferenceComparison } from "../src/engine/referenceComparison";
import { VISUAL_GRAMMARS } from "../src/engine/visualGrammars";
import { compileScenes } from "../src/engine/sceneCompiler";
import { injectLiveliness } from "../src/engine/liveliness";
import { resolveAuthoredAssets } from "../src/engine/authoredAssets";
import { approvedPhotoPaths, isApprovedNoFacePhoto } from "../src/engine/photoPolicy";

type Test = { name: string; run: () => void };
const tests: Test[] = [];
function test(name: string, run: () => void): void {
  tests.push({ name, run });
}

test("canonical JSON checksums ignore formatting but detect semantic changes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cat-artifact-test-"));
  try {
    const artifact = path.join(dir, "artifact.json");
    fs.writeFileSync(artifact, '{\n  "a": 1,\n  "b": [2, 3]\n}\n');
    const expected = canonicalJsonChecksum(artifact);
    fs.writeFileSync(artifact, '{"a":1,"b":[2,3]}');
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
  fs.writeFileSync(path.join(stagingDir, "video.production-report.json"), "new-report");
  try {
    const archive = promoteArtifacts(stagingDir, finalDir, "run-test");
    assert.strictEqual(fs.readFileSync(path.join(finalDir, "video.mp4"), "utf8"), "new-video");
    assert.strictEqual(
      fs.readFileSync(path.join(finalDir, "video.production-report.json"), "utf8"),
      "new-report"
    );
    assert.ok(archive);
    assert.strictEqual(fs.readFileSync(path.join(archive!, "video.mp4"), "utf8"), "old-video");
    assert.ok(!fs.existsSync(path.join(finalDir, "video.visual-audit.json")));
    assert.strictEqual(
      fs.readFileSync(path.join(archive!, "video.visual-audit.json"), "utf8"),
      "stale-audit"
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("failed visual audits preserve the staged MP4 for re-audit", () => {
  assert.strictEqual(shouldPreserveFailedMp4("Command failed: visual-audit.py"), true);
  assert.strictEqual(shouldPreserveFailedMp4("storyboard quality gate failed"), false);
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

test("reference comparison names the robust baseline and emits signed deltas", () => {
  const result = buildReferenceComparison(
    {
      flatFrameRatio: 0.6,
      edgeDensity: { mean: 0.14 },
      nearDuplicateRatio: 0.3,
      longestNearDuplicateRunSeconds: 15,
      saturation: { mean: 0.2 },
      nearWhiteMean: 0.2,
      whiteDominantRatio: 0.1,
    },
    {
      reference: "refer/meo.mp4",
      referenceSha256: "abc",
      offsetsSeconds: [0, 1.7, 3.3],
      robustBaseline: {
        metrics: {
          flatFrameRatio: { mean: 0.45 },
          edgeDensity: { mean: 0.19 },
          nearDuplicateRatio: { mean: 0.18 },
          longestNearDuplicateRunSeconds: { mean: 10 },
          saturation: { mean: 0.18 },
          nearWhiteMean: { mean: 0.44 },
          whiteDominantRatio: { mean: 0.43 },
        },
      },
    }
  );
  assert.strictEqual(result.baseline, "robustBaseline");
  assert.strictEqual(result.deltaCandidateMinusReference.flatFrameRatio, 0.15);
  assert.strictEqual(result.deltaCandidateMinusReference.edgeDensity, -0.05);
  assert.strictEqual(result.deltaCandidateMinusReference.nearWhiteMean, -0.24);
  assert.strictEqual(result.deltaCandidateMinusReference.longestNearDuplicateRunSeconds, 5);
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

test("DIALOGUE_QA bubbles persist instead of disappearing early in long scenes", () => {
  const result = VISUAL_GRAMMARS.DIALOGUE_QA({
    id: "qa", narration: "Why? Because debt.", purpose: "teach through dialogue",
    emotion: "curious", viewerFocus: "the answer", visualGrammar: "DIALOGUE_QA",
    slots: {
      asker: "characters/cat_talk", answerer: "characters/cat_think",
      askerText: "Why?", answererText: "Because debt.",
    },
  } as any, { cast: {}, index: 0, strict: true });
  assert.strictEqual(result.speechBubbles?.length, 2);
  assert.ok(result.speechBubbles?.every((bubble) => bubble.duration === undefined));
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

test("long multi-card scenes stage persistent reveals about four seconds apart", () => {
  const storyboard = timingFixture(["scene-001"]);
  storyboard.scenes[0].visualGrammar = "CAUSE_EFFECT";
  storyboard.scenes[0].slots = {
    cause: "Debt", effect: "Stress",
    causeIcon: "finance/debt", effectIcon: "props/brain",
  };
  const timeline = compileStoryboard(storyboard, {
    durations: [{ id: "scene-001", startFrame: 0, frames: 360 }],
  });
  // The first focal appears immediately after clearPrevious; later cards keep
  // the persistent ~4-second staging that prevents a static long scene.
  assert.strictEqual(timeline.scenes[0].cards?.[0].delay, 2);
  assert.strictEqual(timeline.scenes[0].cards?.[1].delay, 120);
  assert.deepStrictEqual(timeline.timingProvenance?.beatTimingSummary, {
    "source-range-proportional": 1,
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
  assert.ok(approvedPhotoPaths().includes("backgrounds/mobile_trading_flatlay.jpg"));
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
  const report = runQualityCheck({
    schemaVersion: 2, fps: 30, width: 1920, height: 1080, durationInFrames: 600,
    audio: "audio/test.wav",
    scenes: [
      makeScene("p1", 0, "backgrounds/kitchen.jpg"),
      makeScene("p2", 150, "backgrounds/office_trading.jpg"),
      makeScene("p3", 300, "backgrounds/office_trading.jpg"),
      makeScene("p4", 450, "backgrounds/office_trading.jpg"),
    ],
  });
  const rules = report.checks.flatMap((check) => check.issues ?? []).map((issue) => issue.rule);
  assert.ok(rules.includes("PHOTO_FACE_POLICY"));
  assert.ok(rules.includes("PHOTO_REPEAT"));
});

test("narrator pose swaps persist until the next narration beat", () => {
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
      animation: "popIn",
    }],
  };
  const result = injectLiveliness(timeline, {
    availablePoses: new Set([
      "characters/cat",
      "characters/cat_talk",
      "characters/cat_explain",
      "characters/cat_think",
    ]),
  });
  const swaps = timeline.events.filter((event: any) => event.type === "swap");
  assert.strictEqual(result.swapsAdded, 3);
  assert.strictEqual(result.movesAdded, 0);
  assert.strictEqual(result.cameraMovesAdded, 3);
  assert.strictEqual(swaps.length, 3);

  const costumed: any = {
    ...timeline,
    events: [{
      frame: 0,
      type: "enter",
      assetId: "worker",
      src: "characters/cat_worker",
      position: { x: 0.5, y: 0.5 },
      scale: 1,
      animation: "popIn",
    }],
  };
  const costumedResult = injectLiveliness(costumed);
  assert.strictEqual(costumedResult.movesAdded, 3);
  assert.strictEqual(costumedResult.cameraMovesAdded, 3);
  assert.strictEqual(costumed.events.filter((event: any) => event.type === "move").length, 3);
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
  assert.strictEqual(timeline.scenes[0].visualFingerprint, "compare|diagram|0|none|contrast");
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
      { wordIndex: 0, word: "one", startSec: 0.1, endSec: 0.3 },
      { wordIndex: 1, word: "two", startSec: 0.4, endSec: 0.6 },
      { wordIndex: 2, word: "three", startSec: 1.0, endSec: 1.2 },
      { wordIndex: 3, word: "four", startSec: 1.3, endSec: 1.6 },
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

test("strict asset resolution keeps sentence-aligned pose swaps enabled", () => {
  const storyboard = timingFixture(["scene-001"]);
  storyboard.scenes[0].narration = "The cat explains the risk. Then the cat reacts to the result.";
  const timeline = compileStoryboard(storyboard, {
    durations: [{ id: "scene-001", startFrame: 0, frames: 300 }],
  });
  const cats = timeline.scenes[0].entities.filter((entity) => entity.assetId === "scene-001-cat");
  assert.ok(cats.length >= 2, "expected the focal cat plus a sentence-aligned pose swap");
  assert.ok(new Set(cats.map((entity) => entity.src)).size >= 2);
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

let failures = 0;
for (const item of tests) {
  try {
    item.run();
    console.log(`PASS ${item.name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${item.name}`);
    console.error(error);
  }
}
if (failures > 0) process.exit(1);
console.log(`\n${tests.length} tests passed.`);
