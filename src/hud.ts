import * as THREE from 'three';
import type { Game } from './game';
import type { PopLine } from './score';
import { Aircraft } from './aircraft';
import { GUN, MISSILE, WORLD } from './config';
import { clamp, DEG, formatClock, formatScore, headingDeg } from './math';
import { coastE, coastW } from './terrain';

type BannerStyle = 'info' | 'gold' | 'warning' | 'red' | 'combo';
interface BannerItem {
  main: string;
  sub: string;
  style: BannerStyle;
  dur: number;
}
interface RadioItem {
  who: string;
  text: string;
}

const C = {
  hud: '#a6ffd0',
  hudDim: 'rgba(166,255,208,0.55)',
  hudFaint: 'rgba(166,255,208,0.25)',
  hostile: '#ff4d3d',
  target: '#ff9f1c',
  ace: '#ff4f7d',
  drone: '#ffc23d',
  friend: '#63c9ff',
  gold: '#ffd25a',
  white: '#ffffff',
};

const $ = (id: string) => document.getElementById(id)!;

export class Hud {
  private root = $('hud');
  private overlay = $('overlay') as HTMLCanvasElement;
  private ctx = this.overlay.getContext('2d')!;
  private radarCanvas = $('radar') as HTMLCanvasElement;
  private rctx = this.radarCanvas.getContext('2d')!;
  private w = 1;
  private h = 1;
  private dpr = 1;
  private visible = false;
  private bannerQ: BannerItem[] = [];
  private bannerEl: HTMLElement | null = null;
  private bannerUp = false;
  /** Marker label boxes drawn this frame (x0, y0, x1, y1). */
  private labels: [number, number, number, number][] = [];
  private bannerT = 0;
  private radioQ: RadioItem[] = [];
  private radioCur: RadioItem | null = null;
  private radioT = 0;
  private radioDur = 0;
  private lastScore = -1;
  private lastCombo = -1;
  private pingT = 99;
  private coast: THREE.Vector2[][];
  private proj = new THREE.Vector3();
  private cache: Record<string, string> = {};
  /** Plays a radio line as it is shown; returns its spoken length in seconds (0 if silent). */
  onRadio: ((who: string, text: string) => number) | null = null;
  radarRange = 4500;
  private radarRangeTarget = 4500;
  objectiveText = '';

  constructor() {
    const west: THREE.Vector2[] = [];
    const east: THREE.Vector2[] = [];
    for (let z = -8300; z <= 6400; z += 150) {
      west.push(new THREE.Vector2(coastW(z), z));
      east.push(new THREE.Vector2(coastE(z), z));
    }
    this.coast = [west, east];
  }

  resize(w: number, h: number, dpr: number) {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.overlay.width = Math.round(w * dpr);
    this.overlay.height = Math.round(h * dpr);
    const rs = this.radarCanvas.getBoundingClientRect().width || 230;
    this.radarCanvas.width = Math.round(rs * dpr);
    this.radarCanvas.height = Math.round(rs * dpr);
  }

  setVisible(on: boolean) {
    this.visible = on;
    this.root.classList.toggle('off', !on);
  }

  setCinematic(on: boolean) {
    this.root.classList.toggle('cine', on);
    $('letterbox').classList.toggle('on', on);
  }

  private set(id: string, prop: 'text' | 'html' | 'class', value: string) {
    const key = id + prop;
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    const el = $(id);
    if (prop === 'text') el.textContent = value;
    else if (prop === 'html') el.innerHTML = value;
    else el.className = value;
  }

  show(id: string, on: boolean) {
    $(id).classList.toggle('hidden', !on);
  }

  objective(text: string, flash = true) {
    this.objectiveText = text;
    const el = $('objective');
    el.textContent = text;
    if (flash) {
      el.classList.remove('flash');
      void el.offsetWidth;
      el.classList.add('flash');
    }
  }

  timer(label: string | null, seconds = 0, tenths = false, countUp = false) {
    if (label === null) {
      this.show('timer', false);
      return;
    }
    this.show('timer', true);
    this.set('timer-label', 'text', label);
    this.set('timer-value', 'text', formatClock(seconds, tenths));
    this.set('timer', 'class', countUp ? '' : seconds <= 10 ? 'critical' : seconds <= 30 ? 'warn' : '');
  }

  subtimer(text: string) {
    this.set('subtimer', 'text', text);
  }

  phase(text: string) {
    this.set('phase-tag', 'text', text);
  }

  banner(main: string, sub = '', style: BannerStyle = 'info', dur = 2.4) {
    this.bannerQ.push({ main, sub, style, dur });
  }

  /** Show immediately, replacing whatever is up. */
  bannerNow(main: string, sub = '', style: BannerStyle = 'info', dur = 2.4) {
    this.bannerQ.length = 0;
    this.bannerT = 0;
    this.bannerQ.push({ main, sub, style, dur });
  }

