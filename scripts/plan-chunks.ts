/**
 * Derive deterministic semantic chunks from a complete Route A storyboard.
 * This command never author-slices SCENES and never writes a canonical timeline.
 */
import * as fs from "fs";
import * as path from "path";
import { checksumJson } from "../src/ai/transcriptCoverage";
import { planSemanticChunks } from "../src/types/chunk";
import { Storyboard } from "../src/types/storyboard";

const args = process.argv.slice(2);
const value = (flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

const projectArg = value("--project");
const storyboardPath = value("--storyboard") ?? (projectArg
  ? path.join(fs.existsSync(projectArg) ? projectArg : path.join("projects", projectArg), "storyboard.json")
  : undefined);
if (!storyboardPath || !fs.existsSync(storyboardPath)) {
  console.error("❌ plan-chunks requires --project <id> or an existing --storyboard <path>.");
  process.exit(1);
}
const projectDir = projectArg
  ? (fs.existsSync(projectArg) ? projectArg : path.join("projects", projectArg))
  : path.dirname(storyboardPath);
const outPath = value("--out") ?? path.join(projectDir, "chunks", "chunk-plan.json");
const targetSeconds = Number(value("--target-seconds") ?? 120);
const maximumSeconds = Number(value("--maximum-seconds") ?? 180);
if (!(targetSeconds > 0) || !(maximumSeconds > 0) || targetSeconds > maximumSeconds) {
  console.error("❌ --target-seconds must be positive and no larger than --maximum-seconds.");
  process.exit(1);
}

const storyboard = JSON.parse(fs.readFileSync(storyboardPath, "utf8")) as Storyboard;
const result = planSemanticChunks(storyboard, {
  projectId: path.basename(path.resolve(projectDir)),
  storyboardChecksum: checksumJson(storyboard),
  targetChunkSeconds: targetSeconds,
  maximumChunkTargetSeconds: maximumSeconds,
});
if (!result.plan) {
  console.error(`❌ Cannot create a chunk plan (${result.issues.length} issue(s)):`);
  for (const issue of result.issues) console.error(`   [${issue.code}] ${issue.message}`);
  process.exit(1);
}
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(result.plan, null, 2)}\n`, "utf8");
console.log(`✅ Chunk plan: ${result.plan.chunks.length} chunk(s) → ${outPath}`);
for (const chunk of result.plan.chunks) {
  console.log(`   ${chunk.id}: ${chunk.sceneIds.length} scenes, target ${chunk.targetDurationSeconds}s`);
}
