import * as THREE from 'three';
import { Aircraft, Brain, Weapon } from './aircraft';
import { clamp, damp, horizontal, quatFromFwdUp, rand, randSign, rotateToward } from './math';
import type { Game } from './game';
import type { Missile } from './weapons';
import { CanyonPoint } from './terrain';

const _f = new THREE.Vector3();
const _n = new THREE.Vector3();
const _lat = new THREE.Vector3();
const _u = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
const _t = new THREE.Vector3();
const _aim = new THREE.Vector3();

/** Turn-rate-limited steering with automatic coordinated banking. */
export function steer(a: Aircraft, desired: THREE.Vector3, turnRate: number, dt: number, targetSpeed: number, accel = 0.8) {
  _d.copy(desired).normalize();
  _f.copy(a.fwd);
  rotateToward(a.fwd, _d, turnRate * dt, _n);
  _lat.subVectors(_n, _f).multiplyScalar(a.speed / Math.max(dt, 1e-4));
  _u.set(0, 9.81, 0).add(_lat);
  _u.addScaledVector(_n, -_u.dot(_n));
  if (_u.lengthSq() < 1e-6) _u.copy(a.up);
  _u.normalize();
  _b.copy(a.up).lerp(_u, 1 - Math.exp(-5 * dt));
  _b.addScaledVector(_n, -_b.dot(_n));
  if (_b.lengthSq() < 1e-6) _b.copy(_u);
  _b.normalize();
  quatFromFwdUp(_n, _b, a.quat);
  a.speed = damp(a.speed, targetSpeed, accel, dt);
  a.gLoad = _lat.length() / 9.81;
  a.updateBasis();
  a.pos.addScaledVector(a.vel, dt);
}

/** Bend `desired` upward when the terrain ahead is too close. */
export function avoidTerrain(a: Aircraft, g: Game, desired: THREE.Vector3, margin: number) {
  let worst = 0;
  for (const t of [0.5, 1.2, 2.2, 3.4]) {
    const px = a.pos.x + a.vel.x * t;
    const pz = a.pos.z + a.vel.z * t;
    const py = a.pos.y + a.vel.y * t;
    const gh = g.terrain.ground(px, pz);
    const clearance = py - (gh + margin);
    if (clearance < 0) worst = Math.max(worst, -clearance / margin);
  }
  const here = a.pos.y - g.terrain.ground(a.pos.x, a.pos.z);
  if (here < margin * 0.5) worst = Math.max(worst, 1.5);
  if (worst > 0) {
    desired.normalize();
    desired.y = Math.max(desired.y, 0) + Math.min(2.5, worst * 1.5);
    desired.normalize();
  }
  if (a.pos.y > 4800 && desired.y > 0) {
    desired.y *= 0.2;
    desired.normalize();
  }
  return desired;
}

function leadPoint(a: Aircraft, t: Aircraft, projectileSpeed: number, out: THREE.Vector3) {
  const dist = a.pos.distanceTo(t.pos);
  const tf = clamp(dist / projectileSpeed, 0, 2.5);
  return out.copy(t.pos).addScaledVector(t.vel, tf);
}

export interface GunSpec {
  range: number;
  cone: number;
  rate: number;
  damage: number;
  spread: number;
  burstOn: number;
  burstOff: number;
}

export class GunControl {
  private burst = 0;
  private on = false;
  fire(a: Aircraft, g: Game, target: Aircraft, spec: GunSpec, dt: number) {
    a.gunCooldown -= dt;
    this.burst -= dt;
    if (this.burst <= 0) {
      this.on = !this.on;
      this.burst = this.on ? spec.burstOn : spec.burstOff * rand(0.7, 1.3);
    }
    if (!this.on || a.gunCooldown > 0) return;
    const dist = a.pos.distanceTo(target.pos);
    if (dist > spec.range) return;
    leadPoint(a, target, 950 + a.speed, _aim);
    _t.subVectors(_aim, a.pos).normalize();
    if (a.fwd.angleTo(_t) > spec.cone) return;
    a.gunCooldown = 1 / spec.rate;
    _t.lerp(a.fwd, 0.25);
    _t.x += rand(-spec.spread, spec.spread);
    _t.y += rand(-spec.spread, spec.spread);
    _t.z += rand(-spec.spread, spec.spread);
    _t.normalize();
    g.weapons.fireBullet(a, _b.copy(a.pos).addScaledVector(a.fwd, 11), _t, 950, spec.damage, 1.35);
    g.onAiGunShot(a);
  }
}