  /** On phones, keep the banner between the score column (with its combo bar) and the radar,
   *  shrinking the text if a long one or a camera cutout would make them meet. */
  private fitBanner(el: HTMLElement) {
    const w = window.innerWidth;
    const scoreRight = $('tl').getBoundingClientRect().left + 140 + 8;
    const radarLeft = $('bl').getBoundingClientRect().left - 8;
    const half = Math.min(w / 2 - scoreRight, radarLeft - w / 2);
    const main = el.querySelector<HTMLElement>('.main');
    if (main) {
      main.style.display = 'inline-block'; // layout width of the text itself, not the band
      const tw = main.scrollWidth;
      main.style.display = '';
      const size = parseFloat(getComputedStyle(main).fontSize);
      if (tw > half * 2) main.style.fontSize = `${Math.max(18, Math.floor((size * half * 2) / tw))}px`;
    }
    if (el.classList.contains('warning')) el.style.width = `${Math.min(w * 0.48, half * 2)}px`;
  }

  clearBanners() {
    this.bannerQ.length = 0;
    this.bannerT = 0;
    $('banner').innerHTML = '';
    this.bannerEl = null;
  }

  popup(lines: PopLine[]) {
    const box = $('popups');
    lines.forEach((l, i) => {
      const d = document.createElement('div');
      d.className = `pop ${l.kind ?? 'bonus'}`;
      d.style.animationDelay = `${i * 0.07}s, ${2 + i * 0.07}s`;
      d.innerHTML = l.points !== undefined ? `${l.text}<span class="pts">+${formatScore(l.points)}</span>` : l.text;
      box.appendChild(d);
      setTimeout(() => d.remove(), 2700 + i * 70);
    });
    const max = document.body.classList.contains('touch') ? 4 : 9;
    while (box.children.length > max) box.firstChild?.remove();
  }

  radio(who: string, text: string, priority = false) {
    if (priority) {
      this.radioQ.length = 0;
      this.radioT = this.radioDur;
    }
    this.radioQ.push({ who, text });
  }

  clearRadio() {
    this.radioQ.length = 0;
    this.radioCur = null;
    this.show('radio', false);
  }

  get radioBusy() {
    return this.radioCur !== null || this.radioQ.length > 0;
  }

  prompt(html: string | null) {
    if (html === null) {
      this.show('prompt', false);
      return;
    }
    this.show('prompt', true);
    this.set('prompt', 'html', html);
  }

  countdown(n: number | null) {
    const el = $('countdown');
    if (n === null) {
      el.textContent = '';
      return;
    }
    const s = String(n);
    if (el.textContent !== s) {
      el.textContent = s;
      el.classList.remove('tick');
      void el.offsetWidth;
      el.classList.add('tick');
    }
  }

  boss(info: { hp: number; pressure: number; stage: number; status: string; low: boolean } | null) {
    if (!info) {
      this.show('boss', false);
      return;
    }
    this.show('boss', true);
    ($('boss-hp') as HTMLElement).style.transform = `scaleX(${clamp(info.hp, 0, 1)})`;
    ($('boss-pressure') as HTMLElement).style.transform = `scaleX(${clamp(info.pressure, 0, 1)})`;
    this.set('boss-stage', 'text', info.stage === 2 ? 'ENRAGED' : 'STAGE 1');
    this.set('boss-status', 'text', info.status);
    this.set('boss-status', 'class', info.low ? 'low' : '');
  }

  scouts(rows: { name: string; upload: number; state: 'up' | 'paused' | 'down' | 'dark' }[] | null) {
    const box = $('scout-list');
    if (!rows) {
      this.set('scout-list', 'html', '');
      return;
    }
    const html = rows
      .map((r) => {
        const pct = Math.round(r.upload * 100);
        const st = r.state === 'down' ? 'DOWN' : r.state === 'dark' ? 'LOST' : r.state === 'paused' ? 'JAMMED' : `${pct}%`;
        return `<div class="scout-row ${r.state}"><span>${r.name}</span><div class="bar"><i style="transform:scaleX(${r.state === 'down' ? 0 : r.upload})"></i></div><b>${st}</b></div>`;
      })
      .join('');
    if (this.cache.scouts !== html) {
      this.cache.scouts = html;
      box.innerHTML = html;
    }
  }

  wingOrderShown: string | null = null;

  wingOrder(order: string | null) {
    this.wingOrderShown = order;
    if (!order) {
      this.show('wing-order', false);
      return;
    }
    this.show('wing-order', true);
    const names: Record<string, string> = { cover: 'COVER ME', scouts: 'ATTACK SCOUTS', split: 'SPLIT' };
    const k = (n: number, key: string, label: string) => `<span class="${order === key ? 'on' : ''}">[${n}] ${label}</span>`;
    this.set(
      'wing-order',
      'html',
      `WINGMEN · <b>${names[order]}</b><div class="keys">${k(1, 'cover', 'COVER')} ${k(2, 'scouts', 'SCOUTS')} ${k(3, 'split', 'SPLIT')}</div>`,
    );
  }

