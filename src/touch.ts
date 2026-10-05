// Touch controls: a floating flight stick for the left thumb, a weapon/throttle cluster for
// the right thumb, tap-to-target anywhere, optional tilt steering and haptics. The output is
// sampled into Input once per frame, so the flight model and mission code are unchanged.

import { clamp } from './math';

type Btn = 'gun' | 'msl' | 'boost' | 'brake' | 'roll' | 'tgt' | 'pause' | 'order1' | 'order2' | 'order3';

export interface TouchSample {
  steering: boolean;
  x: number;
  y: number;
  gun: boolean;
  boost: boolean;
  brake: boolean;
  msl: boolean;
  roll: number;
  tgt: boolean;
  look: boolean;
  pause: boolean;
  order: number;
  taps: { x: number; y: number }[];
}

export interface TouchView {
  live: boolean;
  controls: boolean;
  lock: number;
  locked: boolean;
  ecm: boolean;
  rails: [number, number];
  boost: number;
  boosting: boolean;
  gunHot: boolean;
  evade: boolean;
  orders: string | null;
  teach: string | null;
  hint: string;
}

const STICK_R = 64;
const DEAD = 0.08;
const TAP_MS = 260;
const TAP_PX = 14;
const LOOK_HOLD_MS = 320;
const BOOST_LATCH_MS = 280;

export class TouchControls {
  /** Touch UI is shown and sampled. Enabled by the first touch, disabled by keyboard use. */
  enabled = false;
  readonly root = document.getElementById('touch')!;
  private stickEl = document.getElementById('t-stick')!;
  private knobEl = document.getElementById('t-knob')!;
  private stickId: number | null = null;
  private origin = { x: 0, y: 0 };
  /** Processed stick output, screen-up positive. */
  x = 0;
  y = 0;
  private held = new Map<number, Btn>();
  private edges = new Set<Btn>();
  private tgtDown = new Map<number, number>();
  /** Boost press start time; negative when the press began by cancelling a latch. */
  private boostDown = new Map<number, number>();
  boostLatched = false;
  private lookHeld = false;
  private taps: { x: number; y: number }[] = [];
  private tapCand = new Map<number, { x: number; y: number; t: number }>();
  private lastRollDir = 1;
  readonly tilt = new TiltInput();
  haptics = true;
  private buttons = new Map<Btn, HTMLElement>();
  onEnable: ((on: boolean) => void) | null = null;

