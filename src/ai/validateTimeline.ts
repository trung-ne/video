import * as fs from "fs";
import * as path from "path";
import { Timeline, EnterEvent } from "../types/timeline";
import { SceneTimeline, SLOT_POSITIONS, TEXT_SLOT_POSITIONS } from "../types/scene";
import { isCSSBackground, backgroundImageExists } from "./backgroundResolver";
import { STAGE_ANCHORS } from "../engine/stageAnchors";
import { resolveAssetSrc } from "../engine/assetPaths";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// Resolve through the same manifest alias map the renderer uses, so the gate
// validates the file that will actually be drawn (production art in
// generated-assets/…), not the retired public/assets/*.svg it used to assume.
function resolveAssetPath(src: string, _assetsDir: string): string {
  return path.join(process.cwd(), "public", resolveAssetSrc(src));
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
  if (input.schemaVersion !== undefined && ![1, 2].includes(input.schemaVersion)) {
    errors.push(`Unsupported schemaVersion ${input.schemaVersion}`);
  }

  const validLayouts = [
    // V3 layouts
    "SOLO", "DIALOGUE", "DUAL_CONTRAST", "SIZE_HIERARCHY", "CHAR_PROP",
    "ICON_TRIPLE", "QA_REVEAL", "LINEUP", "STAT_DRAMA", "CLOSE_UP", "TABLEAU",
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
    if (input.schemaVersion === 2) {
      if (!scene.sourceRange || !Number.isInteger(scene.sourceRange.startWord) || !Number.isInteger(scene.sourceRange.endWord)) {
        errors.push(`${sp} schema v2 scene requires sourceRange`);
      }
      if (!scene.visualRegister) errors.push(`${sp} schema v2 scene requires visualRegister`);
      if (!scene.semanticTakeaway) errors.push(`${sp} schema v2 scene requires semanticTakeaway`);
      if (!scene.semanticAction) errors.push(`${sp} schema v2 scene requires semanticAction`);
      if (!Array.isArray(scene.semanticAssetIds)) errors.push(`${sp} schema v2 scene requires semanticAssetIds`);
      if (!scene.focalType) errors.push(`${sp} schema v2 scene requires focalType`);
      if (!scene.visualFingerprint) errors.push(`${sp} schema v2 scene requires visualFingerprint`);
      if (!scene.silentFrameTakeaway) errors.push(`${sp} schema v2 scene requires silentFrameTakeaway`);
      if (typeof scene.focalOccupancyTarget !== "number") errors.push(`${sp} schema v2 scene requires focalOccupancyTarget`);
      if (!Array.isArray(scene.noveltyFromPrevious)) errors.push(`${sp} schema v2 scene requires noveltyFromPrevious`);
      if ((scene.unresolvedAssets?.length ?? 0) > 0) errors.push(`${sp} has unresolvedAssets`);
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
          const assetPath = resolveAssetPath(e.src, assetsDir);
          if (!fs.existsSync(assetPath)) {
            errors.push(`${ep} asset not found: ${path.relative(process.cwd(), assetPath)}`);
          }
        }

        if (e.slot && !validSlots.includes(e.slot)) {
          warnings.push(`${ep} unknown slot "${e.slot}"`);
        }
        if (e.anchor) {
          const anchors = STAGE_ANCHORS[scene.backgroundSrc ?? ""];
          if (!anchors) {
            errors.push(`${ep} anchor "${e.anchor}" nhưng backgroundSrc không phải stage set (assets/scenes/*)`);
          } else if (!anchors[e.anchor]) {
            errors.push(`${ep} anchor "${e.anchor}" không tồn tại trong stage — có: ${Object.keys(anchors).join(", ")}`);
          }
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

    if (Array.isArray(scene.speechBubbles)) {
      const entityIds = new Set(
        (Array.isArray(scene.entities) ? scene.entities : []).map((e: any) => e.assetId)
      );
      for (let bi = 0; bi < scene.speechBubbles.length; bi++) {
        const b = scene.speechBubbles[bi];
        const bp = `${sp} speechBubble[${bi}]:`;
        if (!b.id) errors.push(`${bp} missing id`);
        if (!b.text) errors.push(`${bp} missing text`);
        if (!b.anchorAssetId) {
          errors.push(`${bp} missing anchorAssetId`);
        } else if (!entityIds.has(b.anchorAssetId)) {
          errors.push(`${bp} anchorAssetId "${b.anchorAssetId}" không khớp entity nào trong scene`);
        }
        if (b.text && b.text.split(/\s+/).length > 12) {
          warnings.push(`${bp} thoại ${b.text.split(/\s+/).length} từ — nên ≤8 từ cho dễ đọc`);
        }
      }
    }

    if (!Array.isArray(scene.texts)) {
      errors.push(`${sp} texts must be an array`);
    } else {
      if (scene.texts.length === 0 &&
          (scene.entities?.length ?? 0) === 0 &&
          (scene.paperCards?.length ?? 0) === 0 &&
          (scene.frameBoxes?.length ?? 0) === 0) {
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

  // NOTE: aesthetic/director rules (background philosophy, SOLO ratio, pose
  // monotony, opening brightness, subtitle-band collisions, layout rhythm) live
  // exclusively in qualityCheck.ts — the single source of truth for V4 quality.
  // validateTimeline stays a pure SCHEMA gate (required fields, valid enums,
  // broken paths, range checks) so the two systems never drift out of sync.
  void realBgImages;
  void gradientBgCount;

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
          const assetPath = resolveAssetPath(event.src, assetsDir);
          if (!fs.existsSync(assetPath)) {
            errors.push(`${prefix} asset not found: ${path.relative(process.cwd(), assetPath)}`);
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
    for (const e of result.errors.slice(0, 40)) console.error(`   ERROR: ${e}`);
    if (result.errors.length > 40) {
      console.error(`   ... ${result.errors.length - 40} more validation errors`);
    }
  } else {
    console.log(`\n✅ Validation passed: ${timelinePath}`);
  }
  if (result.warnings.length > 0) {
    for (const w of result.warnings) console.warn(`   WARN: ${w}`);
  }
}
