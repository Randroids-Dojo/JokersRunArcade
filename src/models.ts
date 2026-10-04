import * as THREE from 'three';
import { box, cyl, loft, merge, mirrorX, paint, place, slab, sphere, tubeZ, canvasTexture } from './geo';

export type ModelKind = 'joker' | 'enemy' | 'ace' | 'scout' | 'drone';

const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.55, metalness: 0.35 });
const shipMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, metalness: 0.15 });

export const burnerMat = new THREE.MeshBasicMaterial({
  color: 0xff9a3c,
  transparent: true,
  opacity: 0.9,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  toneMapped: false,
});
export const burnerCoreMat = new THREE.MeshBasicMaterial({
  color: 0xbfe0ff,
  transparent: true,
  opacity: 0.95,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  toneMapped: false,
});
const burnerGeo = (() => {
  const g = new THREE.ConeGeometry(0.5, 1, 10, 1, true);
  g.translate(0, 0.5, 0);
  g.rotateX(Math.PI / 2);
  return g;
})();

interface Scheme {
  body: number;
  accent: number;
  dark: number;
  glass: number;
}
const SCHEMES: Record<'joker' | 'enemy' | 'ace', Scheme> = {
  joker: { body: 0x8a96a3, accent: 0xc0282d, dark: 0x3a4048, glass: 0x1c2a38 },
  enemy: { body: 0x5b6157, accent: 0xd46a1f, dark: 0x2c2f2b, glass: 0x3a2c18 },
  ace: { body: 0x1b1d22, accent: 0xe6b422, dark: 0x0d0e10, glass: 0x5a1010 },
};

function fighterGeometry(kind: 'joker' | 'enemy' | 'ace'): THREE.BufferGeometry {
  const s = SCHEMES[kind];
  const parts: THREE.BufferGeometry[] = [];
  parts.push(
    loft(
      [
        { z: -9.2, w: 0.04, h: 0.04, y: -0.1 },
        { z: -8.0, w: 0.42, h: 0.38, y: -0.05 },
        { z: -6.0, w: 0.8, h: 0.72 },
        { z: -3.5, w: 1.0, h: 0.95, y: 0.1 },
        { z: -1.0, w: 1.55, h: 0.95 },
        { z: 2.5, w: 1.75, h: 0.9 },
        { z: 6.0, w: 1.45, h: 0.85 },
        { z: 8.2, w: 1.15, h: 0.75 },
      ],
      10,
      s.body,
    ),
  );
  if (kind === 'ace') {
    // Black nose with a red tip.
    parts.push(place(loft([{ z: -9.3, w: 0.05, h: 0.05, y: -0.1 }, { z: -8.1, w: 0.44, h: 0.4, y: -0.05 }], 10, 0xb5121b)));
  }
  parts.push(place(sphere(0.8, 10, 6, s.glass, Math.PI * 2, Math.PI / 2), 0, 0.72, -3.7, 0, 0, 0, 0.85, 0.75, 2.8));
  let wing: [number, number][];
  if (kind === 'ace') {
    wing = [
      [1.0, 1.0],
      [7.4, -0.8],
      [7.4, 0.5],
      [1.0, 5.4],
    ];
    const canard: [number, number][] = [
      [0.9, -4.6],
      [2.8, -3.9],
      [2.8, -3.3],
      [0.9, -3.0],
    ];
    const c = place(slab(canard, 0.15, s.accent), 0, 0.1, 0);
    parts.push(c, mirrorX(c));
  } else {
    wing = [
      [0.9, -1.8],
      [7.0, 3.4],
      [7.0, 4.5],
      [0.9, 5.4],
    ];
  }
  const w = place(slab(wing, 0.28, s.body), 0, -0.1, 0);
  parts.push(w, mirrorX(w));
  const tip = wing[1];
  const tipPts: [number, number][] = [
    [tip[0] - 0.9, tip[1] - 0.5],
    [tip[0] + 0.05, tip[1]],
    [tip[0] + 0.05, wing[2][1]],
    [tip[0] - 0.9, wing[2][1] + 0.3],
  ];
  const t = place(slab(tipPts, 0.32, s.accent), 0, -0.1, 0);
  parts.push(t, mirrorX(t));
  const stab = place(
    slab(
      [
        [1.0, 5.6],
        [3.9, 7.7],
        [3.9, 8.5],
        [1.0, 8.4],
      ],
      0.2,
      s.body,
    ),
    0,
    0,
    0,
  );
  parts.push(stab, mirrorX(stab));
  const fin = place(
    slab(
      [
        [4.4, 0.6],
        [7.4, 3.9],
        [8.3, 3.9],
        [8.4, 0.6],
      ],
      0.22,
      s.accent,
      'zy',
    ),
    1.0,
    0,
    0,
    0,
    0,
    -0.26,
  );
  parts.push(fin, mirrorX(fin));
  const intake = place(box(0.8, 0.9, 3.4, s.dark), 1.45, -0.25, -0.6);
  parts.push(intake, mirrorX(intake));
  const nozzle = place(tubeZ(0.5, 0.58, 1.3, 8, s.dark), 0.6, 0, 8.6);
  parts.push(nozzle, mirrorX(nozzle));
  if (kind === 'joker') {
    // White stripe along the spine.
    parts.push(place(box(0.35, 0.12, 6, 0xe8e8e8), 0, 0.95, 2.2));
  }
  if (kind === 'ace') {
    const stripe = place(box(0.18, 0.12, 4.5, s.accent), 0.5, 0.93, 1.5);
    parts.push(stripe, mirrorX(stripe));
  }
  return merge(parts);
}

