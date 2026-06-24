/**
 * Generate cat pose variants SVG
 * 8 poses: explain, think, surprised, happy, sad, shrug, point_left, talk
 */
const fs = require('fs');
const path = require('path');

const OUT = path.resolve(__dirname, '../public/assets/characters');

// ─── Base parts ──────────────────────────────────────────────────────────────
const BASE_BODY = `
  <!-- Body -->
  <ellipse cx="80" cy="110" rx="38" ry="32" fill="#FFB347"/>
  <!-- Belly -->
  <ellipse cx="80" cy="112" rx="22" ry="18" fill="#FFD699"/>
  <!-- Tail -->
  <path d="M118 115 Q145 100 138 130" stroke="#FFB347" stroke-width="9" fill="none" stroke-linecap="round"/>
  <!-- Bottom paws -->
  <ellipse cx="55" cy="138" rx="14" ry="10" fill="#FFB347"/>
  <ellipse cx="105" cy="138" rx="14" ry="10" fill="#FFB347"/>`;

const BASE_HEAD = `
  <!-- Head -->
  <circle cx="80" cy="68" r="30" fill="#FFB347"/>
  <!-- Ears -->
  <polygon points="55,45 48,22 68,40" fill="#FFB347"/>
  <polygon points="105,45 112,22 92,40" fill="#FFB347"/>
  <!-- Inner ears -->
  <polygon points="56,43 51,28 66,40" fill="#FF8C69"/>
  <polygon points="104,43 109,28 94,40" fill="#FF8C69"/>
  <!-- Nose -->
  <ellipse cx="80" cy="76" rx="4" ry="3" fill="#FF8C69"/>
  <!-- Whiskers -->
  <line x1="48" y1="73" x2="68" y2="76" stroke="#666" stroke-width="1.2"/>
  <line x1="48" y1="79" x2="68" y2="79" stroke="#666" stroke-width="1.2"/>
  <line x1="92" y1="76" x2="112" y2="73" stroke="#666" stroke-width="1.2"/>
  <line x1="92" y1="79" x2="112" y2="79" stroke="#666" stroke-width="1.2"/>`;

// Eye variants
const EYES_NORMAL = `
  <ellipse cx="68" cy="65" rx="7" ry="8" fill="white"/>
  <ellipse cx="92" cy="65" rx="7" ry="8" fill="white"/>
  <circle cx="69" cy="66" r="4" fill="#333"/>
  <circle cx="93" cy="66" r="4" fill="#333"/>
  <circle cx="70" cy="64" r="1.5" fill="white"/>
  <circle cx="94" cy="64" r="1.5" fill="white"/>`;

const EYES_HAPPY = `
  <!-- Happy crescent eyes -->
  <path d="M61 65 Q68 57 75 65" stroke="#333" stroke-width="2.5" fill="none" stroke-linecap="round"/>
  <path d="M85 65 Q92 57 99 65" stroke="#333" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;

const EYES_SAD = `
  <!-- Sad eyes — drooping inner corners -->
  <ellipse cx="68" cy="66" rx="7" ry="7" fill="white"/>
  <ellipse cx="92" cy="66" rx="7" ry="7" fill="white"/>
  <circle cx="68" cy="67" r="4" fill="#333"/>
  <circle cx="92" cy="67" r="4" fill="#333"/>
  <circle cx="69" cy="65" r="1.5" fill="white"/>
  <circle cx="93" cy="65" r="1.5" fill="white"/>
  <!-- Droopy brows -->
  <path d="M60 57 Q68 61 76 58" stroke="#a06030" stroke-width="2" fill="none" stroke-linecap="round"/>
  <path d="M84 58 Q92 61 100 57" stroke="#a06030" stroke-width="2" fill="none" stroke-linecap="round"/>`;

const EYES_SURPRISED = `
  <!-- Surprised — large round eyes -->
  <ellipse cx="68" cy="64" rx="10" ry="11" fill="white"/>
  <ellipse cx="92" cy="64" rx="10" ry="11" fill="white"/>
  <circle cx="69" cy="65" r="6" fill="#333"/>
  <circle cx="93" cy="65" r="6" fill="#333"/>
  <circle cx="71" cy="63" r="2" fill="white"/>
  <circle cx="95" cy="63" r="2" fill="white"/>
  <!-- Raised brows -->
  <path d="M58 51 Q68 47 78 52" stroke="#a06030" stroke-width="2.2" fill="none" stroke-linecap="round"/>
  <path d="M82 52 Q92 47 102 51" stroke="#a06030" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;

