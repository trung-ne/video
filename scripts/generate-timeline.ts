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
import { compileStoryboard, SceneTiming } from "../src/engine/storyboardCompiler";
import { validateTimeline, printValidationResult } from "../src/ai/validateTimeline";
import { autoFixBackgrounds, printBackgroundFixReport } from "../src/ai/backgroundResolver";
import { QualityReport, runQualityCheck, printQualityReport, runStoryboardCheck } from "../src/ai/qualityCheck";
import { buildStoryMapPrompt } from "../src/ai/prompts/storyMapPrompt";
import { buildScenePlanPrompt } from "../src/ai/prompts/scenePlanPrompt";
import { buildRepairPrompt } from "../src/ai/prompts/repairPrompt";
import {
  checksumJson, checksumText, indexTranscript, makeSourceRange, sourceExcerpt, validateStoryboardCoverage,
} from "../src/ai/transcriptCoverage";
import { AssetManifest, AssetManifestEntry } from "../src/types/assets";
import { SceneBrief, StorySection, Storyboard } from "../src/types/storyboard";
import { createDefaultProjectManifest, ProjectManifest } from "../src/types/project";
import { DIRECTOR_POLICY_VERSION } from "../src/ai/directorPolicy";
import { resolveAssetRequests } from "../src/engine/assetResolver";
import { sha256File } from "../src/audio/prepareAudio";
import { critiqueSceneBriefs } from "../src/ai/visualCritic";

// --- Parse CLI args ---
const args = process.argv.slice(2);
function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : undefined;
}

const ideaInput = getArg("--idea");
const urlInput = getArg("--url");
const projectArg = getArg("--project");
const projectInput = projectArg
  ? (fs.existsSync(projectArg) || projectArg.includes("/") || projectArg.includes("\\")
      ? projectArg
      : path.join("projects", projectArg))
  : undefined;
const transcriptInput = getArg("--transcript") ?? (projectInput ? path.join(projectInput, "transcript.txt") : undefined);
const audioInput = getArg("--audio");
const durationOverride = getArg("--duration");
// Production default: always author intent first, then compile deterministically.
// The old direct-to-timeline route remains only as an explicit diagnostic escape
// hatch because it is easy for an LLM to satisfy schema quotas while producing
// repetitive "cat + icon on white" frames.
const storyboardMode = !args.includes("--legacy-direct");
const ttsFlag = args.includes("--tts") || args.includes("--tts-kokoro");
const ttsBackend = args.includes("--tts-kokoro") ? "kokoro" : "edge";
// kokoro voices: af_heart af_bella am_adam am_michael bf_emma bm_george
// edge voices:   en-US-AvaNeural vi-VN-HoaiMyNeural vi-VN-NamMinhNeural
const ttsVoice = getArg("--tts-voice") ?? (ttsBackend === "kokoro" ? "af_heart" : "en-US-AvaNeural");
const ttsLang = getArg("--tts-lang") ?? "a"; // kokoro only: a=US English, b=British, j=Japanese

// Auto output path: cùng folder với transcript nếu không có --out
const outPath = getArg("--out") ?? (
  projectInput
    ? path.join(projectInput, "timeline.json")
    : transcriptInput
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

// --- Step 2 (storyboard mode): transcript → Storyboard JSON ---
function parseJsonObject(raw: string): any {
  const match = raw.match(/\{[\s\S]+\}/);
  try {
    return JSON.parse(match ? match[0] : raw);
  } catch {
    throw new Error("JSON parse failed or response was truncated");
  }
}

function readAssetManifest(): AssetManifest {
  const manifestPath = path.join(process.cwd(), "public", "assets.manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error("Missing public/assets.manifest.json. Run `npm run build-assets`.");
  }
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function selectAssetCandidates(text: string, manifest: AssetManifest, limit = 48): AssetManifestEntry[] {
  const tokens = new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 2));
  const ranked = manifest.entries
    .filter((entry) => !entry.isFallback)
    .map((entry) => {
      const haystack = [
        entry.id, entry.path, entry.characterId,
        ...(entry.topics ?? []), ...(entry.action ?? []), ...(entry.emotion ?? []), ...(entry.props ?? []),
      ].join(" ").toLowerCase();
      let score = entry.styleFamily === "legacy" ? -5 : 0;
      if (entry.characterId === "lead-teal-cat") score += 4;
      for (const token of tokens) if (haystack.includes(token)) score += 2;
      return { entry, score };
    })
    .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id));
  const byKind = new Map<string, number>();
  const selected: AssetManifestEntry[] = [];
  for (const { entry } of ranked) {
    if ((byKind.get(entry.kind) ?? 0) >= 12) continue;
    selected.push(entry);
    byKind.set(entry.kind, (byKind.get(entry.kind) ?? 0) + 1);
    if (selected.length >= limit) break;
  }
  return selected;
}

