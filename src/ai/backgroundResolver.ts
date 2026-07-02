import * as fs from "fs";
import * as path from "path";

// ============================================================
// backgroundResolver — real illustrated backgrounds
//
// The renderer (BackgroundLayer.tsx) already supports photo backgrounds:
// any backgroundSrc that is NOT a hex/rgb/gradient is treated as an image
// path under public/. The problem historically was that the AI only ever
// emitted flat `linear-gradient(...)` values — never a real scene image —
// so every video looked like flat ugly color washes.
//
// This module:
//   1. listAvailableBackgrounds()  — scan public/backgrounds for real files
//   2. resolveBackgroundForScene() — keyword → best matching real image
//   3. autoFixBackgrounds()        — post-process a SceneTimeline, replacing
//                                    lazy gradients with real scene images.
//
// Everything is deterministic (no API calls) so it runs cheaply inside the
// generation flow, after the timeline + audio are produced.
// ============================================================

const BG_DIR = path.join(process.cwd(), "public", "backgrounds");
const IMAGE_EXT = /\.(jpg|jpeg|png|webp)$/i;

/** Scan public/backgrounds and return background paths relative to public/ (e.g. "backgrounds/office_01.jpg"). */
export function listAvailableBackgrounds(): string[] {
  if (!fs.existsSync(BG_DIR)) return [];
  return fs
    .readdirSync(BG_DIR)
    .filter((f) => IMAGE_EXT.test(f))
    .map((f) => `backgrounds/${f}`)
    .sort();
}

/** A backgroundSrc value that is a CSS color / gradient rather than an image path. */
export function isCSSBackground(src: string): boolean {
  if (!src) return true;
  return (
    src.startsWith("#") ||
    src.startsWith("rgb") ||
    src.startsWith("linear-gradient") ||
    src.startsWith("radial-gradient")
  );
}

/** Does this backgroundSrc point at a real image file that exists on disk? */
export function backgroundImageExists(src: string): boolean {
  if (!src || isCSSBackground(src)) return false;
  const full = path.join(process.cwd(), "public", src);
  return fs.existsSync(full);
}

