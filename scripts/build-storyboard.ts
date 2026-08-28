/**
 * build-storyboard.ts — mechanical resolver for a hand-authored storyboard
 * (the "session-authored" path: an agent reads the transcript directly in
 * chat and writes scene content by hand, with no API key / model call).
 *
 * Every creative decision (scene boundaries, grammar, emotion, slots,
 * purpose, viewerFocus) lives in a per-project data file exporting `SCENES`
 * (and optionally `CAST`) — see projects/<id>/storyboard-data.ts for the
 * shape (AuthoredScene). This script's ONLY job is mechanical: find each
 * scene's `marker` phrase in the tokenized transcript, slice exact
 * contiguous word ranges from it (guaranteeing full, gap-free,
 * non-overlapping transcript coverage), and emit storyboard.json.
 *
 *   npx ts-node scripts/build-storyboard.ts --project <id-or-path>
 *   npx ts-node scripts/build-storyboard.ts --project <id> --data path/to/data.ts --out path/to/storyboard.json
 */
import * as fs from "fs";
import * as path from "path";
import { indexTranscript, makeSourceRange, sourceExcerpt, checksumText } from "../src/ai/transcriptCoverage";
import {
  getGrammarDefinition, isKnownGrammar, knownGrammarIds, missingRequiredSlots,
} from "../src/engine/grammarRegistry";
import {
  resolveAuthoredAssets, roleForAuthoredAssetSlot,
} from "../src/engine/authoredAssets";
import type { VisualTreatmentPlan } from "../src/types/storyboard";
import type { AssetManifest } from "../src/types/assets";
import { resolveAssetRequest } from "../src/engine/assetResolver";
import referenceQuality from "../config/reference-quality.json";
import { ENTRANCE_STYLES } from "../src/engine/entrancePolicy";
import { authoredCadenceIssues, authoredTransitionCapabilityIssues } from "../src/engine/visualCadence";

