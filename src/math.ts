import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const UP = new THREE.Vector3(0, 1, 0);

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Frame-rate independent exponential approach. */
export const damp = (a: number, b: number, lambda: number, dt: number) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randSign = () => (Math.random() < 0.5 ? -1 : 1);
export const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

function hash(ix: number, iy: number): number {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h & 0xffff) / 0xffff;
}

/** Smooth value noise in [-1, 1]. */
export function noise2(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);
  return (a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy) * 2 - 1;
}

export function fbm(x: number, y: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * freq + i * 17.3, y * freq - i * 9.1);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

/** Deterministic PRNG so world layout is identical every run. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function formatScore(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function formatClock(sec: number, tenths = false): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  const whole = Math.floor(r);
  const base = `${String(m).padStart(2, '0')}:${String(whole).padStart(2, '0')}`;
  return tenths ? `${base}.${Math.floor((r - whole) * 10)}` : base;
}

const _q = new THREE.Quaternion();
/** Rotate unit vector `from` toward unit vector `to` by at most `maxAngle` radians. Writes into `out`. */
export function rotateToward(from: THREE.Vector3, to: THREE.Vector3, maxAngle: number, out: THREE.Vector3): THREE.Vector3 {
  const d = clamp(from.dot(to), -1, 1);
  const angle = Math.acos(d);
  if (angle < 1e-5) return out.copy(to);
  if (angle <= maxAngle) return out.copy(to);
  const axis = new THREE.Vector3().crossVectors(from, to);
  if (axis.lengthSq() < 1e-10) axis.set(0, 1, 0);
  axis.normalize();
  _q.setFromAxisAngle(axis, maxAngle);
  return out.copy(from).applyQuaternion(_q).normalize();
}

const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _FALLBACK_UP = new THREE.Vector3(0, 0, 1);
/** Build an orientation whose local -Z is `fwd` and local +Y is as close to `up` as possible. */
export function quatFromFwdUp(fwd: THREE.Vector3, up: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  _z.copy(fwd).negate().normalize();
  _x.crossVectors(up, _z);
  if (_x.lengthSq() < 1e-8) _x.crossVectors(Math.abs(_z.y) < 0.99 ? UP : _FALLBACK_UP, _z);
  _x.normalize();
  _y.crossVectors(_z, _x).normalize();
  _m.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m);
}

export function horizontal(v: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
  out.set(v.x, 0, v.z);
  if (out.lengthSq() < 1e-8) out.set(0, 0, -1);
  return out.normalize();
}

/** Segment p0->p1 intersects sphere (c, r). */
export function segmentHitsSphere(p0: THREE.Vector3, p1: THREE.Vector3, c: THREE.Vector3, r: number): boolean {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const dz = p1.z - p0.z;
  const fx = c.x - p0.x;
  const fy = c.y - p0.y;
  const fz = c.z - p0.z;
  const len2 = dx * dx + dy * dy + dz * dz;
  const t = len2 > 0 ? clamp((fx * dx + fy * dy + fz * dz) / len2, 0, 1) : 0;
  const ex = p0.x + dx * t - c.x;
  const ey = p0.y + dy * t - c.y;
  const ez = p0.z + dz * t - c.z;
  return ex * ex + ey * ey + ez * ez <= r * r;
}

/** Heading in degrees, 0 = north (-Z), clockwise. */
export function headingDeg(fwd: THREE.Vector3): number {
  const h = Math.atan2(fwd.x, -fwd.z) / DEG;
  return (h + 360) % 360;
}
