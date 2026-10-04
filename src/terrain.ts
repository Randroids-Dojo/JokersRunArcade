import * as THREE from 'three';
import { clamp, fbm, lerp, mulberry32, noise2, smoothstep } from './math';
import { box, merge, place } from './geo';
import { WORLD } from './config';

// East peninsula: sea cliffs on the west face, a sea-level canyon cutting west->east,
// a suspension bridge over the canyon, open water beyond. The fleet sails north in the
// open sea to the west.

export const LAND = { x0: 5000, x1: 14000, z0: -9500, z1: 7500, cell: 30 };
const LAND_N = -8300;
const LAND_S = 6400;

export function coastW(z: number) {
  return 6500 + 380 * Math.sin(z / 2100) + 160 * Math.sin(z / 650 + 1.3) + 60 * Math.sin(z / 230 + 0.4);
}
export function coastE(z: number) {
  return 12600 + 300 * Math.sin(z / 1800 + 2.1) + 120 * Math.sin(z / 520 + 0.7);
}
export function canyonZ(x: number) {
  return -1200 + 520 * Math.sin((x - 6000) / 1250) + 180 * Math.sin((x - 6000) / 480 + 0.8);
}
export function canyonHalfWidth(x: number) {
  return 150 + 30 * Math.sin(x / 640 + 0.3);
}

/** The bridge sits where the canyon runs closest to due east so it can be axis aligned. */
export const BRIDGE_X = (() => {
  let best = 10200;
  let bestSlope = Infinity;
  for (let x = 9700; x <= 10700; x += 10) {
    const s = Math.abs(canyonZ(x + 5) - canyonZ(x - 5));
    if (s < bestSlope) {
      bestSlope = s;
      best = x;
    }
  }
  return best;
})();
export const BRIDGE_DECK_Y = 135;

interface Stack {
  x: number;
  z: number;
  r: number;
  h: number;
}
const STACKS: Stack[] = (() => {
  const rng = mulberry32(42);
  const zs = [-6200, -5400, -4300, -3500, -2700, 900, 1700, 2600, 3500, 4300, 5100];
  return zs.map((z) => {
    const zz = z + (rng() - 0.5) * 300;
    return { x: coastW(zz) - 250 - rng() * 550, z: zz, r: 35 + rng() * 40, h: 70 + rng() * 120 };
  });
})();

export function rawHeight(x: number, z: number): number {
  const dW = x - coastW(z);
  const dE = coastE(z) - x;
  const dN = z - (LAND_N + 260 * Math.sin(x / 830));
  const dS = LAND_S + 240 * Math.sin(x / 1040 + 1) - z;
  const d = Math.min(dW, dE, dN, dS);
  let h: number;
  if (d <= 0) {
    h = Math.max(-70, -6 + d * 0.12);
  } else {
    const southLow = lerp(1, 0.42, smoothstep(-500, 4500, z));
    const cliffH = (130 + 110 * (fbm(x / 1500, z / 1500, 2) * 0.5 + 0.5)) * southLow;
    h = cliffH * smoothstep(0, 70, d);
    const inland = smoothstep(60, 1400, d);
    h += inland * (120 * fbm(x / 900 + 3.1, z / 900 - 1.7, 4) + 90);
    const mt = smoothstep(700, 2600, d);
    const ridge = 1 - Math.abs(noise2(x / 2100 + 7.7, z / 2100 + 2.2));
    h += mt * Math.pow(ridge, 2.2) * 640;
    h += 14 * noise2(x / 140, z / 140) * smoothstep(0, 200, d);
  }
  for (const s of STACKS) {
    const dx = x - s.x;
    const dz = z - s.z;
    const dd = Math.sqrt(dx * dx + dz * dz);
    if (dd < s.r + 60) {
      const t = 1 - smoothstep(s.r * 0.7, s.r + 40, dd);
      h = Math.max(h, lerp(h, s.h + 12 * noise2(x / 25, z / 25), t));
    }
  }
  // Canyon: a flooded gap straight through the peninsula.
  const cz = canyonZ(x);
  const hw = canyonHalfWidth(x);
  const wall = smoothstep(hw, hw + 85, Math.abs(z - cz));
  h = lerp(Math.min(h, -14), h, wall);
  // Road saddle where the bridge meets the rim.
  const nb = 1 - smoothstep(160, 380, Math.abs(x - BRIDGE_X));
  if (nb > 0 && wall > 0.5) h = lerp(h, BRIDGE_DECK_Y + 3, nb * smoothstep(0.5, 1, wall));
  return h;
}

export interface CanyonPoint {
  pos: THREE.Vector3;
  speed: number;
}