function scoutGeometry(): THREE.BufferGeometry {
  const body = 0xa9aeb3;
  const accent = 0xb3261e;
  const parts: THREE.BufferGeometry[] = [];
  parts.push(
    loft(
      [
        { z: -13, w: 0.1, h: 0.1 },
        { z: -11.5, w: 1.0, h: 1.0 },
        { z: -9, w: 1.6, h: 1.7 },
        { z: -4, w: 1.9, h: 2.0 },
        { z: 5, w: 1.9, h: 1.9 },
        { z: 10, w: 1.3, h: 1.5, y: 0.4 },
        { z: 13, w: 0.5, h: 0.8, y: 0.9 },
      ],
      12,
      body,
    ),
  );
  parts.push(place(sphere(1.0, 10, 6, 0x22303c, Math.PI * 2, Math.PI / 2), 0, 1.2, -9.4, 0, 0, 0, 1.2, 0.8, 1.8));
  const w = place(
    slab(
      [
        [1.5, -2.5],
        [15, -1.2],
        [15, 0.8],
        [1.5, 1.8],
      ],
      0.4,
      body,
    ),
    0,
    1.2,
    0,
  );
  parts.push(w, mirrorX(w));
  const tip = place(
    slab(
      [
        [13.5, -1.35],
        [15.05, -1.2],
        [15.05, 0.8],
        [13.5, 0.95],
      ],
      0.45,
      accent,
    ),
    0,
    1.2,
    0,
  );
  parts.push(tip, mirrorX(tip));
  const pod = place(tubeZ(0.9, 0.8, 5, 10, 0x6d7278), 6, 0.3, -1.2);
  parts.push(pod, mirrorX(pod));
  parts.push(
    slab(
      [
        [8, 1.5],
        [11.5, 6.5],
        [13.2, 6.5],
        [13.3, 1.5],
      ],
      0.35,
      accent,
      'zy',
    ),
  );
  const ht = place(
    slab(
      [
        [0.2, 10.6],
        [5.5, 12.0],
        [5.5, 13.0],
        [0.2, 13.2],
      ],
      0.25,
      body,
    ),
    0,
    6.4,
    0,
  );
  parts.push(ht, mirrorX(ht));
  parts.push(place(box(0.4, 2.4, 0.9, body), 0, 3.1, 0.5));
  parts.push(place(box(0.4, 2.4, 0.9, body), 0, 3.1, 3.6));
  return merge(parts);
}

