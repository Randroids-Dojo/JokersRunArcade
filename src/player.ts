import * as THREE from 'three';
import { Aircraft } from './aircraft';
import { PLAYER } from './config';
import { clamp, damp, lerp } from './math';
import type { ControlState } from './input';
import type { Game } from './game';

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion();

export class PlayerController {
  pitchCmd = 0;
  rollCmd = 0;
  yawCmd = 0;
  boostEnergy = 1;
  boosting = false;
  braking = false;
  private boostRegenWait = 0;
  rollTime = 0;
  rollDir = 0;
  rollCooldown = 0;
  /** Sim time of the most recent completed barrel roll start. */
  lastRollAt = -100;
  /** Recent left-bank evidence for the tutorial. */
  leftBankAt = -100;
  pitchRateNow = 0;
  autopilot: ((a: Aircraft, dt: number) => void) | null = null;
  collisionCooldown = 0;
  lastGround = 0;

  reset() {
    this.pitchCmd = this.rollCmd = this.yawCmd = 0;
    this.boostEnergy = 1;
    this.boosting = this.braking = false;
    this.rollTime = 0;
    this.rollCooldown = 0;
    this.autopilot = null;
    this.collisionCooldown = 0;
  }

  bankAngle(a: Aircraft): number {
    // Positive = right wing down.
    return Math.asin(clamp(-a.right.y, -1, 1));
  }

