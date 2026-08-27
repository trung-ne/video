import {
  SceneTimeline,
  Scene,
  SceneEntity,
  SceneText,
  ScenePaperCard,
  SceneFrameBox,
  SceneSpeechBubble,
  LayoutPreset,
  SLOT_POSITIONS,
  TEXT_SLOT_POSITIONS,
  LAYOUT_ENTITY_SLOTS,
} from "../types/scene";
import {
  Timeline,
  TimelineEvent,
  EnterEvent,
  ExitEvent,
  EmphasizeEvent,
  CameraEvent,
  TextEvent,
  ClearEvent,
  TransitionEvent,
  BackgroundEvent,
  PaperCardEvent,
  CardEvent,
  FrameBoxEvent,
  SpeechBubbleEvent,
} from "../types/timeline";
import { isStageBackground, resolveStageAnchor } from "./stageAnchors";
import { animationForEntranceStyle, selectEntranceStyle } from "./entrancePolicy";
import { isCharacterAssetSrc, isUiAssetSrc } from "./assetPaths";

// ============================================================
// SceneCompiler — translates SceneTimeline → Timeline (events)
// ============================================================

export function compileScenes(input: SceneTimeline): Timeline {
  const events: TimelineEvent[] = [];

  for (let i = 0; i < input.scenes.length; i++) {
    compileScene(input.scenes[i], events, input.durationInFrames, i === 0);
  }

  // Sort all events by frame
  events.sort((a, b) => a.frame - b.frame);

  return {
    fps: input.fps,
    width: input.width,
    height: input.height,
    durationInFrames: input.durationInFrames,
    audio: input.audio,
    background: input.background ?? "#FAFAF8",
    events,
  };
}

