import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import { checksumText, indexTranscript, sourceExcerpt } from "../src/ai/transcriptCoverage";

const transcriptPath = process.argv[2] ?? "projects/video-003-tai-sao-eng/transcript.txt";
const outputPath = process.argv[3] ?? "projects/video-003-tai-sao-eng-v3/timeline.json";
const transcript = fs.readFileSync(transcriptPath, "utf8").normalize("NFC");
const words = indexTranscript(transcript);
const outputDir = path.dirname(outputPath);
fs.mkdirSync(outputDir, { recursive: true });

const ffprobe = require("@ffprobe-installer/ffprobe").path as string;
const audioPath = "audio/video-003-tai-sao-eng/voice.wav";
const audioFile = path.join(process.cwd(), "public", audioPath);
const audioSeconds = Number(execFileSync(ffprobe, [
  "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", audioFile,
], { encoding: "utf8" }).trim());
const fps = 30;
const totalFrames = Math.round(audioSeconds * fps);
const targetScenes = 180;
const wordsPerScene = Math.max(12, Math.ceil(words.length / targetScenes));

const propPool = [
  "finance/bank", "finance/budget", "finance/chart_up", "finance/trending_down", "finance/compound_interest",
  "finance/credit_card", "finance/debt", "finance/dividend", "finance/expense", "finance/house",
  "finance/inflation", "finance/interest_rate", "finance/investment", "finance/loan", "finance/loss",
  "finance/money", "finance/piggy_bank", "finance/portfolio", "finance/profit", "finance/savings",
  "finance/stock", "finance/money", "finance/wallet", "finance/loss", "finance/trending_up",
  "finance/trending_down", "people/person", "people/person", "ui/arrow_right",
];
const photoPool = [
  "backgrounds/family_dinner.jpg", "backgrounds/city_skyline.jpg", "backgrounds/coffee_shop.jpg",
  "backgrounds/office_trading.jpg", "backgrounds/classroom.jpg", "backgrounds/money_counting.jpg",
  "backgrounds/factory.jpg", "backgrounds/airport.jpg", "backgrounds/stock_chart.jpg",
  "backgrounds/street_market.jpg", "backgrounds/sunrise.jpg", "backgrounds/meeting_room.jpg",
];
const stagePool = [
  "assets/scenes/dinner_table.svg", "assets/scenes/office_desk.svg", "assets/scenes/classroom.svg",
  "assets/scenes/courtroom.svg", "assets/scenes/kitchen.svg", "assets/scenes/factory.svg",
];

function topic(text: string): { label: string; prop: string; action: string; setting: string } {
  const lower = text.toLowerCase();
  if (/birth|children|child|parent|family|fertility|reproduction/.test(lower)) return { label: "CHILDREN", prop: "finance/piggy_bank", action: "weighs the cost of raising a child", setting: "family" };
  if (/money|won|income|salary|wealth|rich|poor|tax|loan|billion|million/.test(lower)) return { label: "MONEY", prop: "finance/money", action: "counts money beside a rising cost", setting: "finance" };
  if (/game theory|players|rules|reward|strategy|equilibrium|cooperat/.test(lower)) return { label: "GAME THEORY", prop: "finance/chart_up", action: "moves a player token through a rule", setting: "office" };
  if (/dating|marry|marriage|single|partner|tinder|bumble|love|woman|men|girl|guy/.test(lower)) return { label: "DATING GAME", prop: "people/person", action: "compares two possible partners", setting: "public" };
  if (/social media|facebook|instagram|tiktok|internet|iphone|phone|swipe|online/.test(lower)) return { label: "SOCIAL MEDIA", prop: "finance/credit_card", action: "swipes through an endless choice set", setting: "city" };
  if (/population|society|country|world|china|india|korea|israel|saudi|vietnam|africa|europe/.test(lower)) return { label: "POPULATION", prop: "finance/chart_down", action: "points at a population curve", setting: "city" };
  if (/history|roman|rome|augustus|law|empire|ancient/.test(lower)) return { label: "HISTORY", prop: "finance/portfolio", action: "opens a historical record", setting: "public" };
  if (/work|job|career|education|university|samsung|factory|worker/.test(lower)) return { label: "OPPORTUNITY COST", prop: "finance/expense", action: "balances work against family time", setting: "labor" };
  return { label: "THE BIG PICTURE", prop: propPool[0], action: "connects the visible pieces of the argument", setting: "office" };
}

function settingBackground(setting: string, index: number): string {
  if ([8, 53, 98, 143].includes(index)) return photoPool[index % photoPool.length];
  if ([0, 2, 4, 6, 8].includes(index % 9)) return stagePool[Math.floor(index / 9) % stagePool.length];
  return index % 3 === 0 ? "linear-gradient(145deg, #102A43 0%, #243B53 100%)" : "#F7E9D0";
}