function normalizeSections(raw: any, transcript: string): StorySection[] {
  const words = indexTranscript(transcript);
  const sections = Array.isArray(raw?.sections) ? raw.sections : [];
  if (sections.length === 0) throw new Error("Story map returned no sections");
  const normalized = sections.map((section: any, index: number) => {
    const startWord = Number(section.sourceRange?.startWord);
    const endWord = Number(section.sourceRange?.endWord);
    if (!Number.isInteger(startWord) || !Number.isInteger(endWord) || startWord < 0 || endWord < startWord || endWord >= words.length) {
      throw new Error(`Invalid story-map sourceRange for section ${section.id ?? index}`);
    }
    return {
      ...section,
      id: section.id ?? `section-${index + 1}`,
      sourceRange: makeSourceRange(words, startWord, endWord),
      thesis: String(section.thesis ?? ""),
      emotionalTurn: String(section.emotionalTurn ?? ""),
      targetDurationSeconds: section.targetDurationSeconds,
    };
  });
  let cursor = 0;
  for (const section of normalized) {
    if (section.sourceRange.startWord !== cursor) {
      throw new Error(`Story-map coverage gap/overlap before ${section.id}: expected ${cursor}, got ${section.sourceRange.startWord}`);
    }
    cursor = section.sourceRange.endWord + 1;
  }
  if (cursor !== words.length) {
    throw new Error(`Story map ends at word ${cursor - 1}; transcript ends at ${words.length - 1}`);
  }
  return normalized;
}

function normalizeClaims(rawClaims: any, transcript: string): Storyboard["claims"] {
  const words = indexTranscript(transcript);
  if (!Array.isArray(rawClaims)) return [];
  return rawClaims.map((claim: any, index: number) => {
    const startWord = Number(claim.sourceRange?.startWord);
    const endWord = Number(claim.sourceRange?.endWord);
    if (!Number.isInteger(startWord) || !Number.isInteger(endWord) ||
        startWord < 0 || endWord < startWord || endWord >= words.length) {
      throw new Error(`Invalid claim sourceRange for ${claim.id ?? index}`);
    }
    const policy = ["none", "quote", "data", "source_card"].includes(claim.evidencePolicy)
      ? claim.evidencePolicy
      : "none";
    return {
      id: String(claim.id ?? `claim-${index + 1}`),
      text: String(claim.text ?? sourceExcerpt(transcript, words, makeSourceRange(words, startWord, endWord))),
      sourceRange: makeSourceRange(words, startWord, endWord),
      evidencePolicy: policy,
      sceneIds: Array.isArray(claim.sceneIds) ? claim.sceneIds : [],
    };
  });
}

function finalizeSectionScenes(rawScenes: any[], section: StorySection, transcript: string): SceneBrief[] {
  const words = indexTranscript(transcript);
  return rawScenes.map((raw, index) => {
    const startWord = Number(raw.sourceRange?.startWord);
    const endWord = Number(raw.sourceRange?.endWord);
    if (!Number.isInteger(startWord) || !Number.isInteger(endWord)) {
      throw new Error(`${section.id} scene ${index + 1} is missing a numeric sourceRange`);
    }
    const range = makeSourceRange(words, startWord, endWord);
    return {
      ...raw,
      id: raw.id ?? `${section.id}-scene-${index + 1}`,
      sectionId: section.id,
      sourceRange: range,
      narration: sourceExcerpt(transcript, words, range),
      claimIds: Array.isArray(raw.claimIds) ? raw.claimIds : [],
      assetRequests: Array.isArray(raw.assetRequests) ? raw.assetRequests : [],
      continuity: raw.continuity ?? { castIds: ["narrator"] },
      slots: raw.slots ?? {},
      beats: raw.beats ?? [],
    } as SceneBrief;
  });
}