function compileScene(
  scene: Scene,
  events: TimelineEvent[],
  totalFrames: number,
  isFirstScene: boolean = false
): void {
  const start = scene.startFrame;
  const sceneEnd = start + scene.durationFrames;

  // V4.1 — a full-bleed photo is a "punch": it must tell its own story. A cat
  // planted dead-center over the subject turns the photo into meaningless
  // wallpaper. Detect photo backgrounds here so entity compilation can shove
  // characters into a small corner (scale-capped) instead of centering them.
  // Illustrated stage sets (assets/scenes/*) are NOT photos: characters live
  // INSIDE them at anchors, so no blur/scrim/corner-shove applies.
  const sceneBgIsStage = isStageBackground(scene.backgroundSrc);
  const sceneBgIsPhoto =
    !!scene.backgroundSrc &&
    !sceneBgIsStage &&
    !scene.backgroundSrc.startsWith("#") &&
    !scene.backgroundSrc.startsWith("rgb") &&
    !scene.backgroundSrc.startsWith("linear-gradient") &&
    !scene.backgroundSrc.startsWith("radial-gradient");

  // Tracks the ACTUAL background rendered (may be forced bright on scene 1) so
  // downstream text-color logic reads reality, not the AI's original request.
  let effectiveBgSrc: string | undefined = scene.backgroundSrc;

  // The opening must be bright and readable within the first seconds — a fade
  // from black on scene 1 buries the hook, so those transitions are dropped.
  const openingFade =
    isFirstScene &&
    scene.transition &&
    (scene.transition.style === "fadeBlack" || scene.transition.style === "fadeWhite");

  // Transition duration — used to offset clear + entity enter
  const transitionDur =
    scene.transition && !openingFade ? (scene.transition.duration ?? 15) : 0;

  // ── 1. Transition ─────────────────────────────────────────
  // Only emit flash/fadeBlack/fadeWhite — wipe is skipped because BackgroundEvent
  // already provides a crossfade that is visually equivalent and less jarring.
  // STAT_DRAMA scenes with flash/fadeBlack are the primary use case.
  const shouldEmitTransition =
    scene.transition &&
    scene.transition.style !== "wipe" &&
    !openingFade;

  if (shouldEmitTransition) {
    events.push({
      frame: start,
      type: "transition",
      style: scene.transition!.style,
      duration: transitionDur,
    } as TransitionEvent);
  }

  // ── 2. Background first (crossfade handles the visual transition) ──
  if (scene.backgroundSrc) {
    // Photo backgrounds (not a hex/gradient) get a gentle default blur + scrim so the
    // flat 2D characters pop and overlay text stays legible — matches the reference video.
    const isPhoto =
      !sceneBgIsStage &&
      !scene.backgroundSrc.startsWith("#") &&
      !scene.backgroundSrc.startsWith("rgb") &&
      !scene.backgroundSrc.startsWith("linear-gradient") &&
      !scene.backgroundSrc.startsWith("radial-gradient");

    // The opening 3 seconds must be bright and readable regardless of what
    // the AI picked — a STAT_DRAMA-style dark gradient on scene 1 buries the
    // hook just as badly as a fadeBlack transition does.
    const bgSrc =
      isFirstScene && !isPhoto && isDarkBackground(scene.backgroundSrc)
        ? "#FAFAF8"
        : scene.backgroundSrc;
    effectiveBgSrc = bgSrc;

    events.push({
      frame: start,
      type: "background",
      src: bgSrc,
      blur: scene.backgroundBlur ?? (isPhoto ? 10 : 0),
      overlay: clampOverlayAlpha(
        scene.backgroundOverlay ?? (isPhoto ? "rgba(0,0,0,0.28)" : undefined)
      ),
      // A hard scene clear removes the old focal immediately. Crossfading the
      // new background for another 25 frames then exposes a blank canvas at
      // every cut. With no authored transition, make the replacement atomic;
      // explicit transitions keep the gentle background crossfade.
      duration: scene.clearPrevious && !scene.transition ? 1 : 25,
    } as BackgroundEvent);
  }

  // ── 3. Clear AFTER transition completes ──────────────────
  // clearPrevious is an EXPLICIT signal from the AI — always honor it.
  //   true      → wipe the whole canvas for a clean slate (new scene context)
  //   string[]  → clear only the named assets (within-scene phase change)
  // Hold-state (assets persist across scenes) is the DEFAULT when clearPrevious
  // is omitted/false, so scenes that want continuity simply don't set it.
  if (scene.clearPrevious) {
    const clearFrame = start + transitionDur;
    if (scene.clearPrevious === true) {
      events.push({ frame: clearFrame, type: "clear", assetIds: [] } as ClearEvent);
    } else if (Array.isArray(scene.clearPrevious) && scene.clearPrevious.length > 0) {
      events.push({ frame: clearFrame, type: "clear", assetIds: scene.clearPrevious } as ClearEvent);
    }
  }

  // ── 4. Entities enter AFTER transition + small buffer ────
  // enterDelay is relative to scene start — add transition offset so
  // entities don't pop in while transition is still playing
  for (let i = 0; i < scene.entities.length; i++) {
    const entity = scene.entities[i];
    compileEntity(entity, scene, i, start, sceneEnd, events, transitionDur, sceneBgIsPhoto);
  }

  // ── 5. Texts ──────────────────────────────────────────────
  for (const text of scene.texts) {
    compileText(text, scene, start, sceneEnd, events, totalFrames, transitionDur, effectiveBgSrc);
  }

  // ── 5a. Auto subtitles from narration (the reference channel's signature) ──
  // Burned-in narration caption at the very bottom, chunked into short lines and
  // timed evenly across the scene. Disabled per-scene with subtitle:false.
  if (scene.narration && (scene as any).subtitle !== false) {
    compileSubtitles(scene, start, sceneEnd, events, totalFrames, transitionDur);
  }

  // ── 5b. Paper cards (evidence / survey) ──────────────────
  if (scene.paperCards) {
    for (const pc of scene.paperCards) {
      compilePaperCard(pc, scene, start, sceneEnd, events, totalFrames, transitionDur);
    }
  }
  if (scene.cards) {
    for (const card of scene.cards) {
      const frame = start + transitionDur + (card.delay ?? 0);
      events.push({
        frame,
        type: "card",
        cardId: card.id,
        position: card.position,
        scale: card.scale,
        background: card.background,
        iconSrc: card.iconSrc,
        label: card.label,
        animation: card.enterAnimation ?? (scene.cards.length === 1 ? defaultComponentAnimation(scene, card.position) : "fadeIn"),
        exitFrame: card.duration !== undefined
          ? Math.min(frame + card.duration, totalFrames - 1)
          : Math.min(sceneEnd - 5, totalFrames - 1),
        width: card.width,
        height: card.height,
      } as CardEvent);
    }
  }

  // ── 5c. TV/monitor data frames ───────────────────────────
  if (scene.frameBoxes) {
    for (const fb of scene.frameBoxes) {
      compileFrameBox(fb, scene, start, sceneEnd, events, totalFrames, transitionDur);
    }
  }

  // ── 5d. Speech bubbles (dialogue lines above characters) ──
  if (scene.speechBubbles) {
    for (const sb of scene.speechBubbles) {
      compileSpeechBubble(sb, scene, start, sceneEnd, events, totalFrames, transitionDur);
    }
  }

  // ── 6. Camera ─────────────────────────────────────────────
  if (scene.camera) {
    compileCamera(scene.camera, scene, start, events);
  }
}

