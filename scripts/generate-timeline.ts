/**
 * generate-timeline.ts — AI-powered timeline generator
 *
 * 3 input modes:
 *
 *   MODE 1: Idea only (Claude writes script + generates timeline)
 *     npx ts-node scripts/generate-timeline.ts --idea "Tại sao lạm phát tăng?"
 *
 *   MODE 2: YouTube/video URL (extracts transcript → generates timeline)
 *     npx ts-node scripts/generate-timeline.ts --url "https://youtube.com/watch?v=..."
 *
 *   MODE 3: Transcript file (generates timeline from text)
 *     npx ts-node scripts/generate-timeline.ts --transcript transcript.txt
 *
 * Optional flags:
 *   --audio audio/voice.mp3    Audio file to sync with (relative to public/)
 *   --duration 90              Override duration in seconds (default: auto)
 *   --out timeline.json        Output file path
 *
 * API fallback chain (auto, theo thứ tự ưu tiên):
 *   1. ANTHROPIC_API_KEY  → Claude Sonnet (best quality)
 *   2. AISTUDIO_API_KEY   → Gemini 2.0 Flash (Google AI Studio)
 *   3. GROK_API_KEY       → Grok 2
 *   4. DEEPSEEK_API_KEY   → DeepSeek Chat
 */

import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { buildSystemPrompt, buildScriptFromIdea, listAvailableAssets } from "../src/ai/systemPrompt";
import { validateTimeline, printValidationResult } from "../src/ai/validateTimeline";
import { autoFixBackgrounds, printBackgroundFixReport } from "../src/ai/backgroundResolver";
import { runQualityCheck, printQualityReport } from "../src/ai/qualityCheck";
// import { compileScenes } from "../src/engine/sceneCompiler"; // [SCENE_COMPILER]

// --- Parse CLI args ---
const args = process.argv.slice(2);
function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : undefined;
}

const ideaInput = getArg("--idea");
const urlInput = getArg("--url");
const transcriptInput = getArg("--transcript");
const audioInput = getArg("--audio");
const durationOverride = getArg("--duration");
const ttsFlag = args.includes("--tts") || args.includes("--tts-kokoro");
const ttsBackend = args.includes("--tts-kokoro") ? "kokoro" : "edge";
// kokoro voices: af_heart af_bella am_adam am_michael bf_emma bm_george
// edge voices:   en-US-AvaNeural vi-VN-HoaiMyNeural vi-VN-NamMinhNeural
const ttsVoice = getArg("--tts-voice") ?? (ttsBackend === "kokoro" ? "af_heart" : "en-US-AvaNeural");
const ttsLang = getArg("--tts-lang") ?? "a"; // kokoro only: a=US English, b=British, j=Japanese

// Auto output path: cùng folder với transcript nếu không có --out
const outPath = getArg("--out") ?? (
  transcriptInput
    ? path.join(path.dirname(transcriptInput), "timeline.json")
    : "timeline.json"
);

if (!ideaInput && !urlInput && !transcriptInput) {
  console.error(`
❌ Cần ít nhất 1 input mode:

  --idea "Ý tưởng video"           AI tự viết script rồi tạo timeline
  --url  "https://youtube.com/..."  Dùng transcript từ URL
  --transcript transcript.txt       Dùng file transcript có sẵn
`);
  process.exit(1);
}

// ─── API Provider Fallback Chain ────────────────────────────────────────────

interface ProviderConfig {
  name: string;
  key: string;
  baseURL?: string;       // undefined = Anthropic native
  model: string;
  scriptModel: string;
}

function buildProviderChain(): ProviderConfig[] {
  const chain: ProviderConfig[] = [];

  if (process.env.ANTHROPIC_API_KEY) {
    chain.push({
      name: "Anthropic (Claude)",
      key: process.env.ANTHROPIC_API_KEY,
      model: "claude-sonnet-4-6",
      scriptModel: "claude-sonnet-4-6",
    });
  }

  // Gemini key rotation: AISTUDIO_API_KEY, AISTUDIO_API_KEY_2, AISTUDIO_API_KEY_3
  const geminiKeys = [
    process.env.AISTUDIO_API_KEY,
    process.env.AISTUDIO_API_KEY_2,
    process.env.AISTUDIO_API_KEY_3,
  ].filter((k): k is string => !!k);

  for (let i = 0; i < geminiKeys.length; i++) {
    chain.push({
      name: `Gemini Flash${geminiKeys.length > 1 ? ` (key ${i + 1}/${geminiKeys.length})` : ""}`,
      key: geminiKeys[i],
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
      model: "gemini-2.5-flash",
      scriptModel: "gemini-2.5-flash",
    });
  }


  return chain;
}

