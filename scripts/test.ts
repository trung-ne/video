import * as assert from "assert";
import { indexTranscript, makeSourceRange, validateStoryboardCoverage } from "../src/ai/transcriptCoverage";
import { Storyboard } from "../src/types/storyboard";
import { resolveAssetRequest } from "../src/engine/assetResolver";
import { AssetManifest } from "../src/types/assets";

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
    role: "character", query: "lead cat explain", requiredTags: ["explain"], allowGenerate: false,
  }, manifest);
  assert.strictEqual(result.asset?.id, "lead.explain");
});

test("semantic asset resolver never silently falls back", () => {
  const manifest: AssetManifest = { schemaVersion: 1, generatedAt: "test", entries: [] };
  const result = resolveAssetRequest({
    role: "prop", query: "population map", requiredTags: ["population"], allowGenerate: true,
  }, manifest);
  assert.strictEqual(result.asset, undefined);
  assert.match(result.unresolvedReason ?? "", /generation queue/);
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
