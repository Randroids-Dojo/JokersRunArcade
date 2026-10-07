// Title screen regression check for wide landscape phones and input-mode switching.
// Run with the local Vite server on port 5190.
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const output = process.env.EVIDENCE_DIR;
if (output) await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${JSON.stringify(detail)}` : ''}`);
  if (!ok) failed++;
};

async function inspect(name, options, expectCard) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:5190/?debug');
  await page.waitForSelector('#btn-launch');
  await page.waitForTimeout(1600);
  const layout = await page.evaluate(() => {
    const title = document.querySelector('.title-wrap').getBoundingClientRect();
    const launch = document.querySelector('#btn-launch').getBoundingClientRect();
    const card = document.querySelector('.controls-card');
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      touch: document.body.classList.contains('touch'),
      cardVisible: getComputedStyle(card).display !== 'none',
      titleTop: title.top,
      titleBottom: title.bottom,
      launchTop: launch.top,
      launchBottom: launch.bottom,
    };
  });
  check(`${name}: control card visibility`, layout.cardVisible === expectCard, layout);
  check(`${name}: launch and title fit`, layout.titleTop >= -1 && layout.titleBottom <= layout.height + 1 && layout.launchTop >= 0 && layout.launchBottom <= layout.height, layout);
  if (output) await page.screenshot({ path: `${output}/${name}-title.png` });
  return { context, page, errors };
}

const wide = await inspect('wide-phone-1024x460', { viewport: { width: 1024, height: 460 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, false);
check('wide phone: touch instructions visible', await wide.page.locator('.touch-note').isVisible());
await wide.page.keyboard.press('Tab');
check('wide phone: card stays hidden after keyboard switch', !(await wide.page.locator('.controls-card').isVisible()));
await wide.page.touchscreen.tap(500, 350);
check('wide phone: touch mode returns', await wide.page.evaluate(() => document.body.classList.contains('touch')));
await wide.page.locator('#btn-launch').click();
await wide.page.waitForFunction(() => window.__joker.game.state !== 'title');
check('wide phone: launch starts gameplay', true);
if (output) await wide.page.screenshot({ path: `${output}/wide-phone-gameplay.png` });
check('wide phone: no page errors', wide.errors.length === 0, wide.errors);
await wide.context.close();

const phone = await inspect('phone-844x390', { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, false);
check('phone: touch instructions visible', await phone.page.locator('.touch-note').isVisible());
check('phone: no page errors', phone.errors.length === 0, phone.errors);
await phone.context.close();

const desktop = await inspect('desktop-1440x860', { viewport: { width: 1440, height: 860 } }, true);
await desktop.page.locator('#btn-launch').click();
await desktop.page.waitForFunction(() => window.__joker.game.state !== 'title');
check('desktop: launch starts gameplay', true);
check('desktop: no page errors', desktop.errors.length === 0, desktop.errors);
await desktop.context.close();

const compact = await inspect('compact-keyboard-1024x460', { viewport: { width: 1024, height: 460 } }, false);
check('compact keyboard: no page errors', compact.errors.length === 0, compact.errors);
await compact.context.close();

const hybrid = await inspect('hybrid-1440x860', { viewport: { width: 1440, height: 860 }, hasTouch: true }, false);
await hybrid.page.touchscreen.tap(700, 700);
check('hybrid: touch hides keyboard help', !(await hybrid.page.locator('.controls-card').isVisible()));
await hybrid.page.keyboard.press('Tab');
check('hybrid: keyboard restores help', await hybrid.page.locator('.controls-card').isVisible());
check('hybrid: no page errors', hybrid.errors.length === 0, hybrid.errors);
await hybrid.context.close();

await browser.close();
if (failed) process.exitCode = 1;
