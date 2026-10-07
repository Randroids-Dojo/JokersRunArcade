import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
const out='release-artifacts';
mkdirSync(`${out}/mission-scenes`, {recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--ignore-gpu-blocklist']});
const context=await browser.newContext({viewport:{width:960,height:540},deviceScaleFactor:2,isMobile:true,hasTouch:true});
const page=await context.newPage();
const errors=[], states=[], events=[], captures=new Set();
page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:5191/?debug&bot');
await page.waitForFunction(()=>window.__joker);
await page.locator('#btn-launch').tap();
await page.evaluate(()=>{ if (__joker.game.settings.assist) __joker.game.toggleSetting('assist'); __joker.speed(2); });
const began=Date.now();
while(Date.now()-began<180000) {
  await page.waitForTimeout(1000);
  const state=await page.evaluate(()=>__joker.state());
  states.push(state);
  events.push(...await page.evaluate(()=>__joker.events()));
  console.log(JSON.stringify(state));
  if(state.state==='play' && !captures.has(state.phase)) {
    captures.add(state.phase);
    await page.screenshot({path:`${out}/mission-scenes/${String(captures.size).padStart(2,'0')}-${state.phase.replace(/[^a-z0-9]+/gi,'-')}-1920x1080.png`});
  }
  if(state.state==='debrief'||state.state==='failed') break;
}
const last=states.at(-1);
writeFileSync(`${out}/mission-qa.json`,JSON.stringify({environment:'Windows Chrome touch emulation, production bundle, direct steering setting, real bot control inputs, 2x simulation speed, god mode off',completed:last?.state==='debrief',states,events,errors},null,2));
await browser.close();
if(last?.state!=='debrief'||errors.length) process.exitCode=1;
