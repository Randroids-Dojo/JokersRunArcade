import type { Game } from './game';
import type { RemoteFlight } from './input';
import privacy from '../tv/privacy-content.html?raw';

interface SamsungApis {
  tizen?: {
    application?: { getCurrentApplication(): { exit(): void } };
    tvinputdevice?: { registerKey(name: string): void };
  };
  webapis?: { appcommon?: {
    AppCommonScreenSaverState: { SCREEN_SAVER_OFF: number; SCREEN_SAVER_ON: number };
    setScreenSaver(state: number, success?: () => void, error?: (e: unknown) => void): void;
  } };
}

const host = window as Window & SamsungApis;
const keyCodes: Record<string, number> = {
  ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
  Enter: 13, Escape: 10009, Backspace: 10009, BrowserBack: 10009,
  MediaPlayPause: 10252, MediaPause: 19, MediaPlay: 415,
  F1: 403, F2: 404, F3: 405, F4: 406,
};
const handled = new Set([13, 37, 38, 39, 40, 10009, 10252, 19, 415, 403, 404, 405, 406]);

/** TV shell: actual remote keyCodes, spatial menu focus, gamepads, and Tizen lifecycle. */
export class TvEdition {
  readonly remote: RemoteFlight = { pitch: 0, turn: 0, guns: false, boost: false, brake: false, missile: false, targetNext: false, rollTap: 0, order: 0, skip: false };
  private held = new Set<number>();
  private lastTap = { code: 0, time: -1000 };
  private boost = false;
  private brake = false;
  private order = 0;
  private lastState = '';
  private lastModal: HTMLDialogElement | null = null;
  private lastMenu: HTMLElement | null = null;
  private previousFocus: HTMLElement | null = null;
  private padPrevious: boolean[] = [];
  private padIndex: number | null = null;
  private padDirection = '';
  private nextPadMove = 0;
  private screenSaverOff = false;
  private pending: string[] = [];
  private strip = document.createElement('div');
  private exitDialog = document.createElement('dialog');

