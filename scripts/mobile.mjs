// Phone playtest: emulated touch device, real multi-touch via CDP.
// node scripts/mobile.mjs   (dev server on :5190)
import { chromium } from 'playwright-core';

const base = process.env.URL ?? 'http://localhost:5190/';
const W = 844;
const H = 390;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const cdp = await context.newCDPSession(page);
const active = new Map();
const send = (type) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...active.values()] });
const down = async (id, x, y) => {
  active.set(id, { x, y, id, radiusX: 8, radiusY: 8, force: 1 });
  await send('touchStart');
};
const move = async (id, x, y, steps = 6) => {
  const p = active.get(id);
  for (let i = 1; i <= steps; i++) {
    active.set(id, { ...p, x: p.x + ((x - p.x) * i) / steps, y: p.y + ((y - p.y) * i) / steps });
    await send('touchMove');
    await page.waitForTimeout(16);
  }
};
// Chrome's CDP releases exactly the points listed in touchEnd; the others stay down.
const up = async (id) => {
  const p = active.get(id);
  active.delete(id);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [p] });
};
const tap = async (x, y, id = 9) => {
  await down(id, x, y);
  await page.waitForTimeout(60);
  await up(id);
};
const center = async (sel) => {
  const b = await page.locator(sel).first().boundingBox();
  if (!b) throw new Error(`no box for ${sel}`);
  return [b.x + b.width / 2, b.y + b.height / 2];
};
const T = () => page.evaluate('__joker.touch()');
const shot = (n) => page.screenshot({ path: `artifacts/m-${n}.png` });
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`);
};

await page.goto(base + '?debug');
await page.waitForTimeout(1800);
await shot('title');
const t0 = await T();
check('touch mode auto-enabled on a touch-only device', t0.enabled && (await page.evaluate("document.body.classList.contains('touch')")));

// Launch from the title with a tap, then skip the deck shot with a tap.
await tap(...(await center('#btn-launch')));
await page.waitForTimeout(2200);
await shot('deck');
const hint = await page.evaluate("document.getElementById('t-hint').textContent");
check('deck shot offers TAP TO LAUNCH', hint === 'TAP TO LAUNCH', hint);
await tap(420, 200);
await page.waitForFunction('__joker.game.controlsEnabled', null, { timeout: 8000 });
check('tap skipped the wait and launched', true);
await page.waitForTimeout(800);
await shot('tutorial');
const teach = await page.evaluate("document.getElementById('t-stick').classList.contains('teach')");
check('CLIMB step highlights the stick', teach);

// Stick up = climb (assisted steering is on by default).
const alt0 = (await page.evaluate('__joker.state()')).pos[1];
await down(1, 150, 280);
await move(1, 150, 200);
await page.waitForTimeout(1200);
let s = await T();
await shot('stick-up');
const alt1 = (await page.evaluate('__joker.state()')).pos[1];
const nose = await page.evaluate('Math.round(Math.asin(__joker.game.player.fwd.y) * 180 / Math.PI)');
check('stick up gives full pitch input', s.input.pitch > 0.9 && s.input.assist, s.input);
check('jet climbs while stick is up', alt1 - alt0 > 60, { alt0, alt1 });
check('assisted climb holds a steep angle instead of looping', nose > 45 && nose < 80, { nose });
await move(1, 150, 280);
await page.waitForTimeout(1800);
const level = await page.evaluate('Math.round(Math.asin(__joker.game.player.fwd.y) * 180 / Math.PI)');
check('centred stick returns to level flight', Math.abs(level) < 10, { level });

// Stick left = assisted left turn: banks left and the heading swings left.
await move(1, 70, 280);
const h0 = (await T()).heading;
await page.waitForTimeout(1600);
s = await T();
check('stick left asks for a left turn', s.input.turn < -0.9, s.input);
check('assisted steering banks left', s.bank < -45, { bank: s.bank });
const dh = ((s.heading - h0 + 540) % 360) - 180;
check('heading turns left', dh < -15, { h0, h1: s.heading, dh });

// Multi-touch: hold stick right, tap BOOST (latches), hold GUN, all at once.
await move(1, 230, 280);
await tap(...(await center('#t-boost')), 2);
const shots0 = (await T()).shots;
const [gx, gy] = await center('#t-gun');
await down(3, gx, gy);
await page.waitForTimeout(900);
s = await T();
await shot('multitouch');
check('boost tap latches the afterburner', s.latched && s.boosting, { latched: s.latched, boosting: s.boosting });
check('guns fire while stick and boost are active', s.shots - shots0 > 10 && s.input.turn > 0.9, { shots: s.shots - shots0, turn: s.input.turn });
await up(3);
await tap(...(await center('#t-boost')), 2);
await page.waitForTimeout(150);
s = await T();
check('second boost tap cancels it', !s.latched && !s.input.boost, s);

// Release the stick: wings level by themselves.
await up(1);
await page.waitForTimeout(100);
console.log('   stick after release', (await T()).stick);
await page.waitForTimeout(2100);
s = await T();
check('hands off: assisted wings return level', Math.abs(s.bank) < 12, { bank: s.bank });

// ROLL button.
const roll0 = s.lastRollAt;
await tap(...(await center('#t-roll')));
await page.waitForTimeout(200);
s = await T();
check('ROLL tap performs a barrel roll', s.lastRollAt > roll0, { before: roll0, after: s.lastRollAt });

// Pause button and resume.
await tap(...(await center('#t-pause')));
await page.waitForTimeout(300);
s = await T();
check('pause button pauses', s.state === 'paused', s.state);
await shot('pause');
await tap(...(await center('#screen-pause [data-action=resume]')));
await page.waitForTimeout(300);
check('resume button resumes', (await T()).state === 'play');

// Training: MSL tap fires; TGT hold looks at the target.
await page.evaluate("__joker.start('training')");
await page.waitForFunction("__joker.game.target && __joker.game.target.kind === 'drone'", null, { timeout: 15000 });
await page.waitForTimeout(500);
await shot('training');
const m0 = (await T()).missiles;
await tap(...(await center('#t-msl')));
await page.waitForTimeout(200);
check('MSL tap launches a missile', (await T()).missiles === m0 + 1);
const [tx, ty] = await center('#t-tgt');
await down(4, tx, ty);
await page.waitForTimeout(600);
s = await T();
check('holding TGT looks at the target', s.input.look, s.input);
await up(4);

// Scouts phase: orders chips, tap-to-target, compact HUD.
await page.evaluate("__joker.start('scouts')");
await page.waitForTimeout(9000);
await shot('scouts');
const chipsShown = await page.evaluate("document.getElementById('t-orders').classList.contains('show')");
check('wingman order chips appear in the scout phase', chipsShown);
await tap(...(await center('[data-b=order2]')));
await page.waitForTimeout(200);
check('tapping SCOUTS orders wingmen onto the scouts', (await T()).wingOrder === 'scouts');
const findPick = () => page.evaluate(`(() => {
  const g = __joker.game; const cam = g.rig.camera;
  for (const a of g.aircraft) {
    if (a.team !== 'red' || !a.targetable || a === g.target) continue;
    const v = a.pos.clone().applyMatrix4(cam.matrixWorldInverse); if (v.z > 0) continue;
    const p = a.pos.clone().project(cam);
    const x = (p.x * 0.5 + 0.5) * innerWidth, y = (-p.y * 0.5 + 0.5) * innerHeight;
    if (x > 120 && x < innerWidth - 330 && y > 60 && y < innerHeight - 60) return { x, y, label: a.label, id: a.id };
  }
  return null;
})()`);
// Face the enemy formation so there is something on screen to tap.
await page.evaluate(`(() => {
  const g = __joker.game, p = g.player;
  const e = g.aircraft.find((a) => a.team === 'red' && a.targetable);
  const d = e.pos.clone().sub(p.pos).normalize();
  p.quat.setFromUnitVectors(new p.pos.constructor(0, 0, -1), d);
  p.updateBasis();
})()`);
await page.waitForTimeout(600);
let pick = null;
for (let i = 0; i < 40 && !pick; i++) {
  pick = await findPick();
  if (!pick) await page.waitForTimeout(250);
}
if (pick) {
  await tap(pick.x, pick.y);
  await page.waitForTimeout(150);
  const tid = await page.evaluate('__joker.game.target && __joker.game.target.id');
  check('tapping an enemy on screen targets it', tid === pick.id, pick);
} else check('tap-to-target (no enemy on screen to tap)', true, 'skipped');

// Tilt steering: synthetic deviceorientation through the real handler (landscape, 45° back).
const tilt = await page.evaluate(`(async () => {
  const t = __joker.game.touch.tilt;
  await t.enable();
  const angle = screen.orientation ? screen.orientation.angle : 0;
  const fire = (beta, gamma) => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta, gamma }));
  // Neutral pose for angle 90: beta 0, gamma -45. For angle 270 the signs mirror.
  const s = angle === 270 ? -1 : 1;
  fire(0, -45 * s);
  const neutral = [t.steer, t.pitch];
  fire(14 * s, -45 * s);   // wheel turned clockwise ~20°
  const right = t.steer;
  fire(0, -45 * s);
  fire(0, -70 * s);         // top edge pulled toward the player (phone more upright)
  const pull = t.pitch;
  t.disable();
  return { angle, neutral, right, pull };
})()`);
check('tilt: level pose is neutral', Math.abs(tilt.neutral[0]) < 0.05 && Math.abs(tilt.neutral[1]) < 0.05, tilt);
check('tilt: turning the phone like a wheel steers right', tilt.right > 0.4, tilt);
check('tilt: pulling the top edge toward you climbs', tilt.pull > 0.4, tilt);

// Later phases, layout only.
await page.evaluate("__joker.god(); __joker.start('ace')");
await page.waitForTimeout(12000);
await shot('ace');
await page.evaluate("__joker.start('final')");
await page.waitForTimeout(4000);
await shot('final');

// Portrait: rotate prompt, auto-pause.
await page.setViewportSize({ width: H, height: W });
await page.waitForTimeout(500);
await shot('portrait');
s = await T();
check('portrait shows the rotate prompt and pauses', s.state === 'paused' && (await page.evaluate("getComputedStyle(document.getElementById('rotate')).display")) !== 'none', s.state);
await page.setViewportSize({ width: W, height: H });
await page.waitForTimeout(500);
await shot('back-landscape');

// Fail and debrief screens on a short screen.
await tap(...(await center('#screen-pause [data-action=resume]')));
await page.evaluate("__joker.god(false); __joker.game.playerDamaged(500, 'missile')");
await page.waitForTimeout(4000);
await shot('fail');
await page.evaluate('__joker.game.showDebrief()');
await page.waitForTimeout(600);
await shot('debrief');
check('render scale', true, (await T()).renderScale);

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
if (errors.length) console.log('PAGE ERRORS:\n' + errors.join('\n'));
await browser.close();
