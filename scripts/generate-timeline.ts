/**
 * Route B tombstone.
 *
 * Production authoring is Route A only. Keep this entry point so stale scripts
 * fail closed before loading providers, credentials, prompts, or project files.
 */
console.error(`
❌ Route B is locked for this repository.

Only Route A (session-authored) is allowed:
  1. Author projects/<id>/storyboard-data.ts from the complete transcript.
  2. npx ts-node scripts/build-storyboard.ts --project <id>
  3. For long videos, process every semantic chunk checkpoint in order.
  4. Run measured TTS + alignment, compile, then render the canonical project.

Do not use npm run generate, scripts/generate-timeline.ts, or new-project.ts --auto.
`);
process.exit(2);
