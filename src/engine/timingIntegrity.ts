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

import { SceneTimingSource, BeatTimingSource, SceneBeatTimingSource, TimingProvenance } from "../types/scene";

export type TimingSeverity = "BLOCKER" | "WARNING";

// Re-exported so timing consumers have one import site.
export type { SceneTimingSource, BeatTimingSource, TimingProvenance };

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

export interface WordLike {
  startSec?: number;
  endSec?: number;
  wordIndex?: number | null;
  scene?: string;
  sceneWordIndex?: number | null;
}

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
  const indexed = words.filter((w) =>
    Number.isInteger(w.sceneWordIndex) || Number.isInteger(w.wordIndex)
  ).length;
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

/**
 * Subtitle timing is a production invariant separate from coarse audio
 * coverage. A words file can reach the end of voice.wav yet still be unusable
 * when it maps the source transcript rather than the narration TTS spoke.
 */
export function checkCanonicalSubtitleAlignment(
  words: WordLike[] | undefined,
  scenes: Array<{ id?: string; narration?: string }> | undefined,
  alignment: any,
): TimingIssue[] {
  if (!alignment || alignment.source !== "canonical-tts-scenes") {
    return [{
      code: "SUBTITLE_ALIGNMENT_COVERAGE",
      severity: "BLOCKER",
      message: "Subtitle alignment is not bound to canonical tts_scenes narration.",
      hint: "Run align_words.py with --scenes projects/<id>/tts_scenes.json.",
    }];
  }
  const coverage = Number(alignment.coverage);
  if (!Number.isFinite(coverage) || coverage < 0.98) {
    return [{
      code: "SUBTITLE_ALIGNMENT_COVERAGE",
      severity: "BLOCKER",
      message: `Canonical subtitle alignment covers ${(Number.isFinite(coverage) ? coverage * 100 : 0).toFixed(1)}% of spoken tokens; minimum is 98.0%.`,
      hint: "Re-run alignment against the current voice.wav and exact tts_scenes.json.",
    }];
  }
  const matchedCoverage = Number(alignment.matchedCoverage ?? coverage);
  if (!Number.isFinite(matchedCoverage) || matchedCoverage < 0.85) {
    return [{
      code: "SUBTITLE_ALIGNMENT_COVERAGE",
      severity: "BLOCKER",
      message: `Canonical subtitle alignment has only ${(Number.isFinite(matchedCoverage) ? matchedCoverage * 100 : 0).toFixed(1)}% directly matched words; minimum is 85.0%.`,
      hint: "Improve the alignment model/audio or inspect the TTS pronunciation before production.",
    }];
  }
  for (const scene of scenes ?? []) {
    // Must stay token-compatible with align_words.py::transcript_words().
    const tokens = String(scene.narration ?? "").match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) ?? [];
    if (!tokens.length || !scene.id) continue;
    const indexed = new Set((words ?? [])
      .filter((word) => word.scene === scene.id && Number.isInteger(word.sceneWordIndex))
      .map((word) => word.sceneWordIndex as number));
    if (indexed.size !== tokens.length || tokens.some((_, index) => !indexed.has(index))) {
      return [{
        code: "SUBTITLE_ALIGNMENT_COVERAGE",
        severity: "BLOCKER",
        message: `${scene.id} has ${indexed.size}/${tokens.length} canonical subtitle tokens aligned.`,
        hint: "The spoken narration and tts_scenes text differ, or alignment skipped words.",
      }];
    }
  }
  return [];
}

const SCENE_TIMING_SOURCES: SceneTimingSource[] = ["durations", "aligned-words", "authored-silent", "estimated"];
const BEAT_TIMING_SOURCES: BeatTimingSource[] = ["aligned-words", "proportional"];

/**
 * Gate a timeline's provenance before it is rendered or published.
 *
 * Absent provenance fails rather than passes. Every timeline written before this
 * field existed lacks it, including ones whose scene durations were distributed
 * proportionally by word count — those have a plausible total and estimated
 * internals, which is exactly the state that must not slip through.
 */
