import * as THREE from 'three';
import { damp, noise2 } from './math';
import type { Game } from './game';

export interface ShotFrame {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  up: THREE.Vector3;
  fov: number;
}
export type Shot = (t: number, out: ShotFrame) => void;

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private camQuat = new THREE.Quaternion();
  private frame: ShotFrame = { pos: new THREE.Vector3(), look: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), fov: 68 };
  shot: Shot | null = null;
  shotT = 0;
  trauma = 0;
  fov = 68;
  lookBlend = 0;
  reducedMotion = false;
  private snapNext = true;
  private shakeT = 0;
  private lookPos = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(68, aspect, 2, 45000);
  }

  snap() {
    this.snapNext = true;
  }

  play(shot: Shot | null) {
    this.shot = shot;
    this.shotT = 0;
    if (!shot) this.snapNext = true;
  }

  addTrauma(x: number) {
    this.trauma = Math.min(1, this.trauma + x * (this.reducedMotion ? 0.25 : 1));
  }

  update(dt: number, g: Game) {
    const cam = this.camera;
    const f = this.frame;
    if (this.shot) {
      this.shotT += dt;
      this.shot(this.shotT, f);
      cam.position.copy(f.pos);
      cam.up.copy(f.up);
      cam.lookAt(f.look);
      this.fov = f.fov;
    } else {
      const p = g.player;
      if (this.snapNext) {
        this.camQuat.copy(p.quat);
        this.snapNext = false;
      } else this.camQuat.slerp(p.quat, 1 - Math.exp(-7.5 * dt));
      const stretch = (p.speed - 235) * 0.032;
      const back = 25 + stretch;
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camQuat);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camQuat);
      f.pos.set(0, 6.4, back).applyQuaternion(this.camQuat).add(p.pos);
      f.look.copy(p.pos).addScaledVector(fwd, 70).addScaledVector(up, 3);
      f.up.copy(up);
      const t = g.target;
      const wantLook = g.input.lookTarget && t && t.targetable && g.controlsEnabled;
      this.lookBlend = damp(this.lookBlend, wantLook ? 1 : 0, 6, dt);
      if (this.lookBlend > 0.01 && t) {
        this.lookPos.copy(t.pos);
        const dir = new THREE.Vector3().subVectors(t.pos, p.pos).normalize();
        const altPos = p.pos.clone().addScaledVector(dir, -34).add(new THREE.Vector3(0, 9, 0));
        f.pos.lerp(altPos, this.lookBlend);
        f.look.lerp(this.lookPos, this.lookBlend);
        f.up.lerp(new THREE.Vector3(0, 1, 0), this.lookBlend).normalize();
      }
      const gh = g.terrain.ground(f.pos.x, f.pos.z);
      if (f.pos.y < gh + 3) f.pos.y = gh + 3;
      cam.position.copy(f.pos);
      cam.up.copy(f.up);
      cam.lookAt(f.look);
      const boostFov = g.pc.boosting ? 9 : g.pc.braking ? -5 : 0;
      this.fov = damp(this.fov, 68 + boostFov, 3.5, dt);
    }
    if (this.trauma > 0) {
      this.shakeT += dt * 30;
      const s = this.trauma * this.trauma;
      const amp = this.reducedMotion ? 0.3 : 1.4;
      cam.position.x += noise2(this.shakeT, 1.3) * s * amp;
      cam.position.y += noise2(this.shakeT, 7.1) * s * amp;
      cam.rotateZ(noise2(this.shakeT, 3.7) * s * 0.03);
      this.trauma = Math.max(0, this.trauma - dt * 1.5);
    }
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }
}
