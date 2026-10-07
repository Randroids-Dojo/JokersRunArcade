// Keyboard + mouse + gamepad + touch, merged into one control state per frame.

import type { TouchControls } from './touch';

const PREVENT = new Set([
  'Space',
  'Tab',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ShiftLeft',
  'ShiftRight',
  'KeyF',
]);

/** The subset of controls the flight model reads. */
export interface ControlState {
  pitch: number;
  roll: number;
  yaw: number;
  boost: boolean;
  brake: boolean;
  rollTap: number;
  /** Assisted steering: desired turn (-1..1). The flight model banks and pulls for you. */
  turn: number;
  assist: boolean;
}

export const NEUTRAL: ControlState = { pitch: 0, roll: 0, yaw: 0, boost: false, brake: false, rollTap: 0, turn: 0, assist: false };

export class Input implements ControlState {
  private keys = new Set<string>();
  private pressedQ = new Set<string>();
  private mouse = new Set<number>();
  private mousePressed = new Set<number>();
  private lastTap: Record<string, number> = {};
  private pendingRoll = 0;
  private padPrev: boolean[] = [];
  usingPad = false;
  touch: TouchControls | null = null;
  /** Use assisted steering for the touch stick and tilt. */
  touchAssist = true;
  turn = 0;
  assist = false;
  taps: { x: number; y: number }[] = [];

  pitch = 0;
  roll = 0;
  yaw = 0;
  boost = false;
  brake = false;
  guns = false;
  missile = false;
  targetNext = false;
  rollTap = 0;
  lookTarget = false;
  order = 0;
  pause = false;
  confirm = false;
  anyKey = false;
  skip = false;

