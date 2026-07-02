/**
 * Patch timeline video-002 với cải tiến V2:
 * 1. Background events với illustrated gradients
 * 2. Tăng scale nhân vật (small → big)
 * 3. Speech bubbles cho dialogue scenes
 * 4. Text color trắng trên dark backgrounds
 */
const fs = require('fs');
const path = require('path');

const srcPath = path.resolve(__dirname, '../projects/video-002-rich-vs-poor/timeline.json');
const destPath = srcPath; // overwrite

const tl = JSON.parse(fs.readFileSync(srcPath, 'utf8'));

// ─── 1. BACKGROUND EVENTS ────────────────────────────────────────────────────
const bgEvents = [
  // Intro: warm cream (default - từ timeline.background)
  // Frame 290: phòng khách ấm - gia đình, bố mẹ so sánh con
  { frame: 290, type: "background", src: "linear-gradient(160deg, #FFF8E1 0%, #FFE0B2 100%)", duration: 25 },

  // Frame 1078: classroom neutral - trước khi nói về 3 stories
  { frame: 1078, type: "background", src: "linear-gradient(160deg, #E3F2FD 0%, #EDE7F6 100%)", duration: 25 },

  // Frame 2575: dark drama - STAT TỰ CHỦ
  { frame: 2575, type: "background", src: "linear-gradient(160deg, #1a1a2e 0%, #16213e 100%)", duration: 20 },

  // Frame 3235: calm educational - Dweck scene
  { frame: 3235, type: "background", src: "linear-gradient(160deg, #E8F5E9 0%, #F3E5F5 100%)", duration: 25 },

  // Frame 3925: dark drama - STAT KIÊN TRÌ
  { frame: 3925, type: "background", src: "linear-gradient(160deg, #1a1a2e 0%, #16213e 100%)", duration: 20 },

  // Frame 4105: work warm - Ericsson scene
  { frame: 4105, type: "background", src: "linear-gradient(160deg, #FFF3E0 0%, #FBE9E7 100%)", duration: 25 },

  // Frame 4795: dark drama - STAT TỰ ĐÁNH GIÁ
  { frame: 4795, type: "background", src: "linear-gradient(160deg, #1a1a2e 0%, #16213e 100%)", duration: 20 },

  // Frame 5035: white clean - 3 Formulas (icons trên nền trắng)
  { frame: 5035, type: "background", src: "#FFFFFF", duration: 20 },

  // Frame 5635: dramatic dark - TƯƠNG QUAN ≠ NHÂN QUẢ (big reveal)
  { frame: 5635, type: "background", src: "linear-gradient(160deg, #0d0d1a 0%, #1a0a0a 100%)", duration: 20 },

  // Frame 7135: neutral contrast - Rich vs Poor comparison
  { frame: 7135, type: "background", src: "#FAFAF8", duration: 25 },

  // Frame 8395: hope warm - Conclusion
  { frame: 8395, type: "background", src: "linear-gradient(160deg, #E8F5E9 0%, #F3E5F5 100%)", duration: 25 },
];

// ─── 2. SPEECH BUBBLES (replace CALLOUTs in dialogue scenes) ─────────────────
// Xóa CALLOUT text dùng làm speech và thêm speechBubble events thật
const textIdsToRemove = new Set(["callout_parents", "speech_growth", "speech_fixed"]);

const speechBubbleEvents = [
  // Scene 2: Cat dad nói
  {
    frame: 320, type: "speechBubble",
    bubbleId: "sb_dad",
    anchorAssetId: "cat_dad_sc2",
    text: "\"Con nhà người ta học giỏi lắm!\"",
    style: "speech", direction: "right",
    exitFrame: 700,
    fontSize: 24,
    background: "#FFF9C4",
    textColor: "#1a1a1a"
  },
  // Scene 2: Cat mom phản hồi
  {
    frame: 490, type: "speechBubble",
    bubbleId: "sb_mom",
    anchorAssetId: "cat_mom_sc2",
    text: "\"Nhà người ta khác nhà mình, con ơi!\"",
    style: "speech", direction: "left",
    exitFrame: 1080,
    fontSize: 22,
    background: "#FCE4EC",
    textColor: "#1a1a1a"
  },
  // Dweck: cat_growth (growth mindset)
  {
    frame: 3275, type: "speechBubble",
    bubbleId: "sb_growth",
    anchorAssetId: "cat_growth",
    text: "\"Mình chưa làm đúng cách — lần sau nghiên cứu lại!\"",
    style: "speech", direction: "right",
    exitFrame: 3600,
    fontSize: 22,
    background: "#E8F5E9",
    textColor: "#1a5e1a"
  },
  // Dweck: cat_fixed (fixed mindset)
  {
    frame: 3600, type: "speechBubble",
    bubbleId: "sb_fixed",
    anchorAssetId: "cat_fixed",
    text: "\"Mình không có khiếu. Thôi bỏ đi!\"",
    style: "speech", direction: "left",
    exitFrame: 3930,
    fontSize: 22,
    background: "#FFEBEE",
    textColor: "#7f0000"
  },
];

