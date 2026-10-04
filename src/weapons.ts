import * as THREE from 'three';
import { Aircraft, Team } from './aircraft';
import { buildMissile } from './models';
import { clamp, rand, rotateToward, segmentHitsSphere } from './math';
import type { Game } from './game';

export interface Bullet {
  active: boolean;
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  team: Team;
  owner: Aircraft | null;
  damage: number;
}

export interface MissileSpec {
  maxSpeed: number;
  accel: number;
  turn: number;
  life: number;
  damage: number;
  proximity: number;
}

export class Missile {
  active = false;
  readonly pos = new THREE.Vector3();
  readonly dir = new THREE.Vector3(0, 0, -1);
  speed = 0;
  spec!: MissileSpec;
  target: Aircraft | null = null;
  owner: Aircraft | null = null;
  team: Team = 'blue';
  life = 0;
  age = 0;
  smokeTimer = 0;
  evadeChecked = false;
  /** Fooled by flares or a dodge: the fuse ignores aircraft from now on. */
  spoofed = false;
  decoy: THREE.Vector3 | null = null;
  readonly root: THREE.Group;
  readonly flame: THREE.Object3D;
  constructor() {
    const m = buildMissile();
    this.root = m.root;
    this.flame = m.flame;
    this.root.visible = false;
  }
}

export interface Flare {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
}

const tracerColors: Record<Team, THREE.Color> = {
  blue: new THREE.Color(1.6, 1.25, 0.55),
  red: new THREE.Color(1.6, 0.4, 0.25),
};