const EYES_THINK = `
  <!-- Thinking — one eye slightly squinted, looking up-right -->
  <ellipse cx="68" cy="65" rx="7" ry="7" fill="white"/>
  <ellipse cx="92" cy="65" rx="7" ry="6" fill="white"/>
  <circle cx="70" cy="63" r="4" fill="#333"/>
  <circle cx="94" cy="63" r="4" fill="#333"/>
  <circle cx="71" cy="62" r="1.5" fill="white"/>
  <circle cx="95" cy="62" r="1.5" fill="white"/>
  <!-- Thinking brow (one raised) -->
  <path d="M84 56 Q92 53 100 57" stroke="#a06030" stroke-width="2" fill="none" stroke-linecap="round"/>`;

const EYES_SIDEWAYS = `
  <!-- Looking sideways (shrug) -->
  <ellipse cx="68" cy="65" rx="7" ry="8" fill="white"/>
  <ellipse cx="92" cy="65" rx="7" ry="8" fill="white"/>
  <circle cx="72" cy="66" r="4" fill="#333"/>
  <circle cx="96" cy="66" r="4" fill="#333"/>
  <circle cx="73" cy="64" r="1.5" fill="white"/>
  <circle cx="97" cy="64" r="1.5" fill="white"/>`;

// Mouth variants
const MOUTH_NORMAL = `<path d="M76 79 Q80 84 84 79" stroke="#333" stroke-width="1.5" fill="none"/>`;
const MOUTH_HAPPY = `
  <path d="M72 79 Q80 88 88 79" stroke="#333" stroke-width="2" fill="none"/>
  <path d="M72 79 Q80 88 88 79" stroke="none" fill="#FF8C69" opacity="0.4"/>`;
const MOUTH_SAD = `<path d="M76 83 Q80 78 84 83" stroke="#333" stroke-width="1.5" fill="none"/>`;
const MOUTH_SURPRISED = `
  <ellipse cx="80" cy="82" rx="6" ry="7" fill="#333"/>
  <ellipse cx="80" cy="82" rx="4" ry="5" fill="#FF8C69"/>`;
const MOUTH_TALK = `
  <path d="M73 79 Q80 86 87 79" stroke="#333" stroke-width="1.8" fill="none"/>
  <ellipse cx="80" cy="82" rx="5" ry="4" fill="#FF8C69" opacity="0.7"/>`;
const MOUTH_THINK = `<path d="M76 80 Q80 83 84 80" stroke="#333" stroke-width="1.5" fill="none"/>`;
const MOUTH_SHRUG = `<path d="M76 80 Q80 83 84 80" stroke="#333" stroke-width="1.5" fill="none"/>`;

// Arm variants
const ARMS_NONE = ``;

const ARMS_POINT_RIGHT = `
  <!-- Right arm pointing right -->
  <path d="M116 105 Q134 93 146 83" stroke="#FFB347" stroke-width="15" fill="none" stroke-linecap="round"/>
  <circle cx="145" cy="82" r="9" fill="#FFB347"/>
  <!-- Left arm relaxed down -->
  <path d="M44 108 Q36 118 34 128" stroke="#FFB347" stroke-width="14" fill="none" stroke-linecap="round"/>
  <circle cx="34" cy="129" r="8" fill="#FFB347"/>`;

const ARMS_POINT_LEFT = `
  <!-- Left arm pointing left -->
  <path d="M44 105 Q26 93 14 83" stroke="#FFB347" stroke-width="15" fill="none" stroke-linecap="round"/>
  <circle cx="15" cy="82" r="9" fill="#FFB347"/>
  <!-- Right arm relaxed -->
  <path d="M116 108 Q124 118 126 128" stroke="#FFB347" stroke-width="14" fill="none" stroke-linecap="round"/>
  <circle cx="126" cy="129" r="8" fill="#FFB347"/>`;

const ARMS_RAISED_HAPPY = `
  <!-- Both arms raised in celebration -->
  <path d="M44 105 Q28 82 30 64" stroke="#FFB347" stroke-width="14" fill="none" stroke-linecap="round"/>
  <circle cx="30" cy="62" r="9" fill="#FFB347"/>
  <path d="M116 105 Q132 82 130 64" stroke="#FFB347" stroke-width="14" fill="none" stroke-linecap="round"/>
  <circle cx="130" cy="62" r="9" fill="#FFB347"/>`;

const ARMS_THINK = `
  <!-- Right arm raised to chin -->
  <path d="M116 105 Q118 88 100 82" stroke="#FFB347" stroke-width="14" fill="none" stroke-linecap="round"/>
  <circle cx="99" cy="81" r="9" fill="#FFB347"/>
  <!-- Left arm relaxed -->
  <path d="M44 108 Q36 118 34 128" stroke="#FFB347" stroke-width="14" fill="none" stroke-linecap="round"/>
  <circle cx="34" cy="129" r="8" fill="#FFB347"/>`;

