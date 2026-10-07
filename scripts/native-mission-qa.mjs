// Full mission in the signed Android debug APK, with actual bot control inputs.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
const serial = process.env.ANDROID_SERIAL ?? 'emulator-5554';
const speed = Number(process.env.SPEED ?? 1);
const adbPath = path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb.exe');
const adb = (...args) => execFileSync(adbPath, ['-s', serial, ...args], { encoding:'utf8', timeout:20000 }).trim();
const out = 'release-artifacts/native';
mkdirSync(out, { recursive:true });
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223', { noDefaults:true });
const context = browser.contexts()[0];
const page = context.pages().find(p => p.url().includes('appassets.androidplatform.net'));
if (!page) throw new Error('Android game page unavailable');
const resume = process.env.RESUME === '1';
const priorResult = process.env.CONTINUE_JSON ? JSON.parse(readFileSync(process.env.CONTINUE_JSON,'utf8')) : null;
const previous = priorResult?.states ?? (process.env.CONTINUE_LOG ? readFileSync(process.env.CONTINUE_LOG,'utf8').split(/\r?\n/).filter(l=>l.startsWith('{')).map(l=>JSON.parse(l)) : []);
const errors = [], states = [...previous], events = [], captures = new Set();
const retries=[...(priorResult?.checkpointRetries ?? [])];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
await page.waitForFunction(() => window.__joker && __joker.game.fps > 0);
const cdp = await context.newCDPSession(page);
const tap = async selector => {
  await page.locator(selector).waitFor({state:'visible'});
  const box=await page.locator(selector).boundingBox();
  await cdp.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[{ id:1, x:box.x+box.width/2, y:box.y+box.height/2, radiusX:8, radiusY:8, force:1 }] });
  await page.waitForTimeout(70);
  await cdp.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[{ id:1, x:box.x+box.width/2, y:box.y+box.height/2 }] });
};
if (!resume) await tap('#btn-launch');
await page.evaluate(speed => { if (__joker.game.settings.assist) __joker.game.toggleSetting('assist'); __joker.bot(true); __joker.speed(speed); }, speed);
const began = Date.now();
try {
  while (Date.now() - began < 420000) {
    await page.waitForTimeout(1000);
    const state = await page.evaluate(() => __joker.state());
    states.push(state);
    events.push(...await page.evaluate(() => __joker.events()));
    console.log(JSON.stringify(state));
    if (process.env.NATIVE_MISSION_CAPTURES !== '0' && state.state === 'play' && !captures.has(state.phase)) {
      captures.add(state.phase);
      const name = `mission-${String(captures.size).padStart(2,'0')}-${state.phase.replace(/[^a-z0-9]+/gi,'-')}.png`;
      const remote = `/sdcard/jokers-${name}`;
      adb('shell','screencap','-p',remote);
      adb('pull',remote,`${out}/${name}`);
    }
    if (state.state === 'failed' && retries.length < Number(process.env.MAX_RETRIES ?? 0)) {
      retries.push({checkpoint:state.checkpoint,score:state.score,hp:state.hp});
      await tap('#screen-fail [data-action="retry"]');
      continue;
    }
    if (state.state === 'debrief' || state.state === 'failed') break;
  }
} catch (error) { errors.push(error.stack ?? String(error)); }
const last = states.at(-1);
let godMode=null;
try { godMode=await page.evaluate(() => __joker.game.god); } catch(error) { errors.push(`QA transport: ${error.message}`); }
writeFileSync(`${out}/native-mission-qa.json`, JSON.stringify({ environment:'API36 Android16 AOSP x86_64 emulator; signed debug APK; WebView133; real bot inputs; direct steering', simulationSpeed:speed, resumedAfterQaTransportReconnect:resume, priorHarnessErrors:priorResult?.errors??[], checkpointRetries:retries, completed:last?.state==='debrief', godMode, physicalDeviceTested:false, states, events, errors },null,2));
await browser.close();
if (last?.state !== 'debrief' || errors.length || godMode !== false) process.exitCode = 1;