function compileEntity(
  entity: SceneEntity,
  scene: Scene,
  entityIndex: number,
  sceneStart: number,
  sceneEnd: number,
  events: TimelineEvent[],
  transitionDur: number = 0,
  bgIsPhoto: boolean = false
): void {
  // Resolve position. Priority: stage anchor > explicit position > slot > layout.
  const stageAnchor = resolveStageAnchor(scene.backgroundSrc, entity.anchor);
  let position: { x: number; y: number };
  if (stageAnchor) {
    position = { x: stageAnchor.x, y: stageAnchor.y };
  } else if (entity.position) {
    position = entity.position;
  } else if (entity.slot) {
    position = SLOT_POSITIONS[entity.slot];
  } else {
    // Auto-assign slot from layout
    const layoutSlots = LAYOUT_ENTITY_SLOTS[scene.layout];
    const slot = layoutSlots[entityIndex] ?? "CENTER";
    position = SLOT_POSITIONS[slot];
  }

  // Resolve scale up front so V4.1 photo-composition can cap it.
  // A stage anchor carries its own tuned scale (cat must FIT the furniture).
  let scale =
    stageAnchor?.scale ?? entity.scale ?? defaultScaleForLayout(scene.layout, entityIndex);
  if (stageAnchor && isCharacterAssetSrc(entity.src)) {
    // The stage registry was tuned for the retired SVG cats, whose opaque
    // footprint filled more of each nominal square. Production PNG actors
    // otherwise read as tiny stickers inside a detailed set. Keep furniture
    // anchors, but restore the reference-like 25–40% character footprint.
    scale = Math.min(2.8, scale * 1.6);
  }

  // Anti-tiny-cat clamp: AI-generated timelines sometimes hand-write small
  // scales (0.5–1.2) on characters, overriding auto-scale and leaving a
  // thumbnail-sized cat adrift in whitespace (video-003 had 48 such fields).
  // Characters must fill the frame like the reference — if the AI asks for
  // less than 1.4 on a character, fall back to the layout's auto-scale.
  if (
    !stageAnchor &&
    entity.scale !== undefined &&
    entity.scale < 1.4 &&
    !isUiAssetSrc(entity.src)
  ) {
    scale = defaultScaleForLayout(scene.layout, entityIndex);
  }

  // V4.1 enforcement — on a full-bleed photo, characters must NOT cover the
  // subject. Unless the AI explicitly pinned this entity (entity.position set),
  // shove it into a bottom corner and cap its size so the photo reads first.
  // Corners alternate by index so two cats don't stack.
  if (stageAnchor) {
    // Anchored to stage furniture — composition is pre-tuned, leave it alone.
  } else if (bgIsPhoto && !entity.position) {
    const PHOTO_MAX_SCALE = 1.2;
    scale = Math.min(scale, PHOTO_MAX_SCALE);
    const corners = [
      { x: 0.16, y: 0.74 },
      { x: 0.84, y: 0.74 },
    ];
    position = corners[entityIndex % corners.length];
  } else if (!entity.position && scene.entities.length >= 2 && position.x > 0.45 && position.x < 0.55) {
    // V4.8.4 rule-of-thirds safety net — two elements should never share the
    // dead-center axis (the eye can't pick a focus). Only dead-center a single
    // entity addressing the viewer directly.
    position = { x: entityIndex % 2 === 0 ? 0.34 : 0.66, y: position.y };
  }

  // Enter after transition finishes so entities don't pop in mid-wipe
  const enterFrame = sceneStart + transitionDur + (entity.enterDelay ?? 0);

  // Entity-level clearPrevious (phase transition within a scene)
  if (entity.clearPrevious && entity.clearPrevious.length > 0) {
    events.push({ frame: enterFrame, type: "clear", assetIds: entity.clearPrevious } as ClearEvent);
  }

  // Enter event
  events.push({
    frame: enterFrame,
    type: "enter",
    assetId: entity.assetId,
    src: entity.src,
    position,
    scale,
    animation: entity.enterAnimation ?? defaultEnterAnimation(entity.role, scene, position, entityIndex),
    animationDuration: entity.animationDuration ?? 20,
    label: entity.label,
    badge: entity.badge,
    circle: entity.circle,
    facing: entity.facing,
    // Furniture anchors and tableau props have an authored spatial relationship
    // to the stage. Liveliness may change their pose/emphasis but never move
    // them through another actor.
    motionPolicy: entity.motionPolicy ?? (stageAnchor || scene.layout === "TABLEAU" ? "fixed" : "collision-safe"),
    allowOverlapWith: entity.allowOverlapWith,
    zIndex: entity.zIndex ?? (entity.role === "host" ? 1 : 2),
  } as EnterEvent);

  // Emphasize event
  if (entity.emphasize) {
    const emphDelay = (entity.emphasize.delay ?? 30);
    events.push({
      frame: enterFrame + emphDelay,
      type: "emphasize",
      assetId: entity.assetId,
      animation: entity.emphasize.animation,
      duration: entity.emphasize.duration ?? 25,
      value: entity.emphasize.value,
    } as EmphasizeEvent);
  }

  // Exit event (if explicitly requested)
  if (entity.exitFrame !== undefined) {
    events.push({
      frame: entity.exitFrame,
      type: "exit",
      assetId: entity.assetId,
      animation: entity.exitAnimation ?? "fadeOut",
      animationDuration: 15,
    } as ExitEvent);
  }
}