const ARMS_SHRUG = `
  <!-- Both arms spread wide (shrug) -->
  <path d="M44 108 Q22 100 10 97" stroke="#FFB347" stroke-width="14" fill="none" stroke-linecap="round"/>
  <circle cx="9" cy="96" r="9" fill="#FFB347"/>
  <path d="M116 108 Q138 100 150 97" stroke="#FFB347" stroke-width="14" fill="none" stroke-linecap="round"/>
  <circle cx="151" cy="96" r="9" fill="#FFB347"/>`;

const ARMS_SAD = `
  <!-- Both arms drooping down sadly -->
  <path d="M44 108 Q32 122 28 135" stroke="#FFB347" stroke-width="14" fill="none" stroke-linecap="round"/>
  <circle cx="27" cy="136" r="8" fill="#FFB347"/>
  <path d="M116 108 Q128 122 132 135" stroke="#FFB347" stroke-width="14" fill="none" stroke-linecap="round"/>
  <circle cx="133" cy="136" r="8" fill="#FFB347"/>`;

const ARMS_TALK = `
  <!-- Right arm slightly raised — gesturing while talking -->
  <path d="M116 105 Q128 96 130 85" stroke="#FFB347" stroke-width="14" fill="none" stroke-linecap="round"/>
  <circle cx="130" cy="84" r="8" fill="#FFB347"/>
  <!-- Left arm relaxed -->
  <path d="M44 108 Q36 118 34 128" stroke="#FFB347" stroke-width="14" fill="none" stroke-linecap="round"/>
  <circle cx="34" cy="129" r="8" fill="#FFB347"/>`;

// ─── Build SVG ────────────────────────────────────────────────────────────────
function buildSVG(eyes, mouth, arms, comment) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="160" height="160">
  <!-- ${comment} -->
  ${BASE_BODY}
  ${arms}
  ${BASE_HEAD}
  ${eyes}
  ${mouth}
</svg>`;
}

// ─── Pose definitions ─────────────────────────────────────────────────────────
const poses = [
  {
    file: 'cat_explain.svg',
    comment: 'Explaining / narrating — pointing right',
    eyes: EYES_NORMAL,
    mouth: MOUTH_NORMAL,
    arms: ARMS_POINT_RIGHT,
  },
  {
    file: 'cat_think.svg',
    comment: 'Thinking — paw on chin, looking up',
    eyes: EYES_THINK,
    mouth: MOUTH_THINK,
    arms: ARMS_THINK,
  },
  {
    file: 'cat_surprised.svg',
    comment: 'Surprised / shocked — big eyes, O mouth',
    eyes: EYES_SURPRISED,
    mouth: MOUTH_SURPRISED,
    arms: ARMS_RAISED_HAPPY,
  },
  {
    file: 'cat_happy.svg',
    comment: 'Happy / celebrating — crescent eyes, arms up',
    eyes: EYES_HAPPY,
    mouth: MOUTH_HAPPY,
    arms: ARMS_RAISED_HAPPY,
  },
  {
    file: 'cat_sad.svg',
    comment: 'Sad / concerned — droopy eyes, frown, arms down',
    eyes: EYES_SAD,
    mouth: MOUTH_SAD,
    arms: ARMS_SAD,
  },
  {
    file: 'cat_shrug.svg',
    comment: 'Shrug / I don\'t know — arms spread, sideways eyes',
    eyes: EYES_SIDEWAYS,
    mouth: MOUTH_SHRUG,
    arms: ARMS_SHRUG,
  },
  {
    file: 'cat_point_left.svg',
    comment: 'Pointing left — for referencing left side of screen',
    eyes: EYES_NORMAL,
    mouth: MOUTH_NORMAL,
    arms: ARMS_POINT_LEFT,
  },
  {
    file: 'cat_talk.svg',
    comment: 'Talking / dialogue — open mouth, gesturing',
    eyes: EYES_NORMAL,
    mouth: MOUTH_TALK,
    arms: ARMS_TALK,
  },
];

// ─── Write files ──────────────────────────────────────────────────────────────
for (const pose of poses) {
  const svg = buildSVG(pose.eyes, pose.mouth, pose.arms, pose.comment);
  const outPath = path.join(OUT, pose.file);
  fs.writeFileSync(outPath, svg, 'utf8');
  console.log(`✅ ${pose.file}`);
}

console.log(`\n🎨 ${poses.length} cat poses created in public/assets/characters/`);
console.log('\nPose reference:');
console.log('  cat_explain    → giải thích, chỉ tay phải (narrating)');
console.log('  cat_think      → suy nghĩ, tay chạm cằm');
console.log('  cat_surprised  → ngạc nhiên, mắt to, tay giơ lên');
console.log('  cat_happy      → vui mừng, mắt cong, tay giơ cao');
console.log('  cat_sad        → buồn, mắt rủ, tay buông xuống');
console.log('  cat_shrug      → không biết, tay dang rộng');
console.log('  cat_point_left → chỉ tay trái');
console.log('  cat_talk       → đang nói, miệng mở');
