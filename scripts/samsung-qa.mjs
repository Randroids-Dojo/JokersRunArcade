import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rgbPng } from './png.mjs';

const out = resolve('release-artifacts/samsung');
const assets = resolve('release/samsung/assets');
mkdirSync(out, { recursive: true });
mkdirSync(assets, { recursive: true });
const base = pathToFileURL(resolve('dist-samsung/index.html')).href;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--allow-file-access-from-files', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, userAgent: 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 10.0) AppleWebKit/537.36 (KHTML, like Gecko) 130.0.6723.116/10.0 TV Safari/537.36' });
const errors = [], external = [], checks = [];
await context.route('**/*', async route => {
  const url = route.request().url();
  if (url.includes('$WEBAPIS/webapis/webapis.js')) {
    await route.fulfill({ contentType: 'text/javascript', body: `
      window.__tvCalls = { keys: [], screensaver: [], exits: 0 };
      window.tizen = { tvinputdevice: { registerKey: key => __tvCalls.keys.push(key) }, application: { getCurrentApplication: () => ({ exit: () => __tvCalls.exits++ }) } };
      window.webapis = { appcommon: { AppCommonScreenSaverState: { SCREEN_SAVER_OFF: 0, SCREEN_SAVER_ON: 1 }, setScreenSaver: (state, success) => { __tvCalls.screensaver.push(state); success?.(); } } };` });
  } else if (!url.startsWith('file:') && !url.startsWith('data:') && !url.startsWith('blob:')) {
    external.push(url); await route.abort();
  } else await route.continue();
});
const page = await context.newPage();
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const pass = (name, data = true) => { checks.push({ name, data }); console.log(`PASS ${name}`); };
const state = () => page.evaluate(() => __joker.state());
const key = async (code, kind = 'press') => {
  await page.evaluate(({ code, kind }) => {
    if (kind !== 'up') window.dispatchEvent(new KeyboardEvent('keydown', { keyCode: code, which: code, bubbles: true, cancelable: true }));
    if (kind !== 'down') window.dispatchEvent(new KeyboardEvent('keyup', { keyCode: code, which: code, bubbles: true, cancelable: true }));
  }, { code, kind });
  await page.waitForTimeout(100);
};
const focus = selector => page.locator(selector).focus();
const command = async action => {
  if ((await state()).state === 'play') await key(10009);
  await focus(`[data-flight="${action}"]`);
  await key(13);
  await page.waitForTimeout(150);
};