// ─── Keyword → background mapping (English + Vietnamese) ─────────
// Each entry maps a background *stem* (filename without extension) to the
// words that should select it. Scored by hit count, highest wins.
const BG_KEYWORDS: Record<string, string[]> = {
  office_01: ["office", "workplace", "work", "job", "career", "employee", "corporate", "văn phòng", "công sở", "đi làm", "nhân viên"],
  office_trading: ["trading", "trader", "stock market", "wall street", "investment", "portfolio", "giao dịch", "chứng khoán", "đầu tư"],
  meeting_room: ["meeting", "conference", "boardroom", "negotiation", "discuss", "team", "họp", "hội nghị", "thảo luận", "bàn bạc"],
  bank_interior: ["bank", "loan", "deposit", "interest rate", "mortgage", "ngân hàng", "vay", "gửi tiền", "lãi suất"],
  stock_chart: ["chart", "graph", "index", "market data", "stock chart", "biểu đồ", "chỉ số"],
  money_counting: ["cash", "counting money", "banknote", "salary", "wage", "income", "spend", "đếm tiền", "lương", "thu nhập", "chi tiêu", "tiền mặt"],
  finance_desk: ["finance", "budget", "accounting", "financial", "analyst", "tài chính", "ngân sách", "kế toán"],
  family_dinner: ["family dinner", "dinner", "family meal", "eating together", "household", "bữa ăn", "bữa tối", "gia đình quây quần"],
  living_room: ["living room", "home", "house", "family", "sofa", "at home", "phòng khách", "ở nhà", "gia đình", "nhà"],
  kitchen: ["kitchen", "cooking", "meal prep", "nhà bếp", "nấu ăn"],
  home_study: ["study", "reading", "learn at home", "homework", "research", "học ở nhà", "đọc sách", "nghiên cứu", "tự học"],
  classroom: ["classroom", "school", "teacher", "student", "education", "lesson", "lớp học", "trường", "giáo viên", "học sinh", "giáo dục"],
  library: ["library", "books", "knowledge", "archive", "thư viện", "sách", "kiến thức"],
  school_hallway: ["hallway", "corridor", "campus", "hành lang", "khuôn viên"],
  street_market: ["street market", "market", "food stall", "vendor", "chợ", "hàng rong", "quầy"],
  city_street: ["city street", "downtown", "pedestrian", "urban", "traffic", "phố", "đường phố", "đô thị", "giao thông"],
  supermarket: ["supermarket", "grocery", "shopping", "retail", "siêu thị", "mua sắm", "tạp hóa"],
  coffee_shop: ["coffee", "cafe", "chat", "casual talk", "date", "hangout", "cà phê", "quán", "tâm sự", "hẹn hò", "trò chuyện"],
  restaurant: ["restaurant", "dining", "dinner date", "eat out", "nhà hàng", "ăn ngoài", "hẹn hò ăn tối"],
  gym: ["gym", "fitness", "workout", "exercise", "health", "phòng gym", "tập luyện", "sức khỏe", "rèn luyện"],
  hospital: ["hospital", "clinic", "doctor", "medical", "health care", "bệnh viện", "bác sĩ", "y tế"],
  city_skyline: ["skyline", "dusk", "cityscape", "metropolis", "economy", "society", "toàn cảnh thành phố", "kinh tế", "xã hội"],
  sunrise: ["sunrise", "dawn", "hope", "new beginning", "future", "morning", "bình minh", "hy vọng", "khởi đầu", "tương lai"],
  countryside: ["countryside", "rural", "village", "farm", "nature", "field", "nông thôn", "quê", "làng", "đồng quê", "thiên nhiên"],
  apartment: ["apartment", "condo", "flat", "building", "chung cư", "căn hộ", "tòa nhà"],
  construction: ["construction", "building site", "crane", "develop", "xây dựng", "công trường"],
  real_estate: ["real estate", "property", "buy house", "housing", "bất động sản", "nhà đất", "mua nhà"],
  airport: ["airport", "travel", "flight", "migration", "emigrate", "abroad", "sân bay", "du lịch", "di cư", "nước ngoài"],
  factory: ["factory", "manufacturing", "industry", "production", "labor", "worker", "nhà máy", "sản xuất", "công nghiệp", "lao động"],
};

// Layout-based fallback when no keyword matches but the scene still wants a
// real illustrated environment (narrative scenes, not abstract ones).
const LAYOUT_DEFAULT_BG: Record<string, string> = {
  SOLO: "living_room",
  INTRO: "living_room",
  DIALOGUE: "coffee_shop",
  DUAL_CONTRAST: "city_street",
  CHAR_PROP: "home_study",
  LINEUP: "city_street",
  QA_REVEAL: "living_room",
  STORY_SCENE: "restaurant",
};

// Layouts where a flat gradient / white background is legitimately correct —
// abstract "focus" moments the real channel also renders on plain backdrops.
// We do NOT force an image on these.
const ABSTRACT_LAYOUTS = new Set([
  "STAT_DRAMA",
  "STAT",
  "ICON_TRIPLE",
  "CLOSE_UP",
  "SIZE_HIERARCHY",
]);

function sceneKeywordHaystack(scene: any): string {
  const parts: string[] = [];
  if (scene.label) parts.push(scene.label);
  if (scene.narration) parts.push(scene.narration);
  if (Array.isArray(scene.texts)) {
    for (const t of scene.texts) if (t?.content) parts.push(t.content);
  }
  if (scene.id) parts.push(String(scene.id).replace(/_/g, " "));
  return parts.join(" ").toLowerCase();
}

/**
 * Pick the best real background image for a scene by keyword scoring.
 * Returns a path relative to public/ (e.g. "backgrounds/office_01.jpg"),
 * or null if the scene should keep its abstract (gradient/white) background.
 */
