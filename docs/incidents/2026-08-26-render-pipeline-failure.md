# Video-007 render pipeline failure — 2026-08-26

## Summary

Video `video-007-han-quoc-dau-tu-production` exposed two separate failure classes that were initially conflated:

1. Three background runs were reported by the harness as `killed`, but their child-process logs show Windows native exits `3221225794` (`0xC0000142`, `STATUS_DLL_INIT_FAILED`) after substantial or complete work. These were infrastructure/process failures, not quality-gate results.
2. A later run from a normal terminal completed the render, bitrate normalization, encoding probe, and timing audit, then legitimately failed the first full visual audit on similarity thresholds. This was a valid product-quality failure.

## Impact

- No video-007 candidate was promoted to the canonical output directory; the prior/canonical artifact set remained untouched.
- Multiple full 36,031-frame renders were repeated. Individual background attempts ran for approximately 16, 32, and 21 minutes; one failure occurred only after rendering and normalization had completed.
- The legitimate failed candidate retained a 627 MB MP4, but the pipeline had no supported phase resume, so retrying a post-render phase required another complete render.
- The harness label `killed` obscured the actionable native exit status and made infrastructure failures look like external cancellation.
- Blocking `execSync`/`execFileSync` calls prevented the Node heartbeat timer from running during long Remotion/FFmpeg phases. The old lock policy could therefore classify a healthy local render as stale after five minutes and permit a concurrent writer.
- Old argument parsing ignored a positional project ID. `npx ts-node scripts/render.ts video-007-han-quoc-dau-tu-production` consequently fell back to the root scratch `timeline.json`, producing an unrelated error instead of rendering video-007.

## Evidence

- Native task logs show FFmpeg or FFprobe exiting `3221225794` after the jobs had progressed beyond the harness's nominal ten-minute background timeout. No explicit `TaskStop` was issued. The task logs are:
  - `C:\Users\ADMINI~1\AppData\Local\Temp\claude\C--Users-Administrator-Documents-video\94614f7a-378a-4758-a1d8-8118da9f5524\tasks\bcd0p40qp.output`
  - `C:\Users\ADMINI~1\AppData\Local\Temp\claude\C--Users-Administrator-Documents-video\94614f7a-378a-4758-a1d8-8118da9f5524\tasks\brhrhs897.output`
  - `C:\Users\ADMINI~1\AppData\Local\Temp\claude\C--Users-Administrator-Documents-video\94614f7a-378a-4758-a1d8-8118da9f5524\tasks\bf1f657j8.output`
- The durable-terminal candidate is recorded under `output/video-007-han-quoc-dau-tu-production/.runs/run-2026-08-26T08-49-24-768Z/`. Its production report records measured timing, 1,201.088 seconds of MP4 versus 1,201.033 seconds expected (0.055-second drift), and failure at the visual-audit command.
- Its visual report sampled 241 frames and failed both configured similarity gates:
  - adjacent near-duplicate ratio: `23.33%` (limit `22%`);
  - within-scene near-duplicate ratio: `61.8%` (limit `15%`).
  Cross-scene duplicates were only `0.66%`, supporting the conclusion that the failure was prolonged static composition within scenes rather than repeated scene selection.
- The canonical project output contained no promoted `video.mp4`; failed evidence remained isolated under `.runs`.

## Immediate guardrails implemented

- CLI parsing now rejects positional and unknown arguments, requires flag values, and requires exactly one of `--project` or `--timeline`. A malformed positional project can no longer silently route to the root timeline.
- The render lock is acquired before shared audio preparation. For a same-host lock, a live owner PID is authoritative even when the heartbeat timestamp is old; only a dead local owner can be reclaimed.
- Diagnostic options require an explicit noncanonical `--out` and cannot replace the canonical candidate.
- Promotion now requires exactly one MP4, the complete evidence set, a `candidate-ready` report, and passing encoding, audio, and visual reports. A missing visual-audit script/report is a hard failure.
- Failed runs remain staged with a diagnostic production report, while transactional promotion keeps canonical artifacts unchanged.

These are containment measures. The pipeline still uses blocking child-process execution and still lacks resume.

## Remaining root-cause plan

1. **Async child runner:** replace shell-string `execSync` and blocking `execFileSync` phases with an argument-array `spawn` runner. Keep the event loop available for lock heartbeats, record the exact failed phase and native status, write an interrupted report on ordinary termination, and apply only bounded phase-local retries for `0xC0000142`.
2. **Hash-bound phase resume:** persist a `run-state.json` with completed phases (`rendered`, `normalized`, encoding/timing/visual/audio audited, report-ready, promoted) and hashes for the timeline, source/prepared audio, quality configuration, reference baseline, render-affecting flags, and staged MP4. Resume must refuse any hash mismatch and must not turn a legitimate failed audit into a pass.
3. **End-to-end provenance:** bind the production report, acceptance, and publication checks to the same timeline/config/reference hashes so a staged artifact cannot be resumed or published after its inputs change.

## Verification

- `npm test` passed all 90 tests after the guardrails were applied, including regression cases for a stale heartbeat with a live PID, dead-owner reclamation, concurrent-writer refusal, diagnostic promotion refusal, complete artifact promotion, and failed visual-audit MP4 retention.
- The retained video-007 visual-audit JSON provides a reproducible legitimate quality failure, distinct from the three `0xC0000142` infrastructure exits.
- No code was changed as part of writing this report.