  constructor(target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (PREVENT.has(e.code)) e.preventDefault();
      this.usingPad = false;
      if (!e.repeat) {
        this.pressedQ.add(e.code);
        const now = performance.now();
        const tapKey = e.code === 'KeyA' || e.code === 'ArrowLeft' ? 'L' : e.code === 'KeyD' || e.code === 'ArrowRight' ? 'R' : '';
        if (tapKey) {
          if (now - (this.lastTap[tapKey] ?? -1e9) < 280) {
            this.pendingRoll = tapKey === 'L' ? -1 : 1;
            this.lastTap[tapKey] = -1e9;
          } else this.lastTap[tapKey] = now;
        }
      }
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });
    target.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.mouse.add(e.button);
      this.mousePressed.add(e.button);
    });
    window.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'mouse') this.mouse.delete(e.button);
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  releaseAll() {
    this.keys.clear();
    this.mouse.clear();
    this.pressedQ.clear();
    this.mousePressed.clear();
    this.pendingRoll = 0;
    this.lastTap = {};
    this.touch?.releaseAll();
  }

  get usingTouch() {
    return !!this.touch?.enabled;
  }

  private k(...codes: string[]) {
    for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }
  private p(...codes: string[]) {
    for (const c of codes) if (this.pressedQ.has(c)) return true;
    return false;
  }

  /** Sample once per rendered frame before simulation steps. */
  poll() {
    let pitch = (this.k('KeyW', 'ArrowUp') ? 1 : 0) - (this.k('KeyS', 'ArrowDown') ? 1 : 0);
    let roll = (this.k('KeyD', 'ArrowRight') ? 1 : 0) - (this.k('KeyA', 'ArrowLeft') ? 1 : 0);
    let yaw = (this.k('KeyE') ? 1 : 0) - (this.k('KeyQ') ? 1 : 0);
    let boost = this.k('ShiftLeft', 'ShiftRight');
    let brake = this.k('KeyX', 'KeyC');
    let guns = this.k('Space', 'KeyJ') || this.mouse.has(0);
    let missile = this.p('KeyF', 'KeyK') || this.mousePressed.has(2);
    let targetNext = this.p('Tab', 'KeyT', 'KeyL') || this.mousePressed.has(1);
    let rollTap = this.pendingRoll || (this.p('KeyR') ? (roll < 0 ? -1 : 1) : 0);
    let lookTarget = this.k('KeyV');
    let order = this.p('Digit1') ? 1 : this.p('Digit2') ? 2 : this.p('Digit3') ? 3 : 0;
    let pause = this.p('Escape', 'KeyP');
    let confirm = this.p('Enter', 'NumpadEnter', 'Space');
    const anyKey = this.pressedQ.size > 0 || this.mousePressed.has(0);
    let skip = this.p('Enter', 'Space');

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      const dz = (v: number) => (Math.abs(v) < 0.14 ? 0 : (v - Math.sign(v) * 0.14) / 0.86);
      const ax = dz(pad.axes[0] ?? 0);
      const ay = dz(pad.axes[1] ?? 0);
      const btn = (i: number) => !!pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.5);
      const pressed = (i: number) => btn(i) && !this.padPrev[i];
      if (Math.abs(ax) > 0 || Math.abs(ay) > 0 || pad.buttons.some((b) => b.pressed)) this.usingPad = true;
      roll = Math.abs(ax) > Math.abs(roll) ? ax : roll;
      pitch = Math.abs(ay) > Math.abs(pitch) ? -ay : pitch;
      if (btn(4)) yaw = -1;
      if (btn(5)) yaw = 1;
      boost ||= btn(7);
      brake ||= btn(6);
      guns ||= btn(2);
      missile ||= pressed(0);
      targetNext ||= pressed(3);
      if (pressed(1)) rollTap = roll < 0 ? -1 : 1;
      lookTarget ||= btn(10) || btn(11);
      if (pressed(12)) order = 1;
      if (pressed(14)) order = 2;
      if (pressed(15)) order = 3;
      pause ||= pressed(9);
      confirm ||= pressed(0) || pressed(9);
      skip ||= pressed(0) || pressed(9);
      for (let i = 0; i < pad.buttons.length; i++) this.padPrev[i] = btn(i);
    }

    let turn = 0;
    let assist = false;
    let taps: { x: number; y: number }[] = [];
    if (this.touch?.enabled) {
      const t = this.touch.sample();
      if (t.steering) {
        if (this.touchAssist) {
          assist = true;
          turn = t.x;
        } else if (Math.abs(t.x) > Math.abs(roll)) roll = t.x;
        if (Math.abs(t.y) > Math.abs(pitch)) pitch = t.y;
      } else if (this.touchAssist && roll === 0 && pitch === 0 && yaw === 0) {
        // Thumb off the stick in assisted mode: hold wings level and the nose on the horizon.
        assist = true;
      }
      boost ||= t.boost;
      brake ||= t.brake;
      guns ||= t.gun;
      missile ||= t.msl;
      targetNext ||= t.tgt;
      if (t.roll) rollTap = t.roll;
      lookTarget ||= t.look;
      if (t.order) order = t.order;
      pause ||= t.pause;
      skip ||= t.taps.length > 0;
      taps = t.taps;
    }
    this.turn = turn;
    this.assist = assist;
    this.taps = taps;
    this.pitch = pitch;
    this.roll = roll;
    this.yaw = yaw;
    this.boost = boost;
    this.brake = brake;
    this.guns = guns;
    this.missile = missile;
    this.targetNext = targetNext;
    this.rollTap = rollTap;
    this.lookTarget = lookTarget;
    this.order = order;
    this.pause = pause;
    this.confirm = confirm;
    this.anyKey = anyKey;
    this.skip = skip;
    this.pressedQ.clear();
    this.mousePressed.clear();
    this.pendingRoll = 0;
  }

  /** Clear one-shot inputs after the first sim step consumed them. */
  consumeEdges() {
    this.missile = false;
    this.targetNext = false;
    this.rollTap = 0;
    this.order = 0;
    this.taps = [];
  }

  pressedKey(code: string) {
    return this.keys.has(code);
  }
}
