import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const output = resolve('release-artifacts/samsung');
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--allow-file-access-from-files', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.route('**/*$WEBAPIS/webapis/webapis.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
const errors = [], states = [], events = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(`${pathToFileURL(resolve('dist-samsung/index.html')).href}?debug&bot`);
  await page.waitForFunction(() => window.__joker);
  await page.keyboard.press('Enter');
  await page.evaluate(() => __joker.speed(2));
  const started = Date.now();
  let lastPhase = '';
  while (Date.now() - started < 240000) {
    await page.waitForTimeout(1000);
    const state = await page.evaluate(() => ({ ...__joker.state(), god: __joker.game.god, shots: __joker.game.score.shotsFired, missiles: __joker.game.score.missilesFired }));
    states.push(state);
    events.push(...await page.evaluate(() => __joker.events()));
    if (state.phase !== lastPhase || states.length % 10 === 0 || state.state !== 'play') {
      console.log(JSON.stringify(state)); lastPhase = state.phase;
    }
    if (state.god) throw new Error('Invulnerability must remain off.');
    if (state.state === 'debrief' || state.state === 'failed') break;
  }
  const completed = states.at(-1)?.state === 'debrief';
  if (!completed) throw new Error(`Mission did not complete: ${JSON.stringify(states.at(-1))}`);
  await page.screenshot({ path: `${output}/mission-debrief.png` });
  console.log('PASS full carrier-to-debrief mission using normal flight/weapon inputs, no invulnerability or mission skips');
} catch (error) {
  errors.push(error.stack ?? String(error)); console.error(error); process.exitCode = 1;
} finally {
  writeFileSync(`${output}/mission-qa.json`, JSON.stringify({ environment: `macOS ${process.arch}, Chrome ${browser.version()}, actual Samsung local bundle, automated direct-control pilot at 2x simulation speed`, physicalSamsungTVVerified: false, humanRemotePlaytest: false, completed: states.at(-1)?.state === 'debrief', states, events, errors }, null, 2) + '\n');
  await browser.close();
}