export class Weapons {
  readonly bullets: Bullet[] = [];
  readonly missiles: Missile[] = [];
  readonly flares: Flare[] = [];
  private tracers: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private zAxis = new THREE.Vector3(0, 0, 1);

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < 900; i++) {
      this.bullets.push({
        active: false,
        pos: new THREE.Vector3(),
        prev: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        life: 0,
        team: 'blue',
        owner: null,
        damage: 0,
      });
    }
    const tg = new THREE.BoxGeometry(0.45, 0.45, 1);
    const tm = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.tracers = new THREE.InstancedMesh(tg, tm, this.bullets.length);
    this.tracers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tracers.setColorAt(0, tracerColors.blue);
    this.tracers.frustumCulled = false;
    this.tracers.count = 0;
    scene.add(this.tracers);
    for (let i = 0; i < 48; i++) {
      const m = new Missile();
      scene.add(m.root);
      this.missiles.push(m);
    }
  }

  fireBullet(owner: Aircraft, origin: THREE.Vector3, dir: THREE.Vector3, speed: number, damage: number, life: number) {
    const b = this.bullets.find((x) => !x.active);
    if (!b) return;
    b.active = true;
    b.pos.copy(origin);
    b.prev.copy(origin);
    b.vel.copy(dir).multiplyScalar(speed).addScaledVector(owner.fwd, owner.speed);
    b.life = life;
    b.team = owner.team;
    b.owner = owner;
    b.damage = damage;
  }

  fireMissile(owner: Aircraft, target: Aircraft | null, spec: MissileSpec, launchSpeedBonus: number): Missile | null {
    const m = this.missiles.find((x) => !x.active);
    if (!m) return null;
    m.active = true;
    m.spec = spec;
    m.owner = owner;
    m.team = owner.team;
    m.target = target;
    m.decoy = null;
    m.evadeChecked = false;
    m.spoofed = false;
    m.life = spec.life;
    m.age = 0;
    m.speed = owner.speed + launchSpeedBonus;
    m.dir.copy(owner.fwd);
    m.pos.copy(owner.pos).addScaledVector(owner.up, -1.6).addScaledVector(owner.right, rand(-2, 2));
    m.root.visible = true;
    return m;
  }

  dropFlares(owner: Aircraft) {
    for (let i = 0; i < 4; i++) {
      this.flares.push({
        pos: owner.pos.clone().addScaledVector(owner.fwd, -6),
        vel: owner.fwd
          .clone()
          .multiplyScalar(owner.speed * 0.35)
          .addScaledVector(owner.right, (i % 2 === 0 ? -1 : 1) * rand(25, 60))
          .addScaledVector(owner.up, rand(-30, 10)),
        life: rand(2.2, 3.2),
      });
    }
  }

  update(dt: number, g: Game) {
    const aircraft = g.aircraft;
    // Bullets.
    for (const b of this.bullets) {
      if (!b.active) continue;
      b.prev.copy(b.pos);
      b.vel.y -= 4 * dt;
      b.pos.addScaledVector(b.vel, dt);
      b.life -= dt;
      if (b.life <= 0) {
        b.active = false;
        continue;
      }
      for (const a of aircraft) {
        if (a.team === b.team || !a.alive || a.hidden || a.frozen) continue;
        if (segmentHitsSphere(b.prev, b.pos, a.pos, a.radius * (b.team === 'blue' ? 1.15 : 0.8))) {
          b.active = false;
          g.onBulletHit(a, b);
          break;
        }
      }
      if (!b.active) continue;
      const gh = g.terrain.ground(b.pos.x, b.pos.z);
      if (b.pos.y < gh) {
        b.active = false;
        if (Math.random() < 0.35) {
          if (gh <= 0.1) g.fx.smoke.emit(b.pos.x, 0.5, b.pos.z, 0, 12, 0, 0.6, 1.5, 5, 0.95, 0.95, 0.95, 0.9, 0.9, 0.9, 0.7, 0, 1, -10);
          else g.fx.dust(b.pos);
        }
      }
    }
    // Flares.
    for (let i = this.flares.length - 1; i >= 0; i--) {
      const f = this.flares[i];
      f.life -= dt;
      f.vel.y -= 25 * dt;
      f.vel.multiplyScalar(Math.exp(-1.2 * dt));
      f.pos.addScaledVector(f.vel, dt);
      g.fx.flareTrail(f.pos);
      if (f.life <= 0) this.flares.splice(i, 1);
    }
    // Missiles.
    const toT = new THREE.Vector3();
    const desired = new THREE.Vector3();
    const aim = new THREE.Vector3();
    for (const m of this.missiles) {
      if (!m.active) continue;
      m.age += dt;
      m.life -= dt;
      m.speed = Math.min(m.spec.maxSpeed, m.speed + m.spec.accel * dt);
      const t = m.target;
      if (t && (!t.alive || t.hidden || t.frozen)) m.target = null;
      if (m.target) {
        const tgt = m.target;
        toT.subVectors(tgt.pos, m.pos);
        const dist = toT.length();
        // Missiles that overshoot lose their lock.
        if (toT.dot(m.dir) < -0.2 * dist && dist > 60) {
          m.target = null;
        } else {
          const closing = Math.max(80, m.speed - tgt.vel.dot(toT) / Math.max(dist, 1));
          const tGo = clamp(dist / closing, 0, 3);
          aim.copy(tgt.pos).addScaledVector(tgt.vel, tGo * 0.9);
          desired.subVectors(aim, m.pos).normalize();
          const turn = m.age < 0.2 ? m.spec.turn * 0.3 : m.spec.turn;
          rotateToward(m.dir, desired, turn * dt, m.dir);
          if (!m.evadeChecked && dist < 650 && tgt.brain?.onMissileIncoming) {
            m.evadeChecked = true;
            if (tgt.brain.onMissileIncoming(tgt, m, g)) this.spoof(m, tgt);
          }
          if (tgt.missileJammer && dist < 320) {
            this.spoof(m, tgt);
            m.dir.addScaledVector(tgt.up, 0.6).normalize();
            g.onMissileJammed(tgt, m);
          }
        }
      } else if (m.decoy) {
        desired.subVectors(m.decoy, m.pos).normalize();
        rotateToward(m.dir, desired, m.spec.turn * 0.6 * dt, m.dir);
      }
      const prev = toT.copy(m.pos);
      m.pos.addScaledVector(m.dir, m.speed * dt);
      m.smokeTimer -= dt;
      if (m.smokeTimer <= 0) {
        m.smokeTimer = 0.012;
        g.fx.missileSmoke(m.pos, m.dir, m.speed);
      }
      // Proximity fuse against anything hostile.
      let detonated = false;
      for (const a of aircraft) {
        if (m.spoofed || m.age < 0.15) break;
        if (a.team === m.team || !a.alive || a.hidden || a.frozen) continue;
        if (segmentHitsSphere(prev, m.pos, a.pos, a.radius * 0.6 + m.spec.proximity)) {
          g.onMissileHit(a, m);
          detonated = true;
          break;
        }
      }
      if (!detonated) {
        const gh = g.terrain.ground(m.pos.x, m.pos.z);
        if (m.pos.y < gh + 1 || g.terrain.hitsStructure(m.pos, 1)) {
          g.onMissileGround(m);
          detonated = true;
        } else if (m.life <= 0) {
          g.fx.explosion(m.pos, 0.35);
          detonated = true;
        }
      }
      if (detonated) this.deactivate(m);
      else {
        m.root.position.copy(m.pos);
        m.root.quaternion.setFromUnitVectors(this.zAxis, desired.copy(m.dir).negate());
        m.flame.scale.z = 2.5 + Math.random() * 1.5;
      }
    }
  }

  /** Break the lock and send the missile wide so it can no longer connect. */
  spoof(m: Missile, from: Aircraft) {
    m.target = null;
    m.spoofed = true;
    m.decoy = this.flares.length ? this.flares[this.flares.length - 1].pos : null;
    const side = new THREE.Vector3().subVectors(m.pos, from.pos).cross(from.up).normalize();
    if (side.lengthSq() > 0.5) m.dir.addScaledVector(side, 0.25).normalize();
  }

  deactivate(m: Missile) {
    m.active = false;
    m.root.visible = false;
    m.target = null;
  }

  /** Called per render frame to rebuild tracer instances. */
  render() {
    let n = 0;
    for (const b of this.bullets) {
      if (!b.active) continue;
      const sp = b.vel.length();
      const len = Math.min(34, sp * 0.026);
      this.dummy.position.copy(b.pos).addScaledVector(b.vel, -0.013);
      this.dummy.quaternion.setFromUnitVectors(this.zAxis, toDir.copy(b.vel).divideScalar(sp));
      this.dummy.scale.set(1, 1, len);
      this.dummy.updateMatrix();
      this.tracers.setMatrixAt(n, this.dummy.matrix);
      this.tracers.setColorAt(n, tracerColors[b.team]);
      n++;
    }
    this.tracers.count = n;
    this.tracers.instanceMatrix.needsUpdate = true;
    if (this.tracers.instanceColor) this.tracers.instanceColor.needsUpdate = true;
  }

  clear() {
    for (const b of this.bullets) b.active = false;
    for (const m of this.missiles) this.deactivate(m);
    this.flares.length = 0;
    this.tracers.count = 0;
  }

  incomingMissiles(target: Aircraft): Missile[] {
    return this.missiles.filter((m) => m.active && m.target === target);
  }
}

const toDir = new THREE.Vector3();