// ─── 3. SCALE PATCHES ────────────────────────────────────────────────────────
const scalePatches = {
  // Dialogue characters → scale up to fill scene
  "cat_dad_sc2": { scale: 1.75, position: { x: 0.28, y: 0.52 } },
  "cat_mom_sc2": { scale: 1.75, position: { x: 0.72, y: 0.52 } },
  // Marshmallow scene
  "cat_child_sc4": { scale: 2.0, position: { x: 0.33, y: 0.52 } },
  "marshmallow_sc4": { scale: 1.7, position: { x: 0.70, y: 0.46 } },
  // STAT cats (they appear at y:0.72, scale:1.0 — too small, too low)
  "cat_main_5": { scale: 1.6, position: { x: 0.5, y: 0.64 } },
  "cat_main_7": { scale: 1.6, position: { x: 0.5, y: 0.64 } },
  "cat_main_9": { scale: 1.6, position: { x: 0.5, y: 0.64 } },
  "cat_drama":  { scale: 1.6, position: { x: 0.5, y: 0.64 } },
  // Dweck dialogue
  "cat_growth": { scale: 1.75, position: { x: 0.26, y: 0.52 } },
  "cat_fixed":  { scale: 1.75, position: { x: 0.74, y: 0.52 } },
  // Ericsson worker
  "cat_worker_sc8": { scale: 1.85, position: { x: 0.35, y: 0.52 } },
  // Icons (3 formulas) — keep scale 1.0 but they're fine
  // cat_question — tiny cat below icons, increase a bit
  "cat_question": { scale: 1.1, position: { x: 0.5, y: 0.78 } },
  // Rich vs Poor comparison
  "cat_rich": { scale: 1.85, position: { x: 0.22, y: 0.52 } },
  "cat_poor": { scale: 1.85, position: { x: 0.78, y: 0.52 } },
  // Final cat — already 1.6, good
};

// ─── 4. TEXT COLOR WHITE for dark background scenes ──────────────────────────
// Dark scenes: frames 2575-3235, 3925-4105, 4795-5035, 5635-7135
const darkRanges = [
  [2575, 3235],
  [3925, 4105],
  [4795, 5035],
  [5635, 7135],
];
function isInDark(frame) {
  return darkRanges.some(([start, end]) => frame >= start && frame < end);
}

// ─── APPLY PATCHES ───────────────────────────────────────────────────────────
let events = tl.events;

// Remove replaced callout texts
events = events.filter(e => {
  if (e.type === 'text' && textIdsToRemove.has(e.textId)) return false;
  return true;
});

// Apply scale patches
events = events.map(e => {
  if (e.type === 'enter' && scalePatches[e.assetId]) {
    const patch = scalePatches[e.assetId];
    return { ...e, scale: patch.scale, position: patch.position };
  }
  return e;
});

// Apply text color for dark scenes
events = events.map(e => {
  if (e.type === 'text' && isInDark(e.frame)) {
    // STAT stays as-is (red, dramatic)
    if (e.style === 'STAT') return e;
    // SECTION header → white
    if (e.style === 'SECTION') return { ...e, color: '#FFFFFF' };
    // BODY → light gray/white
    if (e.style === 'BODY') return { ...e, color: '#E0E0E0' };
    // CAPTION → gray
    if (e.style === 'CAPTION') return { ...e, color: '#B0BEC5' };
  }
  return e;
});

// Add all new events
events = [...events, ...bgEvents, ...speechBubbleEvents];

// Sort by frame
events.sort((a, b) => a.frame - b.frame || 0);

tl.events = events;

fs.writeFileSync(destPath, JSON.stringify(tl, null, 2), 'utf8');

// Verify
console.log('✅ Timeline patched!');
console.log(`Total events: ${tl.events.length}`);
console.log(`Background events: ${tl.events.filter(e => e.type === 'background').length}`);
console.log(`SpeechBubble events: ${tl.events.filter(e => e.type === 'speechBubble').length}`);
console.log(`Duration: ${(tl.durationInFrames / tl.fps).toFixed(1)}s`);
