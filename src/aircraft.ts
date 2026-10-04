import * as THREE from 'three';
import { AircraftModel } from './models';
import type { Game } from './game';
import type { Missile } from './weapons';

export type Team = 'blue' | 'red';
export type Kind = 'player' | 'wingman' | 'fighter' | 'scout' | 'drone' | 'ace';
export type Weapon = 'gun' | 'missile';

export interface Brain {
  update(a: Aircraft, g: Game, dt: number): void;
  /** Return true if the incoming missile was evaded (it will lose its lock). */
  onMissileIncoming?(a: Aircraft, m: Missile, g: Game): boolean;
  onHit?(a: Aircraft, g: Game, weapon: Weapon): void;
}

let nextId = 1;

export class Aircraft {
  readonly id = nextId++;
  readonly kind: Kind;
  readonly team: Team;
  label: string;
  callsign = '';
  readonly model: AircraftModel;
  readonly pos = new THREE.Vector3();
  readonly quat = new THREE.Quaternion();
  readonly vel = new THREE.Vector3();
  readonly fwd = new THREE.Vector3(0, 0, -1);
  readonly up = new THREE.Vector3(0, 1, 0);
  readonly right = new THREE.Vector3(1, 0, 0);
  speed = 200;
  throttle = 0.5;
  hp = 100;
  maxHp = 100;
  radius = 11;
  alive = true;
  hidden = false;
  frozen = false;
  invulnerable = false;
  /** Damage from non-player sources cannot push hp below this fraction. */
  hpFloorFromOthers = 0;
  missionTarget = false;
  /** Cannot be missile-locked. */
  ecm = false;
  /** Deflects missiles that get close. */
  missileJammer = false;
  /** Damage taken is multiplied by this. */
  armor = 1;
  brain: Brain | null = null;
  flares = 0;
  flareCooldown = 0;
  gunCooldown = 0;
  missileCooldown = 0;
  /** Recon upload 0..1 and pause timer. */
  upload = 0;
  uploadPause = 0;
  lastHitTime = -100;
  lastHitWeapon: Weapon | null = null;
  lastHitByPlayer = false;
  lastHitDist = 0;
  wreck = false;
  wreckTime = 0;
  wreckSpin = 0;
  wreckEmit = 0;
  readonly wreckVel = new THREE.Vector3();
  whooshCooldown = 0;
  smokeTimer = 0;
  gLoad = 0;
  vaporTrails: [number, number] = [-1, -1];
  /** Visual roll offset (barrel rolls). */
  rollVisual = 0;
  /** Free-form tag used by the mission script. */
  tag = '';

  constructor(kind: Kind, team: Team, model: AircraftModel, label: string) {
    this.kind = kind;
    this.team = team;
    this.model = model;
    this.label = label;
  }

  get mesh() {
    return this.model.root;
  }

  updateBasis() {
    this.fwd.set(0, 0, -1).applyQuaternion(this.quat);
    this.up.set(0, 1, 0).applyQuaternion(this.quat);
    this.right.set(1, 0, 0).applyQuaternion(this.quat);
    this.vel.copy(this.fwd).multiplyScalar(this.speed);
  }

  get targetable() {
    return this.alive && !this.hidden && !this.frozen;
  }

  syncMesh(time: number) {
    const m = this.model.root;
    m.visible = !this.hidden && !this.frozen;
    m.position.copy(this.pos);
    m.quaternion.copy(this.quat);
    if (this.rollVisual !== 0) {
      m.rotateZ(-this.rollVisual);
    }
    const flick = 0.85 + 0.15 * Math.sin(time * 60 + this.id);
    for (const b of this.model.burners) {
      const len = this.alive ? (1.2 + this.throttle * 4.2) * flick : 0.001;
      b.scale.set(1, 1, len);
    }
    if (this.model.radome) this.model.radome.rotation.y = time * 1.6;
  }
}
