---
description: Read-only diagnosis of an explicit Route A failure
argument-hint: <project-id | output report path>
---

# /triage — Read-only failure diagnosis

```powershell
# Canonical project artifacts only
npm run triage -- --project <id>

# One explicitly selected failed canonical or retained report
npm run triage -- --report output/<id>/.runs/<run-id>/production-report.json --json
```

Run this before repair when a Route A build, chunk checkpoint, render, or audit
fails. It reads artifacts only, classifies explicit evidence with the
versioned remediation catalog, and identifies the permitted repair layer. It
does **not** edit files, build, run TTS/alignment, compile, render, promote,
select a latest retained run, or make a failed gate pass.

Use `--report` (or the equivalent `--path`) for one workspace-relative regular
output report: `production-report.json`, `visual-audit.json`,
`audio-audit.json`, or `encoding-audit.json`. `--include-history` lists
retained reports without selecting or retrying any of them.

Follow the result's `repairLayer`, `sourceOfTruth`, `resolutionFlow`, and
`canonicalRecheck`. Repair only the Route A source of record—transcript,
`projects/<id>/storyboard-data.ts`, or a required production asset—then rerun
the normal affected pipeline. Do not edit compiled `timeline.json`, generated
TTS/alignment files, receipts/provenance, reports, or output artifacts. Never
lower thresholds, skip a mandatory gate, publish a proof/diagnostic, or use
Route B/API generation.

An `unknown` finding is a stop-for-investigation, not a retry instruction. The
same unchanged failure after two attempts requires root-cause work; it never
becomes a pass.

See [failure-triage runbook](../../docs/runbooks/failure-triage.md).
