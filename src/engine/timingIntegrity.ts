/**
 * timingIntegrity.ts — production invariants for audio/timeline/render timing.
 *
 * Why this exists: `compileStoryboard` used to silently fall back to a word-count
 * estimate when a scene id had no TTS duration entry. On
 * video-003-tai-sao-eng-v5-codex every one of 139 scene ids missed (durations
 * were keyed `v4-NNN`, the storyboard had been rebuilt as `scene-NNN`), so the
 * whole video compiled from estimates: timeline 1124s against a 1513s voice
 * track — a 389s shortfall and an out-of-sync MP4 that still rendered and still
 * passed every other gate, including a 100/100 grade-A storyboard report. The
 * failure was invisible because the fallback was silent and per-scene. Worse, a
 * truncated MP4 scores *better* on sampled pixel audits, so the bad render also
 * poisoned cross-render comparison.
 *
 * Two independent axes, deliberately kept apart:
 *
 *   sceneTimingSource — what sets scene boundaries. Exactly one per video.
 *   beatTimingSource  — what anchors emphasis beats inside a scene.
 *
 * `words` may always accompany `durations`: durations fix the boundaries, words
 * anchor the beats. That combination is correct, not "mixed timing".
 *
 * Everything here is pure — no fs, no spawn, no Date — so it stays unit-testable
 * and safe to import from the browser-side compiler. Callers supply measurements.
 */

export type TimingSeverity = "BLOCKER" | "WARNING";

/** What determined scene boundaries. Only `estimated` is barred from production. */
export type SceneTimingSource = "durations" | "aligned-words" | "authored-silent" | "estimated";

/** What anchored emphasis beats. `proportional` is a quality note, not a failure. */
export type BeatTimingSource = "aligned-words" | "proportional";

export interface TimingIssue {
  code: string;
  severity: TimingSeverity;
  message: string;
  hint?: string;
}

/**
 * Structural shape of one scene's timing. Declared locally rather than imported
 * from storyboardCompiler so the compiler can depend on this module without a
 * circular import.
 */
export interface TimingSpan {
  id: string;
  startFrame: number;
  frames: number;
}

/**
 * Tolerances. Per-scene frame rounding is `max(1, round(sec * fps))`, so each
 * scene contributes at most ±1/(2·fps) s. Measured aggregate drift on real
 * projects: 0.173s over 139 scenes, 0.237s over 145 — matching the random-walk
 * estimate sqrt(N/12)/fps. Absolute worst case N/(2·fps) needs every scene to
 * round the same way, which does not happen physically.
 */
export const TIMING_TOLERANCE = {
  /** timeline vs the TTS track, when the scene count is unknown */
  timelineVsAudioSeconds: 1.0,
  /**
   * Preferred timeline-vs-audio budget: scales with scene count instead of a flat
   * second. `max(15, ceil(sqrt(N)))` frames — 0.5s at N=145, against 0.237s of
   * observed rounding drift. A flat 1.0s would let a real end-of-video desync
   * through on a 24-minute track.
   */
  timelineVsAudioFloorFrames: 15,
  /** additionally warn on sustained proportional drift the absolute bound misses */
  timelineVsAudioProportion: 0.002,
  /**
   * Rendered MP4 vs timeline. Remotion writes exactly `durationInFrames`, so the
   * only real slack is container reporting (last-frame duration + AAC priming).
   * A flat 1s would let a 29-frame truncation pass.
   */
  mp4VsTimelineFrames: 2,
  mp4VsTimelineContainerSeconds: 0.15,
  /** word alignment may overrun the wav by at most this much (whisper quantises ~0.02s) */
  wordsVsAudioSeconds: 0.5,
};

function preview(ids: string[], take = 3): string {
  const head = ids.slice(0, take).join(", ");
  return ids.length > take ? `${head}, … (+${ids.length - take})` : head;
}

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dupes.add(id);
    seen.add(id);
  }
  return [...dupes];
}

export interface SceneIdAlignmentOpts {
  /**
   * True when aligned words — not durations.json — are the scene-boundary source.
   * Without this, a project legitimately timed by word alignment reads as
   * "no durations supplied".
   */
  wordsProvideTiming?: boolean;
}

/**
 * Scene ids must agree across storyboard → durations → compiled timeline. A
 * single mismatch means at least one scene compiled from an estimate rather than
 * real TTS timing, which desyncs everything after it.
 */
