// Production-bundle checks and genuine gameplay captures, using installed Chrome.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const base = process.env.URL ?? 'http://127.0.0.1:5191/';
const out = 'release-artifacts';
mkdirSync(`${out}/screenshots`, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
const errors = [], external = [], checks = [];
const context = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await context.route('**/*', route => {
  if (!route.request().url().startsWith(base) && !route.request().url().startsWith('data:')) {
    external.push(route.request().url());
    return route.abort();
  }
  return route.continue();
});
const page = await context.newPage();
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
const check = (name, data = true) => { checks.push({ name, data }); console.log(`PASS ${name}`); };
try {
  await page.goto(`${base}?debug`);
  await page.waitForFunction(() => window.__joker && window.__joker.game.fps > 0);
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.evaluate(() => __joker.game.touch.enabled), true);
  check('production bundle launches with touch UI and local fonts');
  await page.locator('#screen-title [data-privacy]').tap();
  assert.equal(await page.locator('#privacy-dialog').evaluate(el => el.open), true);
  assert.equal(await page.evaluate(() => jokerNativeBack()), false);
  assert.equal(await page.locator('#privacy-dialog').evaluate(el => el.open), false);
  check('offline in-app privacy policy opens and Back dismisses it');
  assert.equal(await page.evaluate(() => jokerNativeBack()), true);
  await page.locator('#btn-launch').tap();
  await page.waitForFunction(() => __joker.game.state === 'play');
  assert.equal(await page.evaluate(() => jokerNativeBack()), false);
  assert.equal(await page.evaluate(() => __joker.game.state), 'paused');
  check('native Back pauses gameplay');
  await page.locator('[data-action=resume]').first().tap();
  await page.evaluate(() => window.dispatchEvent(new Event('joker:native-pause')));
  await page.waitForFunction(() => __joker.game.state === 'paused' && __joker.game.audio.ctx.state === 'suspended');
  const pausedAt = await page.evaluate(() => __joker.game.time);
  await page.evaluate(() => window.dispatchEvent(new Event('joker:native-resume')));
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => __joker.game.state), 'paused');
  assert.equal(await page.evaluate(() => __joker.game.time), pausedAt);
  check('background freezes simulation/audio; foreground requires explicit resume');
  assert.equal(await page.evaluate(() => jokerNativeBack()), false);
  assert.equal(await page.evaluate(() => __joker.game.state), 'title');
  check('Back from pause returns to title');
  for (const size of [{width:640,height:360},{width:960,height:540},{width:1280,height:800},{width:800,height:1280}]) {
    await page.setViewportSize(size);
    await page.evaluate(() => __joker.start('scouts'));
    await page.waitForTimeout(700);
    if (size.width < size.height) {
      assert.equal(await page.evaluate(() => __joker.game.state), 'paused');
      assert.notEqual(await page.locator('#rotate').evaluate(el => getComputedStyle(el).display), 'none');
    } else {
      for (const id of ['t-gun','t-msl','t-pause']) {
        const box = await page.locator(`#${id}`).boundingBox();
        assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= size.width + 1 && box.y + box.height <= size.height + 1, `${id} fits ${size.width}x${size.height}`);
      }
    }
    await page.screenshot({ path: `${out}/layout-${size.width}x${size.height}.png` });
    check(`layout ${size.width}x${size.height}`);
  }
  await page.setViewportSize({width:960,height:540});
  // Checkpoint selection only: real aircraft/terrain/HUD, normal controls, no god mode.
  for (const [cp,delay,file] of [['scouts',2500,'01-scout-intercept'],['ace',9500,'02-ace-dogfight'],['final',3500,'03-final-intercept']]) {
    await page.evaluate(cp => __joker.start(cp), cp);
    await page.waitForTimeout(delay);
    assert.equal(await page.evaluate(() => __joker.game.god), false);
    await page.screenshot({ path: `${out}/screenshots/${file}-1920x1080.png` });
    check(`genuine gameplay capture: ${cp}`, await page.evaluate(() => __joker.state()));
  }
  await page.evaluate(() => { __joker.game.toggleSetting('reducedMotion'); });
  const settings = await page.evaluate(() => localStorage.getItem('jokersrun.settings'));
  await page.reload();
  await page.waitForFunction(() => window.__joker);
  assert.equal(await page.evaluate(() => localStorage.getItem('jokersrun.settings')), settings);
  check('private local settings survive reload');
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  check('no external requests, failed resources, console errors or page errors');
} catch (error) {
  errors.push(error.stack ?? String(error));
  process.exitCode = 1;
} finally {
  writeFileSync(`${out}/release-qa.json`, JSON.stringify({ environment:'Windows installed Chrome; production bundle; emulated touch (not Android runtime)', checks, errors, external, screenshots:'1920x1080 from 960x540 touch viewport at 2x scale; checkpoints selected without god mode' }, null, 2));
  await browser.close();
}