function radomeGeometry(): THREE.BufferGeometry {
  return merge([place(cyl(4.3, 4.3, 0.9, 20, 0xe4e4e4), 0, 0, 0), place(cyl(4.35, 4.35, 0.3, 20, 0x30343a), 0, 0, 0)]);
}

function droneGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(
    loft(
      [
        { z: -4.2, w: 0.05, h: 0.05 },
        { z: -3.3, w: 0.36, h: 0.36 },
        { z: -1.5, w: 0.55, h: 0.55 },
        { z: 2.5, w: 0.5, h: 0.5 },
        { z: 4.1, w: 0.3, h: 0.3 },
      ],
      8,
      0xff6d1a,
    ),
  );
  parts.push(place(box(1.12, 1.12, 0.5, 0x161616), 0, 0, -0.8));
  const w = slab(
    [
      [0.4, -0.6],
      [3.4, -0.2],
      [3.4, 0.7],
      [0.4, 1.0],
    ],
    0.12,
    0xff6d1a,
  );
  parts.push(w, mirrorX(w));
  const tipW = slab(
    [
      [2.7, -0.25],
      [3.42, -0.2],
      [3.42, 0.7],
      [2.7, 0.75],
    ],
    0.14,
    0xf2f2f2,
  );
  parts.push(tipW, mirrorX(tipW));
  const v = place(
    slab(
      [
        [2.4, 0.2],
        [3.7, 1.6],
        [4.2, 1.6],
        [4.1, 0.2],
      ],
      0.1,
      0xf2f2f2,
      'zy',
    ),
    0.15,
    0,
    0,
    0,
    0,
    -0.7,
  );
  parts.push(v, mirrorX(v));
  return merge(parts);
}

const geoCache = new Map<ModelKind, THREE.BufferGeometry>();
let radomeGeo: THREE.BufferGeometry | null = null;

export interface AircraftModel {
  root: THREE.Group;
  burners: THREE.Object3D[];
  radome: THREE.Object3D | null;
  scale: number;
}

export function buildAircraft(kind: ModelKind): AircraftModel {
  let geo = geoCache.get(kind);
  if (!geo) {
    geo =
      kind === 'scout' ? scoutGeometry() : kind === 'drone' ? droneGeometry() : fighterGeometry(kind as 'joker' | 'enemy' | 'ace');
    geoCache.set(kind, geo);
  }
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(geo, bodyMat);
  root.add(mesh);
  const burners: THREE.Object3D[] = [];
  const addBurner = (x: number, y: number, z: number, r: number) => {
    const b = new THREE.Group();
    const outer = new THREE.Mesh(burnerGeo, burnerMat);
    outer.scale.set(r * 2, r * 2, 1);
    const inner = new THREE.Mesh(burnerGeo, burnerCoreMat);
    inner.scale.set(r * 1.1, r * 1.1, 0.55);
    b.add(outer, inner);
    b.position.set(x, y, z);
    root.add(b);
    burners.push(b);
  };
  let radome: THREE.Object3D | null = null;
  if (kind === 'scout') {
    addBurner(6, 0.3, 1.4, 0.7);
    addBurner(-6, 0.3, 1.4, 0.7);
    if (!radomeGeo) radomeGeo = radomeGeometry();
    radome = new THREE.Mesh(radomeGeo, bodyMat);
    radome.position.set(0, 4.6, 2);
    root.add(radome);
  } else if (kind === 'drone') {
    addBurner(0, 0, 4.1, 0.25);
  } else {
    addBurner(0.6, 0, 9.2, 0.45);
    addBurner(-0.6, 0, 9.2, 0.45);
  }
  return { root, burners, radome, scale: 1 };
}

// ---------------------------------------------------------------- Missile

