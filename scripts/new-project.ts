/**
 * new-project.ts — Tạo folder project mới với structure chuẩn
 * npx ts-node scripts/new-project.ts --idea "Chủ đề video"
 * npx ts-node scripts/new-project.ts --transcript "path/to/file.txt"
 * npx ts-node scripts/new-project.ts --url "https://youtube.com/watch?v=..."
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { createDefaultProjectManifest } from "../src/types/project";

const args = process.argv.slice(2);
function getArg(flag: string) { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : undefined; }

const idea = getArg("--idea");
const transcript = getArg("--transcript");
const url = getArg("--url");
const nameInput = getArg("--name");
const auto = args.includes("--auto");

const projectsDir = path.join(process.cwd(), "projects");

// Ensure projects dir exists
if (!fs.existsSync(projectsDir)) {
  fs.mkdirSync(projectsDir, { recursive: true });
  console.log("✓ Created /projects directory");
}

// Generate folder name & ID
function generateFolderName(): string {
  const existingNumbers = fs.readdirSync(projectsDir)
    .map((name) => Number(/^video-(\d+)/.exec(name)?.[1] ?? 0))
    .filter((number) => Number.isFinite(number));
  const videoNum = String(Math.max(0, ...existingNumbers) + 1).padStart(3, "0");
  const slug = nameInput
    ? nameInput.toLowerCase().replace(/[^a-z0-9]+/g, "-")
    : (idea || "untitled")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .slice(0, 30);
  return `video-${videoNum}-${slug}`;
}

const folderName = generateFolderName();
const projectPath = path.join(projectsDir, folderName);
const videoId = folderName;

console.log(`\n🎬 Creating project: ${folderName}\n`);

// Create folder
if (fs.existsSync(projectPath)) {
  console.error(`❌ Folder already exists: ${projectPath}`);
  process.exit(1);
}

fs.mkdirSync(projectPath, { recursive: true });
console.log(`✓ Created folder: ${projectPath}`);

// Create metadata.json
const metadata = {
  id: videoId,
  name: folderName.replace(/^video-\d+-/, ""),
  idea: idea || null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  status: "created",
  durationSeconds: null,
  durationFrames: null,
  assets: [],
  scriptSource: transcript ? "transcript" : url ? "youtube" : idea ? "idea" : null,
  transcriptLines: 0,
  timelineVersion: 0,
  outputPath: null,
  outputSize: null,
  notes: "",
};

fs.writeFileSync(path.join(projectPath, "metadata.json"), JSON.stringify(metadata, null, 2));
console.log("✓ Created metadata.json");
fs.writeFileSync(
  path.join(projectPath, "project.json"),
  `${JSON.stringify(createDefaultProjectManifest(videoId), null, 2)}\n`,
  "utf8",
);
console.log("✓ Created project.json");

// Create idea.txt
if (idea) {
  fs.writeFileSync(path.join(projectPath, "idea.txt"), idea);
  console.log(`✓ Created idea.txt`);
}

// Handle transcript
if (transcript) {
  if (!fs.existsSync(transcript)) {
    console.error(`❌ Transcript file not found: ${transcript}`);
    process.exit(1);
  }
  const transcriptContent = fs.readFileSync(transcript, "utf8");
  const transcriptPath = path.join(projectPath, "transcript.txt");
  fs.writeFileSync(transcriptPath, transcriptContent);
  metadata.transcriptLines = transcriptContent.split("\n").length;
  metadata.status = "transcript_provided";
  console.log(`✓ Copied transcript (${metadata.transcriptLines} lines)`);
} else if (url) {
  console.log(`\n📺 Extracting transcript from YouTube: ${url}`);
  try {
    // Call Python script to fetch transcript
    const videoId_yt = new URL(url).searchParams.get("v");
    if (!videoId_yt) {
      throw new Error("Invalid YouTube URL");
    }

    const pythonScript = `
import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
from youtube_transcript_api import YouTubeTranscriptApi

try:
    transcript = YouTubeTranscriptApi.get_transcript('${videoId_yt}', languages=['vi', 'en'])
    full_text = '\\n'.join([f"[{t['start']:.1f}s-{(t['start']+t['duration']):.1f}s]\\n{t['text']}" for t in transcript])
    print(full_text)
except:
    print("Failed to fetch transcript")
`;

    const result = execSync(`python -c "${pythonScript.replace(/"/g, '\\"')}"`, {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });

    const transcriptPath = path.join(projectPath, "transcript.txt");
    fs.writeFileSync(transcriptPath, result);
    metadata.transcriptLines = result.split("\n").length;
    metadata.status = "transcript_extracted";
    console.log(`✓ Extracted transcript (${metadata.transcriptLines} lines)`);
  } catch (e) {
    console.warn(`⚠️ Could not extract transcript: ${(e as Error).message}`);
    console.log(`   → Create transcript.txt manually in ${projectPath}`);
    metadata.status = "url_provided";
  }
}

// Create .gitkeep
fs.writeFileSync(path.join(projectPath, ".gitkeep"), "");

// Update metadata
fs.writeFileSync(path.join(projectPath, "metadata.json"), JSON.stringify(metadata, null, 2));

console.log(`\n✅ Project created: ${projectPath}`);
console.log(`\n📋 Project structure:`);
console.log(`   ${projectPath}/`);
console.log(`   ├── metadata.json`);
console.log(`   ├── project.json`);
if (idea) console.log(`   ├── idea.txt`);
if (transcript || url) console.log(`   ├── transcript.txt`);
console.log(`   ├── timeline.json (generated later)`);
console.log(`   └── output.mp4 (rendered later)`);

console.log(`\n🚀 Next steps:`);
if (!transcript && !url && idea) {
  console.log(`   1. Edit/write transcript: ${projectPath}/transcript.txt`);
  console.log(`   2. npx ts-node scripts/generate-timeline.ts --project ${videoId}`);
} else {
  console.log(`   1. npx ts-node scripts/generate-timeline.ts --project ${videoId}`);
}
console.log(`   2. npm run preview:project -- --project ${videoId}`);
console.log(`   3. npx ts-node scripts/render.ts --project ${videoId}`);

if (auto) {
  console.log(`\n⏳ Auto mode: generating timeline...`);
  // Auto-generate timeline (call generate-timeline.ts)
  try {
    execSync(`npx ts-node scripts/generate-timeline.ts --project ${videoId}`, { stdio: "inherit" });
    console.log(`\n✅ Timeline generated. Next: npm run preview:project -- --project ${videoId} or npx ts-node scripts/render.ts --project ${videoId}`);
  } catch (e) {
    console.error(`❌ Auto-generation failed. Generate manually: npx ts-node scripts/generate-timeline.ts --project ${videoId}`);
  }
}