try {
  await page.goto(`${base}?debug`);
  await page.waitForFunction(() => window.__joker && __joker.game.fps > 0);
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.evaluate(() => document.body.classList.contains('tv')), true);
  assert.equal(await page.evaluate(() => __joker.game.touch.enabled), false);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-launch');
  assert.equal(await page.locator('#privacy-dialog iframe').count(), 0);
  pass('packaged local-file boot, TV mode, launch focus, local fonts and no touch controls');

  for (const size of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }, { width: 3840, height: 2160 }]) {
    await page.setViewportSize(size);
    await page.waitForTimeout(200);
    const clipped = await page.evaluate(() => Array.from(document.querySelectorAll('#screen-title button, .controls-card')).flatMap(el => {
      const r = el.getBoundingClientRect();
      return r.width && (r.x < 0 || r.y < 0 || r.right > innerWidth || r.bottom > innerHeight) ? [el.textContent] : [];
    }));
    assert.deepEqual(clipped, []);
    const render = await page.evaluate(() => ({ w: __joker.game.renderer.domElement.width, h: __joker.game.renderer.domElement.height }));
    // A 4K CSS viewport must not become a 4K GPU render target after resize.
    assert.ok(render.w <= 1920 && render.h <= 1080);
    pass(`title controls fit ${size.width}x${size.height}`, render);
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.screenshot({ path: `${out}/title.png` });
  await page.screenshot({ path: `${assets}/01-title.jpg`, type: 'jpeg', quality: 82 });

  await focus('#screen-title [data-toggle="music"]');
  const initialMusic = await page.evaluate(() => __joker.game.settings.music);
  await key(13);
  assert.equal(await page.evaluate(() => __joker.game.settings.music), !initialMusic);
  assert.equal((await state()).state, 'title');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.toggle), 'music');
  pass('OK toggles the focused setting without starting the mission or losing focus');
  await key(13);
  await key(40);
  assert.ok(await page.evaluate(() => document.activeElement.tagName === 'BUTTON'));
  pass('five-way remote moves menu focus');

  await focus('#screen-title [data-privacy]');
  await key(13);
  assert.equal(await page.locator('#privacy-dialog').evaluate(el => el.open), true);
  await page.screenshot({ path: `${out}/privacy.png` });
  await key(40);
  assert.ok(await page.locator('.tv-privacy-copy').evaluate(el => el.scrollTop) > 0);
  await key(10009);
  assert.equal(await page.locator('#privacy-dialog').evaluate(el => el.open), false);
  assert.equal(await page.evaluate(() => document.activeElement.hasAttribute('data-privacy')), true);
  pass('offline TV privacy copy scrolls with remote and Return restores focus');

  await focus('#btn-launch');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => __joker.game.state === 'play');
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => __joker.game.audio.ctx.state), 'running');
  await key(10009);
  assert.equal((await state()).state, 'paused');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'resume');
  const paused = await page.evaluate(() => __joker.game.time);
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => __joker.game.time), paused);
  await page.screenshot({ path: `${out}/pause.png` });
  const clippedPause = await page.evaluate(() => Array.from(document.querySelectorAll('#screen-pause button')).filter(el => el.getBoundingClientRect().width > 0).flatMap(el => {
    const r = el.getBoundingClientRect(); return r.y < 0 || r.bottom > innerHeight ? [el.textContent] : [];
  }));
  assert.deepEqual(clippedPause, []);
  pass('remote starts with audio, Return pauses, focus lands on Resume, simulation freezes');
  await key(10009);
  assert.equal((await state()).state, 'play');
  pass('Return resumes without losing the mission');

  await page.evaluate(() => __joker.start('scouts'));
  await page.waitForFunction(() => __joker.game.controlsEnabled && !__joker.game.cinematic && !__joker.game.formation);
  const beforeHeading = await page.evaluate(() => Math.atan2(__joker.game.player.fwd.x, -__joker.game.player.fwd.z));
  await key(39, 'down');
  await page.waitForTimeout(800);
  const flight = await page.evaluate(() => ({ assist: __joker.game.input.assist, turn: __joker.game.input.turn, bank: __joker.game.pc.bankAngle(__joker.game.player), heading: Math.atan2(__joker.game.player.fwd.x, -__joker.game.player.fwd.z) }));
  await key(39, 'up');
  assert.equal(flight.assist, true);
  assert.equal(flight.turn, 1);
  assert.ok(Math.abs(flight.heading - beforeHeading) > .01);
  pass('numeric Samsung arrow codes steer the real aircraft with assisted banking', flight);
  await key(37); await key(37);
  assert.ok(await page.evaluate(() => __joker.game.pc.lastRollAt > 0));
  pass('double-tap remote direction triggers an actual barrel roll');
  await key(13, 'down');
  await page.waitForTimeout(400);
  assert.ok(await page.evaluate(() => __joker.game.score.shotsFired > 0));
  await key(10009);
  await key(13, 'up');
  assert.equal(await page.evaluate(() => __joker.game.input.remote.guns), false);
  pass('holding OK fires guns and pausing releases held weapons');

  await command('boost');
  assert.equal(await page.evaluate(() => __joker.game.input.boost), true);
  await command('brake');
  assert.equal(await page.evaluate(() => __joker.game.input.brake), true);
  assert.equal(await page.evaluate(() => __joker.game.input.boost), false);
  await command('brake');
  pass('flight-menu boost and brake latch, exclude each other, and toggle off');
  await command('order');
  assert.equal(await page.evaluate(() => __joker.game.wingOrder), 'scouts');
  const oldTarget = await page.evaluate(() => __joker.game.target?.id);
  await command('target');
  assert.notEqual(await page.evaluate(() => __joker.game.target?.id), oldTarget);
  pass('flight-menu wingman and target commands reach the simulation');

  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const backgroundTime = await page.evaluate(() => __joker.game.time);
  await page.waitForTimeout(250);
  assert.equal((await state()).state, 'paused');
  assert.equal(await page.evaluate(() => __joker.game.time), backgroundTime);
  assert.equal(await page.evaluate(() => __joker.game.audio.ctx.state), 'suspended');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.equal((await state()).state, 'paused');
  await key(10009);
  pass('visibility contract suspends audio, simulation and controls; foreground waits for Resume');

  await page.evaluate(() => {
    window.__testPad = { index: 0, id: 'Standard test controller', connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [window.__testPad] });
  });
  const padButton = async i => {
    await page.evaluate(i => { __testPad.buttons[i] = { pressed: true, value: 1 }; }, i);
    await page.waitForTimeout(120);
    await page.evaluate(i => { __testPad.buttons[i] = { pressed: false, value: 0 }; }, i);
    await page.waitForTimeout(120);
  };
  await padButton(9);
  assert.equal((await state()).state, 'paused');
  await padButton(15);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'retry');
  await padButton(14);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'resume');
  await padButton(0);
  assert.equal((await state()).state, 'play');
  await page.evaluate(() => { __testPad.connected = false; window.dispatchEvent(new Event('gamepaddisconnected')); });
  assert.equal((await state()).state, 'paused');
  pass('gamepad Start, D-pad, A, and disconnect pause work through standard Gamepad API');
  await page.evaluate(() => { window.__testPad = null; });
  await key(10009);

  // Real game renderer and checkpoints; no invulnerability, bot or fake artwork in screenshots.
  for (const [checkpoint, delay, filename] of [['scouts', 1300, '02-scout-intercept'], ['ace', 8000, '03-ace-dogfight'], ['final', 1200, '04-final-intercept']]) {
    await page.evaluate(cp => __joker.start(cp), checkpoint);
    await page.waitForTimeout(delay);
    assert.equal(await page.evaluate(() => __joker.game.god), false);
    await page.screenshot({ path: `${assets}/${filename}.jpg`, type: 'jpeg', quality: 82 });
    pass(`genuine TV layout screenshot: ${checkpoint}`, await state());
  }

  await page.evaluate(() => __joker.game.fail('AIRCRAFT DESTROYED', 'Checkpoint retry verification.'));
  await page.waitForFunction(() => !document.getElementById('screen-fail').classList.contains('hidden') && document.activeElement.dataset.action === 'retry');
  await page.screenshot({ path: `${out}/failed.png` });
  const checkpoint = await page.evaluate(() => __joker.game.mission.checkpoint);
  await key(13);
  assert.equal((await state()).state, 'play');
  assert.equal(await page.evaluate(() => __joker.game.mission.checkpoint), checkpoint);
  pass('failure screen receives focus when its delayed reveal completes; OK retries the current checkpoint');

  await key(10182);
  assert.equal(await page.evaluate(() => __tvCalls.exits), 1);
  pass('Samsung Exit key exits immediately through the platform API');
  await page.evaluate(() => __joker.game.toTitle());
  await key(10009);
  assert.equal(await page.locator('#tv-exit-dialog').evaluate(el => el.open), true);
  await page.screenshot({ path: `${out}/exit-confirmation.png` });
  await key(10009);
  assert.equal(await page.locator('#tv-exit-dialog').evaluate(el => el.open), false);
  pass('Return on title offers exit confirmation; Return cancels it');

  const saved = await page.evaluate(() => localStorage.getItem('jokersrun.settings'));
  await page.reload();
  await page.waitForFunction(() => window.__joker);
  assert.equal(await page.evaluate(() => localStorage.getItem('jokersrun.settings')), saved);
  assert.equal((await state()).state, 'title');
  pass('local settings persist; a fresh launch safely returns to title');

  // Export wordmark/legacy icon using the game's own bundled font and diamond.
  const font = readFileSync('public/fonts/ChakraPetch-BoldItalic.ttf').toString('base64');
  const logos = await page.evaluate(async font => {
    const face = new FontFace('JokerLogo', `url(data:font/ttf;base64,${font})`, { weight: '700', style: 'italic' });
    await face.load(); document.fonts.add(face);
    function logo(w, h, background, pixels = false) {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      if (background) { ctx.fillStyle = '#05080c'; ctx.fillRect(0,0,w,h); }
      ctx.fillStyle = '#c0282d'; ctx.beginPath();
      ctx.moveTo(w*.5,h*.16); ctx.lineTo(w*.57,h*.28); ctx.lineTo(w*.5,h*.40); ctx.lineTo(w*.43,h*.28); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#f5f2ea'; ctx.textAlign = 'center'; ctx.font = `italic 700 ${w*.14}px JokerLogo`;
      ctx.fillText("JOKER'S", w*.49, h*.61); ctx.fillText('RUN', w*.49, h*.84);
      return pixels ? Array.from(ctx.getImageData(0,0,w,h).data) : c.toDataURL('image/png').split(',')[1];
    }
    return { foreground: logo(1920,1080,false), legacy: logo(512,423,true,true), square: logo(1024,1024,true,true) };
  }, font);
  writeFileSync(`${assets}/logo-1920x1080.png`, Buffer.from(logos.foreground, 'base64'));
  writeFileSync(`${assets}/icon-512x423.png`, rgbPng(512,423,logos.legacy));
  writeFileSync(`${assets}/icon-square-1024.png`, rgbPng(1024,1024,logos.square));
  // The background is a real, unadorned carrier scene from the game.
  await page.evaluate(() => { document.getElementById('screen-title').style.visibility = 'hidden'; });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${assets}/background-1920x1080.jpg`, type: 'jpeg', quality: 75 });
  for (const name of ['logo-1920x1080.png', 'icon-512x423.png', 'background-1920x1080.jpg']) assert.ok(statSync(`${assets}/${name}`).size < 300000, `${name} below Samsung 300KB limit`);
  for (const name of ['01-title', '02-scout-intercept', '03-ace-dogfight', '04-final-intercept']) assert.ok(statSync(`${assets}/${name}.jpg`).size < 500000);
  pass('Samsung wordmark, background, legacy icon and four 1080p JPEG screenshots meet byte limits');
  const calls = await page.evaluate(() => __tvCalls);
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  pass('no network dependency, missing local resources, console errors or page errors', calls);
} catch (error) {
  errors.push(error.stack ?? String(error));
  console.error(error);
  await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  writeFileSync(`${out}/runtime-qa.json`, JSON.stringify({ environment: `macOS ${process.arch}; installed Chrome ${browser.version()}; actual packaged local files; Samsung 2026 user-agent; synthetic platform APIs, remote codes and gamepad`, physicalSamsungTVVerified: false, checks, errors, external }, null, 2) + '\n');
  await browser.close();
}
