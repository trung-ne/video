const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
const path = require('path');
const fs = require('fs');

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

const videoPath = path.resolve(__dirname, '../refer/meo.mp4');
const outDir = path.resolve(__dirname, '../refer/frames');

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

// Get video info first
ffmpeg.ffprobe(videoPath, (err, metadata) => {
  if (err) { console.error(err); process.exit(1); }
  const duration = metadata.format.duration;
  const { width, height } = metadata.streams[0];
  console.log(`Duration: ${duration}s, Size: ${width}x${height}`);
  console.log(`Total frames at 30fps: ${Math.round(duration * 30)}`);

  // Extract 1 frame every 5 seconds = key moments
  const timestamps = [];
  for (let t = 0; t < duration; t += 5) {
    timestamps.push(t);
  }
  console.log(`Extracting ${timestamps.length} frames...`);

  let done = 0;
  function extractNext(i) {
    if (i >= timestamps.length) {
      console.log('Done! Frames saved to refer/frames/');
      return;
    }
    const t = timestamps[i];
    const outFile = path.join(outDir, `frame_${String(i).padStart(3,'0')}_t${Math.round(t)}s.jpg`);
    ffmpeg(videoPath)
      .seekInput(t)
      .frames(1)
      .output(outFile)
      .on('end', () => {
        done++;
        process.stdout.write(`\r${done}/${timestamps.length} frames extracted`);
        extractNext(i + 1);
      })
      .on('error', (e) => {
        console.error(`Error at t=${t}: ${e.message}`);
        extractNext(i + 1);
      })
      .run();
  }
  extractNext(0);
});