function sectionCoverageIssues(section: StorySection, scenes: SceneBrief[]): string[] {
  const issues: string[] = [];
  let cursor = section.sourceRange.startWord;
  for (const scene of scenes) {
    if (!scene.sourceRange) {
      issues.push(`${scene.id}: missing sourceRange`);
      continue;
    }
    if (scene.sourceRange.startWord !== cursor) {
      issues.push(`${scene.id}: expected startWord ${cursor}, got ${scene.sourceRange.startWord}`);
    }
    if (scene.sourceRange.endWord > section.sourceRange.endWord) {
      issues.push(`${scene.id}: range exceeds section end ${section.sourceRange.endWord}`);
    }
    cursor = scene.sourceRange.endWord + 1;
  }
  if (cursor !== section.sourceRange.endWord + 1) {
    issues.push(`${section.id}: coverage ends at ${cursor - 1}, expected ${section.sourceRange.endWord}`);
  }
  return issues;
}

function visualCriticIssues(scenes: SceneBrief[]): string[] {
  return critiqueSceneBriefs(scenes)
    .filter((critique) => critique.score < 8 || critique.issues.some((issue) => /hero is metadata-only|generic taxonomy/i.test(issue)))
    .map((critique) => `${critique.sceneId}: visual critic ${critique.score}/12 — ${critique.issues.join(", ")}`);
}

function buildUsageLedger(scenes: SceneBrief[]): Record<string, Record<string, number>> {
  const ledger: Record<string, Record<string, number>> = {
    register: {}, grammar: {}, fingerprint: {}, asset: {}, stage: {},
  };
  const add = (bucket: keyof typeof ledger, value: string | undefined) => {
    if (!value) return;
    ledger[bucket][value] = (ledger[bucket][value] ?? 0) + 1;
  };
  for (const scene of scenes) {
    add("register", scene.visualRegister);
    add("grammar", scene.visualGrammar);
    add("fingerprint", scene.visualFingerprint);
    add("stage", scene.slots?.stage);
    Object.values(scene.resolvedAssets ?? {}).forEach((asset) => add("asset", asset));
  }
  return ledger;
}

function remainingTreatmentQuotas(storyMap: any, scenes: SceneBrief[]): Record<string, number> {
  const targets = storyMap?.visualTreatmentPlan?.registerTargets ?? {};
  const counts = buildUsageLedger(scenes).register;
  return Object.fromEntries(Object.entries(targets).map(([register, ratio]) => [
    register,
    Math.max(0, Math.round(Number(ratio) * Math.max(1, scenes.length + 8)) - (counts[register] ?? 0)),
  ]));
}

function resolveSceneAssets(scenes: SceneBrief[], manifest: AssetManifest): void {
  const usage = new Map<string, number>();
  const maximumUses = Math.max(2, Math.ceil(scenes.length * 0.08));
  for (const scene of scenes) {
    const resolutions = resolveAssetRequests(scene.assetRequests ?? [], manifest, { usage, maximumUses });
    scene.resolvedAssets = {};
    scene.unresolvedAssetRequests = [];
    for (const resolution of resolutions) {
      if (resolution.asset) {
        scene.resolvedAssets[resolution.request.slot] = resolution.asset.path;
        scene.slots = { ...(scene.slots ?? {}), [resolution.request.slot]: resolution.asset.path };
        usage.set(resolution.asset.path, (usage.get(resolution.asset.path) ?? 0) + 1);
      } else {
        scene.unresolvedAssetRequests.push(
          `${resolution.request.slot}: ${resolution.request.query} (${resolution.unresolvedReason})`,
        );
      }
    }
  }
}