  ping() {
    this.pingT = 0;
  }

  setRadarRange(r: number) {
    this.radarRangeTarget = r;
  }

  update(dt: number, g: Game) {
    // Banners.
    if (this.bannerEl) {
      this.bannerT -= dt;
      if (this.bannerT <= 0.35 && !this.bannerEl.classList.contains('out')) this.bannerEl.classList.add('out');
      if (this.bannerT <= 0) {
        this.bannerEl.remove();
        this.bannerEl = null;
      }
    }
    if (!this.bannerEl && this.bannerQ.length) {
      const b = this.bannerQ.shift()!;
      const el = document.createElement('div');
      el.className = `bn ${b.style}`;
      el.innerHTML = `<div class="main">${b.main}</div>${b.sub ? `<div class="sub">${b.sub}</div>` : ''}`;
      $('banner').innerHTML = '';
      $('banner').appendChild(el);
      this.bannerEl = el;
      this.bannerT = b.dur;
      if (document.body.classList.contains('touch')) this.fitBanner(el);
    }
    // On phones the banner sits over the timer and ace panel, which step aside meanwhile.
    if (!!this.bannerEl !== this.bannerUp) {
      this.bannerUp = !!this.bannerEl;
      $('hud').classList.toggle('banner-up', this.bannerUp);
    }
    // Radio.
    if (this.radioCur) {
      this.radioT += dt;
      const shown = Math.min(this.radioCur.text.length, Math.floor(this.radioT * 55));
      this.set('radio-text', 'text', this.radioCur.text.slice(0, shown));
      if (this.radioT >= this.radioDur) {
        this.radioCur = null;
        this.show('radio', false);
      }
    }
    if (!this.radioCur && this.radioQ.length) {
      const r = this.radioQ.shift()!;
      this.radioCur = r;
      this.radioT = 0;
      this.show('radio', true);
      this.set('radio-who', 'text', r.who);
      this.set('radio', 'class', r.who.startsWith('JOKER') ? 'blue' : '');
      this.set('radio-text', 'text', '');
      const spoken = this.onRadio?.(r.who, r.text) ?? 0;
      this.radioDur = Math.max(1.8 + r.text.length * 0.055, spoken + 0.6);
    }
    // Numbers.
    const s = g.score;
    if (s.total !== this.lastScore) {
      this.lastScore = s.total;
      this.set('score', 'text', formatScore(s.total));
    }
    this.show('hotstart', s.hotStart > 1.001 && g.showHotStart);
    this.set('hotstart', 'html', `HOT START <b>x${s.hotStart.toFixed(1)}</b>`);
    this.show('combo', s.combo > 0);
    if (s.combo !== this.lastCombo) {
      if (s.combo > this.lastCombo && s.combo > 0) {
        const c = $('combo');
        c.classList.remove('pulse');
        void c.offsetWidth;
        c.classList.add('pulse');
      }
      this.lastCombo = s.combo;
      this.set('combo-text', 'html', `COMBO <b>x${s.combo}</b>`);
    }
    ($('combo-bar') as HTMLElement).style.transform = `scaleX(${s.comboFrozen ? 1 : clamp(s.comboTimer / 10, 0, 1)})`;
    const p = g.player;
    this.set('spd', 'text', String(Math.round(p.speed * 3.6)));
    this.set('alt', 'text', formatScore(Math.max(0, p.pos.y)));
    ($('boost-bar') as HTMLElement).style.transform = `scaleY(${g.pc.boostEnergy})`;
    const hpPct = Math.max(0, p.hp / p.maxHp);
    ($('hull-bar') as HTMLElement).style.transform = `scaleX(${hpPct})`;
    this.set('hull-num', 'text', String(Math.ceil(hpPct * 100)));
    $('hull-num').parentElement!.classList.toggle('low', hpPct < 0.35);
    const rails = $('rails').children;
    for (let i = 0; i < 2; i++) {
      const fill = g.missileRails[i] <= 0 ? 100 : Math.round((1 - g.missileRails[i] / MISSILE.reload) * 100);
      (rails[i] as HTMLElement).style.setProperty('--fill', `${fill}%`);
    }
    const t = g.target;
    let lock = '—';
    let lockCls = '';
    if (t && t.targetable) {
      if (t.ecm) {
        lock = 'NO LOCK · ECM';
        lockCls = 'ecm';
      } else if (g.locked) {
        lock = 'LOCKED';
        lockCls = 'locked';
      } else if (g.lockProgress > 0) lock = 'LOCKING';
      else lock = t.label;
    }
    this.set('lock-state', 'text', lock);
    this.set('lock-state', 'class', lockCls);
    const gh = g.pc.lastGround;
    const sink = -p.vel.y;
    this.show('pullup', g.controlsEnabled && p.pos.y - gh < 260 && sink > 0 && (p.pos.y - gh) / sink < 3.2);
    this.show('area-warn', g.outOfArea && g.controlsEnabled);
    this.root.classList.toggle('uploads', g.uploadsActive);
    // Fades for overlays.
    this.radarRange += (this.radarRangeTarget - this.radarRange) * Math.min(1, dt * 3);
    this.pingT += dt;
  }