export function checkTimingProvenance(
  provenance: unknown,
  opts: { allowUnprovenanced?: boolean } = {},
): TimingIssue[] {
  if (provenance === undefined || provenance === null) {
    return opts.allowUnprovenanced
      ? [{
          code: "TIMING_PROVENANCE_UNKNOWN",
          severity: "WARNING",
          message: "Timeline carries no timing provenance; proceeding because it was explicitly allowed.",
          hint: "Recompile from a storyboard with measured TTS timing to remove this.",
        }]
      : [{
          code: "TIMING_PROVENANCE_MISSING",
          severity: "BLOCKER",
          message: "Timeline carries no timing provenance, so its timing cannot be trusted.",
          hint: "Recompile it, or pass --allow-unprovenanced-timing to accept a legacy artifact.",
        }];
  }

  const p = provenance as Partial<TimingProvenance>;
  const issues: TimingIssue[] = [];

  if (p.mode !== "measured" && p.mode !== "estimated") {
    issues.push({
      code: "TIMING_PROVENANCE_MALFORMED",
      severity: "BLOCKER",
      message: `timingProvenance.mode must be "measured" or "estimated", got ${JSON.stringify(p.mode)}.`,
    });
  }
  if (!p.sceneTimingSource || !SCENE_TIMING_SOURCES.includes(p.sceneTimingSource)) {
    issues.push({
      code: "TIMING_PROVENANCE_MALFORMED",
      severity: "BLOCKER",
      message: `timingProvenance.sceneTimingSource is invalid: ${JSON.stringify(p.sceneTimingSource)}.`,
    });
  }
  if (!p.beatTimingSource || !BEAT_TIMING_SOURCES.includes(p.beatTimingSource)) {
    issues.push({
      code: "TIMING_PROVENANCE_MALFORMED",
      severity: "BLOCKER",
      message: `timingProvenance.beatTimingSource is invalid: ${JSON.stringify(p.beatTimingSource)}.`,
    });
  }
  if (!Number.isFinite(p.measuredSceneCount as number)) {
    issues.push({
      code: "TIMING_PROVENANCE_MALFORMED",
      severity: "BLOCKER",
      message: "timingProvenance.measuredSceneCount is missing.",
    });
  }

  // Internally contradictory stamps are worse than a missing one: they assert
  // something false.
  if (p.mode === "measured" && p.sceneTimingSource === "estimated") {
    issues.push({
      code: "TIMING_PROVENANCE_INCONSISTENT",
      severity: "BLOCKER",
      message: 'timingProvenance claims mode "measured" with sceneTimingSource "estimated".',
    });
  }

  if (p.mode === "estimated" && !issues.length) {
    issues.push({
      code: "TIMING_ESTIMATED",
      severity: "BLOCKER",
      message: "Timeline was compiled from word-count estimates, not measured audio.",
      hint: "This is a preview artifact. Run TTS and recompile to produce a production timeline.",
    });
  }

  return issues;
}

const SCENE_BEAT_SOURCES: SceneBeatTimingSource[] = [
  "aligned-words",
  "authored-beat",
  "sentence-boundary",
  "source-range-proportional",
];

export function checkSceneBeatTimingSources(
  scenes: Array<{ id?: string; beatTimingSource?: unknown }> | undefined,
  provenance: TimingProvenance | undefined,
): TimingIssue[] {
  if (!scenes || !provenance) return [];
  const missing = scenes.filter((scene) => !SCENE_BEAT_SOURCES.includes(scene.beatTimingSource as SceneBeatTimingSource));
  if (missing.length) {
    return [{
      code: "TIMING_BEAT_SOURCE_MISSING",
      severity: "BLOCKER",
      message: `${missing.length}/${scenes.length} scenes do not declare their beat timing source.`,
      hint: "Recompile so each scene records the fallback ladder branch it actually used.",
    }];
  }
  const actual = scenes.reduce<Partial<Record<SceneBeatTimingSource, number>>>((counts, scene) => {
    const source = scene.beatTimingSource as SceneBeatTimingSource;
    counts[source] = (counts[source] ?? 0) + 1;
    return counts;
  }, {});
  if (JSON.stringify(actual) !== JSON.stringify(provenance.beatTimingSummary ?? {})) {
    return [{
      code: "TIMING_BEAT_SUMMARY_DRIFT",
      severity: "BLOCKER",
      message: "timingProvenance.beatTimingSummary does not match scene-level timing sources.",
      hint: "The timeline or provenance was modified after compile.",
    }];
  }
  return [];
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