let missileGeo: THREE.BufferGeometry | null = null;
export function buildMissile(): { root: THREE.Group; flame: THREE.Object3D } {
  if (!missileGeo) {
    const parts: THREE.BufferGeometry[] = [];
    parts.push(tubeZ(0.17, 0.17, 3.0, 8, 0xe9e9e9));
    const nose = new THREE.ConeGeometry(0.17, 0.6, 8);
    nose.rotateX(-Math.PI / 2);
    parts.push(place(paint(nose, 0x9a9a9a), 0, 0, -1.8));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      parts.push(place(box(0.04, 0.55, 0.5, 0x777777), Math.cos(a) * 0.3, Math.sin(a) * 0.3, 1.25, 0, 0, a - Math.PI / 2));
    }
    missileGeo = merge(parts);
  }
  const root = new THREE.Group();
  root.add(new THREE.Mesh(missileGeo, bodyMat));
  const flame = new THREE.Mesh(burnerGeo, burnerMat);
  flame.scale.set(0.4, 0.4, 3);
  flame.position.z = 1.5;
  root.add(flame);
  return { root, flame };
}

// ---------------------------------------------------------------- Ships

export function buildCarrier(): THREE.Group {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(
    place(
      slab(
        [
          [0, -165],
          [18, -120],
          [20, -40],
          [19, 120],
          [13, 150],
          [-13, 150],
          [-19, 120],
          [-20, -40],
          [-18, -120],
        ],
        24,
        0x59636d,
      ),
      0,
      8,
      0,
    ),
  );
  parts.push(place(box(40.5, 2.2, 290, 0x7a2a22), 0, -2.5, 0));
  parts.push(
    place(
      slab(
        [
          [2, -172],
          [22, -135],
          [32, -40],
          [34, 100],
          [28, 152],
          [-26, 152],
          [-38, 70],
          [-38, -20],
          [-24, -120],
        ],
        2.5,
        0x34383c,
      ),
      0,
      21.3,
      0,
    ),
  );
  const line = (x0: number, z0: number, x1: number, z1: number, color: number, w = 0.6) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const g = box(w, 0.12, len, color);
    place(g, (x0 + x1) / 2, 22.62, (z0 + z1) / 2, 0, Math.atan2(x1 - x0, z1 - z0), 0);
    parts.push(g);
  };
  line(-22, 140, 4, -50, 0xd8b23a, 0.8);
  line(-10, 140, 16, -50, 0xd8d8d8);
  line(-34, 140, -8, -50, 0xd8d8d8);
  line(8, -168, 8, -60, 0x8c8c8c, 1.2);
  line(-8, -150, -8, -60, 0x8c8c8c, 1.2);
  line(0, 150, 0, 120, 0xd8d8d8);
  // Island superstructure.
  parts.push(place(box(12, 18, 34, 0x6b747d), 27, 31.5, 25));
  parts.push(place(box(12.3, 2, 30, 0x1e2328), 27, 37, 25));
  parts.push(place(box(9, 8, 18, 0x6b747d), 27, 44, 22));
  parts.push(place(box(9.2, 1.6, 16, 0x1e2328), 27, 46, 22));
  parts.push(place(box(7, 8, 8, 0x50575e), 28, 46, 36));
  parts.push(place(cyl(0.6, 0.8, 24, 6, 0x50575e), 27, 60, 20));
  parts.push(place(box(6, 3.2, 0.6, 0x9aa3ab), 27, 58, 18));
  parts.push(place(box(0.6, 2.4, 5, 0x9aa3ab), 27, 66, 20));
  const geo = merge(parts);
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo, shipMat));
  const radar = new THREE.Mesh(merge([box(7, 0.6, 1.4, 0xcfd5da)]), shipMat);
  radar.position.set(27, 69, 20);
  radar.name = 'radar';
  g.add(radar);
  return g;
}

