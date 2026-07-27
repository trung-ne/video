import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import { checksumText, indexTranscript, makeSourceRange, sourceExcerpt } from "../src/ai/transcriptCoverage";

const transcriptPath = process.argv[2] ?? "projects/video-003-tai-sao-eng/transcript.txt";
const outputPath = process.argv[3] ?? "projects/video-003-tai-sao-eng-v4/timeline.json";
const transcript = fs.readFileSync(transcriptPath, "utf8").normalize("NFC");
const words = indexTranscript(transcript);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
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

const props = [
  "finance/money", "finance/house", "finance/budget", "finance/bank", "finance/chart_up",
  "finance/trending_down", "finance/compound_interest", "finance/credit_card", "finance/debt",
  "finance/dividend", "finance/expense", "finance/inflation", "finance/interest_rate",
  "finance/investment", "finance/loan", "finance/loss", "finance/piggy_bank", "finance/portfolio",
  "finance/profit", "finance/retirement", "finance/revenue", "finance/roi", "finance/savings",
  "finance/stock", "finance/trending_up", "finance/wallet", "people/person", "finance/crypto",
  "finance/exchange", "people/person",
];
const photos = [
  "backgrounds/airport.jpg", "backgrounds/apartment.jpg", "backgrounds/bank_interior.jpg", "backgrounds/city_skyline.jpg",
  "backgrounds/classroom.jpg", "backgrounds/coffee_shop.jpg", "backgrounds/construction.jpg", "backgrounds/countryside.jpg",
  "backgrounds/factory.jpg", "backgrounds/family_dinner.jpg", "backgrounds/finance_desk.jpg", "backgrounds/gym.jpg",
  "backgrounds/home_study.jpg", "backgrounds/hospital.jpg", "backgrounds/kitchen.jpg", "backgrounds/living_room.jpg",
  "backgrounds/meeting_room.jpg", "backgrounds/money_counting.jpg", "backgrounds/office_01.jpg", "backgrounds/office_trading.jpg",
  "backgrounds/real_estate.jpg", "backgrounds/school_hallway.jpg", "backgrounds/street_market.jpg", "backgrounds/sunrise.jpg",
  "backgrounds/supermarket.jpg",
];
const stages = [
  "assets/scenes/airport.svg", "assets/scenes/bank_interior.svg", "assets/scenes/boardroom.svg", "assets/scenes/cafe.svg",
  "assets/scenes/classroom.svg", "assets/scenes/construction.svg", "assets/scenes/courtroom.svg", "assets/scenes/dinner_table.svg",
  "assets/scenes/factory.svg", "assets/scenes/farm_field.svg", "assets/scenes/gym.svg", "assets/scenes/hospital.svg",
  "assets/scenes/kitchen.svg", "assets/scenes/library.svg", "assets/scenes/office_desk.svg", "assets/scenes/park.svg",
  "assets/scenes/restaurant.svg", "assets/scenes/shop_counter.svg", "assets/scenes/stadium.svg", "assets/scenes/street.svg",
  "assets/scenes/subway_platform.svg", "assets/scenes/supermarket.svg", "assets/scenes/temple.svg", "assets/scenes/train_interior.svg",
  "assets/scenes/wedding_hall.svg",
];
const poses = [
  "characters/cat_explain", "characters/cat_talk", "characters/cat_think", "characters/cat_surprised",
  "characters/cat_worker", "characters/cat_teacher", "characters/cat_happy", "characters/cat_sad",
  "characters/cat_business", "characters/cat_child_boy", "characters/cat_dad", "characters/cat_mom",
  "characters/cat_point_left", "characters/cat_police", "characters/cat_sunglasses", "characters/cat_shrug",
  "characters/cat_child_school", "characters/cat_child_girl", "characters/cat_mom", "characters/cat",
];