  constructor() {
    this.root.querySelectorAll<HTMLElement>('[data-b]').forEach((el) => this.buttons.set(el.dataset.b as Btn, el));
    const opts = { passive: false } as AddEventListenerOptions;
    this.root.addEventListener('pointerdown', (e) => this.down(e), opts);
    this.root.addEventListener('pointermove', (e) => this.move(e), opts);
    this.root.addEventListener('pointerup', (e) => this.up(e), opts);
    this.root.addEventListener('pointercancel', (e) => this.up(e, true), opts);
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    // Stop iOS from scrolling, zooming or rubber-banding the page under the thumbs.
    for (const t of ['touchstart', 'touchmove', 'touchend'] as const) {
      this.root.addEventListener(t, (e) => e.preventDefault(), { passive: false });
    }
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') this.setEnabled(true);
    });
    window.addEventListener('keydown', () => this.setEnabled(false));
    if (window.matchMedia?.('(pointer: coarse)').matches && !window.matchMedia('(pointer: fine)').matches) this.setEnabled(true);
    this.restStick();
  }

  setEnabled(on: boolean) {
    if (this.enabled === on) return;
    this.enabled = on;
    document.body.classList.toggle('touch', on);
    if (!on) this.releaseAll();
    this.onEnable?.(on);
  }

  releaseAll() {
    this.held.clear();
    this.tgtDown.clear();
    this.boostDown.clear();
    this.boostLatched = false;
    this.lookHeld = false;
    this.stickId = null;
    this.x = this.y = 0;
    this.restStick();
    for (const el of this.buttons.values()) el.classList.remove('down');
  }

  private down(e: PointerEvent) {
    if (e.pointerType === 'mouse') return;
    e.preventDefault();
    this.setEnabled(true);
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-b]');
    try {
      this.root.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (el) {
      const b = el.dataset.b as Btn;
      this.held.set(e.pointerId, b);
      el.classList.add('down');
      if (b === 'tgt') this.tgtDown.set(e.pointerId, performance.now());
      else if (b === 'boost') {
        // Tap toggles the afterburner; a press that starts while latched only cancels.
        this.boostDown.set(e.pointerId, this.boostLatched ? -1 : performance.now());
        this.boostLatched = false;
      } else if (b !== 'gun' && b !== 'brake') this.edges.add(b);
      if (b === 'roll') this.vibrate(10);
      return;
    }
    this.tapCand.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
    if (e.clientX < window.innerWidth * 0.5 && this.stickId === null) {
      this.stickId = e.pointerId;
      // Keep the whole base on screen.
      const m = STICK_R + 10;
      this.origin.x = clamp(e.clientX, m, window.innerWidth - m);
      this.origin.y = clamp(e.clientY, m, window.innerHeight - m);
      this.stickEl.classList.add('active');
      this.updateStick(e.clientX, e.clientY);
    }
  }

  private move(e: PointerEvent) {
    if (e.pointerId !== this.stickId) return;
    e.preventDefault();
    this.updateStick(e.clientX, e.clientY);
  }

  private up(e: PointerEvent, cancelled = false) {
    if (e.pointerType === 'mouse') return;
    const b = this.held.get(e.pointerId);
    if (b) {
      this.held.delete(e.pointerId);
      if (![...this.held.values()].includes(b)) this.buttons.get(b)?.classList.remove('down');
      if (b === 'tgt') {
        const t0 = this.tgtDown.get(e.pointerId) ?? 0;
        this.tgtDown.delete(e.pointerId);
        if (!cancelled && performance.now() - t0 < LOOK_HOLD_MS) this.edges.add('tgt');
      }
      if (b === 'boost') {
        const t0 = this.boostDown.get(e.pointerId) ?? 0;
        this.boostDown.delete(e.pointerId);
        // A quick tap latches boost on; a long press was momentary.
        if (!cancelled && t0 >= 0 && performance.now() - t0 < BOOST_LATCH_MS) this.boostLatched = true;
      }
    }
    const cand = this.tapCand.get(e.pointerId);
    if (cand) {
      this.tapCand.delete(e.pointerId);
      if (!cancelled && performance.now() - cand.t < TAP_MS && Math.hypot(e.clientX - cand.x, e.clientY - cand.y) < TAP_PX) {
        this.taps.push({ x: e.clientX, y: e.clientY });
      }
    }
    if (e.pointerId === this.stickId) {
      this.stickId = null;
      this.x = this.y = 0;
      this.restStick();
    }
  }

  private updateStick(px: number, py: number) {
    let dx = px - this.origin.x;
    let dy = py - this.origin.y;
    let d = Math.hypot(dx, dy);
    // Drag-follow: if the thumb wanders far past the rim, the base slides after it.
    if (d > STICK_R * 1.35) {
      const k = (d - STICK_R * 1.35) / d;
      this.origin.x += dx * k;
      this.origin.y += dy * k;
      dx = px - this.origin.x;
      dy = py - this.origin.y;
      d = Math.hypot(dx, dy);
    }
    const n = Math.min(1, d / STICK_R);
    const m = n < DEAD ? 0 : Math.pow((n - DEAD) / (1 - DEAD), 1.35);
    const ux = d > 0 ? dx / d : 0;
    const uy = d > 0 ? dy / d : 0;
    this.x = ux * m;
    this.y = -uy * m;
    const kx = ux * n * STICK_R;
    const ky = uy * n * STICK_R;
    this.stickEl.style.transform = `translate(${this.origin.x}px, ${this.origin.y}px)`;
    this.knobEl.style.transform = `translate(${kx}px, ${ky}px)`;
  }

  private restStick() {
    const x = Math.max(96, window.innerWidth * 0.13);
    const y = window.innerHeight - Math.max(110, window.innerHeight * 0.3);
    this.origin.x = x;
    this.origin.y = y;
    this.stickEl.classList.remove('active');
    this.stickEl.style.transform = `translate(${x}px, ${y}px)`;
    this.knobEl.style.transform = 'translate(0px, 0px)';
  }

  private isHeld(b: Btn) {
    for (const v of this.held.values()) if (v === b) return true;
    return false;
  }

  /** Read once per frame. Edge-triggered actions are consumed. */
  sample(): TouchSample {
    let x = this.x;
    let y = this.y;
    let steering = this.stickId !== null;
    if (!steering && this.tilt.active) {
      x = this.tilt.steer;
      y = this.tilt.pitch;
      steering = true;
    }
    let roll = 0;
    if (this.edges.has('roll')) {
      roll = Math.abs(x) > 0.25 ? Math.sign(x) : (this.lastRollDir = -this.lastRollDir);
    }
    for (const id of this.tgtDown.keys()) {
      if (performance.now() - (this.tgtDown.get(id) ?? 0) >= LOOK_HOLD_MS) this.lookHeld = true;
    }
    if (this.tgtDown.size === 0) this.lookHeld = false;
    const order = this.edges.has('order1') ? 1 : this.edges.has('order2') ? 2 : this.edges.has('order3') ? 3 : 0;
    const s: TouchSample = {
      steering,
      x,
      y,
      gun: this.isHeld('gun'),
      boost: this.boostLatched || [...this.boostDown.values()].some((t) => t >= 0),
      brake: this.isHeld('brake'),
      msl: this.edges.has('msl'),
      roll,
      tgt: this.edges.has('tgt'),
      look: this.lookHeld,
      pause: this.edges.has('pause'),
      order,
      taps: this.taps,
    };
    this.edges.clear();
    this.taps = [];
    return s;
  }

  /** Brake or an empty tank cancels a latched boost. */
  unlatchBoost() {
    this.boostLatched = false;
  }

  button(b: Btn): HTMLElement | undefined {
    return this.buttons.get(b);
  }

  private cache = new Map<string, string | boolean>();
  private set(key: string, v: string | boolean, apply: () => void) {
    if (this.cache.get(key) === v) return;
    this.cache.set(key, v);
    apply();
  }

  /** Per-frame visual state from the game. */
  render(v: TouchView) {
    const r = this.root;
    this.set('live', v.live, () => r.classList.toggle('live', v.live));
    this.set('cine', !v.controls, () => r.classList.toggle('cine', !v.controls));
    if (!v.live) return;
    const msl = this.buttons.get('msl')!;
    const lock = (Math.round(v.lock * 20) / 20).toFixed(2);
    this.set('lock', lock, () => msl.style.setProperty('--lock', lock));
    this.set('locked', v.locked, () => msl.classList.toggle('locked', v.locked));
    this.set('ecm', v.ecm, () => msl.classList.toggle('ecm', v.ecm));
    const pips = msl.querySelectorAll<HTMLElement>('.pips i');
    v.rails.forEach((f, i) => {
      const val = `${Math.round(f * 100)}%`;
      this.set(`rail${i}`, val, () => pips[i].style.setProperty('--f', val));
    });
    const boost = this.buttons.get('boost')!;
    const e = (Math.round(v.boost * 50) / 50).toFixed(2);
    this.set('energy', e, () => boost.style.setProperty('--energy', e));
    const on = v.boosting || this.boostLatched;
    this.set('boostOn', on, () => boost.classList.toggle('on', on));
    this.set('gunHot', v.gunHot, () => this.buttons.get('gun')!.classList.toggle('hot', v.gunHot));
    const roll = this.buttons.get('roll')!;
    this.set('evade', v.evade, () => {
      roll.classList.toggle('alert', v.evade);
      roll.querySelector('span')!.textContent = v.evade ? 'EVADE' : 'ROLL';
    });
    const orders = document.getElementById('t-orders')!;
    this.set('orders', v.orders ?? '', () => {
      orders.classList.toggle('show', !!v.orders);
      document.body.classList.toggle('orders', !!v.orders);
      (['order1', 'order2', 'order3'] as Btn[]).forEach((b, i) =>
        this.buttons.get(b)!.classList.toggle('on', v.orders === ['cover', 'scouts', 'split'][i]),
      );
    });
    this.set('teach', v.teach ?? '', () => {
      for (const [name, el] of this.buttons) el.classList.toggle('teach', name === v.teach || (v.teach === 'orders' && name.startsWith('order')));
      this.stickEl.classList.toggle('teach', v.teach === 'stick');
    });
    if (this.stickId !== null) this.set('used', true, () => this.stickEl.classList.add('used'));
    const hint = document.getElementById('t-hint')!;
    this.set('hint', v.hint, () => {
      hint.textContent = v.hint;
      hint.style.display = v.hint ? '' : 'none';
    });
  }

  vibrate(pattern: number | number[]) {
    if (!this.enabled || !this.haptics || !('vibrate' in navigator)) return;
    try {
      navigator.vibrate(pattern);
    } catch {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------- Tilt

/**
 * Steering-wheel style tilt from deviceorientation. Converts the Euler angles to the gravity
 * direction in screen space (so it works in either landscape orientation), then measures
 * wheel rotation and fore/aft tilt relative to a calibrated neutral pose.
 */
export class TiltInput {
  active = false;
  steer = 0;
  pitch = 0;
  private neutralPitch: number | null = null;
  private handler = (e: DeviceOrientationEvent) => this.onOrientation(e);

  async enable(): Promise<boolean> {
    const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined;
    if (!DOE) return false;
    if (typeof DOE.requestPermission === 'function') {
      try {
        if ((await DOE.requestPermission()) !== 'granted') return false;
      } catch {
        return false;
      }
    }
    window.addEventListener('deviceorientation', this.handler);
    this.neutralPitch = null;
    this.active = true;
    return true;
  }

  disable() {
    window.removeEventListener('deviceorientation', this.handler);
    this.active = false;
    this.steer = this.pitch = 0;
  }

  recalibrate() {
    this.neutralPitch = null;
  }

  private onOrientation(e: DeviceOrientationEvent) {
    if (e.beta === null || e.gamma === null) return;
    const b = (e.beta * Math.PI) / 180;
    const g = (e.gamma * Math.PI) / 180;
    // World "up" expressed in device coordinates (W3C DeviceOrientation Z-X'-Y'' convention).
    const dx = -Math.sin(g) * Math.cos(b);
    const dy = Math.sin(b);
    const dz = Math.cos(g) * Math.cos(b);
    const angle = (((screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0) as number) * Math.PI) / 180;
    // Rotate into screen coordinates (x right, y up on screen, z out of the glass).
    const sx = dx * Math.cos(angle) - dy * Math.sin(angle);
    const sy = dx * Math.sin(angle) + dy * Math.cos(angle);
    const sz = dz;
    // Wheel turned clockwise tips "up" toward screen-left: steer right.
    const wheel = -Math.atan2(sx, sy);
    const fore = Math.atan2(sz, sy);
    if (this.neutralPitch === null) this.neutralPitch = fore;
    const dz2 = (v: number, dead: number, full: number) => {
      const a = Math.abs(v);
      return a < dead ? 0 : Math.sign(v) * clamp((a - dead) / (full - dead), 0, 1);
    };
    const deg = Math.PI / 180;
    this.steer = dz2(wheel, 3 * deg, 30 * deg);
    // Pulling the top edge toward you (screen tilts up toward vertical) climbs.
    this.pitch = dz2(this.neutralPitch - fore, 3 * deg, 22 * deg);
  }
}
