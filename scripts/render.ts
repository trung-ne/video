/**
 * render.ts — CLI render pipeline
 *
 * Usage:
 *   npx ts-node scripts/render.ts --project <id> --out output/<id>/video.mp4
 *   npx ts-node scripts/render.ts --timeline timeline.json --out output/video.mp4
 *   npx ts-node scripts/render.ts --project <id> --scene <scene-id> --halo-scenes 1 --out diagnostics/<id>/<scene-id>.mp4
 *
 * `--scene` is a non-promotable authoring diagnostic. It selects the requested
 * scene plus an optional adjacent-scene halo and always requires explicit output.
 * Exactly one of --project or --timeline is required.
 *
 * Without --out, the output path defaults to output/<id>/video.mp4 (id from
 * --project, or from the parent folder name when --timeline points inside
 * projects/<id>/) — every artifact for a video (video.mp4, contact.jpg,
 * *-audit.json, production-report.json) lands in one output/<id>/ folder
 * instead of flat output/<id>-suffix.ext files.
 */

import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { loadLocalEnvironment } from "./load-env";
import { loadTimeline } from "../src/engine/loadTimeline";
import { printLivelinessReport } from "../src/engine/liveliness";
import { checkSpatialIntegrity, formatSpatialIntegrityReport } from "../src/engine/spatialIntegrity";
import { validateTimeline, printValidationResult } from "../src/ai/validateTimeline";
import { runScopedQualityCheck, printQualityReport } from "../src/ai/qualityCheck";
import { QualityScope, orderedSceneIdsForScope, parseQualityScope } from "../src/types/chunk";
import { prepareTimelineAudio, writeAudioAudit, resolvePublicAudio, sha256File } from "../src/audio/prepareAudio";
import { adjacentArtifactInputs, verifyArtifactInputs } from "../src/engine/artifactIntegrity";
import { acquireRenderLock } from "../src/engine/renderLock";
import { promoteArtifacts, pruneRunHistory } from "../src/engine/promoteArtifacts";
import { buildReferenceComparison } from "../src/engine/referenceComparison";
import { buildDirectionSummary } from "../src/engine/directionReport";
import { DEFAULT_PROXY_SCALE, getScaledDimensions } from "../src/engine/renderDimensions";
import {
  checkRenderMatchesTimeline,
  checkSceneBeatTimingSources,
  checkTimelineSpansAudio,
  checkTimingProvenance,
  formatTimingIssues,
  hasBlocker,
} from "../src/engine/timingIntegrity";
import referenceQuality from "../config/reference-quality.json";
import { assertTimelineAssetStyle } from "../src/engine/assetStyle";
import { verifyChunkAssemblyProvenance } from "../src/engine/chunkProvenance";
import {
  assertCanonicalTimelinePath,
  assertOutputProjectIdentity,
  assertProjectCanonicalTimeline,
  buildCanonicalTimelineIdentity,
  sameResolvedPath,
} from "../src/engine/publicationIntegrity";
import {
  assertChunkProofBindingUnchanged,
  bindChunkProofToProject,
  ChunkProofBinding,
} from "../src/engine/chunkProofIntegrity";
import {
  assertVisualAuditReport,
  assertVisualMeasurementConfiguration,
  normalizeVisualAuditOffsets,
  VisualMeasurementContract,
} from "../src/engine/visualAuditIntegrity";
import {
  ProcessRunError,
  runProcessWithDllInitRetry,
} from "../src/engine/childProcessRunner";

loadLocalEnvironment();

const args = process.argv.slice(2);

const VALUE_FLAGS = new Set(["--project", "--timeline", "--out", "--composition", "--frames", "--scene", "--halo-scenes", "--quality-scope"]);
const BOOLEAN_FLAGS = new Set([
  "--proxy",
  "--skip-validate",
  "--skip-quality",
  "--skip-audio-prepare",
  "--skip-visual-audit",
  "--skip-audio-audit",
  "--allow-unprovenanced-timing",
  "--chunk-proof",
]);