export class MissileControl {
  lockT = 0;
  fire(a: Aircraft, g: Game, target: Aircraft, dt: number, cooldown: number, range = 2700, lockNeeded = 1.4) {
    a.missileCooldown -= dt;
    const dist = a.pos.distanceTo(target.pos);
    _t.subVectors(target.pos, a.pos).normalize();
    if (dist < range && dist > 350 && a.fwd.angleTo(_t) < 0.42) this.lockT += dt;
    else this.lockT = Math.max(0, this.lockT - dt * 2);
    if (this.lockT >= lockNeeded && a.missileCooldown <= 0 && g.canLaunchAt(target)) {
      g.fireAiMissile(a, target);
      a.missileCooldown = cooldown * rand(0.8, 1.25);
      this.lockT = 0;
    }
  }
}

function dropFlares(a: Aircraft, g: Game, cooldown = 2.5) {
  if (a.flares > 0 && a.flareCooldown <= 0) {
    a.flares--;
    a.flareCooldown = cooldown;
    g.weapons.dropFlares(a);
    g.onFlares(a);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- Fighter

export type FighterMode = 'engage' | 'escort' | 'flee';

export class FighterBrain implements Brain {
  mode: FighterMode;
  target: Aircraft | null = null;
  escortOf: Aircraft | null = null;
  escortOffset = new THREE.Vector3();
  skill: number;
  turnRate = 1.05;
  evadeChance = 0.22;
  /** Prefer the player when picking targets. */
  playerBias = 0.75;
  private evadeT = 0;
  private evadeDir = 1;
  private evadeSwitch = 0;
  private extendT = 0;
  private threatT = 0;
  private retargetT = 0;
  private fleeDir = new THREE.Vector3();
  private gun = new GunControl();
  private msl = new MissileControl();
  private spec: GunSpec;

  constructor(mode: FighterMode, skill = 0.6) {
    this.mode = mode;
    this.skill = skill;
    this.spec = { range: 900, cone: 0.07, rate: 10, damage: 2.0, spread: 0.012, burstOn: 0.9, burstOff: 1.6 };
  }

  flee(from: THREE.Vector3, a: Aircraft) {
    this.mode = 'flee';
    this.fleeDir.subVectors(a.pos, from).setY(0).normalize();
    this.fleeDir.y = 0.25;
    this.fleeDir.normalize();
  }

  private pickTarget(a: Aircraft, g: Game) {
    const p = g.player;
    let best: Aircraft | null = p.alive ? p : null;
    if (Math.random() > this.playerBias) {
      let bd = Infinity;
      for (const w of g.wingmen) {
        if (!w.targetable) continue;
        const d = w.pos.distanceTo(a.pos);
        if (d < bd) {
          bd = d;
          best = w;
        }
      }
    }
    this.target = best;
    this.retargetT = rand(6, 11);
  }

  update(a: Aircraft, g: Game, dt: number) {
    a.flareCooldown -= dt;
    const desired = _aim;
    let speed = 270;
    let turn = this.turnRate;
    if (this.mode === 'flee') {
      desired.copy(this.fleeDir);
      avoidTerrain(a, g, desired, 150);
      steer(a, desired, 0.9, dt, 390, 0.5);
      a.throttle = 1;
      return;
    }
    this.retargetT -= dt;
    if (!this.target || !this.target.targetable || this.retargetT <= 0) this.pickTarget(a, g);
    let target = this.target;

    if (this.mode === 'escort' && this.escortOf && this.escortOf.targetable) {
      const ward = this.escortOf;
      let threat: Aircraft | null = null;
      let td = 2600;
      for (const b of g.aircraft) {
        if (b.team !== 'blue' || !b.targetable) continue;
        const d = b.pos.distanceTo(ward.pos);
        if (d < td) {
          td = d;
          threat = b;
        }
      }
      const fromWard = a.pos.distanceTo(ward.pos);
      if (!threat || fromWard > 4200) {
        _t.copy(this.escortOffset).applyQuaternion(ward.quat).add(ward.pos);
        desired.subVectors(_t, a.pos).addScaledVector(ward.fwd, 400);
        const along = _b.subVectors(_t, a.pos).dot(ward.fwd);
        speed = ward.speed + clamp(along * 0.5, -60, 140);
        avoidTerrain(a, g, desired, 150);
        steer(a, desired, 0.9, dt, speed, 1.2);
        a.throttle = 0.4;
        return;
      }
      target = threat;
    }
    if (!target) {
      desired.copy(a.fwd);
      steer(a, desired, turn, dt, speed);
      return;
    }

    const p = g.player;
    _t.subVectors(a.pos, p.pos);
    const pd = _t.length();
    _t.divideScalar(Math.max(pd, 1));
    const chased = pd < 1300 && p.alive && p.fwd.dot(_t) > 0.93 && a.fwd.dot(_t) > 0.2;
    this.threatT = chased ? this.threatT + dt : Math.max(0, this.threatT - dt);
    if (this.threatT > 1.6 - this.skill && this.evadeT <= 0 && Math.random() < dt * 1.5) {
      this.evadeT = rand(2.2, 3.6);
      this.evadeDir = randSign();
      this.evadeSwitch = rand(0.8, 1.5);
    }

    if (this.evadeT > 0) {
      this.evadeT -= dt;
      this.evadeSwitch -= dt;
      if (this.evadeSwitch <= 0) {
        this.evadeDir = -this.evadeDir;
        this.evadeSwitch = rand(0.9, 1.6);
      }
      desired.copy(a.fwd).multiplyScalar(0.5).addScaledVector(a.right, this.evadeDir * 1.4).addScaledVector(a.up, 0.6);
      speed = 300;
      turn *= 1.15;
    } else if (this.extendT > 0) {
      this.extendT -= dt;
      desired.copy(a.fwd).addScaledVector(horizontal(a.fwd, _b), 0.5);
      desired.y += 0.08;
      speed = 340;
    } else {
      leadPoint(a, target, a.speed * 1.6, desired);
      desired.sub(a.pos);
      const dist = a.pos.distanceTo(target.pos);
      speed = clamp(target.speed + (dist > 1200 ? 80 : 20), 200, 360);
      if (dist < 220 && a.fwd.dot(target.fwd) < 0.5) this.extendT = rand(1.8, 3.2);
    }
    avoidTerrain(a, g, desired, 140);
    steer(a, desired, turn, dt, speed);
    a.throttle = speed > 300 ? 0.9 : 0.45;

    if (target.alive && this.evadeT <= 0) {
      this.gun.fire(a, g, target, this.spec, dt);
      this.msl.fire(a, g, target, dt, 12);
    }
  }

  onMissileIncoming(a: Aircraft, m: Missile, g: Game) {
    this.evadeT = rand(2, 3);
    _t.subVectors(m.pos, a.pos);
    this.evadeDir = _t.dot(a.right) > 0 ? -1 : 1;
    this.evadeSwitch = 3;
    const flared = dropFlares(a, g);
    return Math.random() < this.evadeChance + (flared ? 0.25 : 0);
  }
}

// ---------------------------------------------------------------- Scout

export type ScoutMode = 'cruise' | 'chase' | 'final';

export class ScoutBrain implements Brain {
  mode: ScoutMode = 'cruise';
  heading = new THREE.Vector3(1, 0, 0.12).normalize();
  cruiseAlt = 1700;
  route: CanyonPoint[] = [];
  routeIdx = 0;
  evadeChance = 0.45;
  private t = rand(0, 100);
  private jinkT = 0;
  private jinkDir = new THREE.Vector3();
  private finalDir = new THREE.Vector3();

  startFinal(a: Aircraft, away: THREE.Vector3) {
    this.mode = 'final';
    this.finalDir.copy(away).setY(0).normalize();
    a.speed = 225;
  }

  update(a: Aircraft, g: Game, dt: number) {
    this.t += dt;
    a.flareCooldown -= dt;
    const desired = _aim;
    if (this.mode === 'chase') {
      const r = this.route;
      while (this.routeIdx < r.length - 1) {
        const pt = r[this.routeIdx].pos;
        _t.subVectors(pt, a.pos);
        if (_t.length() < 200 || _t.dot(a.fwd) < 0) this.routeIdx++;
        else break;
      }
      const look = r[Math.min(r.length - 1, this.routeIdx + 1)];
      desired.subVectors(look.pos, a.pos);
      const sway = Math.sin(this.t * 1.3) * 0.04;
      desired.normalize().addScaledVector(a.right, sway);
      steer(a, desired, 1.25, dt, look.speed, 0.7);
      a.throttle = 0.9;
      if (this.routeIdx >= r.length - 2) g.onScoutEscaped(a);
      return;
    }
    if (this.mode === 'final') {
      desired.copy(this.finalDir).addScaledVector(_b.set(-this.finalDir.z, 0, this.finalDir.x), Math.sin(this.t * 0.7) * 0.35);
      const gh = g.terrain.ground(a.pos.x, a.pos.z);
      desired.y = clamp((gh + 230 - a.pos.y) / 500, -0.35, 0.35);
      if (this.jinkT > 0) {
        this.jinkT -= dt;
        desired.add(this.jinkDir);
      }
      avoidTerrain(a, g, desired, 90);
      steer(a, desired, 0.85, dt, 245, 0.5);
      a.throttle = 0.8;
      return;
    }
    desired.copy(this.heading).addScaledVector(_b.set(-this.heading.z, 0, this.heading.x), Math.sin(this.t * 0.25) * 0.25);
    desired.y = clamp((this.cruiseAlt - a.pos.y) / 700, -0.25, 0.25);
    if (this.jinkT > 0) {
      this.jinkT -= dt;
      desired.add(this.jinkDir);
    }
    avoidTerrain(a, g, desired, 200);
    steer(a, desired, 0.5, dt, 135, 0.4);
    a.throttle = 0.35;
  }

  onHit(a: Aircraft) {
    if (this.jinkT <= 0 && this.mode !== 'chase') {
      this.jinkT = 1.4;
      this.jinkDir.copy(a.right).multiplyScalar(randSign() * 0.6);
      this.jinkDir.y = rand(-0.15, 0.2);
    }
  }

  onMissileIncoming(a: Aircraft, _m: Missile, g: Game) {
    const flared = dropFlares(a, g, this.mode === 'chase' ? 0.7 : this.mode === 'final' ? 1.4 : 2.5);
    if (!flared) return Math.random() < this.evadeChance * 0.4;
    return Math.random() < this.evadeChance;
  }
}

// ---------------------------------------------------------------- Training drones

export type DroneMode = 'lock' | 'guns' | 'evasive';

export class DroneBrain implements Brain {
  mode: DroneMode;
  private t = 0;
  private pickT = 0;
  private wish = new THREE.Vector3();
  private evadeT = 0;
  private evadeDir = 1;
  alt: number;

  constructor(mode: DroneMode, alt: number) {
    this.mode = mode;
    this.alt = alt;
  }

  update(a: Aircraft, g: Game, dt: number) {
    this.t += dt;
    const desired = _aim;
    const p = g.player;
    const toP = _t.subVectors(p.pos, a.pos);
    const dist = toP.length();
    if (this.mode === 'lock') {
      desired.copy(a.fwd).applyAxisAngle(_b.set(0, 1, 0), 0.08);
      desired.y = clamp((this.alt - a.pos.y) / 500, -0.2, 0.2);
      const far = dist > 3800;
      if (far) desired.copy(toP).normalize();
      steer(a, desired, far ? 0.4 : 0.12, dt, 120, 0.5);
      a.throttle = 0.3;
      return;
    }
    if (this.mode === 'guns') {
      desired.copy(horizontal(a.fwd, _b)).applyAxisAngle(_u.set(0, 1, 0), Math.sin(this.t * 0.6) * 0.35);
      desired.y = clamp((this.alt - a.pos.y) / 500, -0.2, 0.2) + Math.sin(this.t * 0.9) * 0.08;
      if (dist > 3000) desired.copy(toP).normalize();
      steer(a, desired, 0.55, dt, 145, 0.5);
      a.throttle = 0.35;
      return;
    }
    this.pickT -= dt;
    if (this.pickT <= 0) {
      this.pickT = rand(1.0, 1.8);
      this.wish
        .copy(a.fwd)
        .applyAxisAngle(_u.set(0, 1, 0), rand(-1.2, 1.2))
        .add(_b.set(0, rand(-0.35, 0.4), 0))
        .normalize();
    }
    desired.copy(this.wish);
    if (dist > 3000) desired.copy(toP).normalize();
    if (this.evadeT > 0) {
      this.evadeT -= dt;
      desired.copy(a.fwd).addScaledVector(a.right, this.evadeDir * 1.5);
    }
    desired.y += clamp((this.alt - a.pos.y) / 900, -0.3, 0.3);
    avoidTerrain(a, g, desired, 150);
    steer(a, desired, 1.45, dt, 255, 0.8);
    a.throttle = 0.9;
  }

  onMissileIncoming(a: Aircraft, m: Missile) {
    if (this.mode !== 'evasive') return false;
    this.evadeT = 1.8;
    _t.subVectors(m.pos, a.pos);
    this.evadeDir = _t.dot(a.right) > 0 ? -1 : 1;
    return Math.random() < 0.4;
  }
}

// ---------------------------------------------------------------- Wingman

export class WingmanBrain implements Brain {
  slot: THREE.Vector3;
  role: number;
  target: Aircraft | null = null;
  private retargetT = 0;
  private gun = new GunControl();
  private msl = new MissileControl();
  private spec: GunSpec = { range: 800, cone: 0.06, rate: 9, damage: 2.4, spread: 0.01, burstOn: 1.0, burstOff: 1.4 };

  constructor(slot: THREE.Vector3, role: number) {
    this.slot = slot;
    this.role = role;
  }

  private pick(a: Aircraft, g: Game) {
    const order = g.wingOrder;
    const wantScouts = order === 'scouts' || (order === 'split' && this.role === 2);
    let best: Aircraft | null = null;
    let bd = Infinity;
    for (const b of g.aircraft) {
      if (b.team !== 'red' || !b.targetable) continue;
      const isScout = b.kind === 'scout';
      if (wantScouts !== isScout && !(wantScouts && !g.aircraft.some((x) => x.kind === 'scout' && x.targetable))) continue;
      const ref = wantScouts ? a.pos : g.player.pos;
      const d = b.pos.distanceTo(ref) + (b.kind === 'ace' ? 4000 : 0);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    this.target = best;
    this.retargetT = rand(4, 7);
  }

  update(a: Aircraft, g: Game, dt: number) {
    const desired = _aim;
    const p = g.player;
    this.retargetT -= dt;
    if (!g.formation && (!this.target || !this.target.targetable || this.retargetT <= 0)) this.pick(a, g);
    if (g.formation || !this.target) {
      _t.copy(this.slot).applyQuaternion(p.quat).add(p.pos);
      desired.subVectors(_t, a.pos).addScaledVector(p.fwd, 260);
      const along = _b.subVectors(_t, a.pos).dot(p.fwd);
      const far = a.pos.distanceTo(_t);
      const speed = clamp(p.speed + along * 0.8 + (far > 1500 ? 150 : 0), 120, 480);
      avoidTerrain(a, g, desired, 90);
      steer(a, desired, far > 600 ? 1.2 : 2.0, dt, speed, 2.2);
      a.throttle = clamp((speed - 180) / 220, 0.1, 1);
      return;
    }
    const t = this.target;
    leadPoint(a, t, a.speed * 1.7, desired).sub(a.pos);
    const dist = a.pos.distanceTo(t.pos);
    const speed = clamp(t.speed + (dist > 900 ? 90 : 10), 180, 380);
    avoidTerrain(a, g, desired, 120);
    steer(a, desired, 1.1, dt, speed);
    a.throttle = speed > 300 ? 0.9 : 0.45;
    this.gun.fire(a, g, t, this.spec, dt);
    if (t.kind !== 'ace') this.msl.fire(a, g, t, dt, 16, 2400, 1.8);
  }
}

// ---------------------------------------------------------------- Ace

type AceState = 'entry' | 'loop' | 'evade' | 'attack' | 'joustOut' | 'joustIn' | 'retreat';

export class AceBrain implements Brain {
  stage: 1 | 2 = 1;
  state: AceState = 'entry';
  stateT = 0;
  pressure = 0;
  forcedLowT = 0;
  enrageShield = 0;
  evadeChance = 0.72;
  retreating = false;
  private evadeDir = 1;
  private rollT = 0;
  private rollDir = 1;
  private gun = new GunControl();
  private msl = new MissileControl();
  private spec: GunSpec = { range: 1300, cone: 0.06, rate: 14, damage: 2.1, spread: 0.013, burstOn: 1.0, burstOff: 1.1 };

  retreat() {
    this.retreating = true;
    this.state = 'retreat';
  }

  update(a: Aircraft, g: Game, dt: number) {
    a.flareCooldown -= dt;
    this.stateT += dt;
    const p = g.player;
    const desired = _aim;
    const rel = _t.subVectors(p.pos, a.pos);
    const dist = rel.length();
    rel.divideScalar(Math.max(dist, 1));

    if (this.state === 'retreat') {
      desired.copy(rel).negate().setY(0.35);
      steer(a, desired, 0.9, dt, 430, 0.6);
      a.throttle = 1;
      return;
    }

    // Pressure builds while the player holds the ace in their sights from behind.
    const playerBehind = a.fwd.dot(rel) < -0.4 && p.fwd.dot(_b.copy(rel).negate()) > 0.88 && dist < 1800;
    if (this.forcedLowT > 0) {
      this.forcedLowT -= dt;
      if (this.forcedLowT <= 0) g.onAceRecovered(a);
    } else {
      this.pressure = clamp(this.pressure + (playerBehind ? 0.11 : -0.025) * dt, 0, 1);
      if (this.pressure >= 1) {
        this.pressure = 0;
        this.forcedLowT = 6.5;
        g.onAceForcedLow(a);
      }
    }
    if (this.stage === 1 && a.hp <= a.maxHp * 0.5) {
      this.stage = 2;
      this.state = 'joustOut';
      this.stateT = 0;
      a.hp = a.maxHp * 0.5;
      this.forcedLowT = 0;
      this.pressure = 0;
      this.enrageShield = 2.5;
      g.onAceEnraged(a);
    }
    if (this.enrageShield > 0) {
      this.enrageShield -= dt;
      a.hp = Math.max(a.hp, a.maxHp * 0.5);
    }
    const low = this.forcedLowT > 0;
    if (low) {
      a.armor = 1.15;
      this.evadeChance = 0.35;
    } else if (this.stage === 1) {
      a.armor = a.pos.y > 1300 ? 0.45 : 0.7;
      this.evadeChance = 0.78;
    } else {
      a.armor = 0.8;
      this.evadeChance = 0.55;
    }

    let speed = 330;
    let turn = this.stage === 1 ? 1.32 : 1.5;
    let fire = false;
    if (low) {
      desired.copy(horizontal(a.fwd, _b)).addScaledVector(a.right, Math.sin(g.time * 0.9) * 0.4);
      desired.y = clamp((this.lowAlt(a, g) - a.pos.y) / 350, -0.9, 0.15);
      speed = 255;
      turn = 0.95;
      fire = dist < 900;
    } else {
      switch (this.state) {
        case 'entry':
          desired.copy(p.pos).addScaledVector(p.vel, 0.6).sub(a.pos);
          speed = 400;
          fire = true;
          if ((dist < 280 && this.stateT > 2) || this.stateT > 10) this.next(a, g, playerBehind);
          break;
        case 'loop':
          desired.copy(a.fwd).addScaledVector(a.up, 1.5);
          speed = 320;
          turn = 1.15;
          if (this.stateT > 2.8) this.next(a, g, playerBehind);
          break;
        case 'evade':
          if (this.stateT % 1.3 < dt) this.evadeDir = -this.evadeDir;
          desired.copy(a.fwd).multiplyScalar(0.4).addScaledVector(a.right, this.evadeDir * 1.5).addScaledVector(a.up, 0.7);
          speed = 340;
          turn *= 1.15;
          if (this.stateT > 2.6) this.next(a, g, playerBehind);
          break;
        case 'attack':
          leadPoint(a, p, a.speed * 1.5, desired).sub(a.pos);
          speed = clamp(p.speed + 40, 260, 400);
          fire = true;
          if (this.stateT > (this.stage === 1 ? 5 : 4) || (playerBehind && this.stateT > 1.5)) this.next(a, g, playerBehind);
          break;
        case 'joustOut':
          desired.copy(rel).negate();
          desired.y = clamp((1100 - a.pos.y) / 800, -0.3, 0.4);
          speed = 380;
          if (dist > 2300 || this.stateT > 7) {
            this.state = 'joustIn';
            this.stateT = 0;
          }
          break;
        case 'joustIn':
          desired.copy(p.pos).addScaledVector(p.vel, 0.5).sub(a.pos);
          speed = 400;
          turn = 1.7;
          fire = true;
          if (dist < 260 || (this.stateT > 3 && a.fwd.dot(rel) < 0) || this.stateT > 12) this.next(a, g, playerBehind);
          break;
        default:
          break;
      }
    }
    // Barrel roll visual for dodges.
    if (this.rollT > 0) {
      this.rollT -= dt;
      a.rollVisual = this.rollDir * (1 - this.rollT / 0.6) * Math.PI * 2;
      a.pos.addScaledVector(a.right, this.rollDir * 50 * dt);
      if (this.rollT <= 0) a.rollVisual = 0;
    }
    avoidTerrain(a, g, desired, low ? 90 : 160);
    steer(a, desired, turn, dt, speed, 0.9);
    a.throttle = speed > 340 ? 1 : 0.55;
    if (fire && p.alive) {
      this.gun.fire(a, g, p, this.spec, dt);
      this.msl.fire(a, g, p, dt, this.stage === 1 ? 8 : 5.5, 2600, this.stage === 1 ? 1.0 : 0.8);
    }
  }

  private lowAlt(a: Aircraft, g: Game) {
    return g.terrain.ground(a.pos.x + a.vel.x * 2, a.pos.z + a.vel.z * 2) + 260;
  }

  private next(a: Aircraft, g: Game, playerBehind: boolean) {
    this.stateT = 0;
    if (this.stage === 2) {
      this.state = Math.random() < 0.65 ? 'joustOut' : playerBehind ? 'evade' : 'attack';
      return;
    }
    if (playerBehind) this.state = Math.random() < 0.6 ? 'evade' : 'loop';
    else if (a.pos.y < 1500) this.state = 'loop';
    else this.state = Math.random() < 0.7 ? 'attack' : 'loop';
    void g;
  }

  onHit(_a: Aircraft, _g: Game, weapon: Weapon) {
    if (this.forcedLowT <= 0) this.pressure = clamp(this.pressure + (weapon === 'missile' ? 0.12 : 0.01), 0, 1);
  }

  onMissileIncoming(a: Aircraft, m: Missile, g: Game) {
    if (this.retreating) return true;
    if (Math.random() < this.evadeChance) {
      this.rollT = 0.6;
      _t.subVectors(m.pos, a.pos);
      this.rollDir = _t.dot(a.right) > 0 ? -1 : 1;
      if (a.flares <= 0) a.flares = 1;
      dropFlares(a, g);
      g.onAceDodge(a);
      return true;
    }
    return false;
  }
}