/** Route the lead scout flies in the chase: approach, canyon, under the bridge, open water. */
export function chaseRoute(): CanyonPoint[] {
  const pts: CanyonPoint[] = [];
  const entryX = coastW(canyonZ(6400));
  for (let x = 3000; x <= WORLD.boundaryX + 1500; x += 90) {
    const z = canyonZ(x);
    let y: number;
    let speed: number;
    if (x < entryX - 900) {
      y = lerp(260, 80, smoothstep(3000, entryX - 900, x));
      speed = 285;
    } else if (x < coastE(z) + 300) {
      y = 62;
      speed = 250;
    } else {
      y = lerp(62, 90, smoothstep(coastE(z) + 300, coastE(z) + 2500, x));
      speed = 290;
    }
    pts.push({ pos: new THREE.Vector3(x, y, z), speed });
  }
  return pts;
}

export class Terrain {
  readonly nx: number;
  readonly nz: number;
  readonly heights: Float32Array;
  readonly mesh: THREE.Mesh;
  readonly bridge: THREE.Group;
  readonly colliders: THREE.Box3[] = [];
  readonly heightTexture: THREE.DataTexture;

  constructor() {
    const { x0, x1, z0, z1, cell } = LAND;
    this.nx = Math.round((x1 - x0) / cell) + 1;
    this.nz = Math.round((z1 - z0) / cell) + 1;
    const nx = this.nx;
    const nz = this.nz;
    this.heights = new Float32Array(nx * nz);
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        this.heights[iz * nx + ix] = rawHeight(x0 + ix * cell, z0 + iz * cell);
      }
    }
    this.mesh = this.buildMesh();
    this.heightTexture = this.buildHeightTexture();
    this.bridge = this.buildBridge();
  }

  /** Height of the rendered terrain surface (may be below sea level). */
  height(x: number, z: number): number {
    const { x0, z0, cell } = LAND;
    const gx = (x - x0) / cell;
    const gz = (z - z0) / cell;
    if (gx < 0 || gz < 0 || gx >= this.nx - 1 || gz >= this.nz - 1) return -60;
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;
    const i = iz * this.nx + ix;
    const ha = this.heights[i];
    const hb = this.heights[i + 1];
    const hc = this.heights[i + this.nx];
    const hd = this.heights[i + this.nx + 1];
    if (fx + fz <= 1) return ha + (hb - ha) * fx + (hc - ha) * fz;
    return hd + (hc - hd) * (1 - fx) + (hb - hd) * (1 - fz);
  }

  /** Solid surface height: terrain or the sea. */
  ground(x: number, z: number): number {
    return Math.max(0, this.height(x, z));
  }

  hitsStructure(p: THREE.Vector3, radius: number): boolean {
    for (const b of this.colliders) {
      if (
        p.x > b.min.x - radius &&
        p.x < b.max.x + radius &&
        p.y > b.min.y - radius &&
        p.y < b.max.y + radius &&
        p.z > b.min.z - radius &&
        p.z < b.max.z + radius
      )
        return true;
    }
    return false;
  }

  private buildMesh(): THREE.Mesh {
    const { x0, z0, cell } = LAND;
    const nx = this.nx;
    const nz = this.nz;
    const pos = new Float32Array(nx * nz * 3);
    const col = new Float32Array(nx * nz * 3);
    const c = new THREE.Color();
    const sand = new THREE.Color().setRGB(0.72, 0.66, 0.5, THREE.SRGBColorSpace);
    const wet = new THREE.Color().setRGB(0.3, 0.32, 0.27, THREE.SRGBColorSpace);
    const grassA = new THREE.Color().setRGB(0.27, 0.39, 0.19, THREE.SRGBColorSpace);
    const grassB = new THREE.Color().setRGB(0.42, 0.46, 0.25, THREE.SRGBColorSpace);
    const cliff = new THREE.Color().setRGB(0.56, 0.47, 0.37, THREE.SRGBColorSpace);
    const rock = new THREE.Color().setRGB(0.46, 0.45, 0.44, THREE.SRGBColorSpace);
    const snow = new THREE.Color().setRGB(0.92, 0.94, 0.97, THREE.SRGBColorSpace);
    const tmp = new THREE.Color();
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const i = iz * nx + ix;
        const x = x0 + ix * cell;
        const z = z0 + iz * cell;
        const h = this.heights[i];
        pos[i * 3] = x;
        pos[i * 3 + 1] = h;
        pos[i * 3 + 2] = z;
        const hl = this.heights[iz * nx + Math.max(0, ix - 1)];
        const hr = this.heights[iz * nx + Math.min(nx - 1, ix + 1)];
        const hu = this.heights[Math.max(0, iz - 1) * nx + ix];
        const hd = this.heights[Math.min(nz - 1, iz + 1) * nx + ix];
        const slope = Math.hypot(hr - hl, hd - hu) / (2 * cell);
        const n = noise2(x / 260, z / 260) * 0.5 + 0.5;
        c.copy(grassA).lerp(grassB, n);
        c.lerp(tmp.copy(rock), smoothstep(380, 620, h));
        c.lerp(tmp.copy(snow), smoothstep(690, 760, h) * (1 - smoothstep(0.9, 1.4, slope)));
        c.lerp(tmp.copy(h < 260 ? cliff : rock), smoothstep(0.55, 1.0, slope));
        c.lerp(tmp.copy(sand), (1 - smoothstep(4, 14, h)) * (1 - smoothstep(0.35, 0.7, slope)));
        if (h < 0) c.lerp(wet, smoothstep(0, -10, h));
        const j = 0.94 + 0.12 * (noise2(x / 41, z / 41) * 0.5 + 0.5);
        col[i * 3] = c.r * j;
        col[i * 3 + 1] = c.g * j;
        col[i * 3 + 2] = c.b * j;
      }
    }
    const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
    let k = 0;
    for (let iz = 0; iz < nz - 1; iz++) {
      for (let ix = 0; ix < nx - 1; ix++) {
        const a = iz * nx + ix;
        const b = a + 1;
        const cc = a + nx;
        const d = cc + 1;
        idx[k++] = a;
        idx[k++] = cc;
        idx[k++] = b;
        idx[k++] = b;
        idx[k++] = cc;
        idx[k++] = d;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.96, metalness: 0 });
    const mesh = new THREE.Mesh(g, mat);
    mesh.matrixAutoUpdate = false;
    return mesh;
  }

  private buildHeightTexture(): THREE.DataTexture {
    const data = new Uint8Array(this.nx * this.nz);
    for (let i = 0; i < data.length; i++) data[i] = clamp(Math.round((this.heights[i] + 40) * 2), 0, 255);
    const t = new THREE.DataTexture(data, this.nx, this.nz, THREE.RedFormat, THREE.UnsignedByteType);
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  }

  private buildBridge(): THREE.Group {
    const group = new THREE.Group();
    const cz = canyonZ(BRIDGE_X);
    const hw = canyonHalfWidth(BRIDGE_X);
    const len = hw * 2 + 560;
    const deckY = BRIDGE_DECK_Y;
    const red = 0xb23a24;
    const dark = 0x3c3f44;
    const parts: THREE.BufferGeometry[] = [];
    parts.push(place(box(26, 5, len, red), BRIDGE_X, deckY, cz));
    parts.push(place(box(24, 0.6, len, dark), BRIDGE_X, deckY + 2.8, cz));
    parts.push(place(box(30, 7, len, 0x8d3122), BRIDGE_X, deckY - 5.5, cz, 0, 0, 0, 1, 1, 1));
    const towerTop = deckY + 140;
    const towers = [cz - hw * 0.62, cz + hw * 0.62];
    for (const tz of towers) {
      for (const sx of [-12, 12]) {
        parts.push(place(box(6, towerTop + 20, 7, red), BRIDGE_X + sx, (towerTop - 20) / 2, tz));
      }
      for (const y of [deckY - 18, deckY + 55, towerTop - 6]) {
        parts.push(place(box(30, 6, 6, red), BRIDGE_X, y, tz));
      }
      parts.push(place(box(34, 8, 16, 0x6f7276), BRIDGE_X, -2, tz));
      this.colliders.push(
        new THREE.Box3(new THREE.Vector3(BRIDGE_X - 16, -30, tz - 5), new THREE.Vector3(BRIDGE_X + 16, towerTop + 2, tz + 5)),
      );
    }
    this.colliders.push(
      new THREE.Box3(new THREE.Vector3(BRIDGE_X - 15, deckY - 10, cz - len / 2), new THREE.Vector3(BRIDGE_X + 15, deckY + 4, cz + len / 2)),
    );
    // Main cables: sag between towers, anchor at the deck ends.
    const cableSpan = (zA: number, yA: number, zB: number, yB: number, sag: number, sx: number) => {
      const seg = 18;
      for (let i = 0; i < seg; i++) {
        const t0 = i / seg;
        const t1 = (i + 1) / seg;
        const za = lerp(zA, zB, t0);
        const zb = lerp(zA, zB, t1);
        const ya = lerp(yA, yB, t0) - sag * 4 * t0 * (1 - t0);
        const yb = lerp(yA, yB, t1) - sag * 4 * t1 * (1 - t1);
        const l = Math.hypot(zb - za, yb - ya);
        const g = box(1.4, 1.4, l, 0xd04a30);
        place(g, BRIDGE_X + sx, (ya + yb) / 2, (za + zb) / 2, -Math.atan2(yb - ya, zb - za), 0, 0);
        parts.push(g);
        if (i % 2 === 0) {
          const hy = (ya + deckY) / 2;
          parts.push(place(box(0.5, ya - deckY, 0.5, 0x9a3a2a), BRIDGE_X + sx, hy, za));
        }
      }
    };
    for (const sx of [-12, 12]) {
      cableSpan(towers[0], towerTop, towers[1], towerTop, 110, sx);
      cableSpan(cz - len / 2, deckY + 4, towers[0], towerTop, 18, sx);
      cableSpan(towers[1], towerTop, cz + len / 2, deckY + 4, 18, sx);
    }
    const geo = merge(parts);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.7, metalness: 0.2 }),
    );
    group.add(mesh);
    return group;
  }
}

export { STACKS };
