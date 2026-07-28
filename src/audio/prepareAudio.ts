import { spawnSync } from "child_process";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import referenceQuality from "../../config/reference-quality.json";

export interface AudioAudit {
  input: string;
  integratedLufs: number;
  truePeakDbtp: number;
  passed: boolean;
}

function ffmpegPath(): string {
  return require("@ffmpeg-installer/ffmpeg").path as string;
}

export function measureAudio(input: string): AudioAudit {
  const result = spawnSync(ffmpegPath(), [
    "-hide_banner", "-nostats", "-i", input,
    "-filter_complex", "ebur128=peak=true", "-f", "null", "-",
  ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  const output = result.stderr ?? "";
  const integrated = [...output.matchAll(/I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/g)];
  const truePeak = [...output.matchAll(/Peak:\s*(-?\d+(?:\.\d+)?)\s*dBFS/g)];
  if (!integrated.length || !truePeak.length) {
    throw new Error(`Unable to measure audio loudness: ${input}`);
  }
  const lufs = Number(integrated[integrated.length - 1][1]);
  const peak = Number(truePeak[truePeak.length - 1][1]);
  const cfg = referenceQuality.audio;
  return {
    input: path.resolve(input),
    integratedLufs: lufs,
    truePeakDbtp: peak,
    passed: lufs >= cfg.minimumLufs && lufs <= cfg.maximumLufs && peak <= cfg.maximumTruePeakDbtp,
  };
}

/** sha256 of a file's bytes. Exported so timing provenance can record which
 *  exact voice track a timeline was compiled against — length alone cannot
 *  detect a swap to a different track of the same duration. */
export function sha256File(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

const checksum = sha256File;

export function resolvePublicAudio(audio: string): string {
  if (path.isAbsolute(audio)) return audio;
  return path.join(process.cwd(), "public", audio.replace(/\//g, path.sep));
}

export function prepareTimelineAudio(audio: string): { publicPath: string; audit: AudioAudit; mastered: boolean } {
  const source = resolvePublicAudio(audio);
  if (!fs.existsSync(source)) throw new Error(`Timeline audio not found: ${source}`);
  const initial = measureAudio(source);
  if (initial.passed) return { publicPath: audio, audit: initial, mastered: false };

  const parsed = path.parse(source);
  const masteredPath = path.join(parsed.dir, `${parsed.name}.mastered.wav`);
  const cachePath = `${masteredPath}.json`;
  const sourceHash = checksum(source);
  if (fs.existsSync(masteredPath) && fs.existsSync(cachePath)) {
    const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    if (cached.sourceHash === sourceHash) {
      const audit = measureAudio(masteredPath);
      if (audit.passed) {
        return {
          publicPath: path.relative(path.join(process.cwd(), "public"), masteredPath).replace(/\\/g, "/"),
          audit,
          mastered: true,
        };
      }
    }
  }

  const script = path.join(process.cwd(), "scripts", "master-audio.py");
  const result = spawnSync("python", [
    script, "--input", source, "--output", masteredPath, "--ffmpeg", ffmpegPath(),
    "--lufs", String(referenceQuality.audio.targetLufs),
    "--true-peak", String(referenceQuality.audio.maximumTruePeakDbtp),
  ], { encoding: "utf8", stdio: "inherit" });
  if (result.status !== 0) throw new Error(`Audio mastering failed for ${source}`);
  const audit = measureAudio(masteredPath);
  if (!audit.passed) throw new Error(`Mastered audio is still outside the publish profile: ${JSON.stringify(audit)}`);
  fs.writeFileSync(cachePath, `${JSON.stringify({ sourceHash, audit }, null, 2)}\n`, "utf8");
  return {
    publicPath: path.relative(path.join(process.cwd(), "public"), masteredPath).replace(/\\/g, "/"),
    audit,
    mastered: true,
  };
}

export function writeAudioAudit(input: string, reportPath: string): AudioAudit {
  const audit = measureAudio(input);
  fs.writeFileSync(reportPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
  if (!audit.passed) {
    throw new Error(`Audio audit failed: ${audit.integratedLufs} LUFS, ${audit.truePeakDbtp} dBTP`);
  }
  return audit;
}