function compileText(
  text: SceneText,
  scene: Scene,
  sceneStart: number,
  sceneEnd: number,
  events: TimelineEvent[],
  totalFrames: number,
  transitionDur: number = 0,
  effectiveBgSrc?: string
): void {
  // Resolve position
  let position: { x: number; y: number };
  if (text.position) {
    position = text.position;
  } else if (text.slot) {
    position = TEXT_SLOT_POSITIONS[text.slot];
  } else {
    position = defaultTextPosition(text.style);
  }

  // The bottom band (y > 0.74) belongs exclusively to the auto subtitle — any
  // overlay text placed there would collide with it, so it gets pushed up.
  const subtitlesActive = !!scene.narration && (scene as any).subtitle !== false;
  if (subtitlesActive && position.y > 0.74) {
    position = { x: position.x, y: 0.72 };
  }

  // Naked BODY sentences floating in the top band read as unstyled debris
  // (video-003 opened scenes with bare "In reality, many people rush toward
  // the top…" at y≈0.1). The top band is TITLE/CALLOUT territory — promote
  // stray BODY text there to a CALLOUT pill so it gets real styling.
  let style = text.style;
  if (style === "BODY" && position.y < 0.3) {
    style = "CALLOUT";
  }

  const textFrame = sceneStart + transitionDur + (text.delay ?? 0);

  // Compute exitFrame
  let exitFrame: number | undefined;
  if (text.hold === "title") {
    exitFrame = Math.min(textFrame + 4 * 30, sceneEnd - 5, totalFrames - 1);
  } else if (text.hold === "scene-end" || text.hold === "element") {
    exitFrame = Math.min(sceneEnd - 5, totalFrames - 1);
  } else if (text.hold === "until-replaced") {
    exitFrame = Math.min(
      text.duration !== undefined ? textFrame + text.duration : sceneEnd - 5,
      totalFrames - 1,
    );
  } else if (text.duration !== undefined) {
    exitFrame = Math.min(textFrame + text.duration, totalFrames - 1);
  } else {
    // Default: text lasts until end of scene
    exitFrame = Math.min(sceneEnd - 5, totalFrames - 1);
  }

  // Auto-adjust text color on dark backgrounds. Uses the EFFECTIVE background
  // (post scene-1 brightness override), not the AI's original request, so a
  // scene forced bright doesn't end up with white text on a white backdrop.
  const bg = effectiveBgSrc ?? scene.backgroundSrc;
  const bgIsPhoto = bg
    ? !bg.startsWith("#") &&
      !bg.startsWith("rgb") &&
      !bg.startsWith("linear-gradient") &&
      !bg.startsWith("radial-gradient")
    : false;
  const isDarkBg = bg
    ? isDarkBackground(bg) || bgIsPhoto
    : false;
  const autoColor = isDarkBg && style !== "STAT"
    ? (style === "BODY" ? "#E0E0E0" : style === "CAPTION" ? "#B0BEC5" : "#FFFFFF")
    : undefined;

  // An explicit text.color from the scene JSON always wins — auto-color is
  // only a fallback for dark backgrounds when the AI didn't pick one itself.
  const resolvedColor = text.color ?? autoColor;

  events.push({
    frame: textFrame,
    type: "text",
    textId: text.id,
    content: text.content,
    position,
    style,
    color: resolvedColor,
    background: text.background,
    align: text.align ?? "center",
    fontWeight: text.fontWeight,
    fontSize: text.fontSize,
    animation: text.enterAnimation ?? defaultTextAnimation(scene, text),
    exitFrame,
  } as TextEvent);
}

