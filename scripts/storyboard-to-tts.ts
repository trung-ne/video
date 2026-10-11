/**
 * storyboard-to-tts.ts — extract TTS input from a storyboard.
 *
 * The storyboard pipeline needs audio BEFORE compiling (durations lock the
 * frame timing). This reads storyboard.json → writes tts_scenes.json
 * ([{id, text}]) so the existing TTS scripts can voice it. One scene = one
 * TTS chunk, keyed by brief id, so durations.json lines up with the briefs
 * at compile time.
 *
 *   npx ts-node scripts/storyboard-to-tts.ts --storyboard projects/<id>/storyboard.json \
 *       --out projects/<id>/tts_scenes.json
 */
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { isSafeLineageId } from "../src/types/chunk";

const args = process.argv.slice(2);
const getArg = (f: string) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : undefined; };

const sbPath = getArg("--storyboard");
if (!sbPath || !fs.existsSync(sbPath)) { console.error(`❌ storyboard not found: ${sbPath}`); process.exit(1); }
const outPath = getArg("--out") ?? path.join(path.dirname(sbPath), "tts_scenes.json");

const sb = JSON.parse(fs.readFileSync(sbPath, "utf-8"));
const scenes = (sb.scenes ?? []).map((s: any) => ({
  id: s.id,
  text: (s.narration ?? "").replace(/\s+/g, " ").trim(),
})).map((scene: any) => ({
  ...scene,
  textSha256: crypto.createHash("sha256").update(scene.text, "utf8").digest("hex"),
}));

const unsafeIds = scenes.map((scene: any) => scene.id).filter((id: unknown) => !isSafeLineageId(id));
if (unsafeIds.length) {
  console.error(
    `❌ Scene ids must be safe lowercase path segments before TTS creates per-scene files; got ${JSON.stringify(unsafeIds[0])}.`
  );
  process.exit(1);
}
const duplicateIds = scenes.map((scene: any) => scene.id)
  .filter((id: string, index: number, all: string[]) => all.indexOf(id) !== index);
if (duplicateIds.length) {
  console.error(`❌ Duplicate scene id cannot be used for TTS artifacts: ${duplicateIds[0]}.`);
  process.exit(1);
}

// Dropping a silent scene here would leave it absent from durations.json, which
// surfaces much later as an unsatisfiable TIMING_ID_MISSING at compile time.
// Authored silent beats need an explicit duration and real silence in the voice
// track; until that exists, fail where the cause is obvious.
const silent = scenes.filter((s: any) => !s.text.length).map((s: any) => s.id);
if (silent.length) {
  console.error(
    `❌ ${silent.length} scene(s) have empty narration (${silent.slice(0, 3).join(", ")}).\n` +
    `   Every scene needs narration so TTS can measure its duration.`
  );
  process.exit(1);
}

fs.writeFileSync(outPath, JSON.stringify(scenes, null, 2));
console.log(`✅ tts_scenes.json: ${scenes.length} scenes → ${outPath}`);