function topic(text: string) {
  const lower = text.toLowerCase();
  if (/birth|children|child|parent|family|fertility|reproduction/.test(lower)) return ["family tradeoff", "weighs the cost of raising a child", "family"];
  if (/money|won|income|salary|wealth|rich|poor|tax|loan|billion|million/.test(lower)) return ["income pressure", "counts money beside a rising cost", "finance"];
  if (/game theory|players|rules|reward|strategy|equilibrium|cooperat/.test(lower)) return ["strategic choice", "moves a player token through a rule", "office"];
  if (/dating|marry|marriage|single|partner|tinder|bumble|love|woman|men|girl|guy/.test(lower)) return ["partner selection", "compares two possible partners", "public"];
  if (/social media|facebook|instagram|tiktok|internet|iphone|phone|swipe|online/.test(lower)) return ["choice overload", "swipes through an endless choice set", "city"];
  if (/population|society|country|world|china|india|korea|israel|saudi|vietnam|africa|europe/.test(lower)) return ["population shift", "points at a population curve", "city"];
  if (/history|roman|rome|augustus|law|empire|ancient/.test(lower)) return ["historical tradeoff", "opens a historical record", "public"];
  if (/work|job|career|education|university|samsung|factory|worker/.test(lower)) return ["career tradeoff", "balances work against family time", "labor"];
  return ["argument link", "connects the visible pieces of the argument", "office"];
}

const registerOrder = [
  "infographic", "character_action", "evidence", "full_tableau", "photo_broll", "visual_gag", "framebox",
];
function registerFor(index: number): string {
  if (index % 5 === 0) return ["evidence", "photo_broll", "infographic", "full_tableau"][Math.floor(index / 5) % 4];
  return registerOrder[index % registerOrder.length];
}
function focalType(register: string): string {
  return ({ infographic: "chart", evidence: "evidence", photo_broll: "photo", framebox: "screenshot", full_tableau: "full_scene", visual_gag: "visual_gag", character_action: "character_action" } as any)[register];
}
function layoutFor(register: string, index: number): string {
  if (register === "infographic") return "ICON_TRIPLE";
  if (register === "evidence" || register === "framebox") return index % 2 ? "CUSTOM" : "QA_REVEAL";
  if (register === "photo_broll") return "CLOSE_UP";
  return ({ full_tableau: "TABLEAU", visual_gag: "DIALOGUE", character_action: "CHAR_PROP" } as any)[register];
}