export function checkSceneIdAlignment(
  storyboardIds: string[],
  durationIds: string[],
  timelineIds?: string[],
  opts: SceneIdAlignmentOpts = {},
): TimingIssue[] {
  const issues: TimingIssue[] = [];

  const storyboardDupes = duplicates(storyboardIds);
  if (storyboardDupes.length) {
    issues.push({
      code: "TIMING_STORYBOARD_ID_DUPLICATE",
      severity: "BLOCKER",
      message: `Storyboard has duplicate scene ids (${preview(storyboardDupes)}).`,
      hint: "Scene ids key the TTS timing map — duplicates make timing ambiguous.",
    });
  }

  // Set comparison alone cannot see this: two entries for one id look like one.
  const durationDupes = duplicates(durationIds);
  if (durationDupes.length) {
    issues.push({
      code: "TIMING_DURATION_ID_DUPLICATE",
      severity: "BLOCKER",
      message: `durations.json has duplicate scene ids (${preview(durationDupes)}).`,
      hint: "Regenerate durations.json — one entry per scene.",
    });
  }

  if (!durationIds.length) {
    if (!opts.wordsProvideTiming) {
      issues.push({
        code: "TIMING_NO_DURATIONS",
        severity: "BLOCKER",
        message: "No TTS durations supplied — every scene would compile from a word-count estimate.",
        hint: "Run TTS first, then pass --durations projects/<id>/durations.json.",
      });
    }
    return issues;
  }

  const durationSet = new Set(durationIds);
  const storyboardSet = new Set(storyboardIds);
  const missing = storyboardIds.filter((id) => !durationSet.has(id));
  const orphan = durationIds.filter((id) => !storyboardSet.has(id));

  if (missing.length) {
    issues.push({
      code: "TIMING_ID_MISSING",
      severity: "BLOCKER",
      message:
        `${missing.length}/${storyboardIds.length} storyboard scenes have no TTS duration entry ` +
        `(${preview(missing)}).`,
      hint:
        orphan.length
          ? `durations.json uses a different id scheme (${preview(orphan)}) — it is stale. ` +
            `Re-run storyboard-to-tts.ts + TTS so ids match, do not compile from estimates.`
          : "Re-run TTS for the missing scenes before compiling.",
    });
  }

  if (orphan.length && !missing.length) {
    issues.push({
      code: "TIMING_ID_ORPHAN",
      severity: "BLOCKER",
      message: `${orphan.length} durations entries match no storyboard scene (${preview(orphan)}).`,
      hint: "durations.json is stale relative to the storyboard — regenerate it.",
    });
  }

  if (timelineIds) {
    const timelineSet = new Set(timelineIds);
    const dropped = storyboardIds.filter((id) => !timelineSet.has(id));
    if (dropped.length || timelineIds.length !== storyboardIds.length) {
      issues.push({
        code: "TIMING_ID_TIMELINE_DRIFT",
        severity: "BLOCKER",
        message:
          `Compiled timeline has ${timelineIds.length} scenes for ${storyboardIds.length} storyboard scenes` +
          (dropped.length ? ` (missing ${preview(dropped)})` : ""),
        hint: "The compiler dropped or renamed scenes — investigate before rendering.",
      });
    }
  }

  return issues;
}

/**
 * Structural checks on the timing spans the compiler resolved, verified inside
 * the engine rather than delegated to whoever remembers to run the quality gate.
 * `checkFrameContinuity` in qualityCheck.ts covers gap/overlap on the compiled
 * artifact, but only if the caller runs it — this is the same invariant enforced
 * where it cannot be skipped.
 */
