// Bot playthrough: node scripts/playtest.mjs [cp] [speed] [maxSeconds]
import { chromium } from 'playwright-core';

const cp = process.argv[2] ?? 'launch';
const speed = Number(process.argv[3] ?? 2);
const maxSec = Number(process.argv[4] ?? 400);
const god = process.env.GOD ? '&god' : '';
const url = `http://localhost:5190/?debug&bot${god}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message + '\n' + e.stack));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(url);
await page.waitForTimeout(1200);
await page.evaluate(`__joker.speed(${speed})`);
if (cp === 'launch') await page.keyboard.press('Enter');
else await page.evaluate(`__joker.start('${cp}')`);
let lastPhase = '';
let lastState = '';
const t0 = Date.now();
let shotN = 0;
while ((Date.now() - t0) / 1000 < maxSec) {
  await page.waitForTimeout(1000);
  const s = await page.evaluate('__joker.state()');
  const line = `${((Date.now() - t0) / 1000).toFixed(0)}s ${s.state} | ${s.phase} | score ${s.score} combo ${s.combo} hp ${s.hp} spd ${s.speed} pos ${s.pos} tgt ${s.target}${s.locked ? '*' : ''} fps ${s.fps} | ${s.aircraft.filter((a) => !a.startsWith('player') && !a.startsWith('wingman')).join(',')}`;
  console.log(line);
  const ev = await page.evaluate('__joker.events()');
  for (const e of ev) console.log('   ·', e);
  const every = Number(process.env.SHOTEVERY ?? 0);
  if (every && Math.round((Date.now() - t0) / 1000) % every === 0) {
    await page.screenshot({ path: `artifacts/pt-${cp}-t${String(Math.round((Date.now() - t0) / 1000)).padStart(3, '0')}.png` });
  }
  if (s.phase !== lastPhase || s.state !== lastState) {
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `artifacts/pt-${cp}-${String(shotN++).padStart(2, '0')}-${(s.phase || s.state).replace(/[^A-Za-z0-9]+/g, '_')}.png` });
    lastPhase = s.phase;
    lastState = s.state;
  }
  if (s.state === 'debrief' || (s.state === 'failed' && !process.env.KEEP)) {
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `artifacts/pt-${cp}-end-${s.state}.png` });
    const fail = await page.evaluate(`document.getElementById('fail-reason').textContent`);
    console.log('END', s.state, fail);
    break;
  }
}
if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));
await browser.close();