function parseCli(argv: string[]): Map<string, string | true> {
  const parsed = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag.startsWith("--")) throw new Error(`Unexpected positional argument: ${flag}`);
    if (!VALUE_FLAGS.has(flag) && !BOOLEAN_FLAGS.has(flag)) throw new Error(`Unknown option: ${flag}`);
    if (parsed.has(flag)) throw new Error(`Option may be specified only once: ${flag}`);
    if (VALUE_FLAGS.has(flag)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Option requires a value: ${flag}`);
      parsed.set(flag, value);
      index += 1;
    } else {
      parsed.set(flag, true);
    }
  }
  const sourceCount = Number(parsed.has("--project")) + Number(parsed.has("--timeline"));
  if (sourceCount !== 1) throw new Error("Exactly one of --project or --timeline is required.");
  return parsed;
}

let cli: Map<string, string | true>;
try {
  cli = parseCli(args);
} catch (error) {
  console.error(`Render CLI error: ${(error as Error).message}`);
  process.exit(1);
}
const valueOf = (flag: string, fallback = ""): string => String(cli.get(flag) ?? fallback);
const hasFlag = (flag: string): boolean => cli.has(flag);

const projectArg = valueOf("--project");
const projectPath = projectArg
  ? (fs.existsSync(projectArg) || projectArg.includes("/") || projectArg.includes("\\")
      ? projectArg
      : path.join("projects", projectArg))
  : "";
const timelinePath = valueOf("--timeline", projectPath ? path.join(projectPath, "timeline.json") : "");
let selectedProjectPath: string | null = projectPath ? path.resolve(projectPath) : null;
let selectedProjectId: string | null = projectPath ? path.basename(path.resolve(projectPath)) : null;

// Derive a project id for the default output folder: from --project, or from
// the parent directory name when --timeline points inside projects/<id>/.
function defaultOutPath(): string {
  const id = projectPath
    ? path.basename(projectPath)
    : (() => {
        const dir = path.basename(path.dirname(timelinePath));
        return dir && dir !== "." ? dir : null;
      })();
  return id ? path.join("output", id, "video.mp4") : "output/video.mp4";
}

if (!selectedProjectId) {
  const inferred = (() => {
    const dir = path.dirname(timelinePath);
    return dir && dir !== "." ? path.resolve(dir) : null;
  })();
  selectedProjectPath = inferred;
  selectedProjectId = inferred ? path.basename(inferred) : null;
}

const outPath = valueOf("--out", defaultOutPath());
const compositionId = valueOf("--composition", "CatExplainer");
const isProxy = hasFlag("--proxy");
const isChunkProof = hasFlag("--chunk-proof");
const qualityScopePath = valueOf("--quality-scope");
let qualityScope: QualityScope = { kind: "global" };
if (qualityScopePath) {
  if (!fs.existsSync(qualityScopePath)) {
    console.error(`Quality scope file not found: ${qualityScopePath}`);
    process.exit(1);
  }
  try {
    const parsedScope = JSON.parse(fs.readFileSync(qualityScopePath, "utf8"));
    qualityScope = parseQualityScope(parsedScope);
  } catch (error) {
    console.error(`Quality scope is invalid: ${qualityScopePath}: ${(error as Error).message}`);
    process.exit(1);
  }
}
if (qualityScopePath && !isChunkProof) {
  console.error("--quality-scope is reserved for non-promotable --chunk-proof renders.");
  process.exit(1);
}
if (isChunkProof) {
  if (!qualityScopePath || qualityScope.kind !== "chunk") {
    console.error("--chunk-proof requires a valid --quality-scope chunk file.");
    process.exit(1);
  }
  if (!hasFlag("--timeline") || !hasFlag("--out") || /(^|[\\/])output([\\/]|$)/i.test(path.resolve(outPath))) {
    console.error("--chunk-proof requires explicit --timeline and a non-output/ proof --out path.");
    process.exit(1);
  }
  const unsafeFlags = ["--proxy", "--frames", "--skip-validate", "--skip-quality", "--skip-audio-prepare", "--skip-visual-audit", "--skip-audio-audit", "--allow-unprovenanced-timing"]
    .filter(hasFlag);
  if (unsafeFlags.length) {
    console.error(`--chunk-proof rejects diagnostic bypasses: ${unsafeFlags.join(", ")}`);
    process.exit(1);
  }
}
const framesArg = valueOf("--frames");
const sceneArg = valueOf("--scene");
const haloScenesArg = valueOf("--halo-scenes", "0");
if (sceneArg && framesArg) {
  console.error("--scene and --frames cannot be combined.");
  process.exit(1);
}
let haloScenes = 0;
try {
  haloScenes = Number(haloScenesArg);
  if (!Number.isInteger(haloScenes) || haloScenes < 0 || haloScenes > 4) {
    throw new Error("--halo-scenes must be an integer from 0 to 4.");
  }
  if (haloScenes && !sceneArg) throw new Error("--halo-scenes requires --scene.");
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
function parseFrameRange(value: string): { start: number; end: number } | null {
  if (!value) return null;
  const parts = value.split("-");
  if (parts.length > 2 || parts.some((part) => part.trim() === "")) {
    throw new Error(`Invalid --frames range: ${value}`);
  }
  const start = Number(parts[0]);
  const end = parts.length === 2 ? Number(parts[1]) : start;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
    throw new Error(`Invalid --frames range: ${value}`);
  }
  return { start, end };
}
let frameRange: { start: number; end: number } | null = null;
try {
  frameRange = parseFrameRange(framesArg);
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
const diagnosticFlags = [
  "--scene",
  "--proxy",
  "--frames",
  "--skip-validate",
  "--skip-quality",
  "--skip-audio-prepare",
  "--skip-visual-audit",
  "--skip-audio-audit",
  "--allow-unprovenanced-timing",
].filter(hasFlag);
const diagnosticRun = diagnosticFlags.length > 0;
const pipelineAbort = new AbortController();
const abortPipeline = () => pipelineAbort.abort();
process.once("SIGINT", abortPipeline);
process.once("SIGTERM", abortPipeline);
if (diagnosticRun && (!hasFlag("--out") || path.resolve(outPath) === path.resolve(defaultOutPath()))) {
  console.error(
    `Diagnostic options (${diagnosticFlags.join(", ")}) require an explicit noncanonical --out path. ` +
    "They can never replace the canonical production candidate."
  );
  process.exit(1);
}
let frameRangeStart = frameRange?.start ?? 0;
let sceneDiagnostic: { requestedSceneId: string; sceneIds: string[]; haloScenes: number } | null = null;
const referenceBaselinePath = path.resolve("config/reference-visual-baseline.json");
if (!fs.existsSync(referenceBaselinePath)) {
  console.error(`Reference baseline not found: ${referenceBaselinePath}`);
  process.exit(1);
}
const referenceBaseline = JSON.parse(fs.readFileSync(referenceBaselinePath, "utf8"));
let visualMeasurementContract: VisualMeasurementContract;
try {
  visualMeasurementContract = assertVisualMeasurementConfiguration(
    referenceQuality.visualAudit,
    referenceBaseline,
  );
} catch (error) {
  console.error(`Visual measurement configuration is invalid: ${(error as Error).message}`);
  process.exit(1);
}
const referenceVideoPath = path.resolve(String(referenceBaseline.reference ?? ""));
const requiresReferenceComparison = !diagnosticRun && !isProxy && !framesArg && !isChunkProof;
// A diagnostic/proxy render still needs the measurement contract, but it does
// not compare against the reference MP4. Keep a missing reference from blocking
// schema and storyboard debugging; full promotable candidates verify it below.
if (requiresReferenceComparison && (!fs.existsSync(referenceVideoPath)
    || sha256File(referenceVideoPath) !== referenceBaseline.referenceSha256)) {
  console.error(
    `Reference baseline hash mismatch for ${referenceVideoPath}. ` +
    "Run npm run reference-audit only after confirming the intended reference file."
  );
  process.exit(1);
}

/** Container duration in seconds, or undefined if the file is missing/unreadable. */
function probeDurationSeconds(filePath: string): number | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  try {
    const ffprobePath = require("@ffprobe-installer/ffprobe").path as string;
    const out = execFileSync(ffprobePath, [
      "-v", "error", "-show_entries", "format=duration", "-of", "json", filePath,
    ], { encoding: "utf8" });
    const seconds = Number(JSON.parse(out)?.format?.duration);
    return Number.isFinite(seconds) ? seconds : undefined;
  } catch {
    return undefined;
  }
}

function runEncodingAudit(videoPath: string, recordAs = videoPath): any {
  const ffprobePath = require("@ffprobe-installer/ffprobe").path as string;
  const rawReport = execFileSync(ffprobePath, [
    "-v", "error", "-show_streams", "-show_format", "-of", "json", videoPath,
  ], { encoding: "utf8" });
  const probe = JSON.parse(rawReport);
  const video = (probe.streams ?? []).find((stream: any) => stream.codec_type === "video");
  const audio = (probe.streams ?? []).find((stream: any) => stream.codec_type === "audio");
  const failures: string[] = [];
  if (!video || video.width !== 1920 || video.height !== 1080) failures.push("Video must be 1920x1080.");
  if (video && video.codec_name !== "h264") failures.push(`Video codec must be h264, got ${video.codec_name}.`);
  if (video && ![referenceQuality.encoding.pixelFormat, "yuvj420p"].includes(video.pix_fmt)) {
    failures.push(`Pixel format must be ${referenceQuality.encoding.pixelFormat}-compatible, got ${video.pix_fmt}.`);
  }
  const rateParts = String(video?.avg_frame_rate ?? "0/1").split("/").map(Number);
  const fps = rateParts[1] ? rateParts[0] / rateParts[1] : 0;
  if (Math.abs(fps - 30) > 0.1) failures.push(`Frame rate must be 30fps, got ${fps}.`);
  const videoBitrate = Number(video?.bit_rate ?? 0);
  const totalBitrate = Number(probe.format?.bit_rate ?? 0);
  if (videoBitrate < referenceQuality.encoding.minimumVideoBitrate) {
    failures.push(`1080p video bitrate is below ${referenceQuality.encoding.minimumVideoBitrate} bps.`);
  }
  if (!audio) failures.push("Rendered file has no audio stream.");
  if (audio && audio.codec_name !== "aac") failures.push(`Audio codec must be aac, got ${audio.codec_name}.`);
  const report = {
    videoPath: path.resolve(recordAs),
    codec: video?.codec_name,
    width: video?.width,
    height: video?.height,
    fps,
    pixelFormat: video?.pix_fmt,
    videoBitrate,
    totalBitrate,
    audioCodec: audio?.codec_name,
    audioBitrate: Number(audio?.bit_rate ?? 0),
    failures,
    passed: failures.length === 0,
  };
  const reportPath = videoPath.replace(/\.mp4$/i, ".encoding-audit.json");
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (failures.length) throw new Error(`Encoding audit failed: ${failures.join(" ")}`);
  return report;
}

/**
 * Remotion's H.264 bitrate flag is a quality target, not a delivery-rate
 * guarantee: low-detail white frames can make a long explainer fall below the
 * production floor. Normalize the staged candidate with explicit ABR bounds
 * before auditing it. This never touches a published artifact.
 */
async function normalizeProductionBitrate(videoPath: string): Promise<void> {
  const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path as string;
  const normalizedPath = videoPath.replace(/\.mp4$/i, ".normalized.mp4");
  const target = referenceQuality.encoding.targetVideoBitrate;
  const args = [
    "-y", "-i", videoPath,
    "-map", "0:v:0", "-map", "0:a?",
    "-c:v", "libx264", "-preset", "medium",
    "-b:v", target, "-minrate", target, "-maxrate", target,
    "-bufsize", referenceQuality.encoding.encodingBufferSize,
    // libx264 only enforces a delivery-rate floor when its HRD mode is CBR.
    // Without this, -minrate still produced low-detail explainers near 1 Mbps.
    "-x264-params", "nal-hrd=cbr:force-cfr=1",
    "-pix_fmt", referenceQuality.encoding.pixelFormat,
    "-c:a", "aac", "-b:a", referenceQuality.encoding.audioBitrate,
    "-movflags", "+faststart", normalizedPath,
  ];
  try {
    await runProcessWithDllInitRetry({
      phase: "bitrate-normalization",
      executable: ffmpegPath,
      args,
      cwd: process.cwd(),
      signal: pipelineAbort.signal,
      retryDllInitFailure: true,
      beforeRetry: () => fs.rmSync(normalizedPath, { force: true }),
    });
  } catch (error) {
    // A failed encoder can leave a plausible-looking but incomplete MP4. It is
    // never a valid input to a later audit or a resumed normalization.
    fs.rmSync(normalizedPath, { force: true });
    throw error;
  }
  fs.renameSync(normalizedPath, videoPath);
}

function derivedChunksProjectRoot(filePath: string): string | null {
  const absolute = path.resolve(filePath);
  let current = path.dirname(absolute);
  while (true) {
    if (path.basename(current).toLowerCase() === "chunks") {
      const parts = path.relative(current, absolute).split(path.sep);
      const looksDerived = parts.length === 2 && parts[1].toLowerCase() === "timeline.json"
        || parts.length === 3 && parts[1].toLowerCase() === "proof" && parts[2].toLowerCase() === "timeline.json";
      if (looksDerived) return path.dirname(current);
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

// Validate timeline file
if (!fs.existsSync(timelinePath)) {
  console.error(`❌ Timeline file not found: ${timelinePath}`);
  process.exit(1);
}

let canonicalTimelineIdentity: ReturnType<typeof buildCanonicalTimelineIdentity>;
try {
  if (!isChunkProof) {
    if (projectPath) {
      selectedProjectPath = fs.realpathSync(path.resolve(projectPath));
      selectedProjectId = path.basename(selectedProjectPath);
      assertProjectCanonicalTimeline(selectedProjectPath, timelinePath);
    }

    const projectsRoot = path.resolve("projects");
    const relativeToProjects = path.relative(projectsRoot, path.resolve(timelinePath));
    const underProjects = relativeToProjects !== ""
      && relativeToProjects !== ".."
      && !relativeToProjects.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relativeToProjects);
    if (underProjects) {
      const parts = relativeToProjects.split(path.sep);
      if (parts.length !== 2 || parts[1].toLowerCase() !== "timeline.json") {
        throw new Error(`Project renders require projects/<id>/timeline.json; got ${path.resolve(timelinePath)}.`);
      }
      selectedProjectPath = fs.realpathSync(path.join(projectsRoot, parts[0]));
      selectedProjectId = path.basename(selectedProjectPath);
      assertProjectCanonicalTimeline(selectedProjectPath, timelinePath);
    }
    const inferredDerivedRoot = !projectPath && !underProjects
      ? derivedChunksProjectRoot(timelinePath) ?? derivedChunksProjectRoot(fs.realpathSync(timelinePath))
      : null;
    assertCanonicalTimelinePath(
      timelinePath,
      inferredDerivedRoot ?? selectedProjectPath ?? path.dirname(path.resolve(timelinePath)),
    );
    assertOutputProjectIdentity(outPath, selectedProjectId);
  }
  canonicalTimelineIdentity = buildCanonicalTimelineIdentity({
    timelinePath,
    projectId: selectedProjectId,
    projectPath: selectedProjectPath,
  });
} catch (error) {
  console.error(`❌ Candidate lineage error: ${(error as Error).message}`);
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(timelinePath, "utf-8"));
if (sceneArg) {
  const scenes = Array.isArray(raw.scenes) ? raw.scenes : [];
  const matches = scenes.map((scene: any, index: number) => ({ scene, index }))
    .filter(({ scene }) => scene?.id === sceneArg);
  if (matches.length !== 1) {
    console.error(matches.length
      ? `--scene must identify exactly one scene; found ${matches.length} scenes with id ${JSON.stringify(sceneArg)}.`
      : `--scene does not exist in this timeline: ${JSON.stringify(sceneArg)}.`);
    process.exit(1);
  }
  const { scene, index } = matches[0];
  if (!Number.isInteger(scene.startFrame) || !Number.isInteger(scene.durationFrames) || scene.startFrame < 0 || scene.durationFrames <= 0) {
    console.error(`--scene ${JSON.stringify(sceneArg)} has invalid measured frame bounds.`);
    process.exit(1);
  }
  const first = Math.max(0, index - haloScenes);
  const last = Math.min(scenes.length - 1, index + haloScenes);
  const selected = scenes.slice(first, last + 1);
  const start = selected[0]?.startFrame;
  const final = selected.at(-1);
  const end = Number(final?.startFrame) + Number(final?.durationFrames) - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
    console.error(`--scene ${JSON.stringify(sceneArg)} cannot derive a contiguous measured frame range.`);
    process.exit(1);
  }
  frameRange = { start, end };
  frameRangeStart = start;
  sceneDiagnostic = {
    requestedSceneId: sceneArg,
    sceneIds: selected.map((item: any) => String(item.id)),
    haloScenes,
  };
}
let chunkProofBinding: ChunkProofBinding | null = null;
if (isChunkProof) {
  if (raw.artifactRole !== "chunk-proof") {
    console.error("❌ --chunk-proof requires a timeline explicitly marked artifactRole=chunk-proof.");
    process.exit(1);
  }
  const scope = qualityScope as Extract<QualityScope, { kind: "chunk" }>;
  const expectedIds = orderedSceneIdsForScope(scope);
  const actualIds = Array.isArray(raw.scenes) ? raw.scenes.map((scene: any) => scene.id) : [];
  if (actualIds.length !== expectedIds.length || actualIds.some((id: string, index: number) => id !== expectedIds[index])) {
    console.error(`❌ Chunk proof timeline must contain exactly the declared halo/core scope in order. Expected ${expectedIds.join(", ")}; got ${actualIds.join(", ")}.`);
    process.exit(1);
  }
  try {
    chunkProofBinding = bindChunkProofToProject({
      timelinePath,
      scopePath: qualityScopePath,
      outputPath: outPath,
      scope,
      qualityProfile: referenceQuality,
    });
    if (chunkProofBinding) {
      selectedProjectId = chunkProofBinding.projectId;
      selectedProjectPath = chunkProofBinding.projectPath;
      canonicalTimelineIdentity = buildCanonicalTimelineIdentity({
        timelinePath,
        projectId: selectedProjectId,
        projectPath: selectedProjectPath,
      });
    }
  } catch (error) {
    console.error(`❌ Chunk proof lineage error: ${(error as Error).message}`);
    process.exit(1);
  }
} else if (raw.artifactRole === "chunk-proof" || raw.artifactRole === "chunk-core") {
  console.error(`❌ ${raw.artifactRole} timelines are non-promotable derived artifacts and require the dedicated chunk pipeline.`);
  process.exit(1);
}
let verifiedChunkLineage: { verified: true; provenance: unknown } | null = null;
if (!isChunkProof) {
  const chunkProjectDir = selectedProjectPath ?? path.dirname(path.resolve(timelinePath));
  const chunkIssues = verifyChunkAssemblyProvenance(chunkProjectDir, raw);
  if (chunkIssues.length) {
    console.error(`\n❌ CHUNK ASSEMBLY PROVENANCE\n${chunkIssues.map((issue) => `   [${issue.code}] ${issue.message}`).join("\n")}\n`);
    process.exit(1);
  }
  if (raw.chunkAssemblyProvenance) {
    verifiedChunkLineage = { verified: true, provenance: raw.chunkAssemblyProvenance };
  }
}
try {
  assertTimelineAssetStyle(raw.timingProvenance);
} catch (error) {
  console.error(`❌ ${(error as Error).message}`);
  process.exit(1);
}
let preparedAudio: any = null;

// Schema gate — fail fast with a clear message instead of crashing deep inside
// Remotion on a malformed/hand-edited timeline. Pass --skip-validate to bypass.
if (!hasFlag("--skip-validate")) {
  const validation = validateTimeline(raw);
  printValidationResult(validation, timelinePath);
  if (!validation.valid) {
    console.error("\n❌ Timeline không hợp lệ — dừng render. (dùng --skip-validate để bỏ qua)");
    process.exit(1);
  }
}

// Director gate — schema-valid is not the same as production-ready. Refuse to
// spend minutes rendering a timeline with blockers/majors unless the caller
// explicitly opts out for debugging.
if (!hasFlag("--skip-quality")) {
  const quality = runScopedQualityCheck(raw, qualityScope, timelinePath);
  printQualityReport(quality);
  if (quality.blockers > 0 || quality.majors > 0 || !["A", "B"].includes(quality.grade)) {
    console.error(
      "\n❌ Timeline chưa đạt quality gate — dừng render. " +
      "(dùng --skip-quality chỉ cho render chẩn đoán)"
    );
    process.exit(1);
  }
}

// Provenance gate — a timeline must say how it was timed. Absent provenance is a
// refusal, not a pass: every artifact written before that field existed lacks it,
// including ones whose durations were spread proportionally by word count.
const allowUnprovenanced = hasFlag("--allow-unprovenanced-timing");
{
  const issues = checkTimingProvenance(raw.timingProvenance, { allowUnprovenanced });
  issues.push(...checkSceneBeatTimingSources(raw.scenes, raw.timingProvenance));
  if (issues.length) {
    console.error(`\n⏱️  TIMING PROVENANCE\n${formatTimingIssues(issues)}\n`);
    if (hasBlocker(issues)) process.exit(1);
  }
}

// Preflight: the timeline must span the voice track BEFORE the expensive loudnorm
// pass, so a 389s shortfall surfaces in seconds rather than minutes.
const sourceAudioPath = raw.audio ? resolvePublicAudio(raw.audio) : undefined;
const sourceAudioSeconds = sourceAudioPath ? probeDurationSeconds(sourceAudioPath) : undefined;
if (raw.audio && sourceAudioSeconds === undefined) {
  console.error(`\n❌ Voice track not found or unreadable: ${sourceAudioPath}\n`);
  process.exit(1);
}
{
  const issues = verifyArtifactInputs(
    adjacentArtifactInputs(timelinePath, raw.timingProvenance, {
      audioPath: sourceAudioPath,
      // Word alignment sets subtitle and beat timing, so it is a render input
      // just as much as durations and voice audio are.
      includeWords: true,
      // Chunk proof keeps alignment beside its scoped audio rather than beside
      // timeline.json; canonical projects continue to use <project>/words.json.
      wordsPath: isChunkProof
        ? path.join(path.dirname(path.resolve(timelinePath)), "alignment", "words.json")
        : undefined,
      requireComplete: raw.timingProvenance?.mode === "measured",
    })
  );
  if (issues.length) {
    console.error(`\n⏱️  ARTIFACT PROVENANCE\n${formatTimingIssues(issues)}\n`);
    if (hasBlocker(issues)) process.exit(1);
  }
}
if (sourceAudioSeconds !== undefined) {
  const issues = checkTimelineSpansAudio(raw.durationInFrames / (raw.fps ?? 30), sourceAudioSeconds, {
    sceneCount: Array.isArray(raw.scenes) ? raw.scenes.length : undefined,
    fps: raw.fps ?? 30,
  });
  if (issues.length) {
    console.error(`\n⏱️  TIMING PREFLIGHT\n${formatTimingIssues(issues)}\n`);
    if (hasBlocker(issues)) process.exit(1);
  }
}

// Validate the exact pixel-audit sampling plan before expensive audio mastering
// or Remotion work. Partial/diagnostic scopes receive their own bounded plan and
// can never be mistaken for the canonical full-duration sampling contract.
const plannedVisualAuditSeconds = frameRange
  ? (frameRange.end - frameRange.start + 1) / (raw.fps ?? 30)
  : raw.durationInFrames / (raw.fps ?? 30);
let plannedVisualAuditOffsets: number[] | null = null;
if (!hasFlag("--skip-visual-audit")) {
  try {
    plannedVisualAuditOffsets = normalizeVisualAuditOffsets(
      visualMeasurementContract.sampleOffsets,
      visualMeasurementContract.sampleSeconds,
      plannedVisualAuditSeconds,
    );
  } catch (error) {
    console.error(`Visual audit sampling preflight failed: ${(error as Error).message}`);
    process.exit(1);
  }
}

const finalDir = path.dirname(outPath);
const runId = `run-${new Date().toISOString().replace(/[:.]/g, "-")}`;
// Audio mastering writes shared files under public/audio, so serialize the run
// before preparation rather than only around Remotion output promotion.
const renderLock = acquireRenderLock(finalDir, runId);

if (raw.audio && !isProxy && !hasFlag("--skip-audio-prepare")) {
  preparedAudio = prepareTimelineAudio(raw.audio);
  raw.audio = preparedAudio.publicPath;
  console.log(`Audio prepared: ${preparedAudio.audit.integratedLufs} LUFS${preparedAudio.mastered ? " (mastered)" : ""}`);

  // Mastering must not change length. If it ever does, every scene boundary and
  // every word timestamp silently shifts against the audio Remotion plays.
  const preparedSeconds = probeDurationSeconds(preparedAudio.audit.input);
  if (preparedSeconds !== undefined && sourceAudioSeconds !== undefined) {
    const issues = checkRenderMatchesTimeline(preparedSeconds, sourceAudioSeconds, raw.fps ?? 30);
    if (issues.length) {
      console.error(
        `\n⏱️  Mastered audio length differs from the source track:\n${formatTimingIssues(issues)}\n`
      );
      if (hasBlocker(issues)) process.exit(1);
    }
  }
}

// Scan which cat poses actually exist so pose-swaps never reference a missing asset.
const charDir = path.join(process.cwd(), "public", "assets", "characters");
const generatedCharDir = path.join(process.cwd(), "public", "generated-assets", "characters");
const availablePoses = new Set<string>();
if (fs.existsSync(charDir)) {
  for (const f of fs.readdirSync(charDir)) {
    if (f.endsWith(".svg")) availablePoses.add(`characters/${f.replace(".svg", "")}`);
  }
}
if (fs.existsSync(generatedCharDir)) {
  for (const f of fs.readdirSync(generatedCharDir)) {
    if (f.endsWith(".png")) availablePoses.add(`characters/${f.replace(".png", "")}`);
  }
}

// Single compile point — scenes → events + liveliness (shared with preview).
const { timeline, liveliness } = loadTimeline(raw, availablePoses);
printLivelinessReport(liveliness);
const measuredSpatialReport = checkSpatialIntegrity(
  timeline,
  Array.isArray(raw.scenes) ? raw.scenes.map((scene: any) => ({
    id: scene.id,
    start: scene.startFrame,
    end: scene.startFrame + scene.durationFrames,
    narrationBeatFrames: (scene.subtitleCues ?? []).map((cue: any) => scene.startFrame + cue.startFrame),
  })) : undefined,
);
const spatialReport = isChunkProof && qualityScope.kind === "chunk"
  ? (() => {
      const core = new Set(qualityScope.coreSceneIds);
      const issues = measuredSpatialReport.issues.filter((item) => !item.sceneId || core.has(item.sceneId));
      return { ...measuredSpatialReport, passed: issues.length === 0, issues };
    })()
  : measuredSpatialReport;
console.log(formatSpatialIntegrityReport(spatialReport));
if (!spatialReport.passed) {
  console.error("\n❌ Spatial integrity gate failed — fix storyboard placement; do not render a colliding timeline.");
  process.exit(1);
}

console.log(`✅ Timeline loaded: ${timelinePath}`);
console.log(`   Duration: ${timeline.durationInFrames} frames @ ${timeline.fps}fps`);
console.log(`   = ${(timeline.durationInFrames / timeline.fps).toFixed(1)} seconds`);
console.log(`   Events: ${timeline.events.length}`);

// Render into a per-run staging directory and promote only once every gate has
// passed. Previously a blocked run left a fresh MP4 sitting beside the previous
// run's audits with a report that said "diagnostic" — anything globbing
// output/<id>/*.visual-audit.json then picked up data describing a different file.
const stagingDir = path.join(finalDir, ".runs", runId);
fs.mkdirSync(stagingDir, { recursive: true });
const stagedOut = path.join(stagingDir, path.basename(outPath));

// Serialize props to pass to Remotion
const propsJson = JSON.stringify({ timeline });
const propsTmpFile = path.join(stagingDir, "_props.json");
fs.writeFileSync(propsTmpFile, propsJson);

console.log(`\n🎬 Rendering: ${compositionId}`);
console.log(`   Staging: ${stagedOut}`);
console.log(`   Publishes to: ${outPath}\n`);

// This sandbox has no outbound network access, so Remotion can't download its
// own Chrome Headless Shell. Point it at a compatible binary already cached
// locally by Playwright instead (same underlying Chromium browser).
function findCachedChromeHeadlessShell(): string | null {
  const base = path.join(
    process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Local"),
    "ms-playwright"
  );
  if (!fs.existsSync(base)) return null;
  const candidates = fs
    .readdirSync(base)
    .filter((d) => d.startsWith("chromium_headless_shell-") || d.startsWith("chromium-"))
    .sort()
    .reverse();
  for (const dir of candidates) {
    const candidatesInDir = [
      path.join(base, dir, "chrome-headless-shell-win64", "chrome-headless-shell.exe"),
      path.join(base, dir, "chrome-win64", "chrome.exe"),
      path.join(base, dir, "chrome-win", "chrome.exe"),
    ];
    for (const exe of candidatesInDir) {
      if (fs.existsSync(exe)) return exe;
    }
  }
  return null;
}

// Declared outside the try so a failed run's diagnostic report can still say
// whether the render matched what was asked for.
let timingAudit: {
  mp4Seconds: number; expectedSeconds: number; driftSeconds: number; scope: string;
} | null = null;

async function runRenderPipeline(): Promise<void> {
try {
  if (isProxy) {
    getScaledDimensions(timeline.width, timeline.height, DEFAULT_PROXY_SCALE);
  }
  if (sceneDiagnostic) {
    const diagnosticManifest = {
      schemaVersion: 1,
      artifactRole: "scene-diagnostic",
      nonPromotable: true,
      requestedSceneId: sceneDiagnostic.requestedSceneId,
      sceneIds: sceneDiagnostic.sceneIds,
      haloScenes: sceneDiagnostic.haloScenes,
      frameRange,
      timeline: path.resolve(timelinePath),
      timelineSha256: sha256File(timelinePath),
      output: path.resolve(outPath),
      sampleSeconds: visualMeasurementContract.sampleSeconds,
      sampleOffsets: plannedVisualAuditOffsets,
    };
    fs.writeFileSync(
      path.join(stagingDir, "scene-diagnostic-manifest.json"),
      `${JSON.stringify(diagnosticManifest, null, 2)}\n`,
      "utf8",
    );
  }
  const browserExecutable = findCachedChromeHeadlessShell();
  const remotionCli = path.join(
    path.dirname(require.resolve("@remotion/cli/package.json")),
    "remotion-cli.js",
  );
  const remotionArgs = [
    remotionCli,
    "render",
    "src/index.ts",
    compositionId,
    stagedOut,
    `--props=${propsTmpFile}`,
    "--log=info",
    "--codec=h264",
    isProxy ? `--scale=${DEFAULT_PROXY_SCALE}` : `--video-bitrate=${referenceQuality.encoding.targetVideoBitrate}`,
    // Remotion CLI exposes FFmpeg's rate-control options as --max-rate and
    // --buffer-size. The older flag names below were silently ignored by the
    // CLI, so low-detail portions could collapse well below the production
    // bitrate floor despite the requested target bitrate.
    isProxy ? "--crf=23" : `--max-rate=${referenceQuality.encoding.maximumVideoBitrate}`,
    isProxy ? "--muted" : `--buffer-size=${referenceQuality.encoding.encodingBufferSize}`,
    frameRange ? `--frames=${frameRange.start}-${frameRange.end}` : "",
    `--audio-bitrate=${referenceQuality.encoding.audioBitrate}`,
    `--pixel-format=${referenceQuality.encoding.pixelFormat}`,
    browserExecutable ? `--browser-executable=${browserExecutable}` : "",
  ].filter(Boolean);

  try {
    await runProcessWithDllInitRetry({
      phase: "remotion-render",
      executable: process.execPath,
      args: remotionArgs,
      cwd: process.cwd(),
      signal: pipelineAbort.signal,
      retryDllInitFailure: true,
      beforeRetry: () => fs.rmSync(stagedOut, { force: true }),
    });
  } catch (error) {
    fs.rmSync(stagedOut, { force: true });
    throw error;
  }

  console.log(`\nEncoded media: ${stagedOut}. Running publish audits...`);
  const boundedRender = frameRange !== null;
  if (!isProxy && !boundedRender) {
    console.log("Normalizing staged H.264 delivery bitrate before audit...");
    await normalizeProductionBitrate(stagedOut);
  }
  // A bounded --frames render is a diagnostic slice, never a publishable
  // deliverable. Its average bitrate is dominated by its particular few
  // seconds (especially a quiet white opening) and cannot prove or disprove
  // the production encoding contract. Keep the full-render audit fail-closed;
  // slices still undergo requested-range timing and pixel audits below.
  const encodingAudit = (isProxy || boundedRender) ? null : runEncodingAudit(stagedOut, outPath);

  // A render that does not match what was asked for must never reach an audit or
  // a cross-render comparison — a truncated MP4 scores *better* on sampled pixel
  // metrics, so this blocks before visual-audit runs, not after. A partial
  // --frames render is compared against its requested range rather than skipped.
  {
    const mp4Seconds = probeDurationSeconds(stagedOut);
    if (mp4Seconds === undefined) throw new Error(`Rendered file is unreadable: ${stagedOut}`);
    const expectedSeconds = frameRange
      ? (frameRange.end - frameRange.start + 1) / timeline.fps
      : timeline.durationInFrames / timeline.fps;
    const issues = checkRenderMatchesTimeline(mp4Seconds, expectedSeconds, timeline.fps);
    timingAudit = {
      mp4Seconds,
      expectedSeconds,
      driftSeconds: Number((mp4Seconds - expectedSeconds).toFixed(3)),
      scope: frameRange ? `frames ${frameRange.start}-${frameRange.end}` : "full timeline",
    };
    if (issues.length) {
      console.error(`\n⏱️  TIMING INTEGRITY\n${formatTimingIssues(issues)}\n`);
      if (hasBlocker(issues)) throw new Error("Render timing does not match what was requested — refusing to audit or publish.");
    }
  }

  // Pixel-level regression gate. Timeline quotas cannot detect semantically
  // empty or visually repetitive frames, so sample the actual encoded MP4.
  const visualAuditPath = stagedOut.replace(/\.mp4$/i, ".visual-audit.json");
  const contactSheetPath = stagedOut.replace(/\.mp4$/i, ".contact.jpg");
  let visualAudit: any = null;
  if (!hasFlag("--skip-visual-audit")) {
    const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path as string;
    const auditScript = path.join(process.cwd(), "scripts", "visual-audit.py");
    if (!fs.existsSync(auditScript)) {
      throw new Error(`Required visual audit script not found: ${auditScript}`);
    }
    fs.rmSync(visualAuditPath, { force: true });
    fs.rmSync(contactSheetPath, { force: true });
    const requestedAuditSeconds = timingAudit?.expectedSeconds;
    if (!Number.isFinite(requestedAuditSeconds) || !(requestedAuditSeconds! > 0)) {
      throw new Error("Visual audit requires the validated render timing duration.");
    }
    if (Math.abs(requestedAuditSeconds - plannedVisualAuditSeconds) > 1e-9 || !plannedVisualAuditOffsets) {
      throw new Error("Visual audit timing plan drifted after rendering.");
    }
    const sampleOffsets = plannedVisualAuditOffsets;
    try {
      await runProcessWithDllInitRetry({
        phase: "visual-audit",
        executable: "python",
        args: [
          auditScript,
          "--video", path.resolve(stagedOut),
          "--record-video-path", path.resolve(outPath),
          "--ffmpeg", ffmpegPath,
          "--timeline", path.resolve(timelinePath),
          ...(isChunkProof ? ["--quality-scope", path.resolve(qualityScopePath)] : []),
          "--timeline-offset-seconds", String(frameRangeStart / timeline.fps),
          "--expected-duration-seconds", String(requestedAuditSeconds),
          "--sample-seconds", String(visualMeasurementContract.sampleSeconds),
          "--sample-offsets", sampleOffsets.join(","),
          "--subtitle-band-top", String(referenceQuality.visualAudit.subtitleBandTopRatio),
          "--config", path.resolve("config/reference-quality.json"),
          "--contact-sheet", path.resolve(contactSheetPath),
          "--record-contact-sheet", path.resolve(outPath.replace(/\.mp4$/i, ".contact.jpg")),
        ],
        cwd: process.cwd(),
        signal: pipelineAbort.signal,
        timeoutMs: Math.max(300_000, requestedAuditSeconds * 1_000),
        retryDllInitFailure: true,
        beforeRetry: () => {
          fs.rmSync(visualAuditPath, { force: true });
          fs.rmSync(contactSheetPath, { force: true });
        },
      });
    } catch (error) {
      // A completed audit that fails a quality threshold is valuable diagnostic
      // evidence. Keep its report/contact sheet in staging; only the bounded
      // DLL-init retry above clears partial outputs before rerunning.
      throw error;
    }
    if (!fs.existsSync(visualAuditPath)) {
      throw new Error(`Visual audit did not produce its required report: ${visualAuditPath}`);
    }
    visualAudit = JSON.parse(fs.readFileSync(visualAuditPath, "utf8"));
    assertVisualAuditReport(visualAudit, {
      contract: visualMeasurementContract,
      expectedDurationSeconds: requestedAuditSeconds,
      probedDurationSeconds: timingAudit!.mp4Seconds,
      sampleOffsets,
      frameRate: timeline.fps,
      timelineOffsetSeconds: frameRangeStart / timeline.fps,
      subtitleBandTopRatio: referenceQuality.visualAudit.subtitleBandTopRatio,
      sceneIds: Array.isArray(raw.scenes) ? raw.scenes.map((scene: any) => scene.id) : [],
      qualityScope,
    });
    if (typeof visualAudit.video !== "string"
        || !sameResolvedPath(visualAudit.video, outPath)) {
      throw new Error("Visual audit report identifies a different candidate video.");
    }
    const publishedContactSheet = outPath.replace(/\.mp4$/i, ".contact.jpg");
    if (typeof visualAudit.contactSheet !== "string"
        || !sameResolvedPath(visualAudit.contactSheet, publishedContactSheet)) {
      throw new Error("Visual audit report identifies a different candidate contact sheet.");
    }
    if (!diagnosticRun && !fs.existsSync(contactSheetPath)) {
      throw new Error(`Visual audit did not produce its required contact sheet: ${contactSheetPath}`);
    }
  } else if (!diagnosticRun) {
    throw new Error("Production candidates require the visual audit.");
  }
  // Loudness targets describe a whole narration track. Measuring a --frames slice
  // against them is meaningless — a two-second excerpt legitimately sits outside
  // the full-track LUFS window — so a partial render skips the audio audit for the
  // same reason a proxy does.
  const audioAuditPath = stagedOut.replace(/\.mp4$/i, ".audio-audit.json");
  const audioAudit = isProxy || boundedRender || hasFlag("--skip-audio-audit")
    ? null
    : writeAudioAudit(path.resolve(stagedOut), audioAuditPath, path.resolve(outPath));
  const referenceComparison = visualAudit && qualityScope.kind === "global"
    ? buildReferenceComparison(visualAudit, referenceBaseline)
    : null;
  if (!isProxy && !boundedRender && referenceComparison) {
    const profile = JSON.parse(fs.readFileSync(path.resolve("config/reference-quality.json"), "utf8"));
    const deltaLimit = Number(profile.visualAudit?.maximumSaturationAboveReference ?? 0.025);
    const saturationDelta = Number(referenceComparison.deltaCandidateMinusReference?.saturation);
    if (Number.isFinite(saturationDelta) && saturationDelta > deltaLimit) {
      throw new Error(
        `SATURATION_REFERENCE_DRIFT: candidate exceeds the reference by ${saturationDelta.toFixed(4)} ` +
        `(maximum ${deltaLimit.toFixed(4)}). Normalize the high-impact art assets; do not filter the MP4.`,
      );
    }
  }
  const durationsManifestPath = path.join(path.dirname(path.resolve(timelinePath)), "durations.json");
  const durationsManifest = fs.existsSync(durationsManifestPath)
    ? JSON.parse(fs.readFileSync(durationsManifestPath, "utf8"))
    : null;
  const ttsMetrics = durationsManifest?.ttsMetrics ?? (durationsManifest
    ? {
        chunkCount: Array.isArray(durationsManifest.scenes) ? durationsManifest.scenes.length : null,
        measurement: "legacy manifest; gap and wall-clock metrics unavailable",
      }
    : null);
  const encodingAuditPath = stagedOut.replace(/\.mp4$/i, ".encoding-audit.json");
  const chunkLineageEligible = raw.chunkAssemblyProvenance === undefined
    || verifiedChunkLineage?.verified === true;
  const proofEligible = isChunkProof
    && Boolean(encodingAudit?.passed)
    && Boolean(audioAudit?.passed)
    && visualAudit?.passed === true
    && fs.existsSync(contactSheetPath);
  const promotionEligible = !isChunkProof
    && !diagnosticRun
    && chunkLineageEligible
    && Boolean(encodingAudit?.passed)
    && Boolean(audioAudit?.passed)
    && visualAudit?.passed === true
    && fs.existsSync(contactSheetPath);
  if (isChunkProof && !proofEligible) {
    throw new Error("Chunk proof is missing one or more mandatory passing audits.");
  }
  if (!diagnosticRun && !isChunkProof && !promotionEligible) {
    throw new Error("Production candidate is missing one or more mandatory passing audits.");
  }
  if (chunkProofBinding) assertChunkProofBindingUnchanged(chunkProofBinding);
  if (sha256File(canonicalTimelineIdentity.timelinePath) !== canonicalTimelineIdentity.timelineSha256) {
    throw new Error("Canonical timeline changed while this render was running; refusing to mark the candidate ready.");
  }
  const productionReport = {
    schemaVersion: 2,
    // Rendering proves a technical candidate only. Publication is a separate,
    // hash-bound editorial decision made by publish.ts after manual review.
    status: promotionEligible ? "candidate-ready" : proofEligible ? "chunk-proof-ready" : "diagnostic",
    video: path.resolve((promotionEligible || proofEligible) ? outPath : stagedOut),
    projectId: canonicalTimelineIdentity.projectId,
    projectPath: canonicalTimelineIdentity.projectPath,
    timeline: canonicalTimelineIdentity.timelinePath,
    timelineSha256: canonicalTimelineIdentity.timelineSha256,
    timingProvenance: raw.timingProvenance ?? null,
    chunkLineage: verifiedChunkLineage,
    chunkProofBinding,
    unprovenancedTimingAllowed: allowUnprovenanced || undefined,
    preparedAudio,
    encodingAudit,
    timingAudit,
    audioAudit,
    visualAudit: visualAudit
      ? path.resolve((promotionEligible || proofEligible) ? outPath.replace(/\.mp4$/i, ".visual-audit.json") : visualAuditPath)
      : null,
    referenceComparison,
    directionSummary: buildDirectionSummary(raw),
    spatialIntegrity: spatialReport,
    ttsMetrics,
    artifacts: {
      videoSha256: sha256File(stagedOut),
      contactSheetSha256: fs.existsSync(contactSheetPath) ? sha256File(contactSheetPath) : null,
      visualAuditSha256: fs.existsSync(visualAuditPath) ? sha256File(visualAuditPath) : null,
      audioAuditSha256: fs.existsSync(audioAuditPath) ? sha256File(audioAuditPath) : null,
      encodingAuditSha256: fs.existsSync(encodingAuditPath) ? sha256File(encodingAuditPath) : null,
    },
  };
  fs.writeFileSync(
    stagedOut.replace(/\.mp4$/i, ".production-report.json"),
    `${JSON.stringify(productionReport, null, 2)}\n`,
    "utf8",
  );

  if (fs.existsSync(propsTmpFile)) fs.unlinkSync(propsTmpFile);
  if (proofEligible) {
    const previousProof = promoteArtifacts(stagingDir, finalDir, runId, {
      requiredReportStatus: "chunk-proof-ready",
    });
    pruneRunHistory(finalDir, { preservePreviousMp4: false });
    if (previousProof) console.log(`   Previous chunk proof evidence archived at: ${previousProof}`);
    console.log(`\n✅ Chunk proof complete (non-promotable): ${outPath}`);
  } else if (promotionEligible) {
    const previousBuild = promoteArtifacts(stagingDir, finalDir, runId);
    pruneRunHistory(finalDir);
    if (previousBuild) console.log(`   Previous successful build archived at: ${previousBuild}`);
    console.log(`\n✅ Production render complete: ${outPath}`);
  } else {
    console.log(`\n✅ Diagnostic render complete. Artifacts kept at: ${stagingDir}`);
  }
} catch (err) {
  // The previously published build is left exactly as it was. The failed run
  // stays in its staging dir so its artifacts can be inspected without being
  // mistaken for the current production output.
  const processFailure = err instanceof ProcessRunError ? err.result : null;
  const failedReport = {
    schemaVersion: 2,
    status: "diagnostic",
    video: fs.existsSync(stagedOut) ? path.resolve(stagedOut) : null,
    projectId: canonicalTimelineIdentity.projectId,
    projectPath: canonicalTimelineIdentity.projectPath,
    timeline: canonicalTimelineIdentity.timelinePath,
    timelineSha256: canonicalTimelineIdentity.timelineSha256,
    chunkProofBinding,
    timingProvenance: raw.timingProvenance ?? null,
    timingAudit,
    stagingDir: path.resolve(stagingDir),
    failureKind: processFailure?.phase === "visual-audit" && processFailure.exitCode === 3
      ? "quality"
      : processFailure ? "infrastructure" : "pipeline",
    phase: processFailure?.phase ?? null,
    process: processFailure,
    error: err instanceof Error ? err.message : String(err),
  };
  fs.writeFileSync(
    path.join(stagingDir, "production-report.json"),
    `${JSON.stringify(failedReport, null, 2)}\n`,
    "utf8",
  );
  pruneRunHistory(finalDir);
  console.error("\n❌ Render failed:", err);
  console.error(`   Published build untouched. Failed run kept at: ${stagingDir}`);
  process.exitCode = 1;
} finally {
  if (fs.existsSync(propsTmpFile)) {
    fs.unlinkSync(propsTmpFile);
  }
  renderLock.release();
  process.removeListener("SIGINT", abortPipeline);
  process.removeListener("SIGTERM", abortPipeline);
}
}

void runRenderPipeline();