async function generateStoryboard(transcript: string, durationSeconds: number, projectDir: string): Promise<Storyboard> {
  console.log("🎬 Multipass director: global story map → section scene plans\n");
  const words = indexTranscript(transcript);
  const manifest = readAssetManifest();
  let storyMap: any;
  let sections: StorySection[] | undefined;
  let storyMapError: Error | undefined;
  for (let attempt = 0; attempt < 2 && !sections; attempt++) {
    storyMap = await callWithFallback<any>({
      user: buildStoryMapPrompt(transcript, words, durationSeconds),
      maxTokens: 12000,
      modelType: "timeline",
      parse: parseJsonObject,
    });
    try {
      sections = normalizeSections(storyMap, transcript);
    } catch (error) {
      storyMapError = error as Error;
      console.warn(`   Story-map coverage attempt ${attempt + 1} failed: ${storyMapError.message}`);
    }
  }
  if (!sections) throw storyMapError ?? new Error("Story map generation failed");
  fs.writeFileSync(path.join(projectDir, "story-map.json"), JSON.stringify({ ...storyMap, sections }, null, 2));

  const scenes: SceneBrief[] = [];
  let previousRegisters: string[] = [];
  for (const [sectionIndex, section] of sections.entries()) {
    const excerpt = sourceExcerpt(transcript, words, section.sourceRange);
    const candidates = selectAssetCandidates(excerpt, manifest);
    console.log(`   Section ${sectionIndex + 1}/${sections.length}: ${section.id}`);
    let response = await callWithFallback<any>({
      user: buildScenePlanPrompt({
        transcriptExcerpt: words
          .slice(section.sourceRange.startWord, section.sourceRange.endWord + 1)
          .map((word) => `[${word.index}] ${word.text}`).join(" "),
        section,
        storyMap,
        assetCandidates: candidates,
        previousRegisters,
        recentFingerprints: scenes.slice(-6).map((scene) => scene.visualFingerprint ?? ""),
        usageLedger: buildUsageLedger(scenes),
        remainingQuotas: remainingTreatmentQuotas(storyMap, scenes),
      }),
      maxTokens: 12000,
      modelType: "timeline",
      parse: parseJsonObject,
    });
    let sectionScenes = finalizeSectionScenes(response.scenes ?? [], section, transcript);
    for (let attempt = 0; attempt < 2; attempt++) {
      const issues = [
        ...sectionCoverageIssues(section, sectionScenes),
        ...visualCriticIssues(sectionScenes),
      ];
      if (issues.length === 0) break;
      response = await callWithFallback<any>({
        user: buildRepairPrompt({
          failedScenes: sectionScenes,
          issues,
          neighbors: scenes.slice(-2),
          assetCandidates: candidates,
        }),
        maxTokens: 12000,
        modelType: "timeline",
        parse: parseJsonObject,
      });
      sectionScenes = finalizeSectionScenes(response.scenes ?? [], section, transcript);
    }
    const remaining = [
      ...sectionCoverageIssues(section, sectionScenes),
      ...visualCriticIssues(sectionScenes),
    ];
    if (remaining.length) throw new Error(`Section ${section.id} failed coverage repair: ${remaining.join("; ")}`);
    resolveSceneAssets(sectionScenes, manifest);
    scenes.push(...sectionScenes);
    previousRegisters = scenes.slice(-2).map((scene) => scene.visualRegister ?? "");
  }

  const storyboard: Storyboard = {
    schemaVersion: 2,
    transcriptChecksum: checksumText(transcript),
    promptVersion: DIRECTOR_POLICY_VERSION,
    fps: 30,
    width: 1920,
    height: 1080,
    cast: { narrator: { src: "generated-assets/characters/cat_explain.png" } },
    sections,
    claims: normalizeClaims(storyMap.claims, transcript),
    visualTreatmentPlan: storyMap.visualTreatmentPlan,
    generation: { passIds: ["story-map", ...sections.map((section) => `scene-plan:${section.id}`)] },
    scenes,
  };
  const coverage = validateStoryboardCoverage(transcript, storyboard);
  if (!coverage.valid) {
    throw new Error(`Global storyboard coverage failed: ${coverage.issues.map((issue) => issue.message).join("; ")}`);
  }
  return storyboard;
}

async function repairStoryboard(
  storyboard: Storyboard,
  transcript: string,
  projectDir: string,
  report: QualityReport,
): Promise<Storyboard> {
  const manifest = readAssetManifest();
  const words = indexTranscript(transcript);
  const storyMapPath = path.join(projectDir, "story-map.json");
  const storyMap = fs.existsSync(storyMapPath)
    ? JSON.parse(fs.readFileSync(storyMapPath, "utf8"))
    : { sections: storyboard.sections, claims: storyboard.claims };
  const issueSceneIds = new Set(
    report.checks.flatMap((check) => check.issues).map((issue) => issue.scene).filter(Boolean),
  );
  const hasGlobalMajor = report.checks
    .flatMap((check) => check.issues)
    .some((issue) => issue.severity !== "MINOR" && !issue.scene);
  const nextScenes = [...storyboard.scenes];

  for (const section of storyboard.sections ?? []) {
    const sectionScenes = nextScenes.filter((scene) => scene.sectionId === section.id);
    if (!hasGlobalMajor && !sectionScenes.some((scene) => issueSceneIds.has(scene.id))) continue;
    const excerpt = sourceExcerpt(transcript, words, section.sourceRange);
    const candidates = selectAssetCandidates(excerpt, manifest);
    const sectionIssues = report.checks
      .flatMap((check) => check.issues)
      .filter((issue) => !issue.scene || sectionScenes.some((scene) => scene.id === issue.scene));
    const response = await callWithFallback<any>({
      user: buildRepairPrompt({
        failedScenes: sectionScenes,
        issues: sectionIssues,
        neighbors: nextScenes.filter((scene) => scene.sectionId !== section.id).slice(-2),
        assetCandidates: candidates,
      }),
      maxTokens: 12000,
      modelType: "timeline",
      parse: parseJsonObject,
    });
    const repaired = finalizeSectionScenes(response.scenes ?? [], section, transcript);
    const coverageIssues = sectionCoverageIssues(section, repaired);
    if (coverageIssues.length) {
      throw new Error(`Semantic repair broke ${section.id} coverage: ${coverageIssues.join("; ")}`);
    }
    resolveSceneAssets(repaired, manifest);
    const first = nextScenes.findIndex((scene) => scene.sectionId === section.id);
    nextScenes.splice(first, sectionScenes.length, ...repaired);
    storyboard.generation = storyboard.generation ?? {};
    storyboard.generation.repairs = storyboard.generation.repairs ?? [];
    storyboard.generation.repairs.push({ sceneId: section.id, reason: "production storyboard gate" });
  }
  storyboard.scenes = nextScenes;
  return storyboard;
}

