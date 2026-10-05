// Radio voice check: node scripts/radio.mjs [cp] [speed] [maxSeconds]
// The bot flies the mission while every radio line is logged with whether its clip played.
import { chromium } from 'playwright-core';

const cp = process.argv[2] ?? 'launch';
const speed = Number(process.argv[3] ?? 1);
const maxSec = Number(process.argv[4] ?? 300);
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
const problems = [];
const clips = new Map();
page.on('pageerror', (e) => problems.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text());
});
page.on('response', (r) => {
  if (r.url().includes('/voice/')) clips.set(r.url().split('/voice/')[1], r.status());
});
await page.goto(`http://localhost:5190/?debug&bot&god`);
await page.waitForTimeout(1200);
await page.evaluate(`__joker.speed(${speed})`);
if (cp === 'launch') await page.keyboard.press('Enter');
else await page.evaluate(`__joker.start('${cp}')`);
await page.evaluate(() => {
  const audio = window.__joker.game.audio;
  const speak = audio.speak.bind(audio);
  window.__radio = [];
  audio.speak = (text, who) => {
    const dur = speak(text, who);
    const entry = { who, text, dur, playing: false, checked: false };
    window.__radio.push(entry);
    setTimeout(() => {
      entry.playing = !!audio.voiceSrc;
      entry.checked = true;
    }, 400);
    return dur;
  };
});
const t0 = Date.now();
let seen = 0;
let state = '';
while ((Date.now() - t0) / 1000 < maxSec && state !== 'debrief' && state !== 'failed') {
  await page.waitForTimeout(1000);
  state = (await page.evaluate('__joker.state()')).state;
  const lines = await page.evaluate('window.__radio');
  for (; seen < lines.length && lines[seen].checked; seen++) {
    const l = lines[seen];
    console.log(`${l.playing ? 'PLAY' : 'SILENT'} ${l.dur.toFixed(2)}s ${l.who}: ${l.text}`);
  }
}
const lines = await page.evaluate('window.__radio');
const silent = lines.filter((l) => !l.playing);
console.log(`END ${state}: ${lines.length} lines, ${silent.length} silent, ${clips.size} clips fetched (${[...clips.values()].filter((s) => s !== 200).length} failed)`);
if (problems.length) console.log('PROBLEMS:\n' + problems.join('\n'));
await browser.close();