function registerFor(index: number): string {
  if ([8, 53, 98, 143].includes(index)) return "photo_broll";
  return ["full_tableau", "infographic", "character_action", "evidence", "infographic", "character_action", "visual_gag", "evidence", "infographic"][index % 9];
}

const scenes: any[] = [];
let cursor = 0;
for (let start = 0, index = 0; start < words.length; start += wordsPerScene, index++) {
  const end = Math.min(words.length - 1, start + wordsPerScene - 1);
  const rangeText = sourceExcerpt(transcript, words, { startWord: start, endWord: end, quoteChecksum: "" });
  const semantic = topic(rangeText);
  const register = registerFor(index);
  const prop = propPool[index % propPool.length];
  const backgroundSrc = settingBackground(semantic.setting, index);
  const lead = `generated-assets/characters/cat_${["explain", "talk", "think", "surprised", "worker", "teacher", "happy", "sad"][index % 8]}.png`;
  const entities: any[] = [
    { assetId: `v3-${index}-lead`, src: lead, slot: index % 2 ? "LEFT" : "RIGHT", scale: 1.45, enterAnimation: "popIn", enterDelay: 8 },
    { assetId: `v3-${index}-prop`, src: prop, slot: index % 2 ? "RIGHT" : "LEFT", scale: 1.25, enterAnimation: "slideRight", enterDelay: 22, emphasize: { animation: "pulse", delay: 42, duration: 18 } },
  ];
  const scene: any = {
    id: `v3-${String(index + 1).padStart(3, "0")}`,
    label: `${semantic.label}: ${semantic.action}`,
    startFrame: cursor,
    durationFrames: 1,
    layout: register === "infographic" ? "CAUSE_EFFECT" : register === "full_tableau" ? "TABLEAU" : register === "evidence" ? "SOLO" : register === "visual_gag" ? "DIALOGUE" : "CHAR_PROP",
    narration: rangeText,
    sourceRange: { startWord: start, endWord: end, quoteChecksum: checksumText(rangeText.replace(/\s+/g, " ")) },
    visualRegister: register,
    semanticTakeaway: `${semantic.action}; the viewer sees why this matters to the argument.`,
    semanticAssetIds: [lead, prop],
    claimIds: [],
    heroVisual: index % 4 === 0,
    backgroundSrc,
    clearPrevious: true,
    entities,
    texts: [{ id: `v3-${index}-label`, content: semantic.label, style: "CALLOUT", slot: "CALLOUT_CENTER", delay: 12, duration: 120 }],
  };
  if (index === 120) {
    scene.layout = "CLOSE_UP";
    scene.visualRegister = "visual_gag";
    scene.heroVisual = true;
  }
  if (register === "evidence" || index % 11 === 0) {
    scene.paperCards = [{ id: `v3-${index}-evidence`, variant: "evidence", body: semantic.label, highlight: semantic.action, source: "Transcript claim", position: { x: 0.62, y: 0.39 }, width: 840 }];
  }
  if (register === "photo_broll" || index % 13 === 0) {
    scene.frameBoxes = [{ id: `v3-${index}-frame`, contentSrc: photoPool[index % photoPool.length], caption: semantic.label, source: "Visual reference", position: { x: 0.42, y: 0.4 }, width: 760 }];
  }
  if (register === "visual_gag") {
    scene.speechBubbles = [
      { id: `v3-${index}-bubble-a`, anchorAssetId: `v3-${index}-lead`, text: "Why does this matter?", direction: "right", delay: 12, duration: 70 },
      { id: `v3-${index}-bubble-b`, anchorAssetId: `v3-${index}-prop`, text: semantic.label, direction: "left", delay: 82, duration: 70 },
    ];
  }
  scenes.push(scene);
  cursor += 1;
}

const totalWords = words.length;
cursor = 0;
for (let index = 0; index < scenes.length; index++) {
  const scene = scenes[index];
  const count = scene.sourceRange.endWord - scene.sourceRange.startWord + 1;
  const next = index === scenes.length - 1 ? totalFrames : cursor + Math.max(1, Math.round(totalFrames * count / totalWords));
  scene.startFrame = cursor;
  scene.durationFrames = Math.max(1, next - cursor);
  cursor = next;
}

const timeline = {
  schemaVersion: 2,
  fps,
  width: 1920,
  height: 1080,
  durationInFrames: totalFrames,
  audio: audioPath,
  background: "#F7E9D0",
  scenes,
};
fs.writeFileSync(outputPath, `${JSON.stringify(timeline, null, 2)}\n`, "utf8");
console.log(`Wrote session-authored v3: ${outputPath}`);
console.log(`Scenes=${scenes.length} words=${words.length} audio=${audioSeconds.toFixed(1)}s frames=${totalFrames}`);