function writeAssetRequestQueue(storyboard: Storyboard, projectDir: string): void {
  const requests = storyboard.scenes.flatMap((scene) =>
    (scene.unresolvedAssetRequests ?? []).map((reason) => ({
      sceneId: scene.id,
      sectionId: scene.sectionId,
      reason,
      requests: scene.assetRequests,
      semanticVisual: scene.semanticVisual,
      focalType: scene.focalType,
      silentFrameTakeaway: scene.silentFrameTakeaway,
      generationSpec: {
        styleFamily: "editorial_cat_v1",
        transparent: scene.focalType !== "full_scene" && scene.focalType !== "photo",
        aspectRatio: scene.focalType === "full_scene" || scene.focalType === "photo" ? "16:9" : "1:1",
        action: scene.semanticVisual?.action,
        setting: scene.semanticVisual?.setting,
      },
    }))
  );
  const queuePath = path.join(projectDir, "asset-requests.json");
  if (requests.length) {
    fs.writeFileSync(queuePath, `${JSON.stringify({ schemaVersion: 2, status: "assets_required", requests }, null, 2)}\n`, "utf8");
  } else if (fs.existsSync(queuePath)) {
    fs.unlinkSync(queuePath);
  }
}

// Read a durations.json (written by TTS) → SceneTiming[] for re-compile.
function readDurations(projectDir: string): SceneTiming[] | undefined {
  const p = path.join(projectDir, "durations.json");
  if (!fs.existsSync(p)) return undefined;
  const d = JSON.parse(fs.readFileSync(p, "utf-8"));
  return (d.scenes ?? []).map((s: any) => ({ id: s.id, startFrame: s.startFrame, frames: s.frames }));
}

// Word-align voice.wav → words.json (best-effort; beats fall back to
// char-proportion if whisper isn't installed or fails).
function runWordAlignment(projectDir: string, transcriptPath?: string): void {
  const wav = path.join(projectDir, "voice.wav");
  if (!fs.existsSync(wav)) return;
  try {
    console.log("🎯 Word alignment (whisper)...");
    const transcriptArg = transcriptPath ? ` --transcript "${transcriptPath}"` : "";
    execSync(`py -3.11 scripts/align_words.py --wav "${wav}" --outdir "${projectDir}" --model base${transcriptArg}`, {
      stdio: "inherit", cwd: process.cwd(),
    });
  } catch {
    console.warn("⚠️  align_words thất bại (thiếu faster-whisper?) — beat dùng xấp xỉ theo tỉ lệ.");
  }
}

/**
 * Digests of the inputs a compile consumed, recorded into the artifact so a later
 * consumer can tell which voice track / storyboard / alignment it belongs to.
 * Length alone cannot detect a swap to a different track of the same duration.
 */
