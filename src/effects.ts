import * as THREE from 'three';
import { ParticleSystem } from './particles';
import { rand } from './math';

interface Debris {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  emit: number;
  big: boolean;
}

export class Effects {
  readonly fire = new ParticleSystem(9000, true);
  readonly smoke = new ParticleSystem(7000, false);
  private lights: { light: THREE.PointLight; t: number; peak: number }[] = [];
  private debris: Debris[] = [];
  readonly trails: TrailBatch;
  /** Cheap ground height lookup so debris can splash. */
  groundAt: (x: number, z: number) => number = () => 0;

  constructor(scene: THREE.Scene) {
    scene.add(this.fire.points, this.smoke.points);
    for (let i = 0; i < 3; i++) {
      const light = new THREE.PointLight(0xffa050, 0, 900, 1.6);
      scene.add(light);
      this.lights.push({ light, t: 0, peak: 0 });
    }
    this.trails = new TrailBatch(64, 36);
    scene.add(this.trails.mesh);
  }

  setViewport(h: number, fov: number) {
    this.fire.setScale(h, fov);
    this.smoke.setScale(h, fov);
  }

  flash(pos: THREE.Vector3, peak: number) {
    let slot = this.lights[0];
    for (const l of this.lights) if (l.t <= 0 || l.peak * l.t < slot.peak * slot.t) slot = l;
    slot.light.position.copy(pos);
    slot.t = 1;
    slot.peak = peak;
  }

  explosion(pos: THREE.Vector3, scale = 1, vel?: THREE.Vector3) {
    const vx = vel ? vel.x * 0.25 : 0;
    const vy = vel ? vel.y * 0.25 : 0;
    const vz = vel ? vel.z * 0.25 : 0;
    const f = this.fire;
    f.emit(pos.x, pos.y, pos.z, vx, vy, vz, 0.18, 30 * scale, 70 * scale, 1, 0.95, 0.8, 1, 0.6, 0.2, 1, 0, 0, 0);
    for (let i = 0; i < 30; i++) {
      const d = randomDir();
      const sp = rand(25, 85) * scale;
      f.emit(pos.x, pos.y, pos.z, vx + d.x * sp, vy + d.y * sp, vz + d.z * sp, rand(0.5, 1.1), 7 * scale, rand(18, 30) * scale, 1, 0.85, 0.45, 0.85, 0.22, 0.04, 1, 0, 2.4, 6);
    }
    for (let i = 0; i < 18; i++) {
      const d = randomDir();
      const sp = rand(120, 240) * scale;
      f.emit(pos.x, pos.y, pos.z, vx + d.x * sp, vy + d.y * sp, vz + d.z * sp, rand(0.5, 1.2), 2.5, 1.2, 1, 0.8, 0.4, 1, 0.35, 0.1, 1, 0, 1.2, -50);
    }
    for (let i = 0; i < 20; i++) {
      const d = randomDir();
      const sp = rand(15, 45) * scale;
      const g = rand(0.16, 0.3);
      this.smoke.emit(
        pos.x + d.x * 4 * scale,
        pos.y + d.y * 4 * scale,
        pos.z + d.z * 4 * scale,
        vx + d.x * sp,
        vy + d.y * sp,
        vz + d.z * sp,
        rand(2.5, 4.5),
        12 * scale,
        rand(45, 75) * scale,
        g,
        g,
        g,
        g + 0.25,
        g + 0.25,
        g + 0.27,
        0.75,
        0,
        1.3,
        5,
      );
    }
    this.flash(pos, 40 * scale);
  }

  burningDebris(pos: THREE.Vector3, vel: THREE.Vector3, count: number) {
    for (let i = 0; i < count; i++) {
      const d = randomDir();
      this.debris.push({
        pos: pos.clone(),
        vel: vel.clone().multiplyScalar(0.4).addScaledVector(d, rand(40, 110)),
        life: rand(2.5, 5),
        emit: 0,
        big: i === 0,
      });
    }
  }

  hitSparks(pos: THREE.Vector3, vel?: THREE.Vector3, big = false) {
    const n = big ? 10 : 4;
    for (let i = 0; i < n; i++) {
      const d = randomDir();
      const sp = rand(40, 120);
      this.fire.emit(
        pos.x,
        pos.y,
        pos.z,
        (vel?.x ?? 0) * 0.5 + d.x * sp,
        (vel?.y ?? 0) * 0.5 + d.y * sp,
        (vel?.z ?? 0) * 0.5 + d.z * sp,
        rand(0.15, 0.35),
        big ? 5 : 3,
        0.5,
        1,
        0.9,
        0.55,
        1,
        0.45,
        0.1,
        1,
        0,
        2,
        0,
      );
    }
    this.fire.emit(pos.x, pos.y, pos.z, 0, 0, 0, 0.08, big ? 14 : 8, 2, 1, 1, 0.8, 1, 0.6, 0.3, 1, 0);
  }

