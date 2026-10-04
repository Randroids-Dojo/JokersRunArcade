import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Procedural low-poly parts. Every part is converted to non-indexed geometry with a
// per-vertex colour so a whole model merges into one draw call.

type ColorLike = number | THREE.Color;

const tmpColor = new THREE.Color();

export function paint(geo: THREE.BufferGeometry, color: ColorLike): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  g.deleteAttribute('uv1');
  const n = g.getAttribute('position').count;
  const c = typeof color === 'number' ? tmpColor.setHex(color) : tmpColor.copy(color);
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  return g;
}

export function place(
  geo: THREE.BufferGeometry,
  x = 0,
  y = 0,
  z = 0,
  rx = 0,
  ry = 0,
  rz = 0,
  sx = 1,
  sy = 1,
  sz = 1,
): THREE.BufferGeometry {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
  geo.applyMatrix4(m);
  return geo;
}

export function box(w: number, h: number, d: number, color: ColorLike): THREE.BufferGeometry {
  return paint(new THREE.BoxGeometry(w, h, d), color);
}

/** Cylinder aligned with Z (length along z). */
export function tubeZ(rFront: number, rBack: number, len: number, seg: number, color: ColorLike): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rBack, rFront, len, seg, 1, false);
  g.rotateX(-Math.PI / 2);
  return paint(g, color);
}

export function cyl(rTop: number, rBot: number, h: number, seg: number, color: ColorLike): THREE.BufferGeometry {
  return paint(new THREE.CylinderGeometry(rTop, rBot, h, seg), color);
}

export function sphere(r: number, ws: number, hs: number, color: ColorLike, phiLen = Math.PI * 2, thetaLen = Math.PI): THREE.BufferGeometry {
  return paint(new THREE.SphereGeometry(r, ws, hs, 0, phiLen, 0, thetaLen), color);
}

export interface Section {
  z: number;
  w: number;
  h: number;
  y?: number;
}

/** Fuselage-style loft through elliptical cross sections along Z. */
export function loft(sections: Section[], seg: number, color: ColorLike): THREE.BufferGeometry {
  const pos: number[] = [];
  const ring = (s: Section, i: number): [number, number, number] => {
    const a = (i / seg) * Math.PI * 2;
    return [Math.cos(a) * s.w, (s.y ?? 0) + Math.sin(a) * s.h, s.z];
  };
  for (let k = 0; k < sections.length - 1; k++) {
    const s0 = sections[k];
    const s1 = sections[k + 1];
    for (let i = 0; i < seg; i++) {
      const a0 = ring(s0, i);
      const a1 = ring(s0, i + 1);
      const b0 = ring(s1, i);
      const b1 = ring(s1, i + 1);
      // Front section has smaller z (nose at -Z). Outward winding.
      pos.push(...a0, ...a1, ...b0, ...a1, ...b1, ...b0);
    }
  }
  const capTri = (s: Section, flip: boolean) => {
    const c: [number, number, number] = [0, s.y ?? 0, s.z];
    for (let i = 0; i < seg; i++) {
      const p0 = ring(s, i);
      const p1 = ring(s, i + 1);
      if (flip) pos.push(...c, ...p1, ...p0);
      else pos.push(...c, ...p0, ...p1);
    }
  };
  capTri(sections[0], true);
  capTri(sections[sections.length - 1], false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return paint(g, color);
}

/**
 * Flat polygon slab. `pts` are [a, b] coordinates in the plane spanned by axes
 * (u, v); thickness extends along the remaining axis. plane: 'xz' (wings), 'zy' (fins).
 */
export function slab(pts: [number, number][], thickness: number, color: ColorLike, plane: 'xz' | 'zy' = 'xz'): THREE.BufferGeometry {
  const to3 = (a: number, b: number, t: number): [number, number, number] =>
    plane === 'xz' ? [a, t, b] : [t, b, a];
  const h = thickness / 2;
  const pos: number[] = [];
  const n = pts.length;
  for (let i = 1; i < n - 1; i++) {
    pos.push(...to3(pts[0][0], pts[0][1], h), ...to3(pts[i][0], pts[i][1], h), ...to3(pts[i + 1][0], pts[i + 1][1], h));
    pos.push(...to3(pts[0][0], pts[0][1], -h), ...to3(pts[i + 1][0], pts[i + 1][1], -h), ...to3(pts[i][0], pts[i][1], -h));
  }
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const a0 = to3(a[0], a[1], h);
    const b0 = to3(b[0], b[1], h);
    const a1 = to3(a[0], a[1], -h);
    const b1 = to3(b[0], b[1], -h);
    pos.push(...a0, ...b0, ...a1, ...b0, ...b1, ...a1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p[0];
    cy += p[1];
  }
  const c = to3(cx / n, cy / n, 0);
  fixWinding(g, new THREE.Vector3(c[0], c[1], c[2]));
  g.computeVertexNormals();
  return paint(g, color);
}

/** Orient every triangle so its normal points away from `center` (valid for convex-ish shapes). */
function fixWinding(g: THREE.BufferGeometry, center: THREE.Vector3) {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const m = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(p, i + 1);
    c.fromBufferAttribute(p, i + 2);
    n.subVectors(b, a).cross(m.subVectors(c, a));
    m.copy(a).add(b).add(c).divideScalar(3).sub(center);
    if (n.dot(m) < 0) {
      p.setXYZ(i + 1, c.x, c.y, c.z);
      p.setXYZ(i + 2, b.x, b.y, b.z);
    }
  }
}

export function mirrorX(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.clone();
  g.scale(-1, 1, 1);
  // Restore outward winding after the reflection.
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i += 3) {
    const bx = p.getX(i + 1), by = p.getY(i + 1), bz = p.getZ(i + 1);
    p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
    p.setXYZ(i + 2, bx, by, bz);
  }
  const c = g.getAttribute('color') as THREE.BufferAttribute;
  for (let i = 0; i < c.count; i += 3) {
    const r = c.getX(i + 1), gg = c.getY(i + 1), bb = c.getZ(i + 1);
    c.setXYZ(i + 1, c.getX(i + 2), c.getY(i + 2), c.getZ(i + 2));
    c.setXYZ(i + 2, r, gg, bb);
  }
  g.computeVertexNormals();
  return g;
}

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  for (const p of parts) {
    for (const name of Object.keys(p.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'color') p.deleteAttribute(name);
    }
    if (!p.getAttribute('normal')) p.computeVertexNormals();
  }
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error('mergeGeometries failed');
  g.computeBoundingSphere();
  return g;
}

export function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  draw(ctx);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