export function buildDestroyer(): THREE.Group {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(
    place(
      slab(
        [
          [0, -78],
          [7, -50],
          [8, 40],
          [6, 72],
          [-6, 72],
          [-8, 40],
          [-7, -50],
        ],
        11,
        0x66707a,
      ),
      0,
      3.5,
      0,
    ),
  );
  parts.push(place(box(16.2, 1.6, 120, 0x7a2a22), 0, -1.2, 5));
  parts.push(place(box(10, 8, 30, 0x7b858e), 0, 13, 0));
  parts.push(place(box(7, 6, 14, 0x7b858e), 0, 20, -4));
  parts.push(place(box(7.2, 1.2, 12, 0x1e2328), 0, 21.5, -4));
  parts.push(place(box(5, 7, 8, 0x50575e), 0, 19, 14));
  parts.push(place(cyl(0.4, 0.5, 16, 6, 0x50575e), 0, 30, -2));
  parts.push(place(box(4, 2.2, 5, 0x7b858e), 0, 10.2, -45));
  parts.push(place(tubeZ(0.3, 0.3, 6, 6, 0x50575e), 0, 10.6, -50));
  parts.push(place(box(5, 3, 8, 0x7b858e), 0, 10.6, 50));
  const g = new THREE.Group();
  g.add(new THREE.Mesh(merge(parts), shipMat));
  return g;
}

export const wakeTexture = canvasTexture(64, 256, (ctx) => {
  const grd = ctx.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, 'rgba(255,255,255,0.95)');
  grd.addColorStop(0.3, 'rgba(255,255,255,0.5)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 64, 256);
  const side = ctx.createLinearGradient(0, 0, 64, 0);
  side.addColorStop(0, 'rgba(0,0,0,1)');
  side.addColorStop(0.3, 'rgba(0,0,0,0)');
  side.addColorStop(0.7, 'rgba(0,0,0,0)');
  side.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = side;
  ctx.fillRect(0, 0, 64, 256);
});

export function buildWake(width: number, length: number): THREE.Mesh {
  const g = new THREE.PlaneGeometry(width, length, 1, 8);
  // Widen toward the stern end.
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const t = (p.getY(i) + length / 2) / length;
    p.setX(i, p.getX(i) * (1 + (1 - t) * 2.5));
  }
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0.6, length / 2);
  const m = new THREE.MeshBasicMaterial({ map: wakeTexture, transparent: true, depthWrite: false, opacity: 0.75 });
  const mesh = new THREE.Mesh(g, m);
  mesh.renderOrder = 1;
  return mesh;
}

// ---------------------------------------------------------------- Checkpoint ring

export function labelTexture(text: string, color = '#ffd25a'): THREE.CanvasTexture {
  return canvasTexture(1024, 256, (ctx) => {
    ctx.font = 'italic 700 150px "Chakra Petch", "Arial Narrow", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 14;
    ctx.strokeStyle = 'rgba(10,12,16,0.75)';
    ctx.strokeText(text, 512, 128);
    ctx.fillStyle = color;
    ctx.fillText(text, 512, 128);
  });
}

export function buildRing(radius: number, label: string): { group: THREE.Group; ring: THREE.Mesh; disc: THREE.Mesh; label: THREE.Sprite } {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 3.2, 10, 72),
    new THREE.MeshBasicMaterial({ color: 0xffc94a, transparent: true, opacity: 0.95, toneMapped: false }),
  );
  group.add(ring);
  const discTex = canvasTexture(256, 256, (ctx) => {
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, 'rgba(255,220,120,0.0)');
    g.addColorStop(0.75, 'rgba(255,210,90,0.06)');
    g.addColorStop(0.97, 'rgba(255,200,80,0.35)');
    g.addColorStop(1, 'rgba(255,200,80,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
  });
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 48),
    new THREE.MeshBasicMaterial({
      map: discTex,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
  );
  group.add(disc);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(label), depthWrite: false, toneMapped: false }));
  sprite.scale.set(radius * 3.2, radius * 0.8, 1);
  sprite.position.set(0, radius + 34, 0);
  group.add(sprite);
  return { group, ring, disc, label: sprite };
}