  damageSmoke(pos: THREE.Vector3, vel: THREE.Vector3, severity: number) {
    const g = 0.18;
    this.smoke.emit(pos.x, pos.y, pos.z, vel.x * 0.2, vel.y * 0.2 + 3, vel.z * 0.2, 1.6 + severity, 4, 16 + 14 * severity, g, g, g, 0.35, 0.35, 0.36, 0.45 * severity + 0.15, 0, 0.6, 4);
    if (severity > 0.6) {
      this.fire.emit(pos.x, pos.y, pos.z, vel.x * 0.3, vel.y * 0.3, vel.z * 0.3, 0.25, 4, 7, 1, 0.7, 0.3, 0.9, 0.2, 0.05, 0.9, 0, 0.5, 0);
    }
  }

  missileSmoke(pos: THREE.Vector3, dir: THREE.Vector3, speed: number) {
    const back = rand(0, 6);
    const x = pos.x - dir.x * (2 + back);
    const y = pos.y - dir.y * (2 + back);
    const z = pos.z - dir.z * (2 + back);
    this.smoke.emit(x, y, z, rand(-2, 2), rand(-2, 2), rand(-2, 2), rand(2.4, 3.4), 2.2, rand(13, 19), 0.93, 0.94, 0.95, 0.8, 0.82, 0.86, 0.65, 0, 0.5, 1.5);
    this.fire.emit(pos.x - dir.x * 2, pos.y - dir.y * 2, pos.z - dir.z * 2, -dir.x * speed * 0.05, -dir.y * speed * 0.05, -dir.z * speed * 0.05, 0.07, 4, 1.5, 1, 0.85, 0.5, 1, 0.4, 0.1, 1, 0);
  }

  muzzle(pos: THREE.Vector3, vel: THREE.Vector3) {
    this.fire.emit(pos.x, pos.y, pos.z, vel.x, vel.y, vel.z, 0.05, 3.5, 1, 1, 0.9, 0.6, 1, 0.6, 0.2, 1, 0);
  }

  splash(pos: THREE.Vector3, scale = 1) {
    for (let i = 0; i < 24; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(5, 25) * scale;
      const up = rand(30, 90) * scale;
      const w = rand(0.85, 1);
      this.smoke.emit(pos.x, 1, pos.z, Math.cos(a) * sp, up, Math.sin(a) * sp, rand(1.5, 2.8), 6 * scale, 26 * scale, w, w, w, 0.8, 0.85, 0.9, 0.85, 0, 0.6, -45);
    }
  }

  dust(pos: THREE.Vector3) {
    const g = 0.45;
    this.smoke.emit(pos.x, pos.y + 1, pos.z, 0, 6, 0, 1.2, 3, 10, g, g * 0.95, g * 0.85, 0.5, 0.48, 0.45, 0.6, 0);
  }

  flareBurst(pos: THREE.Vector3) {
    this.fire.emit(pos.x, pos.y, pos.z, 0, 0, 0, 0.12, 18, 4, 1, 1, 0.9, 1, 0.8, 0.5, 1, 0);
  }

  flareTrail(pos: THREE.Vector3) {
    this.fire.emit(pos.x, pos.y, pos.z, 0, 0, 0, 0.18, 6, 2, 1, 0.95, 0.75, 1, 0.6, 0.25, 1, 0);
    this.smoke.emit(pos.x, pos.y, pos.z, 0, 2, 0, 1.6, 2, 9, 0.9, 0.9, 0.9, 0.8, 0.8, 0.8, 0.45, 0, 0.4, 1);
  }

  steam(pos: THREE.Vector3) {
    this.smoke.emit(pos.x + rand(-3, 3), pos.y, pos.z + rand(-6, 6), rand(-2, 2), rand(4, 9), rand(-2, 2), rand(0.8, 1.6), 3, 12, 0.95, 0.95, 0.95, 0.9, 0.9, 0.92, 0.5, 0, 0.8, 2);
  }

  update(dt: number) {
    this.fire.update(dt);
    this.smoke.update(dt);
    for (const l of this.lights) {
      if (l.t > 0) {
        l.t = Math.max(0, l.t - dt * 3.2);
        l.light.intensity = l.peak * l.t * l.t * 1000;
      } else l.light.intensity = 0;
    }
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      d.vel.y -= 30 * dt;
      d.vel.multiplyScalar(Math.exp(-0.4 * dt));
      d.pos.addScaledVector(d.vel, dt);
      d.emit -= dt;
      if (d.emit <= 0) {
        d.emit = 0.035;
        this.fire.emit(d.pos.x, d.pos.y, d.pos.z, 0, 0, 0, 0.3, d.big ? 6 : 3.5, 1.5, 1, 0.75, 0.3, 0.9, 0.25, 0.05, 1, 0);
        const g = 0.15;
        this.smoke.emit(d.pos.x, d.pos.y, d.pos.z, 0, 3, 0, 2.2, 3, d.big ? 18 : 11, g, g, g, 0.3, 0.3, 0.32, 0.6, 0, 0.3, 3);
      }
      const gh = this.groundAt(d.pos.x, d.pos.z);
      if (d.pos.y <= gh || d.life <= 0) {
        if (d.pos.y <= gh + 2) {
          if (gh <= 0.5) this.splash(d.pos, d.big ? 0.8 : 0.4);
          else this.dust(d.pos);
        }
        this.debris.splice(i, 1);
      }
    }
  }

  clear() {
    this.fire.clear();
    this.smoke.clear();
    this.debris.length = 0;
    this.trails.clear();
  }
}

