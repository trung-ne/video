/**
 * generate-via-cli.ts — dùng claude CLI (đã auth) thay vì SDK
 * npx ts-node scripts/generate-via-cli.ts --transcript <file> --duration <s> --out <file>
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { buildSystemPrompt, buildScriptFromIdea, listAvailableAssets } from "../src/ai/systemPrompt";
import { validateTimeline, printValidationResult } from "../src/ai/validateTimeline";

const args = process.argv.slice(2);
function getArg(flag: string) { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : undefined; }

const transcriptFile = getArg("--transcript");
const ideaInput     = getArg("--idea");
const durationSec   = parseInt(getArg("--duration") ?? "180");
const outPath       = getArg("--out") ?? "timeline.json";
const audioInput    = getArg("--audio");

if (!transcriptFile && !ideaInput) {
  console.error("❌ Cần --transcript <file> hoặc --idea <text>");
  process.exit(1);
}

const CLAUDE_BIN = "C:\\Users\\Administrator\\.vscode\\extensions\\anthropic.claude-code-2.1.183-win32-x64\\resources\\native-binary\\claude.exe";

function callClaude(prompt: string, systemPrompt?: string): string {
  const tmpPrompt = path.join(process.cwd(), "_tmp_prompt.txt");
  fs.writeFileSync(tmpPrompt, prompt, "utf8");

  // Escape system prompt for CLI (replace " with escaped, limit newlines)
  let cmd: string;
  if (systemPrompt) {
    // Write system prompt to temp file, use --system-prompt-file flag
    const tmpSys = path.join(process.cwd(), "_tmp_sys.txt");
    fs.writeFileSync(tmpSys, systemPrompt, "utf8");
    // --allowedTools "" disables all tools so Claude only reads stdin and outputs text
    cmd = `"${CLAUDE_BIN}" -p --system-prompt-file "${tmpSys}" --allowedTools "" --output-format text < "${tmpPrompt}"`;
    try {
      const result = execSync(cmd, { encoding: "utf8", maxBuffer: 1024 * 1024 * 10, shell: "cmd.exe" });
      fs.unlinkSync(tmpSys);
      return result;
    } catch(e: any) {
      if (fs.existsSync(tmpSys)) fs.unlinkSync(tmpSys);
      throw e;
    }
  } else {
    cmd = `"${CLAUDE_BIN}" -p --allowedTools "" --output-format text < "${tmpPrompt}"`;
    return execSync(cmd, { encoding: "utf8", maxBuffer: 1024 * 1024 * 10, shell: "cmd.exe" });
  }
}

async function main() {
  console.log("🎬 Cat Explainer — Timeline Generator (via claude CLI)\n");

  // Step 1: Get transcript
  let transcript: string;
  if (transcriptFile) {
    console.log(`📄 Đọc transcript: ${transcriptFile}`);
    transcript = fs.readFileSync(transcriptFile, "utf8");
  } else {
    console.log(`💡 Idea mode: "${ideaInput}"`);
    console.log("✍️  Claude đang viết script...");
    const scriptPrompt = buildScriptFromIdea(ideaInput!);
    const raw = callClaude(scriptPrompt);
    const match = raw.match(/\{[\s\S]+\}/);
    const scriptData = match ? JSON.parse(match[0]) : { fullScript: raw };
    transcript = scriptData.fullScript ?? scriptData.script ?? raw;
    console.log(`✅ Script xong. Duration: ${durationSec}s`);
    fs.writeFileSync(outPath.replace(".json", "_script.txt"), transcript, "utf8");
  }

  // Step 2: Generate timeline
  const assetList = listAvailableAssets();
  const systemPrompt = buildSystemPrompt(assetList, durationSec);
  console.log(`\n🎨 Assets: ${assetList.length} SVGs`);
  console.log(`⏱️  Duration: ${durationSec}s = ${durationSec * 30} frames`);
  console.log("🤖 Claude đang tạo timeline...\n");

  const userMsg = `OUTPUT ONLY RAW JSON. NO EXPLANATION. NO MARKDOWN. START WITH { END WITH }.

Generate timeline for: ${durationSec}s (${durationSec * 30} frames @ 30fps).
${audioInput ? `Audio: ${audioInput}` : ""}

TRANSCRIPT:
---
${transcript}
---

RESPOND WITH ONLY THE JSON OBJECT. FIRST CHARACTER MUST BE {`;

  const rawResponse = callClaude(userMsg, systemPrompt);

  // Extract JSON
  const match = rawResponse.match(/\{[\s\S]+\}/);
  if (!match) {
    console.error("❌ Không tìm thấy JSON trong response:");
    console.error(rawResponse.slice(0, 500));
    process.exit(1);
  }

  let timeline: any;
  try {
    timeline = JSON.parse(match[0]);
  } catch (e) {
    console.error("❌ JSON parse failed:", (e as Error).message);
    console.error(match[0].slice(0, 500));
    process.exit(1);
  }

  if (audioInput) timeline.audio = audioInput;

  const validation = validateTimeline(timeline);
  printValidationResult(validation, outPath);

  fs.writeFileSync(outPath, JSON.stringify(timeline, null, 2), "utf8");
  console.log(`\n💾 Timeline đã lưu: ${outPath}`);
  console.log(`   Events: ${timeline.events?.length ?? 0}`);
  console.log(`   Duration: ${timeline.durationInFrames} frames`);
  console.log(`\n✅ Mở Studio: npm start → http://localhost:3000`);
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