const args = process.argv.slice(2);
function getArg(flag: string, defaultVal?: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

const projectArg = getArg("--project");
if (!projectArg) {
  console.error("❌ Cần --project <id-or-path> (folder chứa transcript.txt + storyboard-data.ts)");
  process.exit(1);
}
const projectDir = fs.existsSync(projectArg) || projectArg.includes("/") || projectArg.includes("\\")
  ? projectArg
  : path.join("projects", projectArg);

const transcriptPath = getArg("--transcript", path.join(projectDir, "transcript.txt"))!;
const dataPath = getArg("--data", path.join(projectDir, "storyboard-data.ts"))!;
const outPath = getArg("--out", path.join(projectDir, "storyboard.json"))!;

if (!fs.existsSync(transcriptPath)) {
  console.error(`❌ Transcript not found: ${transcriptPath}`);
  process.exit(1);
}
if (!fs.existsSync(dataPath)) {
  console.error(`❌ Storyboard data file not found: ${dataPath}`);
  process.exit(1);
}

// Route A authoring must contain concrete directorial decisions. A compact
// catalogue is fine, but using an indexed/modulo helper to manufacture props,
// poses, grammar slots, or every scene's semantic contract creates the exact
// mechanical storyboard the production policy forbids. Catch the two known
// failure shapes before loading the module or creating any downstream asset.
const authoredSource = fs.readFileSync(dataPath, "utf8");
const mechanicalAuthoringErrors: string[] = [];
if (/\b[a-zA-Z_$][\w$]*\s*%\s*[a-zA-Z_$][\w$]*/.test(authoredSource)) {
  mechanicalAuthoringErrors.push("modulo expressions are forbidden in storyboard-data.ts; author each scene's visual decision explicitly");
}
if (/\bSCENES\s*(?::[^=]+)?=\s*\w+\.map\([^\n]*=>\s*\w+\(/.test(authoredSource)) {
  mechanicalAuthoringErrors.push("SCENES cannot be produced by mapping beat rows into a generic scene helper; write explicit AuthoredScene objects with scene-specific slots, assets, poses and beats");
}
if (mechanicalAuthoringErrors.length) {
  console.error(`❌ Mechanical authoring rejected in ${dataPath}:`);
  for (const message of mechanicalAuthoringErrors) console.error(`   ${message}`);
  process.exit(1);
}

// Dynamic require (not a static import) since the data file path is only
// known at runtime — ts-node's register hook lets us require() a .ts file
// directly, same as any other CommonJS module.
const dataModule = require(path.resolve(dataPath));
const SCENES: any[] = dataModule.SCENES;
const CAST: Record<string, any> = dataModule.CAST ?? {};
const SECTIONS: any[] = dataModule.SECTIONS ?? [];
const CLAIMS: any[] = dataModule.CLAIMS ?? [];
const VISUAL_TREATMENT_PLAN: VisualTreatmentPlan | undefined = dataModule.VISUAL_TREATMENT_PLAN;
if (!Array.isArray(SCENES) || SCENES.length === 0) {
  console.error(`❌ ${dataPath} must export a non-empty \`SCENES\` array`);
  process.exit(1);
}

// Short id prefix for scene ids: reuse a trailing version tag from the
// project id (e.g. "...-v4" -> "v4-"), else a generic "scene-".
function defaultIdPrefix(): string {
  const base = path.basename(projectDir);
  const m = /-(v\d+[a-z0-9]*)$/i.exec(base);
  return m ? `${m[1]}-` : "scene-";
}
const idPrefix = getArg("--id-prefix", defaultIdPrefix())!;

const transcript = fs.readFileSync(transcriptPath, "utf8").normalize("NFC");
const words = indexTranscript(transcript);

function tokenize(s: string): string[] {
  const matches = s.normalize("NFC").match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) ?? [];
  return matches.map((w) => w.toLowerCase());
}

function findMarker(marker: string, fromIndex: number): number {
  const tokens = tokenize(marker);
  if (tokens.length === 0) throw new Error(`Empty marker`);
  for (let i = fromIndex; i <= words.length - tokens.length; i++) {
    let ok = true;
    for (let j = 0; j < tokens.length; j++) {
      if (words[i + j].text.toLowerCase() !== tokens[j]) { ok = false; break; }
    }
    if (ok) return i;
  }
  throw new Error(`Marker not found from word ${fromIndex}: "${marker}"`);
}

const ranges: { startWord: number; endWord: number }[] = [];
let cursor = 0;
for (let i = 0; i < SCENES.length; i++) {
  const startIdx = i === 0 ? 0 : findMarker(SCENES[i].marker, cursor);
  if (i > 0) ranges[i - 1].endWord = startIdx - 1;
  ranges.push({ startWord: startIdx, endWord: -1 });
  cursor = startIdx;
}
ranges[ranges.length - 1].endWord = words.length - 1;

// Sanity: every scene after the first must actually start where its own
// marker was found (i.e. markers must be found in transcript order).
for (let i = 0; i < ranges.length; i++) {
  if (ranges[i].endWord < ranges[i].startWord) {
    throw new Error(`Scene ${i} (${SCENES[i].marker}) has empty/invalid range ${ranges[i].startWord}-${ranges[i].endWord}`);
  }
}

// A stable dedup key for "have we already shown this exact frame recipe?".
// Derived from decisions the author already made — deriving it does not invent
// intent, unlike the old hardcoded `semanticVisual: { subject: "cat", ... }`.
function fingerprintOf(scene: any, assets: Record<string, string>): string {
  const slots = scene.slots ?? {};
  const roleShape = Object.keys(assets).sort().map((key) =>
    /^(who|asker|answerer|anchor|actor)/.test(key) ? "actor" : "prop").join(",");
  const stageClass = String(slots.stage ?? "").includes("scenes/") ? "stage" :
    scene.photoTreatment ? "photo" : "graphic";
  return [
    scene.grammar, scene.visualRegister, scene.focalType, stageClass,
    roleShape, scene.shot ?? "medium", scene.captionTreatment ?? "none",
    scene.evidenceTreatment ?? "none", scene.photoTreatment ?? "none",
  ].join("|");
}

const authorErrors: string[] = [];
const assetNeeds: Array<{ sceneId: string; slot: string; query: string; reason: string }> = [];
const manifestPath = path.join(process.cwd(), "public", "assets.manifest.json");
const assetManifest: AssetManifest | undefined = fs.existsSync(manifestPath)
  ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : undefined;
const assetUsage = new Map<string, number>();

if (SCENES.length >= 8) {
  const plan = VISUAL_TREATMENT_PLAN;
  if (!plan ||
      !plan.registerTargets || Object.keys(plan.registerTargets).length < 3 ||
      typeof plan.characterFreeTarget !== "number" ||
      !Array.isArray(plan.heroConcepts) || plan.heroConcepts.length === 0 ||
      !Array.isArray(plan.visualMotifs) || plan.visualMotifs.length === 0 ||
      !Array.isArray(plan.forbiddenRepeats) || plan.forbiddenRepeats.length === 0 ||
      !plan.usageBudgets || !Array.isArray(plan.requiredVisualModes) || plan.requiredVisualModes.length < 6 ||
      !(plan.heroCadenceSeconds > 0 && plan.heroCadenceSeconds <= 45) ||
      plan.paletteProfile !== "editorial-muted-v2") {
    authorErrors.push(
      "video: export VISUAL_TREATMENT_PLAN with >=3 registerTargets, " +
      "characterFreeTarget, heroConcepts, visualMotifs, forbiddenRepeats, usageBudgets, " +
      ">=6 requiredVisualModes, heroCadenceSeconds<=45 and paletteProfile=editorial-muted-v2",
    );
  }
}

const scenes = SCENES.map((s, i) => {
  const id = `${idPrefix}${String(i + 1).padStart(3, "0")}`;
  const range = makeSourceRange(words, ranges[i].startWord, ranges[i].endWord);
  const narration = s.narrationOverride ?? sourceExcerpt(transcript, words, range);
  const slots = { ...(s.slots ?? {}) };
  const fail = (msg: string) => authorErrors.push(`${id}: ${msg}`);
  authorErrors.push(...authoredCadenceIssues(id, narration, s.beats));
  authorErrors.push(...authoredTransitionCapabilityIssues(id, s.grammar, slots, s.beats));

  // ── Route A authoring contract. These are creative decisions; the builder
  // refuses to invent them. Previously they were silently absent, which made
  // every semantic gate downstream vacuous.
  if (!isKnownGrammar(s.grammar)) {
    fail(`unknown visualGrammar "${s.grammar}". Valid: ${knownGrammarIds().join(", ")}`);
  }
  if (s.entranceStyle !== undefined && !ENTRANCE_STYLES.includes(s.entranceStyle)) {
    fail(`invalid entranceStyle "${s.entranceStyle}". Valid: ${ENTRANCE_STYLES.join(", ")}`);
  }
  const definition = getGrammarDefinition(s.grammar);
  if (definition) {
    for (const slot of missingRequiredSlots(definition, slots)) {
      fail(`grammar ${s.grammar} requires slot "${slot}"`);
    }
    if (!s.visualRegister) {
      fail(`missing visualRegister (supported: ${definition.supportedRegisters.join(", ")})`);
    } else if (!definition.supportedRegisters.includes(s.visualRegister)) {
      fail(`${s.grammar} does not support register "${s.visualRegister}" ` +
           `(supported: ${definition.supportedRegisters.join(", ")})`);
    }
  }
  const sv = s.semanticVisual;
  if (!sv?.subject?.trim() || !sv?.action?.trim() || !sv?.takeaway?.trim()) {
    fail("semanticVisual needs subject, action and takeaway — what visibly happens on screen");
  }
  if (!s.focalType) fail("missing focalType");
  if (!s.silentFrameTakeaway?.trim()) {
    fail("missing silentFrameTakeaway — what a muted viewer understands from this frame");
  }
  const minFocal = referenceQuality.composition.minimumFocalOccupancy;
  if (typeof s.focalOccupancyTarget !== "number" || s.focalOccupancyTarget < minFocal) {
    fail(`focalOccupancyTarget must be a number >= ${minFocal} (how much frame the focal fills)`);
  }

  const resolvedAssets = resolveAuthoredAssets(slots, CAST);
  const assetRequests = Object.entries(resolvedAssets).map(([slot, query]) => {
    const selection = s.assetSelections?.[slot];
    return {
      role: selection?.role ?? roleForAuthoredAssetSlot(slot),
      slot,
      query: selection?.query ?? query,
      requiredTags: selection?.requiredTags ?? [],
      preferredTags: selection?.preferredTags,
      preferredAssetId: selection?.preferredAssetId ?? query,
      lockedAssetId: selection?.lockedAssetId,
      continuityReason: selection?.continuityReason,
      allowGenerate: selection?.allowGenerate ?? false,
    };
  });
  const resolutionNotes: string[] = [];
  if (s.assetSelections && !assetManifest) fail("public/assets.manifest.json is required for semantic asset selection");
  if (assetManifest) {
    for (const request of assetRequests.filter((item) => !!s.assetSelections?.[item.slot])) {
      const result = resolveAssetRequest(request, assetManifest, undefined,
        { usage: assetUsage, maximumUses: VISUAL_TREATMENT_PLAN?.usageBudgets.maximumAssetUses });
      if (!result.asset) {
        const reason = result.unresolvedReason ?? "no compatible asset";
        fail(`asset slot ${request.slot}: ${reason}`);
        assetNeeds.push({ sceneId: id, slot: request.slot, query: request.query, reason });
        continue;
      }
      assetUsage.set(result.asset.path, (assetUsage.get(result.asset.path) ?? 0) + 1);
      resolvedAssets[request.slot] = result.asset.path;
      if (request.slot in slots) slots[request.slot] = result.asset.path;
      resolutionNotes.push(`${request.slot}: ${result.reasons?.join("; ") ?? result.asset.path}`);
    }
  }
  if (definition?.focalSource === "asset" && Object.keys(resolvedAssets).length === 0) {
    fail(`no slot resolves to a visual asset — the scene would render as text on an empty field`);
  }
  const fingerprint = fingerprintOf({ ...s, slots }, resolvedAssets);

  return {
    id,
    narration,
    purpose: s.purpose,
    emotion: s.emotion,
    entranceStyle: s.entranceStyle,
    viewerFocus: s.viewerFocus,
    visualGrammar: s.grammar,
    sourceRange: range,
    heroVisual: s.heroVisual ?? false,
    shot: s.shot,
    slots,
    visualRegister: s.visualRegister,
    semanticVisual: sv,
    focalType: s.focalType,
    silentFrameTakeaway: s.silentFrameTakeaway,
    focalOccupancyTarget: s.focalOccupancyTarget,
    characterRequired: s.characterRequired,
    photoTreatment: s.photoTreatment,
    captionTreatment: s.captionTreatment,
    evidenceTreatment: s.evidenceTreatment,
    sectionId: s.sectionId,
    claimIds: s.claimIds,
    beats: s.beats,
    visualFingerprint: fingerprint,
    assetRequests,
    resolvedAssets,
    assetResolutionNotes: resolutionNotes,
  };
});

if (VISUAL_TREATMENT_PLAN) {
  const statRatio = scenes.filter((scene) => scene.visualGrammar === "STAT_REVEAL").length / scenes.length;
  if (statRatio > VISUAL_TREATMENT_PLAN.usageBudgets.maximumStatRevealRatio) {
    authorErrors.push(`video: STAT_REVEAL ratio ${statRatio.toFixed(3)} exceeds ` +
      `${VISUAL_TREATMENT_PLAN.usageBudgets.maximumStatRevealRatio}`);
  }
  const registers = new Set(scenes.map((scene) => scene.visualRegister));
  if (registers.size < 6) authorErrors.push(`video: only ${registers.size} visual modes/registers; require at least 6`);
}

// noveltyFromPrevious: what actually changed against the previous scene's
// recipe. Computed, not asserted — an empty list is a truthful signal that the
// scene repeats its predecessor, and the register/repeat gates read it.
const withNovelty = scenes.map((scene, i) => {
  if (i === 0) return { ...scene, noveltyFromPrevious: ["opening scene"] };
  const previous = scenes[i - 1];
  const novelty: string[] = [];
  if (scene.visualGrammar !== previous.visualGrammar) novelty.push(`grammar:${scene.visualGrammar}`);
  if (scene.visualRegister !== previous.visualRegister) novelty.push(`register:${scene.visualRegister}`);
  const previousRefs = new Set(Object.values(previous.resolvedAssets));
  for (const ref of new Set(Object.values(scene.resolvedAssets))) {
    if (!previousRefs.has(ref)) novelty.push(`asset:${ref}`);
  }
  return { ...scene, noveltyFromPrevious: novelty };
});

if (authorErrors.length) {
  if (assetNeeds.length) {
    fs.writeFileSync(path.join(projectDir, "asset-needs.json"), `${JSON.stringify({ schemaVersion: 1, needs: assetNeeds }, null, 2)}\n`, "utf8");
  }
  console.error(`❌ ${authorErrors.length} authoring error(s) in ${dataPath}:\n`);
  for (const line of authorErrors) console.error(`   ${line}`);
  console.error(
    `\nRoute A now emits schemaVersion 2, so every scene must carry the semantic\n` +
    `contract the production gates read (visualRegister, semanticVisual, focalType,\n` +
    `silentFrameTakeaway, focalOccupancyTarget) plus its grammar's required slots.`
  );
  process.exit(1);
}

// Sections are chapter boundaries, not marker-sized excerpts. Resolve every
// authored marker against the complete transcript, then turn adjacent starts
// into contiguous source ranges just as scene markers do. This is deliberately
// done only after the full storyboard's ranges exist; chunk tooling must never
// slice SCENES and re-run marker resolution on a partial transcript.
const resolvedSections = SECTIONS.length
  ? (() => {
      const starts = SECTIONS.map((section, index) =>
        index === 0 ? 0 : findMarker(String(section.sourceMarker ?? ""), 0));
      return SECTIONS.map((section, index) => ({
        ...section,
        sourceRange: makeSourceRange(words, starts[index],
          index + 1 < starts.length ? starts[index + 1] - 1 : words.length - 1),
      }));
    })()
  : [];

const storyboard = {
  schemaVersion: 2,
  transcriptChecksum: checksumText(transcript),
  promptVersion: "session-authored",
  fps: 30,
  width: 1920,
  height: 1080,
  cast: CAST,
  sections: resolvedSections,
  claims: CLAIMS.map((claim) => {
    if (!claim.sourceMarker) return claim;
    const start = findMarker(String(claim.sourceMarker), 0);
    const length = tokenize(String(claim.sourceMarker)).length;
    return { ...claim, sourceRange: makeSourceRange(words, start, start + length - 1) };
  }),
  visualTreatmentPlan: VISUAL_TREATMENT_PLAN,
  scenes: withNovelty,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(storyboard, null, 2)}\n`, "utf8");
console.log(`Wrote ${outPath}`);
console.log(`Scenes: ${scenes.length} | Transcript words: ${words.length} | Coverage: words 0-${words.length - 1}`);
