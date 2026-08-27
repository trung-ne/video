import * as fs from "fs";
import * as path from "path";

function readJson(filePath: string): any {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid promotion artifact ${filePath}: ${(error as Error).message}`);
  }
}

function assertPromotionSet(stagingDir: string, names: string[]): string {
  const videos = names.filter((name) => name.toLowerCase().endsWith(".mp4"));
  if (videos.length !== 1) {
    throw new Error(`Promotion requires exactly one staged MP4; found ${videos.length}.`);
  }
  const stem = videos[0].replace(/\.mp4$/i, "");
  const required = [
    `${stem}.mp4`,
    `${stem}.encoding-audit.json`,
    `${stem}.audio-audit.json`,
    `${stem}.visual-audit.json`,
    `${stem}.contact.jpg`,
    `${stem}.production-report.json`,
  ];
  const missing = required.filter((name) => !names.includes(name));
  if (missing.length) throw new Error(`Promotion artifact set is incomplete: ${missing.join(", ")}`);

  const report = readJson(path.join(stagingDir, `${stem}.production-report.json`));
  const encoding = readJson(path.join(stagingDir, `${stem}.encoding-audit.json`));
  const audio = readJson(path.join(stagingDir, `${stem}.audio-audit.json`));
  const visual = readJson(path.join(stagingDir, `${stem}.visual-audit.json`));
  if (report.status !== "candidate-ready") throw new Error("Only candidate-ready reports may be promoted.");
  if (encoding.passed !== true || audio.passed !== true || visual.passed !== true) {
    throw new Error("Promotion requires passing encoding, audio, and visual audit reports.");
  }
  return stem;
}

/**
 * Transactionally replaces the canonical artifact set. Existing files are first
 * archived; if any move fails, both the old set and staged set are restored.
 * The production report moves last so it can never claim a partial promotion.
 */
export function promoteArtifacts(stagingDir: string, finalDir: string, runId: string): string | undefined {
  fs.mkdirSync(finalDir, { recursive: true });
  const names = fs.readdirSync(stagingDir).filter((name) => name !== "_props.json");
  const stem = assertPromotionSet(stagingDir, names);
  const canonicalSuffixes = [
    ".mp4",
    ".encoding-audit.json",
    ".audio-audit.json",
    ".visual-audit.json",
    ".contact.jpg",
    ".production-report.json",
  ];
  const canonicalNames = stem
    ? canonicalSuffixes
        .map((suffix) => `${stem}${suffix}`)
        .filter((name) => fs.existsSync(path.join(finalDir, name)))
    : [];
  const namesToArchive = [...new Set([...canonicalNames, ...names])];
  const reportName = names.find((name) => name.endsWith(".production-report.json"));
  const ordered = [
    ...names.filter((name) => name !== reportName),
    ...(reportName ? [reportName] : []),
  ];
  const archiveDir = path.join(finalDir, ".runs", `previous-${runId}`);
  const archived: string[] = [];
  const promoted: string[] = [];
  try {
    for (const name of namesToArchive) {
      const current = path.join(finalDir, name);
      if (!fs.existsSync(current)) continue;
      fs.mkdirSync(archiveDir, { recursive: true });
      fs.renameSync(current, path.join(archiveDir, name));
      archived.push(name);
    }
    for (const name of ordered) {
      fs.renameSync(path.join(stagingDir, name), path.join(finalDir, name));
      promoted.push(name);
    }
    fs.rmSync(stagingDir, { recursive: true, force: true });
    return archived.length ? archiveDir : undefined;
  } catch (error) {
    for (const name of promoted.reverse()) {
      const current = path.join(finalDir, name);
      if (fs.existsSync(current)) fs.renameSync(current, path.join(stagingDir, name));
    }
    for (const name of archived.reverse()) {
      const archivedPath = path.join(archiveDir, name);
      if (fs.existsSync(archivedPath)) fs.renameSync(archivedPath, path.join(finalDir, name));
    }
    if (fs.existsSync(archiveDir) && fs.readdirSync(archiveDir).length === 0) {
      fs.rmSync(archiveDir, { recursive: true, force: true });
    }
    throw error;
  }
}

function newestFirst(entries: string[]): string[] {
  return entries.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

function removeLargeArtifacts(dir: string, preserveMp4: boolean): void {
  for (const name of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, name);
    if (!fs.statSync(fullPath).isFile()) continue;
    const large = /\.mp4$/i.test(name) || /render.*\.log$/i.test(name) || name === "_props.json";
    if (large && !(preserveMp4 && /\.mp4$/i.test(name))) fs.rmSync(fullPath, { force: true });
  }
}

export function shouldPreserveFailedMp4(error: string): boolean {
  return /timing|encoding|unreadable|visual[- ]audit/i.test(error);
}

/** Keep one previous MP4, ten successful evidence sets, and two small failed runs. */
export function pruneRunHistory(finalDir: string): void {
  const runsDir = path.join(finalDir, ".runs");
  if (!fs.existsSync(runsDir)) return;
  const directories = fs.readdirSync(runsDir)
    .filter((name) => name !== ".lock")
    .map((name) => path.join(runsDir, name))
    .filter((candidate) => fs.statSync(candidate).isDirectory());

  const previous = newestFirst(directories.filter((dir) => path.basename(dir).startsWith("previous-")));
  previous.forEach((dir, index) => {
    if (index >= 10) fs.rmSync(dir, { recursive: true, force: true });
    else removeLargeArtifacts(dir, index === 0);
  });

  const diagnostics = newestFirst(directories.filter((dir) => path.basename(dir).startsWith("run-")));
  diagnostics.forEach((dir, index) => {
    if (index >= 2) {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    }
    const report = ["production-report.json", ...fs.readdirSync(dir).filter((n) => n.endsWith(".production-report.json"))]
      .map((name) => path.join(dir, name))
      .find((candidate) => fs.existsSync(candidate));
    let preserveMp4 = false;
    if (report) {
      try {
        const error = String(JSON.parse(fs.readFileSync(report, "utf8")).error ?? "");
        preserveMp4 = shouldPreserveFailedMp4(error);
      } catch {
        preserveMp4 = false;
      }
    }
    removeLargeArtifacts(dir, preserveMp4);
  });
}
