import { Game, Settings } from './game';
import type { CheckpointName } from './mission';
import { Bot } from './debugbot';

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const game = new Game(canvas);

// ---------------------------------------------------------------- Menus

function syncToggles() {
  const labels: Record<string, [keyof Settings, boolean]> = {
    invertPitch: ['invertPitch', false],
    voice: ['voice', false],
    music: ['music', false],
    reducedMotion: ['reducedMotion', false],
    mute: ['mute', true],
  };
  document.querySelectorAll<HTMLButtonElement>('[data-toggle]').forEach((b) => {
    const [key, inverted] = labels[b.dataset.toggle!];
    const on = inverted ? !game.settings[key] : game.settings[key];
    const bold = b.querySelector('b');
    if (bold) bold.textContent = on ? 'ON' : 'OFF';
  });
}

document.querySelectorAll<HTMLButtonElement>('[data-toggle]').forEach((b) => {
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    game.toggleSetting(b.dataset.toggle as keyof Settings);
    syncToggles();
    b.blur();
  });
});
syncToggles();

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