function timingProvenanceInputs(projectDir: string, storyboard: Storyboard) {
  const read = (name: string): string | undefined => {
    const p = path.join(projectDir, name);
    return fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : undefined;
  };
  const durationsRaw = read("durations.json");
  const wordsRaw = read("words.json");
  const publicWav = path.join(process.cwd(), "public", "audio", path.basename(projectDir), "voice.wav");
  const durations = durationsRaw ? JSON.parse(durationsRaw) : undefined;
  return {
    audioSeconds: typeof durations?.totalSec === "number" ? durations.totalSec : undefined,
    audioSha256: fs.existsSync(publicWav) ? sha256File(publicWav) : undefined,
    storyboardChecksum: checksumJson(storyboard),
    durationsChecksum: durationsRaw ? checksumJson(JSON.parse(durationsRaw)) : undefined,
    wordsChecksum: wordsRaw ? checksumJson(JSON.parse(wordsRaw)) : undefined,
  };
}

// Read a words.json (written by align_words.py) → AlignedWord[] for beats.
function readWords(projectDir: string): any[] | undefined {
  const p = path.join(projectDir, "words.json");
  if (!fs.existsSync(p)) return undefined;
  const w = JSON.parse(fs.readFileSync(p, "utf-8"));
  return Array.isArray(w) ? w : w.words;
}

interface TtsChunk { id: string; text: string }

/**
 * One TTS chunk per SCENE, for both schema versions.
 *
 * v2 used to chunk by section, which left scene boundaries derivable only from
 * whisper word indices — and those are 0-2.2% populated in practice, so every
 * v2 scene silently fell back to a word-count estimate. Chunking per scene gives
 * both routes the same invariant: durations.json is keyed by scene id, so
 * boundaries are measured and word alignment is free to fail without breaking
 * timing (it then only degrades beat anchoring).
 */
function ttsChunksFromStoryboard(storyboard: Storyboard): TtsChunk[] {
  const chunks = storyboard.scenes.map((scene) => ({
    id: scene.id,
    text: (scene.narration ?? "").replace(/\s+/g, " ").trim(),
  }));
  // A scene with no narration gets no audio, so it can never appear in
  // durations.json — it would surface later as an unsatisfiable TIMING_ID_MISSING.
  // Fail here instead. Authored silent beats need an explicit duration field;
  // inventing one while claiming the timeline matches the audio is the exact
  // class of bug this pipeline is being hardened against.
  const silent = chunks.filter((c) => !c.text.length).map((c) => c.id);
  if (silent.length) {
    throw new Error(
      `${silent.length} scene(s) have empty narration (${silent.slice(0, 3).join(", ")}). ` +
      `Silent scenes need an authored duration and real silence in the voice track; ` +
      `that is not supported yet, so they cannot be timed.`
    );
  }
  return chunks;
}

/** Chunks from an AI-authored timeline — `--legacy-direct` only. */
function ttsChunksFromTimeline(timeline: any): TtsChunk[] {
  return timeline.scenes.map((s: any) => ({
    id: s.id ?? `scene-${s.startFrame ?? 0}`,
    text: (s.narration ?? s.label ?? "").replace(/^\[.*?\]\s*/, "").trim(),
  }));
}

/**
 * Shared TTS execution: chunks → voice.wav + durations.json, mastered and copied
 * into public/ for Remotion. Returns the measured frames per chunk id and the
 * public audio ref.
 */
async function runTTSChunks(
  scenes: TtsChunk[],
  projectDir: string,
): Promise<{ frameMap: Record<string, number>; publicAudio: string }> {
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

  // Master narration before publishing it to Remotion.
  const voiceWav = path.join(ttsDir, "voice.wav");
  const masteredWav = path.join(ttsDir, "voice-mastered.wav");
  const audioReport = path.join(ttsDir, "audio-audit.json");
  const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path as string;
  execSync(`python scripts/master-audio.py --input "${voiceWav}" --output "${masteredWav}" --ffmpeg "${ffmpegPath}"`, {
    stdio: "inherit", cwd: process.cwd(),
  });
  execSync(`python scripts/audio-audit.py "${masteredWav}" --out "${audioReport}" --ffmpeg "${ffmpegPath}"`, {
    stdio: "inherit", cwd: process.cwd(),
  });
  const publicDir = path.join(process.cwd(), "public");
  const publicAudioDir = path.join(publicDir, "audio", path.basename(ttsDir));

  // Copy voice.wav to public/ so Remotion can access it
  fs.mkdirSync(publicAudioDir, { recursive: true });
  const publicVoiceWav = path.join(publicAudioDir, "voice.wav");
  fs.copyFileSync(masteredWav, publicVoiceWav);

  // Timeline audio ref is relative to public/
  const publicAudio = `audio/${path.basename(ttsDir)}/voice.wav`;

  const totalFrames = Object.values(frameMap).reduce((sum, f) => sum + f, 0);
  console.log(`\n✅ TTS done: ${Object.keys(frameMap).length} chunks`);
  console.log(`   Total: ${totalFrames} frames (${(totalFrames / 30).toFixed(1)}s)`);
  console.log(`   Audio: ${voiceWav} (+ public/audio/...)`);
  console.log(`   Timeline ref: ${publicAudio}`);
  return { frameMap, publicAudio };
}

