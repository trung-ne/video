const fs = require('fs');
const path = require('path');

const dir = __dirname;
const raw = fs.readFileSync(path.join(dir, 'transcript.txt'), 'utf8')
  .replace(/^Scene\s+\d+:[^\n]*$/gim, ' ')
  .replace(/^\s*\d+:\d+\s*/gm, ' ')
  .replace(/â€“/g, '—').replace(/â€™/g, "'").replace(/â€œ|â€/g, '"')
  .replace(/\.{2,}/g, '.')
  .replace(/\s+/g, ' ').trim();
const sentences = raw.match(/[^.!?]+(?:[.!?]+["']?|$)/g) || [raw];
const chunks = [];
let buf = [], words = 0;
for (const s0 of sentences) {
  const s = s0.trim(); if (!s) continue;
  const n = s.split(/\s+/).length;
  if (buf.length && (words + n > 34 || buf.length >= 2)) { chunks.push(buf.join(' ')); buf=[]; words=0; }
  buf.push(s); words += n;
}
if (buf.length) chunks.push(buf.join(' '));

const stages = [
  ['assets/scenes/living_room.svg','sofa_left','sofa_right'],
  ['assets/scenes/cafe.svg','counter_left','counter_right'],
  ['assets/scenes/classroom.svg','desk','board'],
  ['assets/scenes/park.svg','bench_left','bench_right'],
  ['assets/scenes/restaurant.svg','seat_left','seat_right'],
  ['assets/scenes/office_desk.svg','desk','desk_right'],
  ['assets/scenes/street.svg','sidewalk_left','sidewalk_right'],
  ['assets/scenes/library.svg','table_left','table'],
];
const photos = ['backgrounds/city_skyline.jpg','backgrounds/family_dinner.jpg','backgrounds/restaurant.jpg','backgrounds/classroom.jpg'];
const props = ['finance/money','props/book','finance/trending_down','props/trophy','props/computer_desk','finance/house'];
const roles = {
  host: {src:'characters/cat_explain'},
  skeptic: {src:'characters/cat_think'},
  narrator: {src:'characters/cat_talk'},
  worried: {src:'characters/cat_sad'},
  analyst: {src:'characters/cat_teacher'},
};
function beat(text, kind='keyword') {
  const m = text.match(/\b(?:\d+(?:\.\d+)?|half|lowest|collapse|Nash equilibrium|zero-sum)\b/i);
  return {text: m ? m[0] : text.split(/\s+/).slice(0,3).join(' '), importance: m ? .95 : .65, kind: m ? 'number' : kind};
}
function title(text) { return text.split(/\s+/).slice(0,4).join(' ').replace(/[,.!?;:]+$/, ''); }
function makeBrief(text, i) {
  const id = `sb${String(i+1).padStart(3,'0')}`;
  const cycle = i % 8;
  let visualGrammar, slots = {}, emotion = /declin|collapse|lowest|refuse|difficult|tiring/i.test(text) ? 'concern' : 'curious';
  if (cycle === 0 || cycle === 3 || cycle === 6) {
    visualGrammar = 'TABLEAU'; const st = stages[(i/3|0) % stages.length];
    slots = {stage:st[0], who:'host', anchorA:st[1], seatB:'skeptic', anchorB:st[2], caption:title(text)};
  } else if (cycle === 1) {
    visualGrammar = 'EVIDENCE'; slots = {title: /\d/.test(text) ? 'KEY POLICY / NUMBER' : 'EVIDENCE', body:text.split(/\s+/).slice(0,28).join(' ')};
  } else if (cycle === 2) {
    visualGrammar = 'DIALOGUE_QA'; slots = {asker:'skeptic', answerer:'host', askerText:'Why does this happen?', answererText:title(text)};
  } else if (cycle === 4) {
    visualGrammar = 'DIAGRAM'; slots = {items:'Players|Rules|Rewards'};
  } else if (cycle === 5) {
    visualGrammar = 'BEAT'; slots = {image: [5,85,145].includes(i) ? photos[(i/5|0)%photos.length] : (i%2 ? '#F4EFFA' : '#EAF2F8')}; emotion='sad';
  } else if (cycle === 7) {
    visualGrammar = 'FRAMEBOX'; slots = {content: i === 7 ? 'backgrounds/stock_chart.jpg' : '#17324D', caption:title(text)};
  } else {
    visualGrammar = 'CHAR_PROP'; slots = {prop:props[i%props.length], label:title(text), who:'analyst'};
  }
  if (/\b\d+(?:\.\d+)?\b|birth rate|population|tax|money|children/i.test(text) && visualGrammar === 'CHAR_PROP') { visualGrammar='STAT_REVEAL'; slots={stat:(text.match(/\b\d+(?:\.\d+)?\b/)||['KEY NUMBER'])[0], who:'worried'}; emotion='surprise'; }
  return {id,narration:text,purpose:`Make the viewer understand: ${title(text)}`,emotion,viewerFocus:title(text),visualGrammar,shot:i%5===0?'close':'medium',slots,beats:[beat(text)]};
}
const storyboard = {fps:30,width:1920,height:1080, audio:'audio/video-003-tai-sao-eng/voice.wav', cast:roles, scenes:chunks.map(makeBrief)};
const fp = path.join(dir,'storyboard.json'); fs.writeFileSync(fp, JSON.stringify(storyboard,null,2));
fs.writeFileSync(path.join(dir,'tts_scenes.json'), JSON.stringify(chunks.map((text,i)=>({id:`scene${String(i+1).padStart(3,'0')}`,text})),null,2));
const totalSec = 1255.775, totalFrames = Math.round(totalSec*30);
const counts = chunks.map(x=>x.split(/\s+/).length); const totalWords=counts.reduce((a,b)=>a+b,0);
const minFrames=180, remainder=totalFrames-(minFrames*counts.length); let cursor=0;
const ds=counts.map((n,i)=>{ const frames=i===counts.length-1?totalFrames-cursor:minFrames+Math.max(0,Math.round(remainder*n/totalWords)); const d={id:`sb${String(i+1).padStart(3,'0')}`,startFrame:cursor,frames}; cursor+=frames; return d; });
fs.writeFileSync(path.join(dir,'durations.json'), JSON.stringify({fps:30,totalFrames,totalSec,scenes:ds},null,2));
console.log(`Prepared ${chunks.length} storyboard shots, ${totalFrames} frames`);
