const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
const path = require('path');
const fs = require('fs');

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

const outDir = path.resolve(__dirname, '../refer/compare');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

// Extract frames mỗi 15s từ result video (ngắn hơn, tập trung vào key scenes)
const resultVideo = path.resolve(__dirname, '../output/video.mp4');

ffmpeg.ffprobe(resultVideo, (err, meta) => {
  if (err) { console.error(err); process.exit(1); }
  const duration = meta.format.duration;
  console.log(`Result video: ${duration.toFixed(1)}s`);

  const timestamps = [];
  for (let t = 0; t < duration; t += 15) timestamps.push(t);
  console.log(`Extracting ${timestamps.length} frames every 15s...`);

  let done = 0;
  function next(i) {
    if (i >= timestamps.length) { console.log('\nDone!'); return; }
    const t = timestamps[i];
    const label = `${String(i).padStart(3,'0')}_t${Math.round(t)}s`;
    ffmpeg(resultVideo)
      .seekInput(t).frames(1)
      .output(path.join(outDir, `result_${label}.jpg`))
      .on('end', () => { process.stdout.write(`\r${++done}/${timestamps.length}`); next(i+1); })
      .on('error', (e) => { console.error(`\nError t=${t}:`, e.message); next(i+1); })
      .run();
  }
  next(0);
});
