// Usage: node scripts/shot.mjs <outPrefix> "<js step>" [waitMs] ...
// Drives real Chrome against the dev server and saves screenshots for review.
import { chromium } from 'playwright-core';

const url = process.env.URL ?? 'http://localhost:5190/?debug';
const steps = process.argv.slice(2);
const browser = await chromium.launch({
  channel: 'chrome',
  headless: process.env.HEADED ? false : true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(url);
await page.waitForTimeout(1500);
for (const s of steps) {
  if (s.startsWith('wait:')) await page.waitForTimeout(Number(s.slice(5)));
  else if (s.startsWith('shot:')) await page.screenshot({ path: `artifacts/${s.slice(5)}.png` });
  else if (s.startsWith('key:')) await page.keyboard.press(s.slice(4));
  else if (s.startsWith('down:')) await page.keyboard.down(s.slice(5));
  else if (s.startsWith('up:')) await page.keyboard.up(s.slice(3));
  else if (s.startsWith('eval:')) {
    const v = await page.evaluate(s.slice(5));
    if (v !== undefined) console.log('eval>', JSON.stringify(v));
  }
}
console.log(logs.filter((l) => !l.includes('[vite]')).join('\n'));
await browser.close();
