import { Game, Settings } from './game';
import type { CheckpointName } from './mission';
import { Bot } from './debugbot';

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const game = new Game(canvas);
const privacyDialog = document.getElementById('privacy-dialog') as HTMLDialogElement;
document.querySelectorAll<HTMLButtonElement>('[data-privacy]').forEach(button => {
  button.addEventListener('click', () => privacyDialog.showModal());
});
document.getElementById('privacy-close')!.addEventListener('click', () => privacyDialog.close());

// Backgrounding must freeze the mission and audio, including Android lifecycle changes.
function suspendGame() {
  game.input.releaseAll();
  game.pause();
  void game.audio.ctx?.suspend();
  game.audio.stopSpeech();
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) suspendGame();
});
window.addEventListener('joker:native-pause', suspendGame);
window.addEventListener('joker:native-resume', () => game.input.releaseAll());
// The native host uses Back to pause flight, return from pause to title, or exit title.
(window as unknown as { jokerNativeBack: () => boolean }).jokerNativeBack = () => {
  if (privacyDialog.open) { privacyDialog.close(); return false; }
  if (game.state === 'title') return true;
  if (game.state === 'play') game.pause();
  else game.toTitle();
  return false;
};

// ---------------------------------------------------------------- Menus

function syncToggles() {
  const labels: Record<string, [keyof Settings, boolean]> = {
    invertPitch: ['invertPitch', false],
    voice: ['voice', false],
    music: ['music', false],
    reducedMotion: ['reducedMotion', false],
    mute: ['mute', true],
    assist: ['assist', false],
    tilt: ['tilt', false],
    haptics: ['haptics', false],
  };
  document.querySelectorAll<HTMLButtonElement>('[data-toggle]').forEach((b) => {
    const [key, inverted] = labels[b.dataset.toggle!];
    const on = inverted ? !game.settings[key] : game.settings[key];
    const bold = b.querySelector('b');
    if (bold) bold.textContent = on ? 'ON' : 'OFF';
  });
}

document.querySelectorAll<HTMLButtonElement>('[data-toggle]').forEach((b) => {
  b.addEventListener('click', async (e) => {
    e.stopPropagation();
    b.blur();
    const key = b.dataset.toggle as keyof Settings;
    game.toggleSetting(key);
    if (key === 'tilt') {
      if (game.settings.tilt) {
        // iOS asks for motion permission here, inside the tap.
        const ok = await game.touch.tilt.enable();
        if (!ok) {
          game.toggleSetting('tilt');
          const bold = b.querySelector('b');
          if (bold) bold.textContent = 'UNAVAILABLE';
          return;
        }
      } else game.touch.tilt.disable();
    }
    syncToggles();
  });
});
syncToggles();

// Tilt stays on between visits; Android resumes immediately, iOS on the next tap.
if (game.settings.tilt) {
  const resume = () => {
    void game.touch.tilt.enable().then((ok) => {
      if (!ok && game.settings.tilt) {
        game.toggleSetting('tilt');
        syncToggles();
      }
    });
    window.removeEventListener('pointerdown', resume);
  };
  window.addEventListener('pointerdown', resume);
}

document.getElementById('btn-launch')!.addEventListener('click', (e) => {
  e.stopPropagation();
  (e.currentTarget as HTMLElement).blur();
  if (game.state === 'title') game.startMission();
});

document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((b) => {
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    b.blur();
    const a = b.dataset.action;
    if (a === 'resume') game.resume();
    else if (a === 'retry') game.retry();
    else if (a === 'restart') game.restart();
    else if (a === 'title') game.toTitle();
  });
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM' && !e.repeat) {
    game.toggleSetting('mute');
    syncToggles();
  }
});

// Audio needs a user gesture.
const unlock = () => game.audio.init();
window.addEventListener('pointerdown', unlock);
window.addEventListener('keydown', unlock);

// ---------------------------------------------------------------- Debug hooks (?debug)

const params = new URLSearchParams(location.search);
const bot = new Bot();
let simSpeed = 1;
if (params.has('debug')) {
  const w = window as unknown as Record<string, unknown>;
  w.__joker = {
    game,
    start: (cp: CheckpointName) => game.startMission(cp),
    god: (on = true) => (game.god = on),
    bot: (on = true) => (bot.enabled = on),
    speed: (x = 1) => (simSpeed = x),
    killTarget: () => {
      const t = game.target;
      if (t && t.alive) game.kill(t, 'missile', true);
    },
    killAll: (kind?: string) => {
      for (const a of [...game.aircraft]) if (a.team === 'red' && a.alive && !a.hidden && !a.frozen && (!kind || a.kind === kind)) game.kill(a, 'gun', true);
    },
    events: () => game.events.splice(0),
    touch: () => ({
      enabled: game.touch.enabled,
      stick: [+game.touch.x.toFixed(2), +game.touch.y.toFixed(2)],
      input: { pitch: +game.input.pitch.toFixed(2), turn: +game.input.turn.toFixed(2), assist: game.input.assist, guns: game.input.guns, boost: game.input.boost, brake: game.input.brake, look: game.input.lookTarget },
      boosting: game.pc.boosting,
      latched: game.touch.boostLatched,
      bank: +((game.pc.bankAngle(game.player) * 180) / Math.PI).toFixed(0),
      heading: +((Math.atan2(game.player.fwd.x, -game.player.fwd.z) * 180) / Math.PI).toFixed(0),
      lastRollAt: +game.pc.lastRollAt.toFixed(1),
      time: +game.time.toFixed(1),
      shots: game.score.shotsFired,
      missiles: game.score.missilesFired,
      target: game.target?.label ?? null,
      wingOrder: game.wingOrder,
      state: game.state,
      renderScale: game.renderScale,
    }),
    state: () => ({
      state: game.state,
      phase: game.mission.phase,
      checkpoint: game.mission.checkpoint,
      score: Math.round(game.score.total),
      combo: game.score.combo,
      hp: Math.round(game.player.hp),
      pos: game.player.pos.toArray().map(Math.round),
      speed: Math.round(game.player.speed),
      target: game.target?.label ?? null,
      locked: game.locked,
      aircraft: game.aircraft.filter((a) => a.alive).map((a) => `${a.kind}:${a.label}${a.frozen ? '(frozen)' : ''}${a.hidden ? '(hidden)' : ''}`),
      fps: Math.round(game.fps),
    }),
  };
  const cp = params.get('cp') as CheckpointName | null;
  if (cp) setTimeout(() => game.startMission(cp), 300);
  if (params.has('god')) game.god = true;
  if (params.has('bot')) bot.enabled = true;
}

// ---------------------------------------------------------------- Loop

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  game.input.poll();
  bot.drive(game, dt * simSpeed);
  game.tick(dt * simSpeed);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