/**
 * Storyboard route. TTS is driven straight off the storyboard — no provisional
 * timeline is built first, so there is never an estimate-timed object in memory
 * or on disk for production to accidentally persist.
 */
async function generateTTSFromStoryboard(storyboard: Storyboard, projectDir: string): Promise<string> {
  const { publicAudio } = await runTTSChunks(ttsChunksFromStoryboard(storyboard), projectDir);
  return publicAudio;
}

/**
 * `--legacy-direct` route: the AI authored scenes directly, so there is no
 * storyboard to recompile from and durations are patched into the timeline in
 * place. Any scene TTS did not measure is fatal — keeping the AI's guess is the
 * second copy of the silent-fallback bug.
 */
async function generateTTSFromTimeline(timeline: any, projectDir: string): Promise<void> {
  const { frameMap, publicAudio } = await runTTSChunks(ttsChunksFromTimeline(timeline), projectDir);

  const unmeasured = timeline.scenes
    .map((s: any) => s.id ?? `scene-${s.startFrame ?? 0}`)
    .filter((id: string) => frameMap[id] === undefined);
  if (unmeasured.length) {
    throw new Error(
      `TTS measured no audio for ${unmeasured.length}/${timeline.scenes.length} scenes ` +
      `(${unmeasured.slice(0, 3).join(", ")}). Refusing to keep the authored estimate — ` +
      `the video would drift out of sync with the voice track.`
    );
  }

  let cursor = 0;
  for (const scene of timeline.scenes) {
    const sid = scene.id ?? `scene-${scene.startFrame ?? 0}`;
    scene.startFrame = cursor;
    scene.durationFrames = frameMap[sid];
    cursor += scene.durationFrames;
  }
  timeline.durationInFrames = cursor;
  timeline.audio = publicAudio;
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

  const projectDir = path.dirname(outPath);

  // Step 3: Generate timeline.
  // storyboard mode: transcript → Storyboard (AI) → scenes[] (deterministic compile).
  // classic mode:    transcript → scenes[] (AI writes scenes directly).
  let storyboard: any = null;
  let timeline: any;
  // True when scene boundaries came from word-count estimates rather than
  // measured audio. Such an artifact is written under a distinct name and is
  // refused downstream — it is a preview, not a production timeline.
  let estimatedTiming = false;
  if (storyboardMode) {
    fs.mkdirSync(projectDir, { recursive: true });
    storyboard = await generateStoryboard(transcript, durationSeconds, projectDir);
    if (audioInput && !ttsFlag) storyboard.audio = audioInput;
    let storyboardReport = runStoryboardCheck(storyboard);
    for (let repairAttempt = 0;
         repairAttempt < 2 && (storyboardReport.blockers > 0 || storyboardReport.majors > 0);
         repairAttempt++) {
      storyboard = await repairStoryboard(storyboard, transcript, projectDir, storyboardReport);
      storyboardReport = runStoryboardCheck(storyboard);
    }
    writeAssetRequestQueue(storyboard, projectDir);
    printQualityReport(storyboardReport);
    if (!args.includes("--diagnostic") && (storyboardReport.blockers > 0 || storyboardReport.majors > 0)) {
      fs.writeFileSync(path.join(projectDir, "storyboard.failed.json"), JSON.stringify(storyboard, null, 2));
      throw new Error("Storyboard failed production gate; use --diagnostic only to inspect invalid output.");
    }
    // The storyboard is the authored artifact and is always kept, even when the
    // run cannot produce a production timeline.
    fs.writeFileSync(path.join(projectDir, "storyboard.json"), JSON.stringify(storyboard, null, 2));
    console.log(`🎬 Storyboard: ${storyboard.scenes?.length ?? 0} briefs`);

    // TTS runs off the storyboard directly. There is deliberately NO provisional
    // pre-TTS compile: an estimate-timed timeline must never exist for production
    // to persist by accident.
    if (ttsFlag) {
      const publicAudio = await generateTTSFromStoryboard(storyboard, projectDir);
      runWordAlignment(projectDir, transcriptInput);
      const durations = readDurations(projectDir);
      const words = readWords(projectDir);
      // Strict: throws unless every scene boundary came from measured audio.
      timeline = compileStoryboard(storyboard, {
        durations, words, provenance: timingProvenanceInputs(projectDir, storyboard),
      });
      timeline.audio = publicAudio;
      console.log(`🎬 Compiled once with locked TTS timing${words ? " + word alignment" : " (approx beats)"}.`);
    } else {
      // No TTS. An external --audio file counts as measured only if the project
      // also supplies a durations manifest (or usable word alignment) to derive
      // scene boundaries from; otherwise this is a preview build.
      const durations = readDurations(projectDir);
      const words = readWords(projectDir);
      const provenance = timingProvenanceInputs(projectDir, storyboard);
      if ((durations?.length ?? 0) > 0 || (words?.length ?? 0) > 0) {
        // Supplied timing artifacts must be internally consistent. A mismatch is
        // stale/corrupt input, not permission to silently downgrade to estimates.
        timeline = compileStoryboard(storyboard, { durations, words, provenance });
      } else {
        timeline = compileStoryboard(storyboard, {
          provenance, allowEstimatedTiming: true,
        });
        estimatedTiming = true;
      }
      if (audioInput) timeline.audio = audioInput;
    }
  } else {
    timeline = await generateTimeline(transcript, durationSeconds);
    if (ttsFlag) {
      await generateTTSFromTimeline(timeline, projectDir);
    } else {
      // Legacy direct authoring with no TTS: every duration is the AI's guess.
      estimatedTiming = true;
      if (audioInput) timeline.audio = audioInput;
    }
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

  // NOTE: The persisted artifact is ALWAYS a SceneTimeline (`scenes[]`) — the
  // single authored format. scenes → events compilation is NOT done here; it
  // happens at exactly one shared point (src/engine/loadTimeline.ts) used by
  // both preview (Root.tsx) and render (scripts/render.ts). Never write events.
  const authored = timeline;

  // Step 6: Validate schema + quality check
  const validation = validateTimeline(authored);
  printValidationResult(validation, outPath);

  let qualityFailed = false;
  if (Array.isArray(authored.scenes)) {
    const qReport = runQualityCheck(authored, outPath);
    printQualityReport(qReport);
    qualityFailed = qReport.blockers > 0 || qReport.majors > 0 || !["A", "B"].includes(qReport.grade);
  }

  if (!validation.valid) {
    console.error("\n⚠️  Timeline có lỗi nhưng vẫn lưu để bạn xem xét...");
  }

  // Step 7: Save the SceneTimeline (loadTimeline compiles it at preview/render).
  // The canonical name is reserved for measured timing. An estimate-timed build
  // goes to `*.estimated.json` and is never registered as the project timeline,
  // so a later render or publish cannot pick it up by convention.
  const writePath = estimatedTiming
    ? outPath.replace(/\.json$/i, ".estimated.json")
    : outPath;
  fs.writeFileSync(writePath, JSON.stringify(authored, null, 2));
  if (projectInput && !estimatedTiming) {
    const manifestPath = path.join(projectDir, "project.json");
    const manifest: ProjectManifest = fs.existsSync(manifestPath)
      ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
      : createDefaultProjectManifest(path.basename(path.resolve(projectDir)));
    manifest.transcriptPath = path.relative(projectDir, transcriptInput ?? path.join(projectDir, "transcript.txt")) || "transcript.txt";
    manifest.timelinePath = path.basename(writePath);
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }
  if (estimatedTiming) {
    console.warn(
      `\n⚠️  TIMING_ESTIMATED — scene boundaries came from word-count estimates, not audio.` +
      `\n   Saved as ${path.basename(writePath)} for preview only; render and publish will refuse it.` +
      `\n   Run with --tts-kokoro (or supply durations.json) to produce a production timeline.`
    );
  }
  console.log(`\n💾 Timeline đã lưu: ${writePath}`);
  console.log(`   Scenes: ${authored.scenes?.length ?? 0}`);
  console.log(`   Duration: ${authored.durationInFrames} frames`);

  if (!validation.valid || qualityFailed) {
    console.error(
      "\n❌ Artifact đã lưu để debug nhưng CHƯA production-ready. " +
      "Sửa storyboard/timeline cho tới khi schema hợp lệ và quality gate có 0 blocker, 0 major."
    );
    process.exitCode = 2;
    return;
  }

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
