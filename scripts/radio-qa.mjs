import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Decode every shipped clip in the actual browser/WebView, then test mixer controls.
export async function verifyRadio(page, check) {
  const manifest = JSON.parse(readFileSync('src/voice-manifest.json', 'utf8'));
  const decoded = await page.evaluate(async clips => {
    const audio = __joker.game.audio;
    const result = [];
    for (const [line, clip] of Object.entries(clips)) {
      const buffer = await audio.loadVoice(clip.file);
      result.push({ line, file: clip.file, expected: clip.dur, duration: buffer?.duration ?? 0 });
    }
    return result;
  }, manifest);
  assert.equal(decoded.length, 35);
  assert.ok(decoded.every(clip => clip.duration > 0 && Math.abs(clip.duration - clip.expected) < 0.15));
  check('all 35 bundled radio MP3s decode with expected durations', decoded);
  await page.evaluate(() => {
    const audio = __joker.game.audio;
    audio.voiceOn = true;
    audio.setMuted(false);
    audio.speak('Looking sharp, lead.', 'JOKER 2');
  });
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => !!__joker.game.audio.voiceSrc), true);
  check('recorded radio starts through the local Web Audio mixer');
  const muted = await page.evaluate(() => {
    const audio = __joker.game.audio;
    audio.setMuted(true);
    return { source: !!audio.voiceSrc, duration: audio.speak('Looking sharp, lead.', 'JOKER 2') };
  });
  assert.deepEqual(muted, { source: false, duration: 0 });
  const off = await page.evaluate(() => {
    const audio = __joker.game.audio;
    audio.setMuted(false);
    audio.voiceOn = false;
    const result = { source: !!audio.voiceSrc, duration: audio.speak('Looking sharp, lead.', 'JOKER 2') };
    audio.voiceOn = true;
    return result;
  });
  assert.deepEqual(off, { source: false, duration: 0 });
  check('mute and RADIO VOICE off suppress recorded playback');
}
