import * as path from "path";
import { writeAudioAudit } from "../src/audio/prepareAudio";

const out = path.resolve("output/video-003-tai-sao-eng-v4.mp4");
const report = writeAudioAudit(out, out.replace(/\.mp4$/i, ".audio-audit.json"));
console.log(JSON.stringify(report, null, 2));