// Split narration into subtitle chunks, respecting sentence boundaries where
// possible, then time them evenly across the scene. Chunks are capped by
// CHARACTER count (not just words) so a chunk never wraps past 2 lines in the
// renderer (~42 chars/line at 40px within the subtitle max-width).
function chunkNarration(narration: string, maxWords = 9, maxChars = 76): string[] {
  const clean = narration.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  // Prefer splitting on sentence/clause punctuation first
  const clauses = clean.split(/(?<=[.!?…])\s+|(?<=[,;:])\s+/);
  const chunks: string[] = [];
  let buf: string[] = [];
  const bufLen = () => buf.join(" ").length;
  for (const clause of clauses) {
    const words = clause.split(" ");
    for (const w of words) {
      if (buf.length > 0 && bufLen() + 1 + w.length > maxChars) {
        chunks.push(buf.join(" "));
        buf = [];
      }
      buf.push(w);
      if (buf.length >= maxWords) {
        chunks.push(buf.join(" "));
        buf = [];
      }
    }
    // flush at clause boundary if we have a reasonable amount
    if (buf.length >= Math.ceil(maxWords * 0.6)) {
      chunks.push(buf.join(" "));
      buf = [];
    }
  }
  if (buf.length) chunks.push(buf.join(" "));
  return chunks;
}

