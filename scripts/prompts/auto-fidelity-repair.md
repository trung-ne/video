You are repairing one failed multilingual TTS fidelity scene in the Cat Explainer
Video System. Read CLAUDE.md and obey it. This is Route A production work.

Project: {{PROJECT_ID}}
Language: {{LANGUAGE}}
Authored source: {{STORYBOARD_DATA}}
Failed scene id: {{SCENE_ID}}
Authored transcript source range: {{SOURCE_RANGE}}
Failure count for this scene in the current run: {{SCENE_FAILURE_COUNT}}
Failed run report: {{FAILED_REPORT}}
Rejected alignment report: {{REJECTED_REPORT}}

Expected spoken text:
{{EXPECTED_TEXT}}

ASR-observed words:
{{OBSERVED_TEXT}}

Metrics:
{{METRICS}}

ASR confidence: {{ASR_CONFIDENCE}}

Classification: {{CLASSIFICATION}}
Token diff: {{TOKEN_DIFF}}
Critical claim diff: {{CRITICAL_CLAIM_DIFF}}
Declared critical claims: {{CRITICAL_CLAIMS}}
Previously failed candidate fingerprints: {{CANDIDATE_HISTORY}}

Task:

1. Locate the authored SCENES entry that builds {{SCENE_ID}}. Scene ids are in
   array order; use the trailing numeric component as the one-based index.
2. Diagnose the exact substitutions/deletions from the rejected alignment.
   If classification is `scene_too_long`, this is an authored-storyboard
   boundary failure, not a TTS pronunciation failure: replace the one source
   entry with several sentence-boundary entries. Give each a deliberate visual
   grammar, purpose, viewer focus, semantic visual and marker; preserve source
   coverage and all claims. Do not create mechanical repeated layouts.
3. Edit only {{STORYBOARD_DATA}} with apply_patch. Add a narrowly scoped
   `pronunciationOverrides` entry when a foreign term is the sole problem, so
   canonical narration/subtitles remain unchanged. Otherwise add or adjust the
   entry's `narrationOverride` using natural, unambiguous {{LANGUAGE}} wording.
   If the failure count is 2 or more, fully rephrase the sentence(s) while
   preserving the claims; do not toggle one word back to an earlier wording.
   Never reuse a candidate represented in the failed fingerprint history.
4. Preserve every material claim, number, causal relation and named concept in
   the declared source range. You may expand abbreviations and replace a foreign
   term with its Vietnamese explanation. Do not shorten the scene merely to
   game the metric.
5. Do not edit transcript.txt, tts_router.py, tts_fidelity.py, thresholds,
   generated storyboard.json, timing artifacts, or any gate. Do not run TTS,
   compile, render, or use diagnostic/skip flags; the parent runner does that.
6. Finish after the single authored repair. In the final message, state the
   exact words changed and why they should align better.

This is a repair loop. A failure must improve the authored TTS source, never
weaken verification.
