import * as assert from "assert";
import { indexTranscript, makeSourceRange, validateStoryboardCoverage } from "../src/ai/transcriptCoverage";
import { Storyboard } from "../src/types/storyboard";
import { resolveAssetRequest } from "../src/engine/assetResolver";
import { AssetManifest } from "../src/types/assets";
import { compileStoryboard } from "../src/engine/storyboardCompiler";
import { runQualityCheck, runStoryboardCheck } from "../src/ai/qualityCheck";
import { stageMatchesSetting } from "../src/engine/stageRegistry";
import { critiqueSceneBriefs } from "../src/ai/visualCritic";
import { validateTimeline } from "../src/ai/validateTimeline";

type Test = { name: string; run: () => void };
const tests: Test[] = [];
function test(name: string, run: () => void): void {
  tests.push({ name, run });
}

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
  const timeline = compileStoryboard(storyboard);
  assert.strictEqual(timeline.scenes[0].backgroundSrc, "#FFFFFF");
  assert.deepStrictEqual(timeline.scenes[0].semanticAssetIds, ["finance/money", "finance/house"]);
  assert.strictEqual(timeline.scenes[0].visualFingerprint, "compare|diagram|0|none|contrast");
  assert.strictEqual(timeline.scenes[0].semanticAction, "contrast");
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
  assert.throws(() => compileStoryboard(storyboard), /Missing semantic asset/);
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
