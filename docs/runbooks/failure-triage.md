# Failure triage

## Purpose

`npm run triage` is a **read-only Route A diagnosis tool**. It turns explicit,
persisted failure evidence into a deterministic remediation flow from the
versioned catalog. It never edits a source or artifact, starts a pipeline
phase, chooses a retained run implicitly, promotes an output, or makes a
failed gate pass.

```powershell
# Inspect canonical artifacts for one project; no retained run is selected.
npm run triage -- --project <id>

# Diagnose one specific failed canonical or staged report.
npm run triage -- --report output/<id>/.runs/<run-id>/production-report.json --json

# --path remains an equivalent explicit-path form.
npm run triage -- --path output/<id>/.runs/<run-id>/video.visual-audit.json
```

Only a workspace-relative project directory or a regular output
`production-report.json`, `visual-audit.json`, `audio-audit.json`, or
`encoding-audit.json` is accepted. Symlinks, traversal, oversized JSON, and
unsupported evidence are rejected. `--include-history` lists retained reports
but **never chooses a latest report or turns history into a retry**.

## Read the result

Every finding contains:

- `catalogId` and catalog version: stable remediation family;
- `classification`: `known` is an explicit supported flow; `unknown` means
  preserve evidence and investigate before any retry;
- scene/claim/phase and artifact evidence when supplied by the original gate;
- `repairLayer` and `sourceOfTruth`: the only layer allowed to change;
- `resolutionFlow`, `forbiddenActions`, and `canonicalRecheck`.

A clean triage result only means no explicit failure evidence was found in the
selected reports. It is **not** a render approval, acceptance, or publication
result.

## Non-negotiable repair rules

1. Repair the earliest authoritative failure. Later failures can be symptoms.
2. Change only the cited Route A source: transcript,
   `projects/<id>/storyboard-data.ts`, or a required production asset. Make
   targeted scene-local patches; do not bulk-transform authored scenes.
3. Never hand-edit compiled `timeline.json`, generated TTS/alignment,
   receipts/provenance, audit reports, or candidate/output artifacts.
4. Never lower an audit threshold, skip a gate, publish a chunk proof or
   diagnostic output, or use Route B/API generation.
5. Rebuild the affected derived artifacts and run the catalog's canonical
   recheck. A retry is valid only for the catalog's explicit infrastructure
   case and must rerun the same phase with unchanged inputs.
6. If the same evidence fails twice unchanged, stop blind retries, retain the
   reports, and investigate the root cause. A failed mandatory gate never
   becomes a pass because it was attempted.

## Remediation families

| Finding family | Repair at | Effective first repair | Required recheck |
|---|---|---|---|
| `LOW_COLOUR_REGISTER`, `OVER_SATURATED`, white-register shortage | Authored scene treatment | Adjust deliberate palette, white-space, background, or semantically relevant asset treatment. | Canonical full visual audit. |
| `LOW_VISUAL_DENSITY`, `FLAT_REGISTER`, `FOCAL_OCCUPANCY` | Authored composition | Add a meaningful focal composition, prop, diagram, evidence, or layout—not wallpaper or autonomous motion. | Rebuild, compile from measured timing, canonical render/audit. |
| `FRAME_SIMILARITY`, `WITHIN_SCENE_SIMILARITY`, `STATIC_SCENE_RUN`, seam similarity | Authored beat cadence | At the cited scene/interval, author a real pose/prop/dialogue/card/cutaway/state transition or split the scene. | Measured compile and canonical full visual audit. |
| `MISSING_*`, `MALFORMED_*` visual evidence | Canonical render/audit inputs | Correct the missing upstream artifact or pinned audit configuration; do not edit audit JSON. | Rerun canonical audit. |
| `RULE:*`, schema/asset/director/quality failure | Authored storyboard or production asset | Repair the named scene, grammar/slot/stage/anchor, semantic treatment, or missing manifest-backed asset. | Build + schema/director quality gates. |
| `TIMING_*`, `SUBTITLE_ALIGNMENT_*` | Measured audio/alignment and authored scene IDs | Correct narration/scene identity, regenerate measured TTS and alignment, then compile. Never estimate or hand-patch frames. | Timing/provenance checks plus canonical render. |
| `CHUNK_*`, `ATTESTATION_*`, `ASSEMBLY_*`, `PLAN_*`, `SECTION_*`, cross-chunk claims | Canonical chunk source/lineage | Repair source or required input; regenerate only invalidated canonical chunk stages. Never alter receipts or assemble proofs for publication. | Verify plan/attestations/assembly, then full render/audit. |
| `DLL_INIT_FAILED`, timeout, spawn/process failure | Local environment or exact failed phase | Confirm the process was not cancelled; one same-input phase retry is allowed only when the catalog says so. Repeated failure requires environment repair. | Repeat that canonical phase and retain its process report. |
| Audio/encoding/render pipeline failure | Canonical audio/timeline/render configuration | Repair the documented upstream input/configuration; do not suppress the audit. | Canonical render with all mandatory audits. |
| `unknown` or malformed evidence | Manual investigation | Preserve the original report and identify the real emitting gate. Add an explicit catalog entry before automating guidance. | Repeat the original canonical gate only after reviewed repair. |

## Exact Route A sequence after a source repair

Use the smallest valid stage first, but do not treat a diagnostic proof as
publishable:

1. `npx tsc --noEmit`
2. `npx ts-node scripts/build-storyboard.ts --project <id>`
3. Regenerate measured TTS/alignment when narration or scene identity changed.
4. Compile using measured `durations.json` and `words.json`.
5. For a chunked project, resume through the existing sequential chunk runner;
   it may reuse only valid attested stages.
6. Render the canonical full timeline and pass schema, director, timing,
   encoding, visual, audio, acceptance, and publication gates as applicable.

See [/triage](../../.claude/commands/triage.md) for the command entry point.