const providerChain = buildProviderChain();

if (providerChain.length === 0) {
  console.error(`
❌ Không có API key nào. Set ít nhất một trong các biến sau:

  $env:ANTHROPIC_API_KEY = "sk-ant-..."    ← Claude (tốt nhất)
  $env:AISTUDIO_API_KEY  = "AIza..."       ← Gemini (Google AI Studio)
  $env:GROK_API_KEY      = "xai-..."       ← Grok (xAI)
  $env:DEEPSEEK_API_KEY  = "sk-..."        ← DeepSeek
`);
  process.exit(1);
}

console.log(`🔑 API chain: ${providerChain.map(p => p.name).join(" → ")}`);

// ─── callWithFallback: thử từng provider, fallback khi lỗi ──────────────────

interface CallOptions<T = string> {
  system?: string;
  user: string;
  maxTokens: number;
  modelType: "script" | "timeline";
  /** Optional: parse raw text → T. If throws, treated as failure → retry next provider */
  parse?: (raw: string) => T;
}

async function callWithFallback<T = string>(opts: CallOptions<T>): Promise<T> {
  let lastError: Error | null = null;

  for (const provider of providerChain) {
    const model = opts.modelType === "script" ? provider.scriptModel : provider.model;

    try {
      process.stdout.write(`   [${provider.name}] đang gọi... `);

      let text: string;

      if (provider.baseURL?.includes("generativelanguage.googleapis.com")) {
        // Gemini — use official Google SDK
        text = await callGeminiSDK(provider.key, opts.system, opts.user, opts.maxTokens, model);
      } else {
        // Anthropic — use native SDK
        const client = new Anthropic({ apiKey: provider.key });
        const response = await client.messages.create({
          model,
          max_tokens: opts.maxTokens,
          system: opts.system,
          messages: [{ role: "user", content: opts.user }],
        });
        text = (response.content[0] as any).text?.trim() ?? "";
      }

      if (opts.parse) {
        const result = opts.parse(text);
        console.log("✅");
        return result;
      }

      console.log("✅");
      return text as unknown as T;
    } catch (err: any) {
      console.log(`❌ ${err?.message?.slice(0, 80) ?? "unknown error"}`);
      lastError = err;
    }
  }

  throw new Error(`Tất cả providers đều thất bại. Lỗi cuối: ${lastError?.message}`);
}

async function callGeminiSDK(
  apiKey: string,
  system: string | undefined,
  user: string,
  maxTokens: number,
  model: string
): Promise<string> {
  // Use new @google/genai SDK (supports both AQ.* and AIza.* keys)
  const ai = new GoogleGenAI({
    apiKey,
  });

  // Combine system + user into single message
  const fullPrompt = system ? `${system}\n\n${user}` : user;

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
    config: {
      maxOutputTokens: maxTokens,
      responseMimeType: "application/json",
    },
  });

  return response.text;
}


// --- Helper: get audio duration ---
function getAudioDuration(audioPath: string): number {
  try {
    const fullPath = path.join(process.cwd(), "public", audioPath);
    if (!fs.existsSync(fullPath)) return 60;
    const result = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${fullPath}"`
    ).toString().trim();
    return parseFloat(result) || 60;
  } catch {
    console.warn("⚠️  ffprobe không tìm thấy, dùng duration mặc định 60s");
    return 60;
  }
}

