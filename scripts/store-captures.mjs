// Genuine production frames at Play-compatible dimensions; no compositing.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
const base = process.env.URL ?? 'http://127.0.0.1:5191/';
const out = 'release-artifacts/store-screenshots';
mkdirSync(out, { recursive:true });
const browser = await chromium.launch({ channel:'chrome', headless:true, args:['--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport:{width:960,height:540}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
const page = await context.newPage();
const errors=[], captures=[];
page.on('pageerror', e=>errors.push(e.message));
page.on('console', m=>{ if(m.type()==='error') errors.push(m.text()); });
await page.addInitScript(()=>{
  window.__captureText=[];
  const original=CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...rest){
    if(this.canvas.id==='overlay' && /^(ACE(?:\s|$)|MISSILE|FIRE\b)/.test(text)) {
      const w=this.measureText(text).width, h=parseFloat(this.font.match(/([\d.]+)px/)?.[1]??'12');
      const left=this.textAlign==='center'?x-w/2:this.textAlign==='right'?x-w:x;
      window.__captureText.push({text,rect:[left,y-h/2,left+w,y+h/2],at:performance.now()});
    }
    window.__captureText=window.__captureText.filter(r=>r.at>performance.now()-300);
    return original.call(this,text,x,y,...rest);
  };
});
await page.goto(`${base}?debug`);
await page.waitForFunction(()=>window.__joker && __joker.game.fps>0);
await page.evaluate(()=>document.fonts.ready);
for (const [checkpoint,delay,file] of [
  ['training',4500,'01-flight-check-1920x1080.png'],
  ['chase',4500,'02-canyon-chase-1920x1080.png'],
  ['ace',9500,'03-ace-dogfight-1920x1080.png'],
  ['final',3500,'04-final-intercept-1920x1080.png'],
]) {
  await page.evaluate(cp=>__joker.start(cp),checkpoint);
  await page.waitForTimeout(delay);
  const state=await page.evaluate(()=>({...__joker.state(),godMode:__joker.game.god}));
  if(state.state!=='play' || state.godMode) throw new Error(`Invalid capture: ${JSON.stringify(state)}`);
  const labelAudit=await page.evaluate(()=>{
    const panels=['tc','boss'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return{id,rect:[r.left,r.top,r.right,r.bottom],visible:!!r.width&&!!r.height};}).filter(p=>p.visible);
    const text=window.__captureText, overlaps=[];
    for(const t of text) for(const p of panels) {
      if(t.rect[0]<p.rect[2] && t.rect[2]>p.rect[0] && t.rect[1]<p.rect[3] && t.rect[3]>p.rect[1]) overlaps.push({text:t.text,panel:p.id});
    }
    return{sampledText:[...new Set(text.map(t=>t.text))],overlaps};
  });
  if(labelAudit.overlaps.length) throw new Error(`Canvas text covers a HUD panel: ${JSON.stringify(labelAudit)}`);
  await page.screenshot({path:`${out}/${file}`});
  captures.push({file,state,labelAudit});
}
writeFileSync(`${out}/capture-provenance.json`,JSON.stringify({environment:'Windows Chrome production bundle, emulated touch 960x540 at 2x, selected checkpoints, normal gameplay, god mode off',captures,errors},null,2));
await browser.close();
if(errors.length) process.exitCode=1;
