import * as fs from "fs";
import { loadTimeline } from "../src/engine/loadTimeline";

function stats(path: string, label: string) {
  const raw = JSON.parse(fs.readFileSync(path, "utf-8"));
  const { timeline, liveliness } = loadTimeline(raw);
  const counts: Record<string, number> = {};
  for (const e of timeline.events as any[]) {
    counts[e.type] = (counts[e.type] || 0) + 1;
  }
  console.log(label, "totalEvents:", timeline.events.length, "durationFrames:", timeline.durationInFrames);
  console.log("  eventCounts:", JSON.stringify(counts));
  console.log("  liveliness:", JSON.stringify(liveliness));
}

stats("projects/video-003-tai-sao-eng-v4/timeline.json", "CODEX/V4");
stats("projects/video-003-tai-sao-eng-v5-claude/timeline.json", "CLAUDE v5");
