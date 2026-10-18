/*
 * Bounded, non-promotable geometry evidence for an explicitly selected interval.
 * It never renders, compiles to disk, or reads a "latest" output run.
 */
import * as fs from "fs";
import * as path from "path";
import { loadTimeline } from "../src/engine/loadTimeline";
import { computeFrameState } from "../src/engine/timelineEngine";
import { visualPrimitivesAtFrame } from "../src/engine/visualGeometry";

const ROOT = path.resolve(__dirname, "..");
const PROJECTS_ROOT = path.join(ROOT, "projects");
const DIAGNOSTICS_ROOT = path.join(ROOT, "diagnostics");
const MAX_TRACE_FRAMES = 300;

export interface VisualTraceArgs {
  timelinePath: string;
  fromFrame: number;
  toFrame: number;
  outPath: string;
}

function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function safeWorkspacePath(value: string, root: string, label: string): string {
  if (!value || path.isAbsolute(value) || path.win32.isAbsolute(value) || value.includes("\0") || value.split(/[\\/]+/).includes("..")) {
    throw new Error(`${label} must be a traversal-free workspace-relative path.`);
  }
  const resolved = path.resolve(ROOT, value);
  if (!isWithin(root, resolved)) throw new Error(`${label} must be inside ${path.relative(ROOT, root)}.`);
  return resolved;
}

function integer(value: string | undefined, flag: string): number {
  if (!value || !/^\d+$/.test(value)) throw new Error(`${flag} must be a non-negative integer.`);
  return Number(value);
}

export function parseVisualTraceArgs(argv: string[]): VisualTraceArgs {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!['--timeline', '--from-frame', '--to-frame', '--out'].includes(flag)) {
      throw new Error(`Unknown argument: ${flag}`);
    }
    if (values.has(flag)) throw new Error(`${flag} may only be supplied once.`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
    values.set(flag, value);
    index += 1;
  }
  const timelinePath = safeWorkspacePath(values.get('--timeline') ?? '', PROJECTS_ROOT, '--timeline');
  const outPath = safeWorkspacePath(values.get('--out') ?? '', DIAGNOSTICS_ROOT, '--out');
  const fromFrame = integer(values.get('--from-frame'), '--from-frame');
  const toFrame = integer(values.get('--to-frame'), '--to-frame');
  if (toFrame < fromFrame) throw new Error('--to-frame must be at or after --from-frame.');
  if (toFrame - fromFrame + 1 > MAX_TRACE_FRAMES) {
    throw new Error(`Trace interval may contain at most ${MAX_TRACE_FRAMES} frames.`);
  }
  if (fs.existsSync(outPath)) throw new Error('--out already exists; diagnostics are write-once evidence.');
  return { timelinePath, fromFrame, toFrame, outPath };
}

function assertInputFile(file: string): void {
  if (!fs.existsSync(file)) throw new Error('--timeline does not exist.');
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('--timeline must be a regular file.');
}

export function writeVisualTrace(args: VisualTraceArgs): void {
  assertInputFile(args.timelinePath);
  const raw = JSON.parse(fs.readFileSync(args.timelinePath, 'utf8'));
  const { timeline } = loadTimeline(raw);
  if (args.toFrame >= timeline.durationInFrames) {
    throw new Error(`--to-frame must be below the timeline duration (${timeline.durationInFrames}).`);
  }
  const authoredScenes = Array.isArray(raw?.scenes) ? raw.scenes : [];
  const sceneAt = (frame: number): string | undefined => authoredScenes.find((scene: any) =>
    typeof scene?.id === 'string' && frame >= scene.startFrame && frame < scene.startFrame + scene.durationFrames,
  )?.id;
  const frames = [];
  for (let frame = args.fromFrame; frame <= args.toFrame; frame += 1) {
    const state = computeFrameState(timeline, frame);
    frames.push({
      frame,
      sceneId: sceneAt(frame),
      primitives: visualPrimitivesAtFrame(timeline, state, frame).map((primitive) => ({
        id: primitive.id,
        kind: primitive.kind,
        box: primitive.box,
        opacity: primitive.opacity,
        zIndex: primitive.zIndex,
        ownerId: primitive.ownerId,
        allowOverlapWith: primitive.allowOverlapWith,
      })),
    });
  }
  fs.mkdirSync(path.dirname(args.outPath), { recursive: true });
  fs.writeFileSync(args.outPath, `${JSON.stringify({
    kind: 'non-promotable-visual-geometry-trace',
    timeline: path.relative(ROOT, args.timelinePath).split(path.sep).join('/'),
    fromFrame: args.fromFrame,
    toFrame: args.toFrame,
    frames,
  }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
}

function main(): void {
  try {
    const args = parseVisualTraceArgs(process.argv.slice(2));
    writeVisualTrace(args);
    console.log(`Non-promotable visual trace: ${path.relative(ROOT, args.outPath).split(path.sep).join('/')}`);
  } catch (error) {
    console.error(`Visual trace input error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}

if (require.main === module) main();