function compileSubtitles(
  scene: Scene,
  sceneStart: number,
  sceneEnd: number,
  events: TimelineEvent[],
  totalFrames: number,
  transitionDur: number
): void {
  if (scene.subtitleCues?.length) {
    for (let i = 0; i < scene.subtitleCues.length; i++) {
      const cue = scene.subtitleCues[i];
      const frame = Math.max(sceneStart + transitionDur, sceneStart + cue.startFrame);
      const exitFrame = Math.min(sceneStart + cue.endFrame, sceneEnd, totalFrames - 1);
      events.push({
        frame,
        type: "text",
        textId: `${scene.id}__sub_${i}`,
        content: cue.text,
        position: { x: 0.5, y: 0.9 },
        style: "SUBTITLE",
        color: "#FFFFFF",
        align: "center",
        animation: "fadeIn",
        exitFrame,
      } as TextEvent);
    }
    return;
  }
  const chunks = chunkNarration(scene.narration!);
  if (chunks.length === 0) return;

  const spanStart = sceneStart + transitionDur;
  const spanFrames = Math.max(1, sceneEnd - spanStart);
  const per = spanFrames / chunks.length;

  for (let i = 0; i < chunks.length; i++) {
    const frame = Math.round(spanStart + i * per);
    const exitFrame = Math.min(Math.round(spanStart + (i + 1) * per), totalFrames - 1);
    events.push({
      frame,
      type: "text",
      textId: `${scene.id}__sub_${i}`,
      content: chunks[i],
      position: { x: 0.5, y: 0.9 },
      style: "SUBTITLE",
      color: "#FFFFFF", // burned-in caption is ALWAYS white — never auto-colored
      align: "center",
      animation: "fadeIn",
      exitFrame,
    } as TextEvent);
  }
}

function compilePaperCard(
  pc: ScenePaperCard,
  scene: Scene,
  sceneStart: number,
  sceneEnd: number,
  events: TimelineEvent[],
  totalFrames: number,
  transitionDur: number
): void {
  const frame = sceneStart + transitionDur + (pc.delay ?? 0);
  const exitFrame =
    pc.duration !== undefined
      ? Math.min(frame + pc.duration, totalFrames - 1)
      : Math.min(sceneEnd - 5, totalFrames - 1);

  // A long evidence body at the default width grows tall enough to collide
  // with the character below it and with the auto-subtitle band at the
  // bottom. Long bodies get a narrower card (taller-but-narrower reads fine
  // for a "document" look) and are nudged up so they stay clear of y>0.74.
  const bodyLen = (pc.body ?? "").length;
  const autoWidth = bodyLen > 220 ? 860 : bodyLen > 120 ? 980 : 1100;
  const autoY = bodyLen > 160 ? 0.34 : 0.42;

  events.push({
    frame,
    type: "paperCard",
    cardId: pc.id,
    variant: pc.variant,
    position: pc.position ?? { x: 0.5, y: autoY },
    scale: pc.scale,
    title: pc.title,
    body: pc.body,
    choices: pc.choices,
    source: pc.source,
    date: pc.date,
    highlight: pc.highlight,
    rotation: pc.rotation,
    animation: pc.enterAnimation ?? defaultComponentAnimation(scene, pc.position),
    exitFrame,
    width: pc.width ?? autoWidth,
  } as PaperCardEvent);
}

// Dialogue lines above characters — the reference's primary teaching device.
// Sequenced bubbles (delay/duration) let two cats trade lines within a scene.
function compileSpeechBubble(
  sb: SceneSpeechBubble,
  scene: Scene,
  sceneStart: number,
  sceneEnd: number,
  events: TimelineEvent[],
  totalFrames: number,
  transitionDur: number
): void {
  const frame = sceneStart + transitionDur + (sb.delay ?? 0);
  const exitFrame =
    sb.duration !== undefined
      ? Math.min(frame + sb.duration, totalFrames - 1)
      : Math.min(sceneEnd - 5, totalFrames - 1);

  events.push({
    frame,
    type: "speechBubble",
    bubbleId: sb.id,
    anchorAssetId: sb.anchorAssetId,
    text: sb.text,
    style: sb.style ?? "speech",
    direction: sb.direction ?? "right",
    exitFrame,
    fontSize: sb.fontSize,
    widthRatio: sb.widthRatio,
    background: sb.background,
    textColor: sb.textColor,
    animation: sb.enterAnimation ?? "fadeIn",
  } as SpeechBubbleEvent);
}

