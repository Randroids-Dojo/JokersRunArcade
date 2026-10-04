import * as THREE from 'three';
import type { Game } from './game';
import { clamp } from './math';

// Test pilot for ?debug runs. It only writes the same control fields the keyboard and
// gamepad feed (pitch, roll, yaw, boost, brake, guns, missile, rollTap), so it exercises
// the real flight model, lock-on, weapons and mission scripting.

const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _aim = new THREE.Vector3();

export class Bot {
  enabled = false;
  private missileT = 0;
  private rolledRing = -1;
  private evadeT = 0;
  log: string[] = [];

  drive(g: Game, dt: number) {
    if (!this.enabled || !g.controlsEnabled || !g.player.alive || g.state !== 'play') return;
    const p = g.player;
    const inp = g.input;
    const cp = g.mission.activeCheckpoint();
    const t = g.target && g.target.targetable ? g.target : null;
    let ringKind = '';
    if (cp) {
      const ring = g.mission.rings.find((r) => r.pos === cp.pos);
      ringKind = ring?.kind ?? '';
      const d = cp.pos.distanceTo(p.pos);
      _aim.copy(cp.pos);
      if (ring && d > 500) _aim.addScaledVector(ring.normal, -Math.min(600, d * 0.4));
    } else if (t) {
      const d = t.pos.distanceTo(p.pos);
      _aim.copy(t.pos).addScaledVector(t.vel, Math.min(1.5, d / (1150 + p.speed)));
    } else {
      _aim.copy(p.pos).addScaledVector(p.fwd, 1000);
      _aim.y = Math.max(_aim.y, 700);
    }
    const dist = _aim.distanceTo(p.pos);
    _dir.subVectors(_aim, p.pos).normalize();
    const local = _dir.clone().applyQuaternion(_q.copy(p.quat).invert());
    const lx = local.x;
    const ly = local.y;
    const lf = -local.z;
    const off = Math.atan2(Math.hypot(lx, ly), lf);
    const rollErr = Math.atan2(lx, ly);
    const bank = g.pc.bankAngle(p);
    let pitch = 0;
    let roll = 0;
    let yaw = 0;
    if (off < 0.12) {
      pitch = clamp(ly * 14, -1, 1);
      yaw = clamp(lx * 14, -1, 1);
      roll = clamp(-bank * 1.2, -0.6, 0.6);
    } else {
      roll = clamp(rollErr * 2.4, -1, 1);
      pitch = Math.abs(rollErr) < 1.1 ? clamp(off * 3, 0.35, 1) : Math.abs(rollErr) > 2.5 ? -0.2 : 0.15;
    }
    const agl = p.pos.y - g.terrain.ground(p.pos.x, p.pos.z);
    const ahead = g.terrain.ground(p.pos.x + p.vel.x * 2, p.pos.z + p.vel.z * 2);
    if ((agl < 140 && p.vel.y < 0) || p.pos.y + p.vel.y * 2 < ahead + 80) {
      roll = clamp(-bank * 2, -1, 1);
      pitch = Math.abs(bank) < 1.2 && p.up.y > 0 ? 1 : 0;
    }
    if (g.settings.invertPitch) pitch = -pitch;
    inp.pitch = pitch;
    inp.roll = roll;
    inp.yaw = yaw;
    inp.boost = false;
    inp.brake = false;
    if (ringKind === 'boost') inp.boost = dist < 2200;
    else if (ringKind === 'brake') inp.brake = dist < 1500;
    else if (cp) inp.boost = dist > 1500 && off < 0.4;
    else if (t) {
      const td = t.pos.distanceTo(p.pos);
      inp.boost = td > 1300 && off < 0.6;
      inp.brake = off > 1.2 && td < 1200;
    }
    if (ringKind === 'roll' && dist < 420 && this.rolledRing !== g.mission.rings.findIndex((r) => r.label === 'ROLL')) {
      inp.rollTap = 1;
      this.rolledRing = g.mission.rings.findIndex((r) => r.label === 'ROLL');
    }
    // Weapons.
    this.missileT -= dt;
    inp.guns = false;
    if (t && !cp) {
      const td = t.pos.distanceTo(p.pos);
      if (g.locked && !t.ecm && this.missileT <= 0) {
        inp.missile = true;
        this.missileT = 0.9;
      }
      if (td < 1100 && off < 0.07) inp.guns = true;
    }
    // Missile evasion.
    this.evadeT -= dt;
    const close = g.weapons.incomingMissiles(p).some((m) => m.pos.distanceTo(p.pos) < 450);
    if (close && this.evadeT <= 0) {
      inp.rollTap = Math.random() < 0.5 ? -1 : 1;
      this.evadeT = 1.5;
    }
  }
}