// --- Helper: fetch YouTube transcript ---
async function fetchYouTubeTranscript(url: string): Promise<string> {
  console.log("🔍 Fetching transcript from URL...");
  try {
    // Try yt-dlp if available
    const result = execSync(
      `yt-dlp --write-auto-sub --skip-download --sub-format vtt --output "%(id)s" "${url}" 2>&1`
    ).toString();
    const videoId = url.match(/[?&]v=([^&]+)/)?.[1] ?? "";
    const vttFile = `${videoId}.en.vtt`;
    if (fs.existsSync(vttFile)) {
      const vtt = fs.readFileSync(vttFile, "utf-8");
      fs.unlinkSync(vttFile);
      // Strip VTT formatting
      return vtt
        .replace(/WEBVTT.*?\n\n/s, "")
        .replace(/\d{2}:\d{2}:\d{2}\.\d{3} --> .+\n/g, "")
        .replace(/<[^>]+>/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }
  } catch (e) {
    // yt-dlp not available — fallback to asking Claude to describe
  }

  console.warn("⚠️  yt-dlp không khả dụng. Dùng Claude để phân tích URL...");
  // Fallback: ask Claude to treat the URL topic as the idea
  return `[URL: ${url}]\n\nHãy tạo script về chủ đề được nhắc đến trong URL này.`;
}

// --- Step 1: Get transcript ---
async function getTranscript(): Promise<{ text: string; source: string }> {
  if (transcriptInput) {
    console.log(`📄 Đọc transcript: ${transcriptInput}`);
    if (!fs.existsSync(transcriptInput)) {
      console.error(`❌ File không tồn tại: ${transcriptInput}`);
      process.exit(1);
    }
    return { text: fs.readFileSync(transcriptInput, "utf-8"), source: "transcript" };
  }

  if (urlInput) {
    const text = await fetchYouTubeTranscript(urlInput);
    return { text, source: "url" };
  }

  // Idea mode: Claude writes the script first
  console.log(`💡 Idea mode: "${ideaInput}"`);
  console.log("✍️  AI đang viết script...");

  const scriptText = await callWithFallback({
    user: buildScriptFromIdea(ideaInput!),
    maxTokens: 2000,
    modelType: "script",
  });
  let scriptData: any;
  try {
    const jsonMatch = scriptText.match(/\{[\s\S]+\}/);
    scriptData = JSON.parse(jsonMatch?.[0] ?? scriptText);
  } catch {
    scriptData = { script: scriptText, estimatedDurationSeconds: 75 };
  }

  console.log(`✅ Script: "${scriptData.title ?? ideaInput}"`);
  console.log(`   Ước tính: ${scriptData.estimatedDurationSeconds ?? 75}s`);

  // Save script for reference
  const scriptPath = outPath.replace(".json", "_script.txt");
  fs.writeFileSync(
    scriptPath,
    `Title: ${scriptData.title ?? ideaInput}\n\n${scriptData.script ?? scriptText}`
  );
  console.log(`   Script đã lưu: ${scriptPath}`);

  // Build enriched transcript with visual hints for the timeline generator
  const segments = scriptData.segments ?? [];
  const segmentGuide = segments.length > 0
    ? "\n\n## VISUAL GUIDE (từ script analysis)\n" +
      segments.map((s: any) =>
        `[${s.startSec}s-${s.endSec}s | Pattern ${s.scenePattern}] ${s.label}\n` +
        `  Script: "${s.script}"\n` +
        `  Assets: ${(s.keyAssets ?? []).join(", ")}\n` +
        `  Callouts: ${(s.keyCallouts ?? []).join(", ")}\n` +
        `  Stats: ${(s.keyStats ?? []).join(", ")}`
      ).join("\n\n")
    : "";

  return {
    text: (scriptData.fullScript ?? scriptData.script ?? scriptText) + segmentGuide,
    source: "idea",
  };
}

// --- Step 2: Generate timeline from transcript ---
async function generateTimeline(
  transcript: string,
  durationSeconds: number,
): Promise<any> {
  const assetList = listAvailableAssets();
  console.log(`\n🎨 Assets có sẵn: ${assetList.length} SVGs`);
  console.log(`⏱️  Duration: ${durationSeconds}s (${durationSeconds * 30} frames)`);
  console.log("🤖 AI đang tạo timeline...\n");

  const systemPrompt = buildSystemPrompt(assetList, durationSeconds);

  // Scene count MUST scale with duration — one scene per ~10-15s of narration.
  // A single scene held for minutes = the #1 cause of a boring video. The
  // reference channel changes context/beat every 5-15s.
  const minScenes = Math.max(4, Math.round(durationSeconds / 15));
  const idealScenes = Math.max(6, Math.round(durationSeconds / 11));

  return await callWithFallback<any>({
    system: systemPrompt,
    user: `Tạo SceneTimeline JSON cho video sau. Duration: ${durationSeconds} giây (${durationSeconds * 30} frames @ 30fps).
${audioInput ? `Audio file: ${audioInput}` : ""}

QUAN TRỌNG — NHỊP ĐIỆU (chống nhàm chán):
- **Số scene: tối thiểu ${minScenes}, lý tưởng ~${idealScenes} scenes.** Mỗi scene 8-15 giây, KHÔNG để 1 scene kéo dài hàng phút.
- Cắt transcript thành nhiều "beat" ngắn — mỗi khi đổi ý/cảm xúc/ví dụ → scene mới (đổi layout + background).
- Mỗi scene 1-3 entities, tối đa 1-2 overlay text (đã có phụ đề narration ở dưới).
- **narration BẮT BUỘC cho mỗi scene** (nguồn tạo phụ đề).
- Dùng đa dạng: paperCards (dẫn chứng/khảo sát), frameBoxes (bản đồ), DIALOGUE, STAT_DRAMA, ICON_TRIPLE — đừng lặp 1 kiểu.
- Trả về JSON thuần túy, KHÔNG markdown, KHÔNG \`\`\`json. JSON hoàn chỉnh, đóng tất cả ngoặc.

TRANSCRIPT / SCRIPT:
---
${transcript}
---`,
    maxTokens: 32000,
    modelType: "timeline",
    parse: (raw) => {
      const jsonMatch = raw.match(/\{[\s\S]+\}/);
      const jsonText = jsonMatch ? jsonMatch[0] : raw;
      try {
        return JSON.parse(jsonText);
      } catch {
        console.error("\n   ⚠️  JSON không hợp lệ (thử provider tiếp theo):");
        console.error(`   ${raw.slice(0, 200)}...`);
        throw new Error("JSON parse failed — truncated response");
      }
    },
  });
}

// --- TTS: generate audio per scene, patch timeline durations ---
async function runTTS(timeline: any, projectDir: string): Promise<void> {
  if (!Array.isArray(timeline.scenes) || timeline.scenes.length === 0) {
    console.warn("⚠️  TTS: timeline có 0 scenes, bỏ qua TTS");
    return;
  }

  // Extract narrations from scenes
  const scenes = timeline.scenes.map((s: any) => ({
    id: s.id ?? `scene-${s.startFrame ?? 0}`,
    text: (s.narration ?? s.label ?? "").replace(/^\[.*?\]\s*/, "").trim(),
  }));

  const ttsDir = projectDir;
  const scenesJsonPath = path.join(ttsDir, "tts_scenes.json");
  fs.mkdirSync(ttsDir, { recursive: true });
  fs.writeFileSync(scenesJsonPath, JSON.stringify(scenes, null, 2));

  console.log(`\n🎙️  TTS: ${scenes.length} scenes → ${ttsVoice}`);
  console.log(`   Outdir: ${ttsDir}`);

  // Run TTS script (kokoro via py -3.11, edge via python)
  const ttsScript = path.join(path.dirname(__filename),
    ttsBackend === "kokoro" ? "tts_kokoro.py" : "tts_edge.py");
  const pythonExe = ttsBackend === "kokoro" ? "py -3.11" : "python";
  const extraArgs = ttsBackend === "kokoro" ? ` --lang "${ttsLang}"` : "";
  const cmd = `${pythonExe} "${ttsScript}" --scenes "${scenesJsonPath}" --outdir "${ttsDir}" --voice "${ttsVoice}"${extraArgs}`;
  try {
    const output = execSync(cmd, { encoding: "utf-8", timeout: 300000 });
    console.log(output.trim().split("\n").map(l => "   " + l).join("\n"));
  } catch (e: any) {
    console.error("❌ TTS failed:", e.message);
    throw e;
  }

  // Read durations.json
  const durPath = path.join(ttsDir, "durations.json");
  if (!fs.existsSync(durPath)) {
    throw new Error(`TTS: durations.json không tạo được tại ${durPath}`);
  }
  const durations = JSON.parse(fs.readFileSync(durPath, "utf-8"));

  // Build lookup: scene id → frames
  const frameMap: Record<string, number> = {};
  for (const s of durations.scenes) {
    frameMap[s.id] = s.frames;
  }

  // Patch timeline: set each scene's durationFrames from actual TTS duration
  let cursor = 0;
  let patchedCount = 0;
  for (const scene of timeline.scenes) {
    const sid = scene.id ?? `scene-${scene.startFrame ?? 0}`;
    scene.startFrame = cursor;
    if (frameMap[sid] !== undefined) {
      scene.durationFrames = frameMap[sid];
      patchedCount++;
    }
    // else: keep AI-estimated duration as fallback
    cursor += scene.durationFrames ?? 150;
  }
  timeline.durationInFrames = cursor;

  // Save voice.wav to project dir + also copy to public/ for Remotion
  const voiceWav = path.join(ttsDir, "voice.wav");
  const publicDir = path.join(process.cwd(), "public");
  const publicAudioDir = path.join(publicDir, "audio", path.basename(ttsDir));

  // Copy voice.wav to public/ so Remotion can access it
  fs.mkdirSync(publicAudioDir, { recursive: true });
  const publicVoiceWav = path.join(publicAudioDir, "voice.wav");
  fs.copyFileSync(voiceWav, publicVoiceWav);

  // Timeline audio ref is relative to public/
  const relAudio = `audio/${path.basename(ttsDir)}/voice.wav`;
  timeline.audio = relAudio;

  console.log(`\n✅ TTS done: ${patchedCount}/${timeline.scenes.length} scenes patched`);
  console.log(`   Total: ${cursor} frames (${(cursor / 30).toFixed(1)}s)`);
  console.log(`   Audio: ${voiceWav} (+ public/audio/...)`);
  console.log(`   Timeline ref: ${relAudio}`);
}

// --- Main ---
async function main() {
  console.log("🎬 Cat Explainer — Timeline Generator\n");
  console.log(`   Mode: ${ideaInput ? "💡 Idea" : urlInput ? "🔗 URL" : "📄 Transcript"}`);
  if (ttsFlag) console.log(`   TTS: ${ttsVoice}`);

  // Step 1: Get transcript
  const { text: transcript, source } = await getTranscript();

  // Step 2: Determine duration
  let durationSeconds = 75;
  if (durationOverride) {
    durationSeconds = parseInt(durationOverride);
  } else if (audioInput) {
    durationSeconds = Math.ceil(getAudioDuration(audioInput));
    console.log(`🎵 Audio duration: ${durationSeconds}s`);
  } else if (ttsFlag) {
    // TTS mode: estimate from transcript word count (~2.5 words/sec narration pace)
    const wordCount = transcript.split(/\s+/).length;
    durationSeconds = Math.ceil(wordCount / 2.5);
    console.log(`📝 Transcript: ~${wordCount} words → estimated ${durationSeconds}s`);
  }

  // Step 3: Generate timeline
  const timeline = await generateTimeline(transcript, durationSeconds);

  // Step 3.5: TTS — generate audio and patch durations (same folder as timeline)
  if (ttsFlag && Array.isArray(timeline.scenes)) {
    const projectDir = path.dirname(outPath);  // Same folder as timeline.json
    await runTTS(timeline, projectDir);
  }

  // Step 4: Add audio if provided (non-TTS mode)
  if (audioInput && !ttsFlag) {
    timeline.audio = audioInput;
  }

  // Step 4.5: AUTO CHECK & FIX — after timeline + audio are ready.
  // Repairs the #1 recurring defect: the AI leaving every scene on a flat
  // gradient so the video looks like ugly color washes. This deterministically
  // swaps lazy gradients on narrative scenes for real illustrated backgrounds
  // from public/backgrounds/ (abstract STAT/ICON scenes keep their gradient).
  if (Array.isArray(timeline.scenes)) {
    const bgReport = autoFixBackgrounds(timeline);
    printBackgroundFixReport(bgReport);
  }

  // // [SCENE_COMPILER] Tạm comment — AI hiện generate raw events trực tiếp (video-002 pattern)
  // // Mở lại nếu muốn dùng SceneTimeline → SceneCompiler pipeline
  // let compiled = timeline;
  // if (Array.isArray(timeline.scenes)) {
  //   console.log(`\n⚙️  Compiling ${timeline.scenes.length} scenes → events...`);
  //   try {
  //     compiled = compileScenes(timeline);
  //     console.log(`   ✅ Compiled: ${compiled.events.length} events`);
  //   } catch (e: any) {
  //     console.error(`❌ Scene compile failed: ${e.message}`);
  //     process.exit(1);
  //   }
  // }
  // // Save raw SceneTimeline for reference
  // if (Array.isArray(timeline.scenes)) {
  //   const scenePath = outPath.replace(".json", "_scenes.json");
  //   fs.writeFileSync(scenePath, JSON.stringify(timeline, null, 2));
  //   console.log(`   SceneTimeline lưu: ${scenePath}`);
  // }
  const compiled = timeline;

  // Step 6: Validate schema + quality check
  const validation = validateTimeline(compiled);
  printValidationResult(validation, outPath);

  if (Array.isArray(compiled.scenes)) {
    const qReport = runQualityCheck(compiled, outPath);
    printQualityReport(qReport);
  }

  if (!validation.valid) {
    console.error("\n⚠️  Timeline có lỗi nhưng vẫn lưu để bạn xem xét...");
  }

  // Step 7: Save compiled timeline (ready for Remotion)
  fs.writeFileSync(outPath, JSON.stringify(compiled, null, 2));
  console.log(`\n💾 Timeline đã lưu: ${outPath}`);
  console.log(`   Events: ${compiled.events?.length ?? 0}`);
  console.log(`   Duration: ${compiled.durationInFrames} frames`);

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ XONG! Bước tiếp theo:

   Preview:  npm start
             → Mở http://localhost:3000

   Render:   npx ts-node scripts/render.ts --timeline ${outPath} --out output/video.mp4
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
}

main().catch((e) => {
  console.error("\n❌ Lỗi:", e.message);
  process.exit(1);
});