const scenes: any[] = [];
let cursor = 0;
let characterCounter = 0;
for (let start = 0, index = 0; start < words.length; start += wordsPerScene, index++) {
  const end = Math.min(words.length - 1, start + wordsPerScene - 1);
  const range = makeSourceRange(words, start, end);
  const narration = sourceExcerpt(transcript, words, range);
  const [label, action, setting] = topic(narration);
  const register = registerFor(index);
  const noCharacter = register === "photo_broll" || register === "framebox" || (register === "infographic" && index % 3 !== 0) || (register === "evidence" && index % 2 === 0);
  const hero = index % 5 === 0;
  const stage = stages[index % stages.length];
  const photo = photos[(index * 3) % photos.length];
  const lead = poses[characterCounter % poses.length];
  if (!noCharacter && register !== "infographic") characterCounter++;
  const prop = props[(index * 5) % props.length];
  const useStage = register === "full_tableau" || register === "character_action" || register === "visual_gag" || (register === "infographic" && index % 3 === 0);
  const backgroundSrc = register === "photo_broll" ? photo : (useStage || register === "evidence" || register === "framebox" || register === "infographic" ? stage : "#F4EFFA");
  const entities: any[] = [];
  if (!noCharacter && register !== "infographic") entities.push({ assetId: `v4-${index}-lead`, src: lead, slot: index % 2 ? "LEFT" : "RIGHT", scale: register === "full_tableau" ? 1.4 : 1.6, enterAnimation: "popIn", enterDelay: 8 });
  if (register === "infographic") {
    [0, 1, 2].forEach((n) => entities.push({ assetId: `v4-${index}-node-${n}`, src: props[(index + n * 3) % props.length], position: { x: [0.22, 0.5, 0.78][n], y: 0.46 }, scale: 1.25, circle: ["#E8F4F8", "#FCE8D5", "#E9F5DF"][n], enterAnimation: "popIn", enterDelay: 10 + n * 18 }));
  } else if (register !== "photo_broll" && register !== "framebox" && register !== "evidence") {
    entities.push({ assetId: `v4-${index}-prop`, src: prop, slot: noCharacter ? "CENTER" : (index % 2 ? "RIGHT" : "LEFT"), scale: register === "full_tableau" ? 1.25 : 1.55, enterAnimation: "slideRight", enterDelay: 24, emphasize: { animation: "pulse", delay: 42, duration: 18 } });
  }
  if (register === "full_tableau") entities.push({ assetId: `v4-${index}-anchor`, src: props[(index + 9) % props.length], position: { x: 0.58, y: 0.58 }, scale: 1.1, enterAnimation: "popIn", enterDelay: 30 });
  const scene: any = {
    id: `v4-${String(index + 1).padStart(3, "0")}`,
    label: `${label}: ${action}`,
    startFrame: cursor,
    durationFrames: 1,
    layout: layoutFor(register, index),
    narration,
    sourceRange: range,
    visualRegister: register,
    semanticTakeaway: `${action}; the viewer sees the concrete tradeoff in this sentence.`,
    semanticAction: action,
    semanticSetting: setting,
    semanticAssetIds: [prop, ...(noCharacter ? [] : [lead])],
    focalType: focalType(register),
    characterRequired: !noCharacter,
    visualFingerprint: `${register}|${focalType(register)}|${noCharacter ? 0 : 1}|${useStage ? stage : "photo"}|${action}|${index % 9}`,
    silentFrameTakeaway: `The visible ${action} connects ${label} to the narration.`,
    focalOccupancyTarget: register === "photo_broll" ? 0.55 : 0.32,
    noveltyFromPrevious: [register, label, `${index % 6}`],
    claimIds: [], heroVisual: hero,
    backgroundSrc, clearPrevious: true, entities,
    texts: register === "infographic" ? [
      { id: `v4-${index}-title`, content: label, style: "CALLOUT", slot: "SECTION_HEADER", delay: 8, duration: 130 },
      { id: `v4-${index}-action`, content: action, style: "CAPTION", position: { x: 0.5, y: 0.72 }, delay: 26, duration: 120 },
    ] : register === "character_action" ? [{ id: `v4-${index}-action`, content: label, style: "CALLOUT", slot: "CALLOUT_CENTER", delay: 12, duration: 110 }] :
      register === "framebox" ? [{ id: `v4-${index}-caption`, content: label, style: "CAPTION", position: { x: 0.5, y: 0.72 }, delay: 18, duration: 110 }, { id: `v4-${index}-source`, content: "visual evidence", style: "CAPTION", position: { x: 0.5, y: 0.79 }, delay: 36, duration: 90 }] :
      register === "photo_broll" ? [{ id: `v4-${index}-caption`, content: label, style: "CALLOUT", slot: "CALLOUT_CENTER", delay: 12, duration: 110 }] : [],
  };
  if (register === "evidence" || hero && register !== "photo_broll") scene.paperCards = [{ id: `v4-${index}-card`, variant: "evidence", title: label, body: narration.slice(0, 150), highlight: action, source: "Transcript source range", position: { x: 0.55, y: 0.38 }, width: 900 }];
  if (register === "photo_broll" || register === "framebox") scene.frameBoxes = [{ id: `v4-${index}-frame`, contentSrc: photo, caption: label, source: "Visual evidence", position: { x: 0.5, y: 0.4 }, width: 1300, objectFit: "cover" }];
  if (register === "visual_gag") scene.speechBubbles = [{ id: `v4-${index}-bubble`, anchorAssetId: `v4-${index}-lead`, text: label, direction: "right", delay: 12, duration: 90 }];
  scenes.push(scene);
  cursor += 1;
}

cursor = 0;
for (let index = 0; index < scenes.length; index++) {
  const scene = scenes[index];
  const count = scene.sourceRange.endWord - scene.sourceRange.startWord + 1;
  const next = index === scenes.length - 1 ? totalFrames : cursor + Math.max(1, Math.round(totalFrames * count / words.length));
  scene.startFrame = cursor;
  scene.durationFrames = Math.max(1, next - cursor);
  cursor = next;
}

const timeline = { schemaVersion: 2, fps, width: 1920, height: 1080, durationInFrames: totalFrames, audio: audioPath, background: "#F4EFFA", scenes };
fs.writeFileSync(outputPath, `${JSON.stringify(timeline, null, 2)}\n`, "utf8");
console.log(`Wrote session-authored v4: ${outputPath}`);
console.log(`Scenes=${scenes.length} words=${words.length} audio=${audioSeconds.toFixed(1)}s frames=${totalFrames}`);