function compileFrameBox(
  fb: SceneFrameBox,
  scene: Scene,
  sceneStart: number,
  sceneEnd: number,
  events: TimelineEvent[],
  totalFrames: number,
  transitionDur: number
): void {
  const frame = sceneStart + transitionDur + (fb.delay ?? 0);
  const exitFrame =
    fb.duration !== undefined
      ? Math.min(frame + fb.duration, totalFrames - 1)
      : Math.min(sceneEnd - 5, totalFrames - 1);

  events.push({
    frame,
    type: "frameBox",
    frameId: fb.id,
    position: fb.position ?? { x: 0.5, y: 0.42 },
    scale: fb.scale,
    contentSrc: fb.contentSrc,
    caption: fb.caption,
    source: fb.source,
    objectFit: fb.objectFit,
    animation: fb.enterAnimation ?? defaultComponentAnimation(scene, fb.position),
    exitFrame,
    width: fb.width,
  } as FrameBoxEvent);
}

function compileCamera(
  camera: { action: string; target?: string; zoom?: number; delay?: number; duration?: number },
  scene: Scene,
  sceneStart: number,
  events: TimelineEvent[]
): void {
  const camFrame = sceneStart + (camera.delay ?? 40);
  const duration = camera.duration ?? 30;
  const safeZoom = (requested: number | undefined, fallback: number) =>
    Math.max(1, Math.min(1.08, requested ?? fallback));
  const safeCenter = (value: number | undefined, axis: "x" | "y") => {
    const [min, max] = axis === "x" ? [0.46, 0.54] : [0.44, 0.52];
    return Math.max(min, Math.min(max, value ?? 0.5));
  };

  switch (camera.action) {
    case "ZOOM_IN": {
      const zoom = safeZoom(camera.zoom, 1.06);
      // Find target entity position for center
      const targetEntity = camera.target
        ? scene.entities.find((e) => e.assetId === camera.target)
        : scene.entities[0];
      const pos = resolveEntityPosition(targetEntity, scene, 0);
      events.push({
        frame: camFrame,
        type: "camera",
        zoom,
        centerX: safeCenter(pos?.x, "x"),
        centerY: safeCenter(pos?.y, "y"),
        duration,
      } as CameraEvent);
      break;
    }

    case "ZOOM_OUT": {
      events.push({
        frame: camFrame,
        type: "camera",
        zoom: 1,
        centerX: 0.5,
        centerY: 0.5,
        duration,
      } as CameraEvent);
      break;
    }

    case "FOCUS_ON": {
      const targetEntity = camera.target
        ? scene.entities.find((e) => e.assetId === camera.target)
        : scene.entities[0];
      const pos = resolveEntityPosition(targetEntity, scene, 0);
      events.push({
        frame: camFrame,
        type: "camera",
        zoom: safeZoom(camera.zoom, 1.06),
        centerX: safeCenter(pos?.x, "x"),
        centerY: safeCenter(pos?.y, "y"),
        duration,
      } as CameraEvent);
      break;
    }

    case "RESET": {
      events.push({
        frame: camFrame,
        type: "camera",
        zoom: 1.0,
        centerX: 0.5,
        centerY: 0.5,
        duration,
      } as CameraEvent);
      break;
    }

    case "PAN_LR": {
      // Pan left first then right
      events.push({
        frame: camFrame,
        type: "camera",
        zoom: safeZoom(camera.zoom, 1.04),
        centerX: 0.47,
        centerY: 0.48,
        duration,
      } as CameraEvent);
      events.push({
        frame: camFrame + duration + 30,
        type: "camera",
        zoom: safeZoom(camera.zoom, 1.04),
        centerX: 0.53,
        centerY: 0.48,
        duration,
      } as CameraEvent);
      break;
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────

function defaultEnterAnimation(
  role: SceneEntity["role"] | undefined,
  scene: Scene,
  position: { x: number; y: number },
  entityIndex: number,
): string {
  if (scene.entities.length > 1 && entityIndex > 0) return "fadeIn";
  if (role === "cause") return "slideRight";
  if (role === "effect") return "slideLeft";
  return defaultComponentAnimation(scene, position);
}

function defaultComponentAnimation(scene: Scene, position?: { x: number; y: number }): string {
  const style = selectEntranceStyle({ requested: scene.entranceStyle, grammar: scene.visualGrammar });
  return animationForEntranceStyle(style, position);
}

function defaultTextAnimation(scene: Scene, text: SceneText): string {
  if (text.style === "SUBTITLE") return "fadeIn";
  const isFocal = text.style === "STAT" || scene.texts.length === 1;
  return isFocal ? defaultComponentAnimation(scene, text.position) : "fadeIn";
}

function defaultTextPosition(style: string): { x: number; y: number } {
  switch (style) {
    case "TITLE": return TEXT_SLOT_POSITIONS.TOP_TITLE;
    case "SECTION": return TEXT_SLOT_POSITIONS.SECTION_HEADER;
    case "CALLOUT": return TEXT_SLOT_POSITIONS.CALLOUT_CENTER;
    case "STAT": return TEXT_SLOT_POSITIONS.STAT_CENTER;
    case "BODY": return TEXT_SLOT_POSITIONS.BODY;
    case "CAPTION": return TEXT_SLOT_POSITIONS.CAPTION;
    default: return TEXT_SLOT_POSITIONS.BODY;
  }
}

function resolveEntityPosition(
  entity: SceneEntity | undefined,
  scene: Scene,
  index: number
): { x: number; y: number } | undefined {
  if (!entity) return undefined;
  if (entity.position) return entity.position;
  if (entity.slot) return SLOT_POSITIONS[entity.slot];
  const layoutSlots = LAYOUT_ENTITY_SLOTS[scene.layout];
  const slot = layoutSlots[index];
  return slot ? SLOT_POSITIONS[slot] : undefined;
}

// Default scale per layout — ensures characters FILL the screen like the reference
// video (cats are ~40-50% of frame height, not tiny icons floating in whitespace).
function defaultScaleForLayout(layout: LayoutPreset, entityIndex: number): number {
  switch (layout) {
    case "SOLO":
    case "INTRO":
    case "CLOSE_UP":
      return 3.0;
    case "TABLEAU":
      return 1.5; // fits stage furniture; anchors carry their own tuned scale
    case "DIALOGUE":
    case "DUAL_CONTRAST":
    case "COMPARE":
      return 2.3;
    case "SIZE_HIERARCHY":
      return entityIndex === 0 ? 3.2 : 1.6; // big entity first, small second
    case "CHAR_PROP":
    case "CAUSE_EFFECT":
      return entityIndex === 0 ? 2.6 : 2.0; // character slightly bigger than prop
    case "ICON_TRIPLE":
    case "ACCUMULATION":
      return 1.4;
    case "LINEUP":
      return 1.5;
    case "STAT_DRAMA":
    case "STAT":
    case "CONCLUSION":
    case "CTA":
      return 2.4;
    case "QA_REVEAL":
    case "SINGLE":
      return 2.8;
    default:
      return 1.8;
  }
}

// A scrim darker than 35% buries the photo AND the characters (the "black
// opening" defect) — clamp whatever the AI asked for down to that ceiling.
function clampOverlayAlpha(overlay: string | undefined, maxAlpha = 0.35): string | undefined {
  if (!overlay) return overlay;
  const m = overlay.match(/^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/i);
  if (!m) return overlay;
  const alpha = parseFloat(m[4]);
  if (isNaN(alpha) || alpha <= maxAlpha) return overlay;
  return `rgba(${m[1]},${m[2]},${m[3]},${maxAlpha})`;
}

// Parse a hex color (#rgb or #rrggbb) → relative luminance 0..1, or null.
function hexLuminance(hex: string): number | null {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return null;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  // Perceived luminance (Rec. 709)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Detect if a backgroundSrc is dark (needs light text).
// Works for any hex or gradient by averaging the luminance of ALL hex stops —
// no fragile hardcoded value list (which previously missed e.g. #0f172a).
function isDarkBackground(src: string): boolean {
  if (!src) return false;
  const hexes = src.match(/#[0-9a-fA-F]{3,6}\b/g);
  if (!hexes || hexes.length === 0) return false;
  const lums = hexes.map(hexLuminance).filter((l): l is number => l !== null);
  if (lums.length === 0) return false;
  const avg = lums.reduce((a, b) => a + b, 0) / lums.length;
  return avg < 0.5; // below mid-luminance → treat as dark, use light text
}
