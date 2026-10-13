/**
 * Create a non-promotable scene-edit scope for the fast authoring verification
 * loop. It never changes storyboard/timeline/proof artifacts.
 */
import * as fs from "fs";
import * as path from "path";
import { indexTranscript, validateStoryboardCoverage } from "../src/ai/transcriptCoverage";
import { runStoryboardCheck } from "../src/ai/qualityCheck";
import { buildStoryboardIterationScope } from "../src/engine/iterationScope";
import { minimumAuthoredScenesForWordCount, verifyCanonicalChunkPlan } from "../src/types/chunk";
import { Storyboard } from "../src/types/storyboard";

const args = process.argv.slice(2);
const value = (flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
};
const projectArgument = value("--project");
const baselineArgument = value("--baseline");
const outArgument = value("--out");
const haloValue = value("--halo-scenes") ?? "1";
const expectedFlags = new Set(["--project", "--baseline", "--out", "--halo-scenes"]);
for (const flag of args.filter((argument) => argument.startsWith("--"))) {
  if (!expectedFlags.has(flag)) throw new Error(`Unknown option: ${flag}`);
}
if (!projectArgument || !baselineArgument) {
  throw new Error("Usage: verify-storyboard-scope --project <id-or-path> --baseline <prior-storyboard.json> [--halo-scenes 1] [--out <path>]");
}
const haloScenes = Number(haloValue);
if (!Number.isInteger(haloScenes) || haloScenes < 0 || haloScenes > 4) {
  throw new Error("--halo-scenes must be an integer from 0 to 4.");
}
const projectDir = fs.existsSync(projectArgument) ? path.resolve(projectArgument) : path.resolve("projects", projectArgument);
const storyboardPath = path.join(projectDir, "storyboard.json");
const planPath = path.join(projectDir, "chunks", "chunk-plan.json");
const transcriptPath = path.join(projectDir, "transcript.txt");
const outPath = outArgument
  ? path.resolve(outArgument)
  : path.join(projectDir, ".iteration", "storyboard-scope.json");

function readJson<T>(filePath: string): T {
  if (!fs.existsSync(filePath)) throw new Error(`Required JSON file is missing: ${filePath}`);
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")) as T; }
  catch { throw new Error(`Invalid JSON file: ${filePath}`); }
}

const storyboard = readJson<Storyboard>(storyboardPath);
const baseline = readJson<Storyboard>(path.resolve(baselineArgument));
const plan = readJson<any>(planPath);
const planIssues = verifyCanonicalChunkPlan(storyboard, plan, path.basename(projectDir));
if (planIssues.length) throw new Error(`Canonical chunk plan failed: ${planIssues.map((issue) => issue.message).join(" ")}`);
if (!fs.existsSync(transcriptPath)) throw new Error(`Transcript required for global authoring gate: ${transcriptPath}`);
const transcriptWords = indexTranscript(fs.readFileSync(transcriptPath, "utf8")).length;
const coverage = validateStoryboardCoverage(fs.readFileSync(transcriptPath, "utf8"), storyboard);
const quality = runStoryboardCheck(storyboard);
const expectedMinimum = minimumAuthoredScenesForWordCount(transcriptWords);
if (!coverage.valid || quality.blockers || quality.majors
  || storyboard.authoringDecision?.transcriptWords !== transcriptWords
  || storyboard.authoringDecision?.minimumScenes !== expectedMinimum
  || storyboard.authoringDecision?.authoredScenes !== storyboard.scenes.length
  || !storyboard.authoringDecision?.passed) {
  throw new Error("Global authoring gate failed; rebuild/repair the complete storyboard before requesting a local diagnostic scope.");
}
const scope = buildStoryboardIterationScope(baseline, storyboard, plan, haloScenes);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
const temporary = `${outPath}.${process.pid}.tmp`;
fs.writeFileSync(temporary, `${JSON.stringify(scope, null, 2)}\n`, "utf8");
fs.renameSync(temporary, outPath);
console.log(`✅ Wrote non-promotable edit scope: ${outPath}`);
console.log(`   Changed: ${scope.changedSceneIds.concat(scope.addedSceneIds, scope.removedSceneIds).join(", ") || "none"}`);
console.log(`   Diagnostic scenes: ${scope.diagnosticSceneIds.join(", ") || "none"}`);
console.log(`   Affected chunks: ${scope.affectedChunkIds.join(", ") || "none"}`);
