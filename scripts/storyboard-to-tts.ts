/**
 * storyboard-to-tts.ts — extract TTS input from a storyboard.
 *
 * The storyboard pipeline needs audio BEFORE compiling (durations lock the
 * frame timing). This reads storyboard.json → writes tts_scenes.json
 * (schema-v2 `scenes[]`) so the TTS router can voice it. One scene = one
 * TTS chunk, keyed by brief id, so durations.json lines up with the briefs
 * at compile time.
 *
 *   npx ts-node scripts/storyboard-to-tts.ts --storyboard projects/<id>/storyboard.json \
 *       --out projects/<id>/tts_scenes.json
 */
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

const args = process.argv.slice(2);
const getArg = (f: string) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : undefined; };

const sbPath = getArg("--storyboard");
if (!sbPath || !fs.existsSync(sbPath)) { console.error(`❌ storyboard not found: ${sbPath}`); process.exit(1); }
const outPath = getArg("--out") ?? path.join(path.dirname(sbPath), "tts_scenes.json");

const sb = JSON.parse(fs.readFileSync(sbPath, "utf-8"));
const projectDir = path.dirname(path.resolve(sbPath));
const manifestPath = path.join(projectDir, "project.json");
const projectManifest = fs.existsSync(manifestPath)
  ? JSON.parse(fs.readFileSync(manifestPath, "utf-8"))
  : {};
const scenes = (sb.scenes ?? []).map((s: any) => {
  // spokenText derives only from storyboard narration. Direction must never
  // become a subtitle token or a canonical alignment target.
  const spokenText = (s.narration ?? "").replace(/\s+/g, " ").trim();
  const ttsInstruction = typeof s.ttsInstruction === "string" && s.ttsInstruction.trim()
    ? s.ttsInstruction.trim()
    : undefined;
  return {
    id: s.id,
    spokenText,
    ttsInstruction,
    spokenTextSha256: crypto.createHash("sha256").update(spokenText, "utf8").digest("hex"),
    instructionSha256: crypto.createHash("sha256").update(ttsInstruction ?? "", "utf8").digest("hex"),
  };
});

// Dropping a silent scene here would leave it absent from durations.json, which
// surfaces much later as an unsatisfiable TIMING_ID_MISSING at compile time.
// Authored silent beats need an explicit duration and real silence in the voice
// track; until that exists, fail where the cause is obvious.
const silent = scenes.filter((s: any) => !s.spokenText.length).map((s: any) => s.id);
if (silent.length) {
  console.error(
    `❌ ${silent.length} scene(s) have empty narration (${silent.slice(0, 3).join(", ")}).\n` +
    `   Every scene needs narration so TTS can measure its duration.`
  );
  process.exit(1);
}

fs.writeFileSync(outPath, JSON.stringify({
  schemaVersion: 2,
  projectId: projectManifest.projectId ?? path.basename(projectDir),
  language: projectManifest.language,
  scenes,
}, null, 2));
console.log(`✅ tts_scenes.json: ${scenes.length} scenes → ${outPath}`);