  constructor(private game: Game, private privacyDialog: HTMLDialogElement) {
    document.body.classList.add('tv');
    game.touch.setEnabled(false);
    game.input.remote = this.remote;

    const launchHint = document.querySelector('#btn-launch span');
    if (launchHint) launchHint.textContent = 'OK';
    document.querySelectorAll('.menu button span').forEach(el => el.textContent = 'OK');
    document.querySelector('.controls-card')!.innerHTML = `
      <h3>TV remote</h3>
      <dl><dt>↑ ↓ ← →</dt><dd>Fly with assisted steering</dd>
      <dt>Hold OK</dt><dd>Guns + missiles when locked</dd>
      <dt>← ← / → →</dt><dd>Barrel roll to evade missiles</dd>
      <dt>Return</dt><dd>Pause and flight commands</dd></dl>
      <p>Choose boost, brake, next target and wingman orders in the flight menu.</p>
      <h3>Gamepad</h3>
      <p>Left stick flies. X guns. A missile. B roll. Y target.<br>RT boost. LT brake. LB / RB rudder.<br>D-pad ↑ cover, ← scouts, → split. Start pauses.</p>
      <p class="tv-menu-help">Menus: arrows or left stick to move, OK / A to select, Return / B to go back.</p>`;

    const policy = document.createElement('article');
    policy.className = 'tv-privacy-copy';
    policy.innerHTML = privacy;
    privacyDialog.querySelector('iframe')!.replaceWith(policy);
    privacyDialog.setAttribute('aria-label', 'Privacy policy');
    privacyDialog.addEventListener('close', () => this.restoreFocus());

    const flight = document.createElement('div');
    flight.className = 'tv-flight-actions';
    flight.innerHTML = `<h3>Flight commands</h3><div class="tv-command-grid">
      <button data-flight="boost">Boost: off</button><button data-flight="brake">Brake: off</button>
      <button data-flight="target">Next target</button><button data-flight="missile">Fire locked missile</button>
      <button data-flight="roll">Barrel roll</button><button data-flight="order">Wingmen: cover</button>
      </div>`;
    document.querySelector('#screen-pause .panel .toggles')!.before(flight);
    flight.querySelectorAll<HTMLButtonElement>('[data-flight]').forEach(button => {
      button.addEventListener('click', () => this.command(button.dataset.flight!));
    });
    const quit = document.createElement('button');
    quit.className = 'legal-link';
    quit.textContent = 'Exit to Smart Hub';
    quit.addEventListener('click', () => this.showExit());
    document.querySelector('.title-wrap')!.append(quit);

    this.exitDialog.id = 'tv-exit-dialog';
    this.exitDialog.setAttribute('aria-labelledby', 'tv-exit-title');
    this.exitDialog.innerHTML = `<h2 id="tv-exit-title">Exit Joker's Run?</h2><p>Return to Smart Hub?</p><div class="menu"><button data-stay>Keep playing</button><button data-exit>Exit to Smart Hub</button></div>`;
    document.body.append(this.exitDialog);
    this.exitDialog.querySelector('[data-stay]')!.addEventListener('click', () => this.exitDialog.close());
    this.exitDialog.querySelector('[data-exit]')!.addEventListener('click', () => this.exit());
    this.exitDialog.addEventListener('close', () => this.restoreFocus());
    for (const modal of [this.exitDialog, privacyDialog]) {
      modal.addEventListener('cancel', e => { e.preventDefault(); modal.close(); });
    }

    this.strip.id = 'tv-controls';
    this.strip.setAttribute('aria-label', 'Flight controls');
    document.getElementById('game')!.append(this.strip);
    window.addEventListener('keydown', e => this.keyDown(e), true);
    window.addEventListener('keyup', e => this.keyUp(e), true);
    window.addEventListener('blur', () => this.suspend());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.suspend(); });
    window.addEventListener('gamepaddisconnected', () => this.suspend());
    window.addEventListener('pagehide', () => this.setScreenSaver(false));
    document.getElementById('gl')!.addEventListener('webglcontextlost', () => this.suspend());
    // These keys are optional. Five-way + Return are delivered without registration.
    for (const name of ['MediaPlayPause', 'MediaPause', 'MediaPlay', 'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue']) {
      try { host.tizen?.tvinputdevice?.registerKey(name); }
      catch (error) { console.warn(`Optional TV key unavailable: ${name}`, error); }
    }
    this.refresh();
  }

  private modal() {
    return this.exitDialog.open ? this.exitDialog : this.privacyDialog.open ? this.privacyDialog : null;
  }

  private menuRoot(): HTMLElement | null {
    return this.modal() ?? document.querySelector<HTMLElement>('.screen:not(.hidden)');
  }

  private buttons() {
    return Array.from(this.menuRoot()?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
      .filter(button => button.getBoundingClientRect().width > 0 && button.getBoundingClientRect().height > 0);
  }

  private focusFirst() {
    this.buttons()[0]?.focus({ preventScroll: true });
  }

  private restoreFocus() {
    if (this.previousFocus?.isConnected && this.previousFocus.getBoundingClientRect().width) this.previousFocus.focus();
    else this.focusFirst();
    this.previousFocus = null;
  }

  private move(direction: string) {
    if (this.privacyDialog.open) {
      this.privacyDialog.querySelector('article')!.scrollBy({ top: direction === 'up' ? -180 : direction === 'down' ? 180 : 0 });
      return;
    }
    const buttons = this.buttons();
    const current = document.activeElement as HTMLButtonElement;
    if (!buttons.includes(current)) { this.focusFirst(); return; }
    const r = current.getBoundingClientRect();
    const horizontal = direction === 'left' || direction === 'right';
    const sign = direction === 'left' || direction === 'up' ? -1 : 1;
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    let nearest: HTMLButtonElement | null = null, cost = Infinity;
    for (const button of buttons) {
      if (button === current) continue;
      const b = button.getBoundingClientRect();
      const dx = b.x + b.width / 2 - cx, dy = b.y + b.height / 2 - cy;
      const forward = (horizontal ? dx : dy) * sign;
      if (forward < 2) continue;
      const lateral = Math.abs(horizontal ? dy : dx);
      const score = forward + lateral * 3;
      if (score < cost) { nearest = button; cost = score; }
    }
    nearest?.focus({ preventScroll: true });
  }

  private select() {
    const buttons = this.buttons();
    const selected = document.activeElement as HTMLButtonElement;
    const active = buttons.includes(selected) ? selected : buttons[0];
    if (active?.hasAttribute('data-privacy')) this.previousFocus = active;
    active?.click();
    if (!this.modal() && active?.getBoundingClientRect().width) active.focus({ preventScroll: true });
  }

  private back() {
    const modal = this.modal();
    if (modal) { modal.close(); return; }
    if (this.game.state === 'play') this.game.pause();
    else if (this.game.state === 'paused') this.game.resume();
    else if (this.game.state === 'title') this.showExit();
    else { this.boost = this.brake = false; this.game.toTitle(); }
    this.held.clear();
    this.refresh();
  }

  private showExit() {
    this.previousFocus = document.activeElement as HTMLElement;
    this.exitDialog.showModal();
    this.focusFirst();
  }

  private exit() {
    this.suspend();
    try {
      if (host.tizen?.application) host.tizen.application.getCurrentApplication().exit();
      else this.exitDialog.querySelector('p')!.textContent = 'This preview is outside a Samsung TV. On the TV, this returns to Smart Hub.';
    } catch (error) {
      console.warn('TV exit failed', error);
      this.exitDialog.querySelector('p')!.textContent = 'Press Home on your TV remote to return to Smart Hub.';
    }
  }

  private keyDown(event: KeyboardEvent) {
    const code = event.keyCode || keyCodes[event.key] || keyCodes[event.code];
    // A long Return press produces Exit. It must terminate immediately, without confirmation.
    if (code === 10182) { this.exit(); return; }
    if (!handled.has(code)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.game.input.usingPad = false;
    if (code === 10009 || code === 10252 || code === 19 || code === 415) {
      if (!event.repeat) this.back();
      return;
    }
    if (this.menuRoot()) {
      if (code === 13 && !event.repeat) this.select();
      else if (code >= 37 && code <= 40) this.move(({ 37: 'left', 38: 'up', 39: 'right', 40: 'down' } as Record<number, string>)[code]);
      this.refresh();
      return;
    }
    if (this.game.state !== 'play') return;
    this.held.add(code);
    if (!event.repeat && (code === 37 || code === 39)) {
      const now = performance.now();
      if (this.lastTap.code === code && now - this.lastTap.time < 300) {
        this.remote.rollTap = code === 37 ? -1 : 1;
        this.lastTap = { code: 0, time: -1000 };
      } else this.lastTap = { code, time: now };
    }
    if (code === 13 && !event.repeat) this.remote.skip = this.game.skippable;
    if (!event.repeat && code >= 403 && code <= 406) this.command(({ 403: 'roll', 404: 'boost', 405: 'brake', 406: 'target' } as Record<number, string>)[code]);
  }

  private keyUp(event: KeyboardEvent) {
    const code = event.keyCode || keyCodes[event.key] || keyCodes[event.code];
    if (!handled.has(code)) return;
    this.held.delete(code);
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  private command(action: string) {
    if (action === 'boost') { this.boost = !this.boost; this.brake = false; }
    if (action === 'brake') { this.brake = !this.brake; this.boost = false; }
    if (action === 'order') this.order = (this.order + 1) % 3;
    if (['target', 'missile', 'roll', 'order'].includes(action)) this.pending.push(action);
    this.held.clear();
    if (this.game.state === 'paused') this.game.resume();
    this.refresh();
  }

  private suspend() {
    this.held.clear();
    this.boost = this.brake = false;
    this.pending = [];
    this.game.input.releaseAll();
    this.game.pause();
    void this.game.audio.ctx?.suspend();
    this.game.audio.stopSpeech();
    this.setScreenSaver(false);
  }

  private setScreenSaver(off: boolean) {
    if (this.screenSaverOff === off) return;
    const api = host.webapis?.appcommon;
    if (!api) return;
    try {
      const state = off ? api.AppCommonScreenSaverState.SCREEN_SAVER_OFF : api.AppCommonScreenSaverState.SCREEN_SAVER_ON;
      api.setScreenSaver(state, () => {}, error => console.warn('TV screensaver setting failed', error));
      this.screenSaverOff = off;
    } catch (error) { console.warn('TV screensaver setting unavailable', error); }
  }

  private refresh() {
    const state = this.game.state, modal = this.modal();
    const menu = this.menuRoot();
    if (state !== this.lastState || modal !== this.lastModal || menu !== this.lastMenu) {
      const stateChanged = state !== this.lastState;
      this.held.clear();
      this.game.input.releaseAll();
      if (state === 'title' || state === 'debrief' || state === 'failed') this.boost = this.brake = false;
      this.lastState = state;
      this.lastModal = modal;
      this.lastMenu = menu;
      if (stateChanged || modal || !this.buttons().includes(document.activeElement as HTMLButtonElement)) this.focusFirst();
    }
    this.setScreenSaver(state === 'play' && !document.hidden);
    this.strip.hidden = state !== 'play';
    const text = this.game.input.usingPad
      ? 'X guns   A missile   B evade   Y target   RT boost   LT brake   Start pause'
      : `Hold OK: guns + locked missiles   Double ← / →: evade   Return: commands${this.boost ? '   BOOST ON' : ''}${this.brake ? '   BRAKE ON' : ''}`;
    if (this.strip.textContent !== text) this.strip.textContent = text;
    const boostButton = document.querySelector('[data-flight="boost"]')!;
    const brakeButton = document.querySelector('[data-flight="brake"]')!;
    boostButton.textContent = `Boost: ${this.boost ? 'on' : 'off'}`;
    brakeButton.textContent = `Brake: ${this.brake ? 'on' : 'off'}`;
    document.querySelector('[data-flight="order"]')!.textContent = `Wingmen: ${['cover', 'scouts', 'split'][this.order]}`;
    (document.querySelector('[data-flight="order"]') as HTMLButtonElement).disabled = this.game.formation || !this.game.controlsEnabled;
    (document.querySelector('[data-flight="missile"]') as HTMLButtonElement).disabled = !this.game.locked;
    (document.querySelector('[data-flight="target"]') as HTMLButtonElement).disabled = this.game.aircraft.filter(a => a.team === 'red' && a.targetable).length < 2;
    document.body.classList.toggle('tv-pad', this.game.input.usingPad);
  }

  /** Called after Input.poll and before the simulation. */
  update() {
    this.refresh();
    const pad = Array.from(navigator.getGamepads?.() ?? []).find(p => p?.connected);
    if (this.padIndex !== null && !pad && this.game.input.usingPad) this.suspend();
    if (this.padIndex !== (pad?.index ?? null)) this.padPrevious = [];
    this.padIndex = pad?.index ?? null;
    if (pad) {
      const down = (i: number) => !!pad.buttons[i]?.pressed || (pad.buttons[i]?.value ?? 0) > 0.5;
      const edge = (i: number) => down(i) && !this.padPrevious[i];
      const menu = !!this.menuRoot();
      if (menu) {
        const x = pad.axes[0] ?? 0, y = pad.axes[1] ?? 0;
        const direction = down(12) || y < -0.55 ? 'up' : down(13) || y > 0.55 ? 'down' : down(14) || x < -0.55 ? 'left' : down(15) || x > 0.55 ? 'right' : '';
        const now = performance.now();
        if (direction && (direction !== this.padDirection || now >= this.nextPadMove)) {
          this.move(direction);
          this.nextPadMove = now + (direction === this.padDirection ? 150 : 400);
        }
        this.padDirection = direction;
        if (edge(1) || edge(9)) this.back();
        else if (edge(0)) this.select();
        this.game.input.pause = false;
      } else this.padDirection = '';
      this.padPrevious = pad.buttons.map((_, i) => down(i));
    } else this.padPrevious = [];
    this.game.input.confirm = false;
    const live = this.game.state === 'play' && !document.hidden;
    if (live) {
      for (const action of this.pending) {
        if (action === 'target') this.game.input.targetNext = true;
        if (action === 'missile') this.game.input.missile = true;
        if (action === 'roll') this.game.input.rollTap = 1;
        if (action === 'order') this.game.input.order = this.order + 1;
      }
      this.pending = [];
    }
    this.remote.pitch = live ? Number(this.held.has(38)) - Number(this.held.has(40)) : 0;
    this.remote.turn = live ? Number(this.held.has(39)) - Number(this.held.has(37)) : 0;
    this.remote.guns = live && this.held.has(13);
    this.remote.boost = live && this.boost;
    this.remote.brake = live && this.brake;
    // Holding OK permits steering between bursts without a second required remote button.
    if (this.remote.guns && this.game.locked && this.game.target && !this.game.target.missileJammer) this.remote.missile = true;
  }
}
