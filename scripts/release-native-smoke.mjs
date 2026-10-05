// Release APK smoke using adb inputs. The QA AOSP userdebug OS exposes CDP;
// the application itself remains non-debuggable and has no game debug hook.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
const adbPath=path.join(process.env.ANDROID_HOME,'platform-tools','adb.exe');
const serial=process.env.ANDROID_SERIAL??'emulator-5554';
const adb=(...args)=>execFileSync(adbPath,['-s',serial,...args],{encoding:'utf8',timeout:20000}).trim();
const out='release-artifacts/native';
mkdirSync(out,{recursive:true});
let browser=await chromium.connectOverCDP('http://127.0.0.1:9223',{noDefaults:true});
let page=browser.contexts()[0].pages().find(p=>p.url().includes('appassets.androidplatform.net'));
assert.ok(page);
const prior=process.env.PORTRAIT_ONLY==='1'?JSON.parse(readFileSync(`${out}/release-smoke.json`,'utf8')):null;
const errors=[],checks=[...(prior?.checks??[])],screenshots=[...(prior?.screenshots??[])];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const check=(name)=>{checks.push(name);console.log(`PASS ${name}`);};
const capture=name=>{const file=`${name}.png`;writeFileSync(`${out}/${file}`,execFileSync(adbPath,['-s',serial,'exec-out','screencap','-p'],{timeout:30000,maxBuffer:16*1024*1024}));screenshots.push(file);};
const tap=async selector=>{
  const box=await page.locator(selector).first().boundingBox();assert.ok(box);
  const dpr=await page.evaluate(()=>devicePixelRatio);
  adb('shell','uiautomator','dump','/sdcard/jokers-ui.xml');
  const xml=adb('shell','cat','/sdcard/jokers-ui.xml');
  const bounds=xml.match(/class="android.webkit.WebView"[^>]*bounds="\[(\d+),(\d+)\]/);
  assert.ok(bounds,'WebView origin in actual Android UI');
  adb('shell','input','tap',String(Math.round(+bounds[1]+(box.x+box.width/2)*dpr)),String(Math.round(+bounds[2]+(box.y+box.height/2)*dpr)));
};
const visible=async id=>page.locator(`#${id}`).isVisible();
try {
  if(!prior) {
  await page.waitForFunction(()=>document.getElementById('btn-launch'));
  assert.equal(await page.evaluate(()=>typeof window.__joker),'undefined');
  assert.ok(await visible('screen-title'));
  const pkg=adb('shell','dumpsys','package','app.toyboxes.jokersrun');
  assert.match(pkg,/versionCode=2/);assert.match(pkg,/versionName=1\.0\.1/);
  assert.ok(!/flags=\[[^\]]*DEBUGGABLE/.test(pkg));
  assert.equal(adb('shell','settings','get','global','wifi_on'),'0');
  check('offline release title, code2, non-debuggable application and absent game debug hook');
  capture('04-release-title');
  await tap('#screen-title [data-privacy]');
  await page.waitForFunction(()=>document.getElementById('privacy-dialog').open);
  adb('shell','input','keyevent','4');
  await page.waitForFunction(()=>!document.getElementById('privacy-dialog').open);
  check('actual Android Back dismisses offline privacy');
  await tap('#btn-launch');
  await page.waitForFunction(()=>document.getElementById('screen-title').classList.contains('hidden'));
  await page.waitForTimeout(20000);
  assert.ok(!await visible('screen-pause')&&!await visible('screen-fail'));
  assert.ok(await visible('t-gun'));
  capture('08-release-flight');
  check('actual adb launch reaches flight with mobile HUD');
  adb('shell','input','keyevent','4');
  await page.waitForFunction(()=>!document.getElementById('screen-pause').classList.contains('hidden'));
  capture('09-release-flight-back-paused');
  check('actual Android Back pauses flight');
  await tap('#screen-pause [data-action=resume]');
  adb('shell','input','keyevent','3');
  await page.waitForTimeout(800);
  adb('shell','am','start','-n','app.toyboxes.jokersrun/.MainActivity');
  await page.waitForFunction(()=>!document.getElementById('screen-pause').classList.contains('hidden'));
  capture('07-release-background-paused');
  check('Home and foreground preserve explicit pause');
  }
  adb('shell','settings','put','system','accelerometer_rotation','0');
  adb('shell','settings','put','system','user_rotation','0');
  adb('shell','wm','size','1600x2560');adb('shell','wm','density','160');
  // Changing the emulator density recreates the Activity and its WebView target.
  await new Promise(resolve=>setTimeout(resolve,5000));
  await browser.close().catch(()=>{});
  const appPid=adb('shell','pidof','app.toyboxes.jokersrun');
  adb('forward','tcp:9223',`localabstract:webview_devtools_remote_${appPid}`);
  browser=await chromium.connectOverCDP('http://127.0.0.1:9223',{noDefaults:true});
  page=browser.contexts()[0].pages().find(p=>p.url().includes('appassets.androidplatform.net'));
  assert.ok(page);
  await page.waitForFunction(()=>document.getElementById('rotate'));
  assert.ok(await page.evaluate(()=>innerWidth<innerHeight));
  assert.ok(await visible('rotate'));
  capture('11-release-tablet-portrait');
  check('API36 large-screen portrait shows rotate prompt');
  assert.deepEqual(errors,[]);
} catch(error){errors.push(error.stack??String(error));process.exitCode=1;}
finally {
  adb('shell','wm','size','reset');adb('shell','wm','density','reset');
  adb('shell','settings','put','system','accelerometer_rotation','1');
  adb('shell','settings','put','system','user_rotation','0');
  writeFileSync(`${out}/release-smoke.json`,JSON.stringify({environment:'API36 Android16 AOSP x86_64 emulator, Pixel6 profile, userdebug OS, signed release APK1.0.1/code2',method:'actual adb touch/Back/Home, screenshots; read-only page metadata through OS-debug WebView socket; portrait target reattached after expected density Activity recreation',apkSha256:createHash('sha256').update(readFileSync('release-artifacts/jokers-run-1.0.1-upload-signed.apk')).digest('hex'),checks,errors,priorHarnessErrors:prior?.errors??[],screenshots,physicalDeviceTested:false,restoredDisplay:'1080x2400 density420, accelerometer rotation1, user rotation0'},null,2));
  await browser.close().catch(()=>{});
}
