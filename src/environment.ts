import * as THREE from 'three';
import { LAND, Terrain } from './terrain';
import { mulberry32 } from './math';

export const SUN_DIR = new THREE.Vector3(-0.55, 0.42, 0.72).normalize();
export const FOG_DENSITY = 0.000052;
export const COLORS = {
  zenith: new THREE.Color(0x2f62a8),
  horizon: new THREE.Color(0xb9cbd8),
  fog: new THREE.Color(0xaec2d2),
  sun: new THREE.Color(0xfff1d6),
  deep: new THREE.Color(0x0c2c46),
  shallow: new THREE.Color(0x1f6f78),
};

const fogGLSL = /* glsl */ `
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  vec3 applyFog(vec3 col, float dist) {
    float f = 1.0 - exp(-pow(uFogDensity * dist, 2.0));
    return mix(col, uFogColor, clamp(f, 0.0, 1.0));
  }
`;

export class Environment {
  readonly sky: THREE.Mesh;
  readonly ocean: THREE.Mesh;
  readonly clouds: CloudLayer;
  readonly storm: CloudLayer;
  readonly rain: THREE.Group;
  readonly sunLight: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  private oceanMat: THREE.ShaderMaterial;
  private skyMat: THREE.ShaderMaterial;
  private lightningTimer = 4;
  stormFlash = 0;