const _d = new THREE.Vector3();
function randomDir(): THREE.Vector3 {
  do {
    _d.set(rand(-1, 1), rand(-1, 1), rand(-1, 1));
  } while (_d.lengthSq() > 1 || _d.lengthSq() < 0.01);
  return _d.normalize();
}

// ---------------------------------------------------------------- Ribbon trails

/** All vapour trails share one geometry and one draw call. */
export class TrailBatch {
  readonly mesh: THREE.Mesh;
  private points: Float32Array;
  private strength: Float32Array;
  private heads: Int32Array;
  private counts: Int32Array;
  private used: boolean[];
  private geo: THREE.BufferGeometry;
  private posAttr: THREE.BufferAttribute;
  private alphaAttr: THREE.BufferAttribute;
  readonly maxTrails: number;
  readonly len: number;
  life = 0.9;

  constructor(maxTrails: number, len: number) {
    this.maxTrails = maxTrails;
    this.len = len;
    this.points = new Float32Array(maxTrails * len * 3);
    this.strength = new Float32Array(maxTrails * len);
    this.heads = new Int32Array(maxTrails);
    this.counts = new Int32Array(maxTrails);
    this.used = new Array(maxTrails).fill(false);
    const verts = maxTrails * len * 2;
    this.geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(verts * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(new Float32Array(verts), 1).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.posAttr);
    this.geo.setAttribute('alpha', this.alphaAttr);
    const idx: number[] = [];
    for (let t = 0; t < maxTrails; t++) {
      for (let i = 0; i < len - 1; i++) {
        const a = (t * len + i) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    this.geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        attribute float alpha; varying float vA;
        void main() { vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() { gl_FragColor = vec4(0.97, 0.98, 1.0, vA); }`,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
  }

  alloc(): number {
    for (let i = 0; i < this.maxTrails; i++) {
      if (!this.used[i]) {
        this.used[i] = true;
        this.counts[i] = 0;
        this.heads[i] = 0;
        return i;
      }
    }
    return -1;
  }

  free(id: number) {
    if (id >= 0) {
      this.used[id] = false;
      this.counts[id] = 0;
    }
  }

  push(id: number, p: THREE.Vector3, strength: number) {
    if (id < 0) return;
    const h = (this.heads[id] + 1) % this.len;
    this.heads[id] = h;
    const k = id * this.len + h;
    this.points[k * 3] = p.x;
    this.points[k * 3 + 1] = p.y;
    this.points[k * 3 + 2] = p.z;
    this.strength[k] = strength;
    this.counts[id] = Math.min(this.len, this.counts[id] + 1);
  }

  private readPoint(t: number, i: number, out: THREE.Vector3) {
    const k = t * this.len + ((this.heads[t] - i + this.len) % this.len);
    return out.set(this.points[k * 3], this.points[k * 3 + 1], this.points[k * 3 + 2]);
  }

  update(camPos: THREE.Vector3) {
    const pa = this.posAttr.array as Float32Array;
    const aa = this.alphaAttr.array as Float32Array;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const side = new THREE.Vector3();
    const toCam = new THREE.Vector3();
    for (let t = 0; t < this.maxTrails; t++) {
      const n = this.counts[t];
      // i = 0 is the newest point.
      for (let i = 0; i < this.len; i++) {
        const v = (t * this.len + i) * 2;
        if (i >= n) {
          aa[v] = 0;
          aa[v + 1] = 0;
          if (i > 0) pa.copyWithin(v * 3, (v - 2) * 3, (v - 2) * 3 + 6);
          continue;
        }
        const k = t * this.len + ((this.heads[t] - i + this.len) % this.len);
        this.readPoint(t, i, a);
        if (n < 2) dir.set(0, 0, 1);
        else if (i < n - 1) dir.subVectors(this.readPoint(t, i + 1, b), a);
        else dir.subVectors(a, this.readPoint(t, i - 1, b));
        toCam.subVectors(camPos, a);
        side.crossVectors(dir, toCam);
        const sl = side.length();
        const width = 0.25 + i * 0.045;
        if (sl > 1e-6) side.multiplyScalar(width / sl);
        pa[v * 3] = a.x + side.x;
        pa[v * 3 + 1] = a.y + side.y;
        pa[v * 3 + 2] = a.z + side.z;
        pa[v * 3 + 3] = a.x - side.x;
        pa[v * 3 + 4] = a.y - side.y;
        pa[v * 3 + 5] = a.z - side.z;
        const fade = 1 - i / this.len;
        const near = Math.min(1, Math.max(0, (toCam.length() - 12) / 40));
        const al = this.strength[k] * fade * 0.32 * near;
        aa[v] = al;
        aa[v + 1] = al;
      }
    }
    this.posAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
  }

  clear() {
    this.counts.fill(0);
    this.used.fill(false);
  }
}
