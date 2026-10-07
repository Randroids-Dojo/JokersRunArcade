// HUD overlap audit on a phone: node scripts/layout.mjs [cp] [speed] [maxSeconds] (DESKTOP=1 for a desktop window, CUTOUT=left|right for a camera inset)
// The bot flies the mission in phone emulation (844x390, touch) while every visible HUD
// text, panel and touch control is measured; any two that overlap are reported once per
// pair with the phase they first collided in.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const cp = process.argv[2] ?? 'launch';
const speed = Number(process.argv[3] ?? 2);
const maxSec = Number(process.argv[4] ?? 300);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: [...(process.platform === 'darwin' ? ['--use-angle=metal'] : []), '--ignore-gpu-blocklist'] });
// DESKTOP=1 checks the keyboard-and-mouse layout in a 1440x860 window instead.
const ctx = await browser.newContext(
  process.env.DESKTOP
    ? { viewport: { width: 1440, height: 860 } }
    : { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
// CUTOUT=left|right adds a 58 px safe-area inset, like a landscape phone's camera cutout.
if (process.env.CUTOUT) {
  const cdp = await ctx.newCDPSession(page);
  const side = process.env.CUTOUT === 'right' ? 'right' : 'left';
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { left: 0, right: 0, top: 0, bottom: 0, [side]: 58 } });
}
const base = process.env.URL ?? 'http://localhost:5190/';
await page.goto(`${base}?debug&bot&god`);
await page.waitForTimeout(1500);
await page.evaluate(`__joker.speed(${speed})`);
// Assisted steering levels the jet whenever no thumb is on the stick, which would override the bot.
await page.evaluate(() => {
  const g = window.__joker.game;
  g.settings.assist = false;
  g.input.touchAssist = false;
});
await page.evaluate(`__joker.start('${cp}')`);

// Selector -> 'text' (measure the glyphs) or 'box' (measure the element).
const ITEMS = {
  '#tl .lbl': 'text', '#score': 'text', '#hotstart': 'text', '#combo-text': 'text', '#combo .bar': 'box',
  '#objective': 'text', '#timer-label': 'text', '#timer-value': 'text', '#subtimer': 'text',
  '#br .row.hull': 'box', '#br .row:not(.hull)': 'box', '#mission-tag': 'text', '#phase-tag': 'text', '#wing-order': 'box', '.scout-row': 'box',
  '#boss-head': 'text', '#boss > .bar': 'box', '#boss-pressure-row': 'box', '#boss-status': 'text',
  '#gauge-l > *': 'text', '#gauge-r > *': 'text', '#bl': 'box',
  '#prompt': 'box', '#popups > *': 'text', '#radio': 'box', '#banner .main': 'text', '#banner .sub': 'text',
  '#countdown': 'text', '#area-warn': 'text',
  '#t-pause': 'box', '.tchip': 'box', '#t-cluster .tb': 'box', '#t-hint': 'text', '#letterbox > div': 'box',
};

const sample = () => page.evaluate((items) => {
  const out = [];
  for (const [sel, mode] of Object.entries(items)) {
    document.querySelectorAll(sel).forEach((el, i) => {
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return;
      // Only settled elements: something fading in or out mid-transition is not a layout clash.
      let op = 1;
      for (let e = el; e; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
      if (op < 0.95) return;
      if (el.getAnimations({ subtree: true }).some((a) => a.playState === 'running' && /transform|opacity|height|bottom/.test(String(a.transitionProperty ?? a.animationName ?? '')))) return;
      let r = el.getBoundingClientRect();
      if (mode === 'text') {
        // Glyphs, not line boxes: the middle 75% of the line height.
        const range = document.createRange();
        range.selectNodeContents(el);
        const b = range.getBoundingClientRect();
        const trim = b.height * 0.125;
        r = { left: b.left, right: b.right, top: b.top + trim, bottom: b.bottom - trim, width: b.width, height: b.height - 2 * trim };
      }
      if (r.width < 1 || r.height < 1) return;
      const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28);
      out.push({ id: `${sel}#${i}`, text, r: [r.left, r.top, r.right, r.bottom], el: null });
    });
  }
  const pairs = [];
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      const a = out[i].r, b = out[j].r;
      const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
      const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
      // The pause button is drawn above the letterbox bars on purpose.
      const ids = out[i].id + out[j].id;
      if (ids.includes('#t-pause') && ids.includes('#letterbox')) continue;
      if (w > 2 && h > 2) pairs.push([out[i], out[j]]);
    }
  }
  return pairs.map(([a, b]) => ({ a: a.id, at: a.text, b: b.id, bt: b.text }));
}, ITEMS);

const seen = new Map();
const phases = new Set();
const t0 = Date.now();
let state = '';
while ((Date.now() - t0) / 1000 < maxSec && state !== 'debrief' && state !== 'failed') {
  await page.waitForTimeout(200);
  const s = await page.evaluate('__joker.state()');
  state = s.state;
  phases.add(s.phase || s.state);
  for (const p of await sample()) {
    const key = [p.a.replace(/#\d+$/, ''), p.b.replace(/#\d+$/, '')].sort().join('  x  ');
    if (!seen.has(key)) {
      seen.set(key, 1);
      console.log(`${(s.phase || s.state).padEnd(26)} ${p.at || p.a}  x  ${p.bt || p.b}   [${key}]`);
    } else seen.set(key, seen.get(key) + 1);
  }
}
console.log(`END ${state}: ${seen.size} overlapping pairs`);
for (const [k, n] of [...seen].sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(5), k);
mkdirSync('release-artifacts', { recursive: true });
const scenario = process.env.DESKTOP ? 'desktop' : process.env.CUTOUT === 'left' ? 'cutout-left' : process.env.CUTOUT === 'right' ? 'cutout-right' : 'phone';
writeFileSync(`release-artifacts/layout-audit-${scenario}.json`, JSON.stringify({ scenario, productionUrl: base, state, phases: [...phases], overlaps: [...seen], errors, godMode: true, simulationSpeed: speed, limitation: 'Measures settled DOM text/panel/control boxes; canvas marker labels still require visual inspection.' }, null, 2));
await browser.close();
if (seen.size || errors.length || state !== 'debrief') process.exitCode = 1;
