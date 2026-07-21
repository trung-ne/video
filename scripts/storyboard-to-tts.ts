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

const args = process.argv.slice(2);
const getArg = (f: string) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : undefined; };

const sbPath = getArg("--storyboard");
if (!sbPath || !fs.existsSync(sbPath)) { console.error(`❌ storyboard not found: ${sbPath}`); process.exit(1); }
const outPath = getArg("--out") ?? path.join(path.dirname(sbPath), "tts_scenes.json");

const sb = JSON.parse(fs.readFileSync(sbPath, "utf-8"));
const scenes = (sb.scenes ?? []).map((s: any) => ({
  id: s.id,
  text: (s.narration ?? "").replace(/\s+/g, " ").trim(),
})).filter((s: any) => s.text.length > 0);

fs.writeFileSync(outPath, JSON.stringify(scenes, null, 2));
console.log(`✅ tts_scenes.json: ${scenes.length} scenes → ${outPath}`);