  constructor(scene: THREE.Scene, terrain: Terrain) {
    scene.fog = new THREE.FogExp2(COLORS.fog.getHex(), FOG_DENSITY);
    scene.background = COLORS.fog.clone();

    this.hemi = new THREE.HemisphereLight(0xcfe2ff, 0x4f5a52, 1.15);
    scene.add(this.hemi);
    this.sunLight = new THREE.DirectionalLight(COLORS.sun.getHex(), 2.6);
    this.sunLight.position.copy(SUN_DIR).multiplyScalar(1000);
    scene.add(this.sunLight);
    scene.add(this.sunLight.target);

    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uZenith: { value: COLORS.zenith },
        uHorizon: { value: COLORS.horizon },
        uFogColor: { value: COLORS.fog },
        uSunDir: { value: SUN_DIR },
        uSunColor: { value: COLORS.sun },
        uFlash: { value: 0 },
        uStormDir: { value: new THREE.Vector3(-0.45, 0, 0.9).normalize() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uFogColor;
        uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uFlash; uniform vec3 uStormDir;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float y = d.y;
          vec3 col = mix(uHorizon, uZenith, pow(clamp(y, 0.0, 1.0), 0.5));
          col = mix(col, uFogColor * 0.92, smoothstep(0.0, -0.08, y));
          float s = max(dot(d, uSunDir), 0.0);
          col += uSunColor * (pow(s, 1500.0) * 25.0 + pow(s, 40.0) * 0.35 + pow(s, 6.0) * 0.12);
          col = mix(col, uFogColor, exp(-abs(y) * 16.0) * 0.55);
          // Storm darkens its side of the horizon.
          float st = max(dot(normalize(vec3(d.x, 0.0, d.z)), uStormDir), 0.0);
          float band = smoothstep(0.6, 0.98, st) * exp(-max(y, 0.0) * 9.0);
          col = mix(col, vec3(0.25, 0.28, 0.33), band * 0.55);
          col += vec3(0.6, 0.65, 0.8) * uFlash * band;
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(30000, 32, 16), this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    scene.add(this.sky);

    this.oceanMat = new THREE.ShaderMaterial({
      fog: false,
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: SUN_DIR },
        uSunColor: { value: COLORS.sun },
        uZenith: { value: COLORS.zenith },
        uHorizon: { value: COLORS.horizon },
        uDeep: { value: COLORS.deep },
        uShallow: { value: COLORS.shallow },
        uFogColor: { value: COLORS.fog },
        uFogDensity: { value: FOG_DENSITY },
        uHeight: { value: terrain.heightTexture },
        uLand: { value: new THREE.Vector4(LAND.x0, LAND.z0, LAND.x1 - LAND.x0, LAND.z1 - LAND.z0) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uSunDir; uniform vec3 uSunColor;
        uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uDeep; uniform vec3 uShallow;
        uniform sampler2D uHeight; uniform vec4 uLand;
        varying vec3 vWorld;
        ${fogGLSL}
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
        }
        float gPx;
        vec2 wave(vec2 p, vec2 dir, float len, float amp, float fade) {
          float k = 6.2831 / len;
          float w = sqrt(9.81 * k);
          float ph = dot(dir, p) * k - w * uTime;
          // Drop waves that a pixel can no longer resolve (prevents moire rings).
          fade *= 1.0 - smoothstep(0.06 * len, 0.25 * len, gPx);
          return dir * (amp * k * cos(ph)) * fade;
        }
        void main() {
          vec2 p = vWorld.xz;
          float dist = length(cameraPosition - vWorld);
          gPx = length(fwidth(p));
          // Fade small waves with distance (and altitude) to avoid moire.
          float f1 = 1.0 - smoothstep(900.0, 4500.0, dist);
          float f2 = 1.0 - smoothstep(120.0, 700.0, dist);
          vec2 g = vec2(0.0);
          g += wave(p, normalize(vec2(1.0, 0.25)), 210.0, 1.3, 1.0);
          g += wave(p, normalize(vec2(0.7, -0.6)), 117.0, 0.7, 1.0);
          g += wave(p, normalize(vec2(0.95, 0.55)), 61.0, 0.38, f1);
          g += wave(p, normalize(vec2(0.15, 1.0)), 37.0, 0.22, f1);
          g += wave(p, normalize(vec2(-0.6, 0.8)), 14.0, 0.08, f2);
          g += wave(p, normalize(vec2(0.9, -0.3)), 7.3, 0.035, f2);
          // Break up the regular interference pattern with noise.
          vec2 np = p * 0.012 + vec2(uTime * 0.03, -uTime * 0.02);
          float n1 = vnoise(np) - vnoise(np + vec2(0.37, 0.0));
          float n2 = vnoise(np) - vnoise(np + vec2(0.0, 0.37));
          g += vec2(n1, n2) * 0.35 * f1;
          g *= mix(0.55, 1.0, f1);
          vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
          vec3 V = normalize(cameraPosition - vWorld);
          float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
          vec3 R = reflect(-V, N);
          R.y = abs(R.y);
          vec3 sky = mix(uHorizon, uZenith, pow(clamp(R.y, 0.0, 1.0), 0.5));
          // Shoreline from terrain heights.
          vec2 luv = (p - uLand.xy) / uLand.zw;
          float th = -40.0;
          if (luv.x > 0.0 && luv.x < 1.0 && luv.y > 0.0 && luv.y < 1.0) th = texture2D(uHeight, luv).r * 255.0 / 2.0 - 40.0;
          float depth = -th;
          float shallow = 1.0 - smoothstep(0.0, 30.0, depth);
          vec3 water = mix(uDeep, uShallow, shallow * 0.8 + 0.12);
          water *= 0.55 + 0.45 * max(dot(N, uSunDir), 0.0);
          float sd = max(dot(R, uSunDir), 0.0);
          float glintFade = 1.0 - smoothstep(4.0, 40.0, gPx);
          float spec = pow(sd, 900.0) * 2.6 * mix(0.25, 1.0, f1) * glintFade + pow(sd, 80.0) * 0.1 * mix(0.4, 1.0, glintFade);
          vec3 col = mix(water, sky, fres * 0.85) + uSunColor * spec;
          float foamN = vnoise(p * 0.07 + vec2(uTime * 0.15, 0.0)) * 0.6 + vnoise(p * 0.21 - uTime * 0.2) * 0.4;
          float foam = (1.0 - smoothstep(0.5, 7.0, depth)) * smoothstep(0.35, 0.7, foamN + (1.0 - smoothstep(0.0, 4.0, depth)) * 0.5);
          col = mix(col, vec3(0.92, 0.95, 0.97), foam * 0.85 * f2 + foam * 0.3 * (1.0 - f2));
          col = applyFog(col, dist);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.ocean = new THREE.Mesh(new THREE.PlaneGeometry(90000, 90000, 1, 1).rotateX(-Math.PI / 2), this.oceanMat);
    this.ocean.frustumCulled = false;
    this.ocean.renderOrder = -5;
    scene.add(this.ocean);

    scene.add(terrain.mesh);
    scene.add(terrain.bridge);

    this.clouds = new CloudLayer(scene, CloudLayer.fieldLayout(), false);
    this.storm = new CloudLayer(scene, CloudLayer.stormLayout(), true);
    this.rain = buildRainShafts();
    scene.add(this.rain);
  }

  update(dt: number, time: number, camera: THREE.Camera) {
    this.oceanMat.uniforms.uTime.value = time;
    this.ocean.position.set(Math.round(camera.position.x / 100) * 100, 0, Math.round(camera.position.z / 100) * 100);
    this.sky.position.copy(camera.position);
    this.sunLight.position.copy(camera.position).addScaledVector(SUN_DIR, 2000);
    this.sunLight.target.position.copy(camera.position);
    this.lightningTimer -= dt;
    if (this.lightningTimer <= 0) {
      this.stormFlash = 1;
      this.lightningTimer = 1.5 + Math.random() * 5;
    }
    this.stormFlash = Math.max(0, this.stormFlash - dt * 5);
    const flicker = this.stormFlash > 0 ? this.stormFlash * (0.6 + 0.4 * Math.sin(time * 70)) : 0;
    this.skyMat.uniforms.uFlash.value = flicker * 0.35;
    this.storm.setFlash(flicker);
    for (const c of this.rain.children) ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).color.setScalar(0.35 + flicker * 0.5);
    this.clouds.update(camera);
    this.storm.update(camera);
  }

  /** 0..1 how deep the camera is inside a cloud bank. */
  cloudDensityAt(p: THREE.Vector3): number {
    return this.clouds.densityAt(p);
  }
}

interface Puff {
  x: number;
  y: number;
  z: number;
  s: number;
  shade: number;
  rot: number;
  alpha: number;
}
interface CloudCluster {
  center: THREE.Vector3;
  rx: number;
  ry: number;
}

export class CloudLayer {
  private puffs: Puff[];
  private clusters: CloudCluster[];
  private mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private mat: THREE.ShaderMaterial;
  private sortTimer = 0;
  private order: number[];

  constructor(scene: THREE.Scene, layout: { puffs: Puff[]; clusters: CloudCluster[] }, storm: boolean) {
    this.puffs = layout.puffs;
    this.clusters = layout.clusters;
    this.order = this.puffs.map((_, i) => i);
    const n = this.puffs.length;
    const g = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    g.index = quad.index;
    g.setAttribute('position', quad.getAttribute('position'));
    g.setAttribute('uv', quad.getAttribute('uv'));
    g.setAttribute('iOffset', new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('iParams', new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4));
    g.instanceCount = n;
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTex: { value: cloudTexture() },
        uFogColor: { value: storm ? new THREE.Color(0x8796a6) : COLORS.fog },
        uFogDensity: { value: storm ? FOG_DENSITY * 0.12 : FOG_DENSITY },
        uLight: { value: storm ? new THREE.Color(0x56606d) : new THREE.Color(0xffffff) },
        uShadow: { value: storm ? new THREE.Color(0x161a21) : new THREE.Color(0xa3b2c4) },
        uFlash: { value: 0 },
        uNearFade: { value: storm ? 0 : 1 },
      },
      vertexShader: /* glsl */ `
        attribute vec3 iOffset; attribute vec4 iParams;
        varying vec2 vUv; varying float vShade; varying float vAlpha; varying float vDist;
        void main() {
          vec4 mv = viewMatrix * vec4(iOffset, 1.0);
          float c = cos(iParams.z), s = sin(iParams.z);
          vec2 q = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * iParams.x;
          mv.xy += q;
          vUv = uv; vShade = iParams.y; vAlpha = iParams.w; vDist = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTex; uniform vec3 uLight; uniform vec3 uShadow; uniform float uFlash; uniform float uNearFade;
        varying vec2 vUv; varying float vShade; varying float vAlpha; varying float vDist;
        ${fogGLSL}
        void main() {
          vec4 t = texture2D(uTex, vUv);
          float a = t.a * vAlpha;
          if (uNearFade > 0.5) a *= smoothstep(40.0, 320.0, vDist);
          if (a < 0.01) discard;
          vec3 col = mix(uShadow, uLight, clamp(vShade * 0.7 + t.r * 0.5, 0.0, 1.0));
          col += vec3(0.75, 0.8, 1.0) * uFlash * t.r;
          col = applyFog(col, vDist);
          gl_FragColor = vec4(col, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = storm ? -4 : 5;
    scene.add(this.mesh);
    this.writeAttributes();
  }

  static fieldLayout(): { puffs: Puff[]; clusters: CloudCluster[] } {
    const rng = mulberry32(7);
    const puffs: Puff[] = [];
    const clusters: CloudCluster[] = [];
    for (let c = 0; c < 70; c++) {
      const cx = -16000 + rng() * 36000;
      const cz = -18000 + rng() * 30000;
      const cy = 1100 + rng() * 900;
      const rx = 350 + rng() * 550;
      const ry = 110 + rng() * 120;
      clusters.push({ center: new THREE.Vector3(cx, cy, cz), rx, ry });
      const count = 7 + Math.floor(rng() * 9);
      for (let i = 0; i < count; i++) {
        const a = rng() * Math.PI * 2;
        const r = Math.sqrt(rng()) * rx * 0.8;
        const dy = (rng() - 0.35) * ry;
        puffs.push({
          x: cx + Math.cos(a) * r,
          y: cy + dy,
          z: cz + Math.sin(a) * r,
          s: 260 + rng() * 360,
          shade: 0.45 + (dy / ry) * 0.6 + rng() * 0.15,
          rot: rng() * Math.PI * 2,
          alpha: 0.7 + rng() * 0.25,
        });
      }
    }
    return { puffs, clusters };
  }

  static stormLayout(): { puffs: Puff[]; clusters: CloudCluster[] } {
    const rng = mulberry32(99);
    const puffs: Puff[] = [];
    // A wall of anvil clouds on the south-south-west horizon.
    for (let i = 0; i < 260; i++) {
      const t = rng();
      const h = rng();
      const x = -34000 + t * 44000;
      const z = 22000 + (rng() - 0.5) * 5000 + Math.sin(t * 7) * 1800;
      const y = 1300 + h * h * 4800;
      const anvil = smoothstepJs(0.55, 1, h);
      puffs.push({
        x: x + (rng() - 0.5) * 2000 * anvil,
        y,
        z: z - anvil * 1500,
        s: (2200 + rng() * 2400) * (1 + anvil * 0.8),
        shade: h * 0.9 + rng() * 0.15,
        rot: rng() * 6.28,
        alpha: 0.92,
      });
    }
    return { puffs, clusters: [] };
  }

  setFlash(v: number) {
    this.mat.uniforms.uFlash.value = v;
  }

  densityAt(p: THREE.Vector3): number {
    let d = 0;
    for (const c of this.clusters) {
      const dx = (p.x - c.center.x) / c.rx;
      const dy = (p.y - c.center.y) / (c.ry * 1.4);
      const dz = (p.z - c.center.z) / c.rx;
      const r2 = dx * dx + dy * dy + dz * dz;
      if (r2 < 1) d = Math.max(d, 1 - r2);
    }
    return d;
  }

  update(camera: THREE.Camera) {
    this.sortTimer -= 1;
    if (this.sortTimer > 0) return;
    this.sortTimer = 8;
    const cp = camera.position;
    const dist = this.puffs.map((p) => (p.x - cp.x) ** 2 + (p.y - cp.y) ** 2 + (p.z - cp.z) ** 2);
    this.order.sort((a, b) => dist[b] - dist[a]);
    this.writeAttributes();
  }

  private writeAttributes() {
    const off = this.geo.getAttribute('iOffset') as THREE.InstancedBufferAttribute;
    const par = this.geo.getAttribute('iParams') as THREE.InstancedBufferAttribute;
    const oa = off.array as Float32Array;
    const pa = par.array as Float32Array;
    for (let k = 0; k < this.order.length; k++) {
      const p = this.puffs[this.order[k]];
      oa[k * 3] = p.x;
      oa[k * 3 + 1] = p.y;
      oa[k * 3 + 2] = p.z;
      pa[k * 4] = p.s;
      pa[k * 4 + 1] = p.shade;
      pa[k * 4 + 2] = p.rot;
      pa[k * 4 + 3] = p.alpha;
    }
    off.needsUpdate = true;
    par.needsUpdate = true;
  }
}

function smoothstepJs(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Dark rain curtains hanging under the storm front. */
function buildRainShafts(): THREE.Group {
  const tex = (() => {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 256;
    const ctx = c.getContext('2d')!;
    const rng = mulberry32(11);
    for (let i = 0; i < 120; i++) {
      const x = rng() * 128;
      const g = ctx.createLinearGradient(0, 0, 0, 256);
      const a = 0.05 + rng() * 0.12;
      g.addColorStop(0, `rgba(40,46,56,${a * 2})`);
      g.addColorStop(0.7, `rgba(40,46,56,${a})`);
      g.addColorStop(1, 'rgba(40,46,56,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, 2 + rng() * 6, 256);
    }
    const side = ctx.createLinearGradient(0, 0, 128, 0);
    side.addColorStop(0, 'rgba(0,0,0,1)');
    side.addColorStop(0.25, 'rgba(0,0,0,0)');
    side.addColorStop(0.75, 'rgba(0,0,0,0)');
    side.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = side;
    ctx.fillRect(0, 0, 128, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const g = new THREE.Group();
  const rng = mulberry32(5);
  for (let i = 0; i < 9; i++) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(4600, 2300),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, color: 0x595959 }),
    );
    const x = -30000 + i * 4800 + rng() * 1500;
    m.position.set(x, 1150, 20500 + (rng() - 0.5) * 2500);
    m.lookAt(0, 1150, -4000);
    m.renderOrder = -4;
    g.add(m);
  }
  return g;
}

function cloudTexture(): THREE.Texture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const rng = mulberry32(3);
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 26; i++) {
    const a = rng() * Math.PI * 2;
    const r = rng() * size * 0.22;
    const x = size / 2 + Math.cos(a) * r;
    const y = size / 2 + Math.sin(a) * r * 0.7;
    const rad = size * (0.14 + rng() * 0.16);
    const g = ctx.createRadialGradient(x, y - rad * 0.25, 0, x, y, rad);
    // R channel carries self-shadowing (lighter on top); alpha carries density.
    const light = Math.round(200 + 55 * (1 - y / size));
    g.addColorStop(0, `rgba(${light},${light},${light},0.55)`);
    g.addColorStop(0.6, `rgba(${light - 40},${light - 40},${light - 40},0.25)`);
    g.addColorStop(1, 'rgba(120,120,120,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}