export function checkCompiledTimings(
  spans: TimingSpan[],
  expectedIdOrder: string[],
  totalFrames: number,
): TimingIssue[] {
  const issues: TimingIssue[] = [];
  if (!spans.length) {
    return [{
      code: "TIMING_NO_SCENES",
      severity: "BLOCKER",
      message: "Compiled timeline has no scenes.",
    }];
  }

  const nonPositive = spans.filter((s) => !(s.frames > 0));
  if (nonPositive.length) {
    issues.push({
      code: "TIMING_NONPOSITIVE_FRAMES",
      severity: "BLOCKER",
      message: `${nonPositive.length} scene(s) have a non-positive duration (${preview(nonPositive.map((s) => s.id))}).`,
    });
  }

  const outOfOrder = spans.findIndex((s, i) => s.id !== expectedIdOrder[i]);
  if (outOfOrder !== -1) {
    issues.push({
      code: "TIMING_ORDER_MISMATCH",
      severity: "BLOCKER",
      message:
        `Timing spans are not in storyboard order at index ${outOfOrder}: ` +
        `expected "${expectedIdOrder[outOfOrder]}", got "${spans[outOfOrder].id}".`,
      hint: "Reordering scenes after TTS leaves each scene at its old absolute start frame.",
    });
  }

  for (let i = 1; i < spans.length; i++) {
    const prevEnd = spans[i - 1].startFrame + spans[i - 1].frames;
    const gap = spans[i].startFrame - prevEnd;
    if (gap !== 0) {
      issues.push({
        code: gap > 0 ? "TIMING_GAP" : "TIMING_OVERLAP",
        severity: "BLOCKER",
        message:
          `${gap > 0 ? "Gap" : "Overlap"} of ${Math.abs(gap)} frames between "${spans[i - 1].id}" ` +
          `and "${spans[i].id}" (ends ${prevEnd}, next starts ${spans[i].startFrame}).`,
      });
      break; // one report is enough; they cascade
    }
  }

  const maxEnd = spans.reduce((max, s) => Math.max(max, s.startFrame + s.frames), 0);
  if (totalFrames !== maxEnd) {
    issues.push({
      code: "TIMING_TOTAL_MISMATCH",
      severity: "BLOCKER",
      message: `durationInFrames is ${totalFrames} but the last scene ends at frame ${maxEnd}.`,
      hint: "These are the same accumulator — a difference means the timeline was edited.",
    });
  }

  return issues;
}

/**
 * The compiled timeline must span the narration track. Codex's bug showed up
 * here as a 25.7% shortfall; anything beyond rounding means scenes were timed
 * from estimates, or word alignment shrank them below the real audio.
 */
export interface TimelineSpanOpts {
  /** scene count, so the budget tracks accumulated per-scene rounding */
  sceneCount?: number;
  fps?: number;
  /** explicit override, bypassing the scene-count budget */
  toleranceSeconds?: number;
}

export function checkTimelineSpansAudio(
  timelineSeconds: number,
  audioSeconds: number,
  opts: TimelineSpanOpts = {},
): TimingIssue[] {
  const fps = opts.fps ?? 30;
  const tolerance =
    opts.toleranceSeconds ??
    (opts.sceneCount
      ? Math.max(TIMING_TOLERANCE.timelineVsAudioFloorFrames, Math.ceil(Math.sqrt(opts.sceneCount))) / fps
      : TIMING_TOLERANCE.timelineVsAudioSeconds);
  const drift = timelineSeconds - audioSeconds;
  const pct = audioSeconds > 0 ? Math.abs(drift) / audioSeconds : 0;

  if (Math.abs(drift) > tolerance) {
    return [{
      code: drift < 0 ? "TIMING_TIMELINE_SHORT" : "TIMING_TIMELINE_LONG",
      severity: "BLOCKER",
      message:
        `Timeline is ${Math.abs(drift).toFixed(2)}s ${drift < 0 ? "shorter" : "longer"} than the narration ` +
        `(${(pct * 100).toFixed(1)}%): timeline ${timelineSeconds.toFixed(2)}s vs audio ${audioSeconds.toFixed(2)}s.`,
      hint:
        drift < 0
          ? "Scenes were timed from estimates or truncated — the render will drift out of sync with the voice track."
          : "Timeline over-runs the voice track — check for duplicated or padded scene timings.",
    }];
  }

  // Within the absolute bound but proportionally large: real on a long track.
  if (pct > TIMING_TOLERANCE.timelineVsAudioProportion) {
    return [{
      code: "TIMING_TIMELINE_DRIFT_PROPORTIONAL",
      severity: "WARNING",
      message:
        `Timeline drifts ${(pct * 100).toFixed(2)}% from the narration ` +
        `(${drift >= 0 ? "+" : ""}${drift.toFixed(2)}s) — above rounding noise.`,
      hint: "Check the last scenes; end-of-video desync is the usual cause.",
    }];
  }

  return [];
}

/** The rendered file must match the composition it was produced from. */
export function checkRenderMatchesTimeline(
  mp4Seconds: number,
  expectedSeconds: number,
  fps = 30,
): TimingIssue[] {
  const tolerance =
    TIMING_TOLERANCE.mp4VsTimelineFrames / fps + TIMING_TOLERANCE.mp4VsTimelineContainerSeconds;
  const drift = mp4Seconds - expectedSeconds;
  if (Math.abs(drift) <= tolerance) return [];
  return [{
    code: "TIMING_RENDER_DRIFT",
    severity: "BLOCKER",
    message:
      `Rendered MP4 is ${Math.abs(drift).toFixed(2)}s ${drift < 0 ? "shorter" : "longer"} than expected: ` +
      `${mp4Seconds.toFixed(2)}s vs ${expectedSeconds.toFixed(2)}s (tolerance ${tolerance.toFixed(2)}s).`,
    hint: "The encode truncated or padded the composition — do not audit or compare this file.",
  }];
}

