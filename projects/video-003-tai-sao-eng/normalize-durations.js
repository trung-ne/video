const fs = require('fs');
const p = require('path').join(__dirname, 'durations.json');
const d = JSON.parse(fs.readFileSync(p, 'utf8'));
d.scenes = d.scenes.map((s, i) => ({...s, id:`sb${String(i+1).padStart(3,'0')}`}));
fs.writeFileSync(p, JSON.stringify(d, null, 2));
console.log(`Normalized ${d.scenes.length} duration ids; total ${d.totalFrames} frames`);
