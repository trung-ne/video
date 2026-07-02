import * as fs from "fs";
import * as path from "path";
import { Timeline, EnterEvent } from "../types/timeline";
import { SceneTimeline, SLOT_POSITIONS, TEXT_SLOT_POSITIONS } from "../types/scene";
import { isCSSBackground, backgroundImageExists } from "./backgroundResolver";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ─── Scene-level validation ──────────────────────────────────

export function validateSceneTimeline(input: any): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const assetsDir = path.join(process.cwd(), "public", "assets");

  if (!input || typeof input !== "object") {
    return { valid: false, errors: ["Input is not an object"], warnings: [] };
  }

  if (!Array.isArray(input.scenes)) {
    errors.push("scenes must be an array");
    return { valid: false, errors, warnings };
  }

  if (!input.durationInFrames || input.durationInFrames < 1) {
    errors.push("durationInFrames must be > 0");
  }

  const validLayouts = [
    // V3 layouts
    "SOLO", "DIALOGUE", "DUAL_CONTRAST", "SIZE_HIERARCHY", "CHAR_PROP",
    "ICON_TRIPLE", "QA_REVEAL", "LINEUP", "STAT_DRAMA", "CLOSE_UP",
    // Legacy layouts
    "INTRO", "SINGLE", "COMPARE", "CAUSE_EFFECT", "CAUSE_EFFECT_CHAIN",
    "ACCUMULATION", "STAT", "CONCLUSION", "CTA", "CUSTOM",
  ];
  const validSlots = Object.keys(SLOT_POSITIONS);
  const validTextSlots = Object.keys(TEXT_SLOT_POSITIONS);
  const validTextStyles = ["TITLE", "STAT", "CALLOUT", "SECTION", "BODY", "CAPTION", "SUBTITLE"];
  const validCameraActions = ["ZOOM_IN", "ZOOM_OUT", "FOCUS_ON", "RESET", "PAN_LR"];
  const validTransitionStyles = ["flash", "wipe", "fadeBlack", "fadeWhite", "zoom"];

  const seenSceneIds = new Set<string>();
  const seenTextIds = new Set<string>();
  const seenAssetIds = new Set<string>();
  const realBgImages = new Set<string>();
  let gradientBgCount = 0;

  let totalFrames = 0;

  for (let si = 0; si < input.scenes.length; si++) {
    const scene = input.scenes[si];
    const sp = `Scene[${si}] "${scene.id ?? "?"}":`;

    if (!scene.id) errors.push(`${sp} missing id`);
    else if (seenSceneIds.has(scene.id)) errors.push(`${sp} duplicate scene id "${scene.id}"`);
    else seenSceneIds.add(scene.id);

    if (typeof scene.startFrame !== "number") errors.push(`${sp} startFrame must be a number`);
    if (typeof scene.durationFrames !== "number" || scene.durationFrames < 1) {
      errors.push(`${sp} durationFrames must be > 0`);
    } else {
      totalFrames += scene.durationFrames;
    }

    if (!validLayouts.includes(scene.layout)) {
      errors.push(`${sp} invalid layout "${scene.layout}". Valid: ${validLayouts.join(", ")}`);
    }

    // Background sanity: track real images vs gradients, catch broken image paths
    if (scene.backgroundSrc) {
      const bg: string = scene.backgroundSrc;
      if (isCSSBackground(bg)) {
        gradientBgCount++;
      } else if (backgroundImageExists(bg)) {
        realBgImages.add(bg);
      } else {
        errors.push(`${sp} backgroundSrc image not found: public/${bg}`);
      }
    }

    if (!Array.isArray(scene.entities)) {
      errors.push(`${sp} entities must be an array`);
    } else {
      for (let ei = 0; ei < scene.entities.length; ei++) {
        const e = scene.entities[ei];
        const ep = `${sp} entity[${ei}]:`;

        if (!e.assetId) errors.push(`${ep} missing assetId`);
        if (!e.src) {
          errors.push(`${ep} missing src`);
        } else {
          const svgPath = path.join(assetsDir, `${e.src}.svg`);
          if (!fs.existsSync(svgPath)) {
            errors.push(`${ep} asset not found: public/assets/${e.src}.svg`);
          }
        }

        if (e.slot && !validSlots.includes(e.slot)) {
          warnings.push(`${ep} unknown slot "${e.slot}"`);
        }
        if (e.position) {
          if (typeof e.position.x !== "number" || e.position.x < 0 || e.position.x > 1) {
            warnings.push(`${ep} position.x out of [0,1]`);
          }
          if (typeof e.position.y !== "number" || e.position.y < 0 || e.position.y > 1) {
            warnings.push(`${ep} position.y out of [0,1]`);
          }
        }
      }
    }

    if (!Array.isArray(scene.texts)) {
      errors.push(`${sp} texts must be an array`);
    } else {
      if (scene.texts.length === 0) {
        warnings.push(`${sp} has no texts — screen will be empty`);
      }
      for (let ti = 0; ti < scene.texts.length; ti++) {
        const t = scene.texts[ti];
        const tp = `${sp} text[${ti}]:`;

        if (!t.id) errors.push(`${tp} missing id`);
        else if (seenTextIds.has(t.id)) errors.push(`${tp} duplicate textId "${t.id}"`);
        else seenTextIds.add(t.id);

        if (!t.content) errors.push(`${tp} missing content`);
        if (!validTextStyles.includes(t.style)) {
          errors.push(`${tp} invalid style "${t.style}". Valid: ${validTextStyles.join(", ")}`);
        }
        if (t.slot && !validTextSlots.includes(t.slot)) {
          warnings.push(`${tp} unknown text slot "${t.slot}"`);
        }
      }
    }

    if (scene.camera) {
      if (!validCameraActions.includes(scene.camera.action)) {
        warnings.push(`${sp} unknown camera action "${scene.camera.action}"`);
      }
    }

    if (scene.transition) {
      if (!validTransitionStyles.includes(scene.transition.style)) {
        warnings.push(`${sp} unknown transition style "${scene.transition.style}"`);
      }
    }
  }

  // ── V4 director checks ─────────────────────────────────────

  // Photo usage: V4 wants photos as deliberate punches (evidence / emotional
  // beat), not wallpaper. 0 photos loses those beats; >5 reads as wallpaper.
  if (input.scenes.length >= 5) {
    if (realBgImages.size === 0) {
      warnings.push(
        `V4: no real background image used. Consider 1-2 photo moments (evidence card / full-bleed emotional beat) — but keep white as the default backdrop.`
      );
    } else if (realBgImages.size > 5) {
      warnings.push(
        `V4: ${realBgImages.size} distinct photo backgrounds — photos are becoming wallpaper. Use 2-4 deliberate photo moments; default scenes should be white/light.`
      );
    }
  }

  // OPENING_DARK: the first 3 seconds must be bright and readable.
  const first = input.scenes[0];
  if (first) {
    if (first.transition && (first.transition.style === "fadeBlack" || first.transition.style === "fadeWhite")) {
      warnings.push(
        `OPENING_DARK: scene[0] uses ${first.transition.style} — the hook is buried. Compiler drops it, but prefer no transition on the opening scene.`
      );
    }
    const fb: string = first.backgroundSrc ?? "";
    const darkHexes = fb.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
    const looksDark =
      darkHexes.length > 0 &&
      darkHexes.every((h) => {
        const r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16);
        return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.35;
      });
    if (looksDark) {
      warnings.push(`OPENING_DARK: scene[0] background is dark ("${fb.slice(0, 50)}"). Open bright — viewers decide in the first 3 seconds.`);
    }
  }

  // SOLO_RATIO: >40% single-cat-center scenes = monotone staging.
  const soloLayouts = new Set(["SOLO", "CLOSE_UP", "SINGLE", "INTRO"]);
  const soloCount = input.scenes.filter((s: any) => soloLayouts.has(s.layout)).length;
  if (input.scenes.length >= 5 && soloCount / input.scenes.length > 0.4) {
    warnings.push(
      `SOLO_RATIO: ${soloCount}/${input.scenes.length} scenes are solo-character layouts (>40%). Mix in DIALOGUE, ICON_TRIPLE/QA_REVEAL, STAT_DRAMA or evidence paperCards.`
    );
  }
  if (input.scenes.length >= 6 && !input.scenes.some((s: any) => s.layout === "DIALOGUE")) {
    warnings.push(`No DIALOGUE scene — the reference channel teaches primarily through characters talking to each other.`);
  }

  // MONOTONE_CUTS: 3+ consecutive scenes with identical layout reads as static.
  let runLayout = "", runLen = 0;
  for (const s of input.scenes) {
    if (s.layout === runLayout) {
      runLen++;
      if (runLen === 3) {
        warnings.push(`MONOTONE_CUTS: 3+ consecutive "${runLayout}" scenes — vary the staging or at least pose/position between them.`);
      }
    } else {
      runLayout = s.layout;
      runLen = 1;
    }
  }

  // POSE_MONOTONY: the same happy pose everywhere kills emotional credibility.
  const happyScenes = input.scenes.filter((s: any) =>
    Array.isArray(s.entities) && s.entities.some((e: any) => typeof e.src === "string" && e.src.includes("cat_happy"))
  ).length;
  if (input.scenes.length >= 5 && happyScenes / input.scenes.length > 0.3) {
    warnings.push(
      `POSE_MONOTONY: cat_happy appears in ${happyScenes}/${input.scenes.length} scenes. Reserve it for genuinely positive beats; default to cat/cat_explain and match pose to each sentence.`
    );
  }

  // SUBTITLE_ZONE: overlay text in the subtitle band collides with captions.
  for (let si = 0; si < input.scenes.length; si++) {
    const scene = input.scenes[si];
    if (!scene.narration || scene.subtitle === false || !Array.isArray(scene.texts)) continue;
    for (const t of scene.texts) {
      const y = t.position?.y ?? (t.slot ? (TEXT_SLOT_POSITIONS as any)[t.slot]?.y : undefined);
      if (typeof y === "number" && y > 0.75 && t.style !== "SUBTITLE") {
        warnings.push(
          `SUBTITLE_ZONE: Scene[${si}] text "${t.id}" at y=${y} sits in the subtitle band (y>0.75). Compiler pushes it to y=0.72 — place it ≤0.72 yourself.`
        );
      }
    }
  }

  if (input.durationInFrames && Math.abs(totalFrames - input.durationInFrames) > 30) {
    warnings.push(
      `Sum of scene durationFrames (${totalFrames}) differs from durationInFrames (${input.durationInFrames}) by > 30 frames`
    );
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ─── Event-level validation (for compiled Timeline) ──────────

export function validateTimeline(timeline: any, assetDir?: string): ValidationResult {
  // If it's a SceneTimeline, validate at scene level instead
  if (Array.isArray(timeline?.scenes)) {
    return validateSceneTimeline(timeline);
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  if (!timeline || typeof timeline !== "object") {
    return { valid: false, errors: ["Timeline is not an object"], warnings: [] };
  }

  if (!timeline.fps || timeline.fps !== 30) {
    warnings.push(`fps should be 30, got: ${timeline.fps}`);
  }
  if (!timeline.durationInFrames || timeline.durationInFrames < 1) {
    errors.push("durationInFrames must be > 0");
  }
  if (!Array.isArray(timeline.events)) {
    errors.push("events must be an array");
    return { valid: false, errors, warnings };
  }

  const assetsDir = assetDir ?? path.join(process.cwd(), "public", "assets");
  const activeAssets = new Set<string>();
  const seenTextIds = new Set<string>();

  for (let i = 0; i < timeline.events.length; i++) {
    const event = timeline.events[i] as any;
    const prefix = `Event[${i}] frame=${event.frame}:`;

    if (typeof event.frame !== "number") {
      errors.push(`${prefix} frame must be a number`);
    }
    if (event.frame > timeline.durationInFrames) {
      errors.push(`${prefix} frame ${event.frame} exceeds durationInFrames ${timeline.durationInFrames}`);
    }

    switch (event.type) {
      case "enter": {
        if (!event.assetId) errors.push(`${prefix} enter event missing assetId`);
        if (!event.src) {
          errors.push(`${prefix} enter event missing src`);
        } else {
          const svgPath = path.join(assetsDir, `${event.src}.svg`);
          if (!fs.existsSync(svgPath)) {
            errors.push(`${prefix} asset not found: public/assets/${event.src}.svg`);
          }
        }
        if (!event.position || typeof event.position.x !== "number") {
          errors.push(`${prefix} enter event missing valid position`);
        } else {
          if (event.position.x < 0 || event.position.x > 1) {
            warnings.push(`${prefix} position.x ${event.position.x} is outside [0,1]`);
          }
          if (event.position.y < 0 || event.position.y > 1) {
            warnings.push(`${prefix} position.y ${event.position.y} is outside [0,1]`);
          }
        }
        activeAssets.add(event.assetId);
        break;
      }

      case "exit": {
        if (!event.assetId) errors.push(`${prefix} exit event missing assetId`);
        else if (!activeAssets.has(event.assetId)) {
          warnings.push(`${prefix} exit for assetId "${event.assetId}" that was never entered`);
        }
        activeAssets.delete(event.assetId);
        break;
      }

      case "move": {
        if (!event.assetId) errors.push(`${prefix} move event missing assetId`);
        else if (!activeAssets.has(event.assetId)) {
          warnings.push(`${prefix} move for assetId "${event.assetId}" that is not on canvas`);
        }
        if (!event.duration || event.duration < 1) {
          errors.push(`${prefix} move event duration must be > 0`);
        }
        break;
      }

      case "emphasize": {
        if (!event.assetId) errors.push(`${prefix} emphasize event missing assetId`);
        const validEm = ["pulse", "shake", "bounce", "highlight", "counter"];
        if (!validEm.includes(event.animation)) {
          errors.push(`${prefix} invalid emphasize animation "${event.animation}". Valid: ${validEm.join(", ")}`);
        }
        break;
      }

      case "camera": {
        if (typeof event.zoom !== "number") errors.push(`${prefix} camera zoom must be a number`);
        if (typeof event.centerX !== "number") errors.push(`${prefix} camera centerX must be a number`);
        if (typeof event.centerY !== "number") errors.push(`${prefix} camera centerY must be a number`);
        if (!event.duration) errors.push(`${prefix} camera event missing duration`);
        break;
      }

      case "text": {
        if (!event.textId) errors.push(`${prefix} text event missing textId`);
        if (!event.content) errors.push(`${prefix} text event missing content`);
        if (seenTextIds.has(event.textId)) {
          warnings.push(`${prefix} duplicate textId "${event.textId}"`);
        }
        seenTextIds.add(event.textId);
        break;
      }

      case "swap": {
        if (!event.assetId) errors.push(`${prefix} swap event missing assetId`);
        if (!event.src) errors.push(`${prefix} swap event missing src`);
        break;
      }

      case "clear":
      case "background":
      case "speechBubble":
      case "card":
      case "transition":
        break;

      default:
        warnings.push(`${prefix} unknown event type "${event.type}"`);
    }
  }

  if (activeAssets.size > 8) {
    warnings.push(`${activeAssets.size} assets never explicitly exited (hold-state is intentional, but >8 may be cluttered)`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function printValidationResult(result: ValidationResult, timelinePath: string) {
  if (result.errors.length > 0) {
    console.error(`\n❌ Validation FAILED (${timelinePath}):`);
    for (const e of result.errors) console.error(`   ERROR: ${e}`);
  } else {
    console.log(`\n✅ Validation passed: ${timelinePath}`);
  }
  if (result.warnings.length > 0) {
    for (const w of result.warnings) console.warn(`   WARN: ${w}`);
  }
}