  // ---------------------------------------------------------------- Overlay

  private project(v: THREE.Vector3, cam: THREE.Camera): { x: number; y: number; behind: boolean } {
    const p = this.proj.copy(v).applyMatrix4(cam.matrixWorldInverse);
    const behind = p.z > 0;
    p.applyMatrix4((cam as THREE.PerspectiveCamera).projectionMatrix);
    return { x: (p.x * 0.5 + 0.5) * this.w, y: (-p.y * 0.5 + 0.5) * this.h, behind };
  }

  draw(g: Game) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    this.labels.length = 0;
    if (!this.visible || g.cinematic || !g.player.alive) {
      this.drawRadar(g);
      return;
    }
    const cam = g.rig.camera;
    const p = g.player;
    const W = this.w;
    const H = this.h;
    const focal = H / 2 / Math.tan((cam.fov * DEG) / 2);
    ctx.lineWidth = 1.5;
    ctx.font = '600 12px "Chakra Petch", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.75)';
    ctx.shadowBlur = 3;

    this.drawLadder(g, cam);
    this.drawHeadingTape(g);

    // Boresight and seeker circle.
    const t = g.target && g.target.targetable ? g.target : null;
    const tDist = t ? t.pos.distanceTo(p.pos) : 900;
    const boreDist = clamp(tDist, 300, 1500);
    const bore = this.project(_v.copy(p.pos).addScaledVector(p.fwd, boreDist), cam);
    const seek = this.project(_v.copy(p.pos).addScaledVector(p.fwd, 1500), cam);
    if (!seek.behind) {
      const r = Math.tan(MISSILE.lockCone) * focal;
      ctx.strokeStyle = C.hudFaint;
      ctx.setLineDash([3, 9]);
      ctx.beginPath();
      ctx.arc(seek.x, seek.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (!bore.behind) this.drawBoresight(bore.x, bore.y);

    // Gun lead pipper.
    let fire: { x: number; y: number } | null = null;
    if (t && tDist < 1600) {
      const tf = tDist / (GUN.speed + p.speed);
      const lead = this.project(_v.copy(t.pos).addScaledVector(t.vel, tf), cam);
      if (!lead.behind) {
        const onTarget = Math.hypot(lead.x - bore.x, lead.y - bore.y) < 14;
        ctx.strokeStyle = onTarget ? C.white : C.hud;
        ctx.lineWidth = onTarget ? 2.5 : 1.5;
        ctx.beginPath();
        ctx.arc(lead.x, lead.y, 9, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fillRect(lead.x - 1.5, lead.y - 1.5, 3, 3);
        if (onTarget) fire = { x: lead.x, y: lead.y };
        ctx.lineWidth = 1.5;
      }
    }

    // Aircraft markers.
    for (const a of g.aircraft) {
      if (a === p || !a.targetable) continue;
      this.drawMarker(g, a, cam, focal, a === t);
    }
    if (fire) this.drawFire(fire.x, fire.y);
    // Checkpoint.
    const cp = g.mission.activeCheckpoint();
    if (cp) {
      const s = this.project(cp.pos, cam);
      const d = cp.pos.distanceTo(p.pos);
      if (!s.behind && s.x > 0 && s.x < W && s.y > 0 && s.y < H) {
        ctx.strokeStyle = C.gold;
        ctx.fillStyle = C.gold;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y - 12);
        ctx.lineTo(s.x + 12, s.y);
        ctx.lineTo(s.x, s.y + 12);
        ctx.lineTo(s.x - 12, s.y);
        ctx.closePath();
        ctx.stroke();
        ctx.textAlign = 'center';
        ctx.fillText(`${cp.label} ${fmtDist(d)}`, s.x, s.y + 24);
        ctx.textAlign = 'left';
      } else this.edgeArrow(s, C.gold, `${cp.label} ${fmtDist(d)}`);
    }
    // Off-screen arrows for important contacts.
    for (const a of g.aircraft) {
      if (a === p || !a.targetable || a.team !== 'red') continue;
      if (a !== t && !a.missionTarget) continue;
      const s = this.project(a.pos, cam);
      if (!s.behind && s.x > 20 && s.x < W - 20 && s.y > 20 && s.y < H - 20) continue;
      const col = a.kind === 'ace' ? C.ace : a.missionTarget ? C.target : C.hostile;
      this.edgeArrow(s, col, `${a.label} ${fmtDist(a.pos.distanceTo(p.pos))}`);
    }
    // Incoming missiles.
    const incoming = g.weapons.incomingMissiles(p);
    if (incoming.length) {
      const blink = Math.floor(g.realTime * 6) % 2 === 0;
      for (const m of incoming) {
        const s = this.project(m.pos, cam);
        let dx = s.x - W / 2;
        let dy = s.y - H / 2;
        if (s.behind) {
          dx = -dx;
          dy = -dy;
        }
        const ang = Math.atan2(dy, dx);
        const r = 120;
        const cx = W / 2 + Math.cos(ang) * r;
        const cy = H / 2 + Math.sin(ang) * r;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(ang);
        ctx.fillStyle = C.hostile;
        ctx.beginPath();
        ctx.moveTo(16, 0);
        ctx.lineTo(-6, -10);
        ctx.lineTo(-6, 10);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      if (blink) {
        ctx.font = '700 22px "Chakra Petch", sans-serif';
        ctx.fillStyle = C.hostile;
        ctx.textAlign = 'center';
        const close = incoming.some((m) => m.pos.distanceTo(p.pos) < 700);
        const short = H < 520;
        ctx.fillText(close ? 'MISSILE — BREAK!' : 'MISSILE', W / 2, short ? H * 0.42 : H / 2 - 160);
        ctx.font = '600 12px "Chakra Petch", sans-serif';
        if (close && !g.input.usingTouch) ctx.fillText('BARREL ROLL: DOUBLE-TAP A / D', W / 2, short ? H * 0.42 + 22 : H / 2 - 138);
        ctx.textAlign = 'left';
      }
    }
    this.drawRadar(g);
  }

  private drawBoresight(x: number, y: number) {
    const ctx = this.ctx;
    ctx.strokeStyle = C.hud;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x - 18, y);
    ctx.lineTo(x - 8, y);
    ctx.lineTo(x - 4, y + 5);
    ctx.lineTo(x, y);
    ctx.lineTo(x + 4, y + 5);
    ctx.lineTo(x + 8, y);
    ctx.lineTo(x + 18, y);
    ctx.moveTo(x, y - 4);
    ctx.lineTo(x, y - 10);
    ctx.stroke();
  }

  private drawLadder(g: Game, cam: THREE.Camera) {
    const ctx = this.ctx;
    const p = g.player;
    const hdg = Math.atan2(p.fwd.x, -p.fwd.z);
    const origin = cam.position;
    const pt = (h: number, e: number) => {
      const ce = Math.cos(e);
      _v.set(Math.sin(h) * ce, Math.sin(e), -Math.cos(h) * ce).multiplyScalar(8000).add(origin);
      return this.project(_v, cam);
    };
    ctx.save();
    ctx.beginPath();
    ctx.arc(this.w / 2, this.h / 2, Math.min(this.w, this.h) * 0.3, 0, Math.PI * 2);
    ctx.clip();
    ctx.font = '500 11px "Chakra Petch", sans-serif';
    for (let e = -60; e <= 60; e += 10) {
      const er = e * DEG;
      const span = e === 0 ? 16 : 5;
      const gap = e === 0 ? 3.2 : 2;
      const a1 = pt(hdg - span * DEG, er);
      const a2 = pt(hdg - gap * DEG, er);
      const b1 = pt(hdg + gap * DEG, er);
      const b2 = pt(hdg + span * DEG, er);
      if (a1.behind || a2.behind || b1.behind || b2.behind) continue;
      ctx.strokeStyle = e === 0 ? C.hudDim : C.hudFaint;
      ctx.lineWidth = e === 0 ? 1.4 : 1;
      if (e < 0) ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(a1.x, a1.y);
      ctx.lineTo(a2.x, a2.y);
      ctx.moveTo(b1.x, b1.y);
      ctx.lineTo(b2.x, b2.y);
      ctx.stroke();
      ctx.setLineDash([]);
      if (e !== 0) {
        ctx.fillStyle = C.hudFaint;
        ctx.fillText(String(Math.abs(e)), b2.x + 5, b2.y);
      }
    }
    ctx.restore();
  }

  private drawHeadingTape(g: Game) {
    const ctx = this.ctx;
    const hdg = headingDeg(g.player.fwd);
    const cx = this.w / 2;
    const y = 22;
    const halfW = 160;
    const pxPerDeg = 3.2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - halfW, 0, halfW * 2, 44);
    ctx.clip();
    ctx.strokeStyle = C.hudDim;
    ctx.fillStyle = C.hudDim;
    ctx.textAlign = 'center';
    ctx.font = '600 11px "Chakra Petch", sans-serif';
    const start = Math.floor((hdg - 60) / 5) * 5;
    for (let d = start; d <= hdg + 60; d += 5) {
      const x = cx + (d - hdg) * pxPerDeg;
      const dd = ((d % 360) + 360) % 360;
      const major = dd % 30 === 0;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + (major ? 8 : 4));
      ctx.stroke();
      if (major) {
        const label = dd === 0 ? 'N' : dd === 90 ? 'E' : dd === 180 ? 'S' : dd === 270 ? 'W' : String(dd / 10).padStart(2, '0');
        ctx.fillText(label, x, y - 8);
      }
    }
    ctx.restore();
    ctx.fillStyle = C.hud;
    ctx.beginPath();
    ctx.moveTo(cx, y + 11);
    ctx.lineTo(cx - 5, y + 18);
    ctx.lineTo(cx + 5, y + 18);
    ctx.closePath();
    ctx.fill();
    ctx.textAlign = 'left';
  }

  /** Remembers where a marker label went, so the FIRE cue can keep clear of it. */
  private note(text: string, x: number, y: number) {
    const w = this.ctx.measureText(text).width;
    const align = this.ctx.textAlign;
    const x0 = align === 'center' ? x - w / 2 : align === 'right' || align === 'end' ? x - w : x;
    this.labels.push([x0, y - 7, x0 + w, y + 7]);
  }

  /** A y for a label near `y` that doesn't land on one already drawn: steps by `step` up to three times. */
  private freeY(text: string, x: number, y: number, step: number) {
    const w = this.ctx.measureText(text).width;
    const align = this.ctx.textAlign;
    const x0 = align === 'center' ? x - w / 2 : align === 'right' || align === 'end' ? x - w : x;
    for (let i = 0; i < 3; i++) {
      const yy = y + step * i;
      if (!this.labels.some((r) => x0 < r[2] && x0 + w > r[0] && yy - 7 < r[3] && yy + 7 > r[1])) return yy;
    }
    return y;
  }

  /** FIRE beside the gun pipper: right of it unless a target label is there, then left, below, above. */
  private drawFire(x: number, y: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = '700 11px "Chakra Petch", sans-serif';
    ctx.fillStyle = C.white;
    const w = ctx.measureText('FIRE').width;
    const spots: [number, number, CanvasTextAlign, number][] = [
      [x + 14, y, 'left', x + 14],
      [x - 14, y, 'right', x - 14 - w],
      [x, y + 20, 'center', x - w / 2],
      [x, y - 20, 'center', x - w / 2],
    ];
    const clear = (s: (typeof spots)[number]) => !this.labels.some((r) => s[3] < r[2] && s[3] + w > r[0] && s[1] - 7 < r[3] && s[1] + 7 > r[1]);
    const [fx, fy, align] = spots.find(clear) ?? spots[0];
    ctx.textAlign = align;
    ctx.fillText('FIRE', fx, fy);
    ctx.restore();
  }

  private drawMarker(g: Game, a: Aircraft, cam: THREE.Camera, focal: number, selected: boolean) {
    const ctx = this.ctx;
    const p = g.player;
    const s = this.project(a.pos, cam);
    if (s.behind || s.x < -50 || s.x > this.w + 50 || s.y < -50 || s.y > this.h + 50) return;
    const dist = a.pos.distanceTo(p.pos);
    if (a.team === 'blue') {
      if (dist > 6000) return;
      ctx.strokeStyle = C.friend;
      ctx.fillStyle = C.friend;
      ctx.beginPath();
      ctx.moveTo(s.x - 6, s.y - 12);
      ctx.lineTo(s.x, s.y - 6);
      ctx.lineTo(s.x + 6, s.y - 12);
      ctx.stroke();
      ctx.font = '600 10px "Chakra Petch", sans-serif';
      ctx.textAlign = 'center';
      const cy = this.freeY(a.callsign, s.x, s.y - 20, -11);
      ctx.fillText(a.callsign, s.x, cy);
      this.note(a.callsign, s.x, cy);
      ctx.textAlign = 'left';
      return;
    }
    const col = a.kind === 'ace' ? C.ace : a.missionTarget ? C.target : a.kind === 'drone' ? C.drone : C.hostile;
    const size = clamp((a.radius * 1.6 * focal) / Math.max(dist, 1), selected ? 16 : 11, 70);
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = selected ? 2 : 1.4;
    const k = size * 0.4;
    ctx.beginPath();
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      const x = s.x + sx * size;
      const y = s.y + sy * size;
      ctx.moveTo(x, y - sy * k);
      ctx.lineTo(x, y);
      ctx.lineTo(x - sx * k, y);
    }
    ctx.stroke();
    ctx.font = `${selected ? 700 : 600} 11px "Chakra Petch", sans-serif`;
    ctx.textAlign = 'center';
    // Declutter: only the selected target and nearby or mission-critical contacts get text.
    const important = selected || a.missionTarget || a.kind === 'ace';
    if (selected || (important && dist < 5000) || dist < 1300) {
      const tag = a.missionTarget ? `TGT ${a.label}` : a.label;
      // Aircraft in formation would print their names over each other: stack them upward.
      const ty = this.freeY(tag, s.x, s.y - size - 9, -12);
      ctx.fillText(tag, s.x, ty);
      this.note(tag, s.x, ty);
    }
    if (selected || important) {
      ctx.fillText(fmtDist(dist), s.x, s.y + size + 10);
      this.note(fmtDist(dist), s.x, s.y + size + 10);
    }
    let barY = s.y + size + 20;
    const detail = selected || dist < 3000;
    if ((a.kind === 'scout' || a.kind === 'ace') && detail) {
      this.miniBar(s.x, barY, 56, a.hp / a.maxHp, col);
      barY += 8;
    }
    if (a.kind === 'scout' && g.uploadsActive && detail) {
      const paused = a.uploadPause > 0;
      this.miniBar(s.x, barY, 56, a.upload, paused ? C.white : C.gold);
      ctx.font = '600 9px "Chakra Petch", sans-serif';
      ctx.fillStyle = paused ? C.white : C.gold;
      ctx.fillText(paused ? 'JAMMED' : `UPLOAD ${Math.round(a.upload * 100)}%`, s.x, barY + 10);
      this.note(paused ? 'JAMMED' : `UPLOAD ${Math.round(a.upload * 100)}%`, s.x, barY + 10);
    }
    if (selected) {
      ctx.textAlign = 'left';
      if (a.ecm) {
        ctx.fillStyle = C.gold;
        ctx.font = '700 11px "Chakra Petch", sans-serif';
        ctx.fillText('NO LOCK', s.x + size + 8, s.y);
        this.note('NO LOCK', s.x + size + 8, s.y);
      } else if (g.locked) {
        const pulse = 1 + 0.08 * Math.sin(g.realTime * 20);
        const d = (size + 10) * pulse;
        ctx.strokeStyle = C.hostile;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y - d);
        ctx.lineTo(s.x + d, s.y);
        ctx.lineTo(s.x, s.y + d);
        ctx.lineTo(s.x - d, s.y);
        ctx.closePath();
        ctx.stroke();
        ctx.fillStyle = C.hostile;
        ctx.font = '700 12px "Chakra Petch", sans-serif';
        ctx.fillText('LOCK', s.x + d + 6, s.y);
        this.note('LOCK', s.x + d + 6, s.y);
      } else if (g.lockProgress > 0) {
        const d = size + 10 + (1 - g.lockProgress) * 70;
        ctx.strokeStyle = C.hud;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y - d);
        ctx.lineTo(s.x + d, s.y);
        ctx.lineTo(s.x, s.y + d);
        ctx.lineTo(s.x - d, s.y);
        ctx.closePath();
        ctx.stroke();
      }
    }
    ctx.textAlign = 'left';
    ctx.lineWidth = 1.5;
  }

  private miniBar(cx: number, y: number, w: number, frac: number, col: string) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(cx - w / 2, y, w, 4);
    ctx.fillStyle = col;
    ctx.fillRect(cx - w / 2, y, w * clamp(frac, 0, 1), 4);
  }

  private edgeArrow(s: { x: number; y: number; behind: boolean }, col: string, label: string) {
    const ctx = this.ctx;
    const cx = this.w / 2;
    const cy = this.h / 2;
    let dx = s.x - cx;
    let dy = s.y - cy;
    if (s.behind) {
      dx = -dx;
      dy = -dy;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) dy = 1;
    }
    const ang = Math.atan2(dy, dx);
    const rx = this.w * 0.42;
    const ry = this.h * 0.38;
    const ex = cx + Math.cos(ang) * rx;
    const ey = cy + Math.sin(ang) * ry;
    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(ang);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(-6, -9);
    ctx.lineTo(-2, 0);
    ctx.lineTo(-6, 9);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = col;
    ctx.font = '600 11px "Chakra Petch", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, ex - Math.cos(ang) * 30, ey - Math.sin(ang) * 22);
    ctx.textAlign = 'left';
  }

  // ---------------------------------------------------------------- Radar

  private drawRadar(g: Game) {
    const ctx = this.rctx;
    const S = this.radarCanvas.width / this.dpr;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, S, S);
    if (!this.visible || g.cinematic) return;
    const R = S / 2 - 4;
    const cx = S / 2;
    const cy = S / 2;
    const p = g.player;
    const range = this.radarRange;
    const hdg = Math.atan2(p.fwd.x, -p.fwd.z);
    const cosH = Math.cos(hdg);
    const sinH = Math.sin(hdg);
    const toRadar = (x: number, z: number) => {
      const dx = x - p.pos.x;
      const dz = z - p.pos.z;
      const rx = dx * cosH + dz * sinH;
      const ry = -dx * sinH + dz * cosH;
      return { x: cx + (rx / range) * R, y: cy + (ry / range) * R, d: Math.hypot(dx, dz) };
    };
    ctx.fillStyle = 'rgba(3, 14, 10, 0.62)';
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();
    ctx.strokeStyle = C.hudFaint;
    ctx.lineWidth = 1;
    for (const f of [1 / 3, 2 / 3]) {
      ctx.beginPath();
      ctx.arc(cx, cy, R * f, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx - R, cy);
    ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy - R);
    ctx.lineTo(cx, cy + R);
    ctx.stroke();
    // Sweep.
    const sweep = (g.realTime * 1.6) % (Math.PI * 2);
    const grad = ctx.createConicGradient ? ctx.createConicGradient(sweep - Math.PI / 2, cx, cy) : null;
    if (grad) {
      grad.addColorStop(0, 'rgba(166,255,208,0.22)');
      grad.addColorStop(0.12, 'rgba(166,255,208,0)');
      grad.addColorStop(1, 'rgba(166,255,208,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, S, S);
    }
    // Coastlines.
    ctx.strokeStyle = 'rgba(166,255,208,0.4)';
    ctx.lineWidth = 1.2;
    for (const line of this.coast) {
      ctx.beginPath();
      line.forEach((pt, i) => {
        const r = toRadar(pt.x, pt.y);
        if (i === 0) ctx.moveTo(r.x, r.y);
        else ctx.lineTo(r.x, r.y);
      });
      ctx.stroke();
    }
    if (g.showBoundary) {
      ctx.strokeStyle = 'rgba(255,77,61,0.7)';
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      const a = toRadar(WORLD.boundaryX, p.pos.z - 30000);
      const b = toRadar(WORLD.boundaryX, p.pos.z + 30000);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Ships.
    ctx.fillStyle = C.friend;
    for (const s of g.fleet.ships) {
      const r = toRadar(s.position.x, s.position.z);
      ctx.save();
      ctx.translate(r.x, r.y);
      ctx.rotate(-hdg);
      ctx.fillRect(-2, -5, 4, 10);
      ctx.restore();
    }
    // Checkpoint.
    const cp = g.mission.activeCheckpoint();
    if (cp) {
      const r = toRadar(cp.pos.x, cp.pos.z);
      const k = clampToRadar(r, cx, cy, R - 6);
      ctx.strokeStyle = C.gold;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(k.x, k.y, 5, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Aircraft.
    for (const a of g.aircraft) {
      if (a === p || !a.targetable) continue;
      const r = toRadar(a.pos.x, a.pos.z);
      let pos: { x: number; y: number } = r;
      if (r.d > range) {
        if (!a.missionTarget && a.kind !== 'ace') continue;
        pos = clampToRadar(r, cx, cy, R - 6);
      }
      const ah = Math.atan2(a.fwd.x, -a.fwd.z) - hdg;
      const col = a.team === 'blue' ? C.friend : a.kind === 'ace' ? C.ace : a.missionTarget ? C.target : a.kind === 'drone' ? C.drone : C.hostile;
      ctx.fillStyle = col;
      ctx.save();
      ctx.translate(pos.x, pos.y);
      if (a.missionTarget) {
        const pulse = 4.5 + Math.sin(g.realTime * 6) * 1.2;
        ctx.beginPath();
        ctx.moveTo(0, -pulse);
        ctx.lineTo(pulse, 0);
        ctx.lineTo(0, pulse);
        ctx.lineTo(-pulse, 0);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.rotate(ah);
        const sz = a.kind === 'ace' ? 7 : a.team === 'blue' ? 4 : 5;
        ctx.beginPath();
        ctx.moveTo(0, -sz);
        ctx.lineTo(sz * 0.7, sz * 0.8);
        ctx.lineTo(-sz * 0.7, sz * 0.8);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      if (a === g.target) {
        ctx.strokeStyle = C.white;
        ctx.lineWidth = 1;
        ctx.strokeRect(pos.x - 7, pos.y - 7, 14, 14);
      }
    }
    // Missiles.
    for (const m of g.weapons.missiles) {
      if (!m.active) continue;
      const r = toRadar(m.pos.x, m.pos.z);
      if (r.d > range) continue;
      ctx.fillStyle = m.team === 'red' ? C.hostile : C.white;
      ctx.fillRect(r.x - 1.5, r.y - 1.5, 3, 3);
    }
    // Ping ring.
    if (this.pingT < 1.6) {
      ctx.strokeStyle = `rgba(255,77,61,${1 - this.pingT / 1.6})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, (this.pingT / 1.6) * R, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    // Player and frame.
    ctx.fillStyle = C.hud;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 7);
    ctx.lineTo(cx + 5, cy + 6);
    ctx.lineTo(cx, cy + 3);
    ctx.lineTo(cx - 5, cy + 6);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = C.hudDim;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = C.hudDim;
    ctx.font = '600 10px "Chakra Petch", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${(range / 1000).toFixed(0)} KM`, S - 6, S - 8);
    ctx.textAlign = 'left';
  }
}

const _v = new THREE.Vector3();

function fmtDist(d: number) {
  return d >= 1000 ? `${(d / 1000).toFixed(1)}KM` : `${Math.round(d / 10) * 10}M`;
}

function clampToRadar(r: { x: number; y: number }, cx: number, cy: number, R: number) {
  const dx = r.x - cx;
  const dy = r.y - cy;
  const d = Math.hypot(dx, dy);
  if (d <= R) return r;
  return { x: cx + (dx / d) * R, y: cy + (dy / d) * R };
}