  update(a: Aircraft, input: ControlState, g: Game, dt: number) {
    if (this.autopilot) {
      // The autopilot owns orientation, speed and position for this step.
      this.autopilot(a, dt);
      return;
    }
    const s = g.settings;
    const pitchIn = input.pitch * (s.invertPitch ? -1 : 1);
    this.pitchCmd = damp(this.pitchCmd, pitchIn, 9, dt);
    this.rollCmd = damp(this.rollCmd, input.roll, 12, dt);
    this.yawCmd = damp(this.yawCmd, input.yaw, 6, dt);

    // Throttle.
    this.braking = input.brake;
    const wantBoost = input.boost && !this.braking;
    this.boosting = wantBoost && this.boostEnergy > 0.01;
    if (this.boosting) {
      this.boostEnergy = Math.max(0, this.boostEnergy - PLAYER.boostDrain * dt);
      this.boostRegenWait = PLAYER.boostRegenDelay;
    } else {
      this.boostRegenWait -= dt;
      if (this.boostRegenWait <= 0) this.boostEnergy = Math.min(1, this.boostEnergy + PLAYER.boostRegen * dt * g.boostRegenMult);
    }
    const target = this.boosting ? PLAYER.boost : this.braking ? PLAYER.brake : PLAYER.cruise;
    const rate = this.boosting ? 0.9 : this.braking ? 1.8 : 0.55;
    a.speed = damp(a.speed, target, rate, dt);
    a.speed -= a.fwd.y * 22 * dt;
    a.speed = clamp(a.speed, PLAYER.minSpeed, PLAYER.maxSpeed);
    a.throttle = this.boosting ? 1 : this.braking ? 0.05 : 0.45;

    // Turn performance peaks at low speed.
    const tf = a.speed < PLAYER.cruise ? lerp(1.3, 1, (a.speed - PLAYER.brake) / (PLAYER.cruise - PLAYER.brake)) : lerp(1, 0.78, (a.speed - PLAYER.cruise) / (PLAYER.boost - PLAYER.cruise));
    const turnFactor = clamp(tf, 0.75, 1.32);

    const q = a.quat;
    this.pitchRateNow = this.pitchCmd * PLAYER.pitchRate * turnFactor;
    q.multiply(_q.setFromAxisAngle(X, this.pitchRateNow * dt));
    q.multiply(_q.setFromAxisAngle(Z, -this.rollCmd * PLAYER.rollRate * dt));
    q.multiply(_q.setFromAxisAngle(Y, -this.yawCmd * PLAYER.yawRate * dt));

    // Barrel roll: a fast 360 with a sideways jink.
    this.rollCooldown -= dt;
    if (input.rollTap !== 0 && this.rollTime <= 0 && this.rollCooldown <= 0) {
      this.rollTime = PLAYER.rollDuration;
      this.rollDir = input.rollTap;
      this.rollCooldown = PLAYER.rollCooldown;
      this.lastRollAt = g.time;
      g.onPlayerBarrelRoll();
    }
    if (this.rollTime > 0) {
      const t = 1 - this.rollTime / PLAYER.rollDuration;
      a.rollVisual = this.rollDir * t * Math.PI * 2;
      a.pos.addScaledVector(a.right, this.rollDir * PLAYER.rollJink * Math.sin(t * Math.PI) * dt);
      this.rollTime -= dt;
      if (this.rollTime <= 0) a.rollVisual = 0;
    }

    a.updateBasis();
    const bank = this.bankAngle(a);
    if (bank < -0.45) this.leftBankAt = g.time;
    const horiz = Math.sqrt(Math.max(0, 1 - a.fwd.y * a.fwd.y));
    q.premultiply(_q.setFromAxisAngle(Y, -Math.sin(bank) * PLAYER.bankTurn * turnFactor * horiz * dt));
    // Gentle auto-level when hands are off.
    if (Math.abs(input.roll) < 0.05 && Math.abs(input.pitch) < 0.05 && Math.abs(bank) < 0.9 && a.up.y > 0.2 && this.rollTime <= 0) {
      q.multiply(_q.setFromAxisAngle(Z, bank * 1.1 * dt));
    }
    q.normalize();
    a.updateBasis();
    a.gLoad = Math.abs(this.pitchRateNow) * a.speed / 9.81;

    // Ceiling.
    if (a.pos.y > PLAYER.ceiling && a.fwd.y > 0) {
      q.premultiply(_q.setFromAxisAngle(a.right, -0.6 * dt)).normalize();
      a.updateBasis();
    }
    // Area limit: gently steer back.
    const r = Math.hypot(a.pos.x - g.areaCenter.x, a.pos.z - g.areaCenter.z);
    g.outOfArea = r > g.areaRadius;
    if (g.outOfArea) {
      const want = Math.atan2(g.areaCenter.x - a.pos.x, -(g.areaCenter.z - a.pos.z));
      const cur = Math.atan2(a.fwd.x, -a.fwd.z);
      let d = want - cur;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      q.premultiply(_q.setFromAxisAngle(Y, -clamp(d, -1, 1) * 0.5 * dt)).normalize();
      a.updateBasis();
    }

    a.pos.addScaledVector(a.vel, dt);
    this.collide(a, g, dt);
  }

  private collide(a: Aircraft, g: Game, dt: number) {
    this.collisionCooldown -= dt;
    const gh = g.terrain.ground(a.pos.x, a.pos.z);
    this.lastGround = gh;
    const hitGround = a.pos.y < gh + 3;
    const hitStruct = g.terrain.hitsStructure(a.pos, 4);
    if (!hitGround && !hitStruct) return;
    if (hitGround) a.pos.y = gh + 8;
    if (this.collisionCooldown <= 0) {
      this.collisionCooldown = 0.6;
      g.onPlayerCrash(gh <= 0.5 && !hitStruct ? 'sea' : hitStruct ? 'structure' : 'terrain');
    }
    // Shove the nose upward and away, whatever the attitude.
    const climb = new THREE.Vector3(a.fwd.x, 0, a.fwd.z);
    if (climb.lengthSq() < 1e-4) climb.set(0, 0, -1);
    climb.normalize().multiplyScalar(0.8).add(new THREE.Vector3(0, 0.6, 0)).normalize();
    a.quat.premultiply(_q.setFromUnitVectors(a.fwd, climb)).normalize();
    a.updateBasis();
    if (hitStruct) a.pos.addScaledVector(a.fwd, -12).y += 10;
  }
}