export interface WordLike { startSec?: number; endSec?: number; wordIndex?: number | null }

export interface WordAlignmentOpts {
  /**
   * True when aligned words are the scene-boundary source (not just beats). Then
   * a coverage shortfall is fatal; otherwise it only degrades beat anchoring.
   */
  wordsProvideTiming?: boolean;
  /** end-of-track coverage required when words drive scene boundaries */
  timingCoverage?: number;
  /** end-of-track coverage expected when words only drive beats */
  beatCoverage?: number;
}

/**
 * Word alignment feeds two different things, so its failures have two different
 * severities. Note `endSec` coverage alone is not enough: all three real
 * words.json files cover 99.95% of their track while carrying 0–2.2% usable
 * `wordIndex` values, which is what `buildAlignedSceneTimings` actually needs.
 */
export function checkWordAlignment(
  words: WordLike[] | undefined,
  audioSeconds: number,
  opts: WordAlignmentOpts = {},
): TimingIssue[] {
  const timingSource = opts.wordsProvideTiming === true;
  const severity: TimingSeverity = timingSource ? "BLOCKER" : "WARNING";

  if (!words || !words.length) {
    return [{
      code: "TIMING_WORDS_MISSING",
      severity,
      message: timingSource
        ? "No word alignment supplied, but words are the scene-timing source."
        : "No word alignment supplied — beat emphasis falls back to proportional guessing.",
      hint: "Run scripts/align_words.py to anchor beats to the spoken word.",
    }];
  }

  const issues: TimingIssue[] = [];
  const lastEnd = words.reduce((max, w) => Math.max(max, w.endSec ?? 0), 0);

  if (lastEnd > audioSeconds + TIMING_TOLERANCE.wordsVsAudioSeconds) {
    issues.push({
      code: "TIMING_WORDS_OVERRUN",
      severity: "BLOCKER",
      message:
        `Word alignment ends at ${lastEnd.toFixed(2)}s but the voice track is ${audioSeconds.toFixed(2)}s — ` +
        `the alignment belongs to a different audio file.`,
      hint: "Re-run align_words.py against the current voice.wav.",
    });
    return issues;
  }

  const required = timingSource ? (opts.timingCoverage ?? 0.98) : (opts.beatCoverage ?? 0.9);
  const coverage = audioSeconds > 0 ? lastEnd / audioSeconds : 0;
  if (coverage < required) {
    issues.push({
      code: "TIMING_WORDS_SHORT_COVERAGE",
      severity,
      message:
        `Word alignment covers only ${(coverage * 100).toFixed(1)}% of the voice track ` +
        `(${lastEnd.toFixed(2)}s of ${audioSeconds.toFixed(2)}s).`,
      hint: "Transcription stopped early — beats after this point cannot be anchored.",
    });
  }

  // The metric that actually gates beat anchoring: how many words carry a
  // transcript index. `buildAlignedSceneTimings` is all-or-nothing on this.
  const indexed = words.filter((w) => Number.isInteger(w.wordIndex)).length;
  const indexedFraction = indexed / words.length;
  if (indexedFraction < (timingSource ? 0.98 : 0.5)) {
    issues.push({
      code: "TIMING_WORDS_UNINDEXED",
      severity,
      message:
        `Only ${indexed}/${words.length} aligned words (${(indexedFraction * 100).toFixed(1)}%) carry a ` +
        `transcript index` + (timingSource ? " — scene boundaries cannot be derived." : " — beats fall back to proportional."),
      hint: "align_words.py lost its cursor against the transcript; see attach_transcript_indices.",
    });
  }

  return issues;
}

export function formatTimingIssues(issues: TimingIssue[]): string {
  return issues
    .map((i) => {
      const tag = i.severity === "BLOCKER" ? "BLOCKER" : "WARNING";
      return `  [${tag}] ${i.code}: ${i.message}${i.hint ? `\n           → ${i.hint}` : ""}`;
    })
    .join("\n");
}

export function hasBlocker(issues: TimingIssue[]): boolean {
  return issues.some((i) => i.severity === "BLOCKER");
}