export function resolveBackgroundForScene(
  scene: any,
  available: string[]
): string | null {
  if (available.length === 0) return null;

  const availStems = new Set(available.map((p) => path.basename(p).replace(IMAGE_EXT, "")));
  const stemToPath = (stem: string) =>
    available.find((p) => path.basename(p).replace(IMAGE_EXT, "") === stem) ?? null;

  const hay = sceneKeywordHaystack(scene);

  // Score every available background by keyword hits.
  let best: { stem: string; score: number } | null = null;
  for (const [stem, kws] of Object.entries(BG_KEYWORDS)) {
    if (!availStems.has(stem)) continue;
    let score = 0;
    for (const kw of kws) {
      if (hay.includes(kw.toLowerCase())) score += kw.includes(" ") ? 2 : 1; // phrase match weighs more
    }
    if (score > 0 && (!best || score > best.score)) best = { stem, score };
  }

  if (best) return stemToPath(best.stem);

  // No keyword hit. V4: a clean white/gradient backdrop with a big expressive
  // character is the channel's default look — do NOT force a photo wallpaper.
  // The layout fallback only serves broken-image repair (see autoFixBackgrounds).
  if (ABSTRACT_LAYOUTS.has(scene.layout)) return null;
  const fallbackStem = LAYOUT_DEFAULT_BG[scene.layout] ?? "living_room";
  return stemToPath(fallbackStem) ?? (available.length ? available[0] : null);
}

export interface BackgroundFixReport {
  total: number;
  imagesBefore: number;
  imagesAfter: number;
  changed: { sceneId: string; from: string; to: string }[];
  distinctImages: number;
}

/**
 * Post-process a SceneTimeline in place. V4 semantics: clean white/gradient
 * backdrops are the channel's default look and are always respected — the only
 * thing repaired is a backgroundSrc that points at a missing image file.
 */
export function autoFixBackgrounds(timeline: any): BackgroundFixReport {
  const available = listAvailableBackgrounds();
  const changed: BackgroundFixReport["changed"] = [];
  const scenes: any[] = Array.isArray(timeline?.scenes) ? timeline.scenes : [];

  const countImages = () =>
    scenes.filter((s) => s.backgroundSrc && backgroundImageExists(s.backgroundSrc)).length;

  const imagesBefore = countImages();

  for (const scene of scenes) {
    const cur: string = scene.backgroundSrc ?? "";

    // A real, existing image → already good, leave it.
    if (cur && backgroundImageExists(cur)) continue;

    // A broken image path (not CSS, file missing) → always try to repair.
    const brokenImage = cur && !isCSSBackground(cur) && !backgroundImageExists(cur);

    // V4: white/gradient is the channel's DEFAULT look on every layout — a
    // deliberate clean backdrop must never be swapped for a photo wallpaper.
    // Only broken image paths get repaired.
    if (!brokenImage && isCSSBackground(cur)) continue;

    const resolved = resolveBackgroundForScene(scene, available);
    if (resolved && resolved !== cur) {
      changed.push({ sceneId: scene.id ?? "?", from: cur || "(none)", to: resolved });
      scene.backgroundSrc = resolved;
    }
  }

  const imagesAfter = countImages();
  const distinctImages = new Set(
    scenes
      .map((s) => s.backgroundSrc)
      .filter((s) => s && backgroundImageExists(s))
  ).size;

  return {
    total: scenes.length,
    imagesBefore,
    imagesAfter,
    changed,
    distinctImages,
  };
}

export function printBackgroundFixReport(r: BackgroundFixReport): void {
  console.log(`\n🖼️  Background auto-check:`);
  console.log(`   Scenes: ${r.total} | real-image bg: ${r.imagesBefore} → ${r.imagesAfter} (${r.distinctImages} distinct)`);
  if (r.changed.length === 0) {
    console.log(`   ✅ No fixes needed`);
  } else {
    for (const c of r.changed) {
      console.log(`   🔧 [${c.sceneId}] ${c.from}  →  ${c.to}`);
    }
  }
}
