import * as THREE from 'three';
import { COLORS, FOG_DENSITY } from './environment';

// Ring-buffer particle pool rendered as one THREE.Points draw call.
// Fields per particle: position, velocity, life, size ramp, colour ramp, alpha ramp, drag, buoyancy.

export class ParticleSystem {
  readonly points: THREE.Points;
  private cap: number;
  private next = 0;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private s0: Float32Array;
  private s1: Float32Array;
  private c0: Float32Array;
  private c1: Float32Array;
  private a0: Float32Array;
  private a1: Float32Array;
  private drag: Float32Array;
  private buoy: Float32Array;
  private geo: THREE.BufferGeometry;
  private mat: THREE.ShaderMaterial;
  activeCount = 0;

  constructor(cap: number, additive: boolean) {
    this.cap = cap;
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 4);
    this.size = new Float32Array(cap);
    this.vel = new Float32Array(cap * 3);
    this.life = new Float32Array(cap);
    this.maxLife = new Float32Array(cap);
    this.s0 = new Float32Array(cap);
    this.s1 = new Float32Array(cap);
    this.c0 = new Float32Array(cap * 3);
    this.c1 = new Float32Array(cap * 3);
    this.a0 = new Float32Array(cap);
    this.a1 = new Float32Array(cap);
    this.drag = new Float32Array(cap);
    this.buoy = new Float32Array(cap);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('psize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: {
        uScale: { value: 600 },
        uFogColor: { value: COLORS.fog },
        uFogDensity: { value: FOG_DENSITY },
        uAdditive: { value: additive ? 1 : 0 },
      },
      vertexShader: /* glsl */ `
        attribute vec4 pcolor; attribute float psize;
        uniform float uScale;
        varying vec4 vColor; varying float vDist;
        void main() {
          vColor = pcolor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vDist = -mv.z;
          gl_PointSize = psize > 0.0 ? clamp(psize * uScale / max(-mv.z, 1.0), 1.5, 900.0) : 0.0;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uFogColor; uniform float uFogDensity; uniform float uAdditive;
        varying vec4 vColor; varying float vDist;
        void main() {
          vec2 d = gl_PointCoord * 2.0 - 1.0;
          float r = dot(d, d);
          if (r > 1.0) discard;
          float a = vColor.a * (1.0 - r) * (1.0 - r);
          float f = 1.0 - exp(-pow(uFogDensity * vDist, 2.0));
          vec3 c = vColor.rgb;
          if (uAdditive > 0.5) { a *= 1.0 - f; }
          else { c = mix(c, uFogColor, f); }
          gl_FragColor = vec4(c, a);
        }`,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 20 : 10;
  }

  setScale(viewportHeight: number, fovDeg: number) {
    this.mat.uniforms.uScale.value = viewportHeight / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  emit(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size0: number,
    size1: number,
    r0: number,
    g0: number,
    b0: number,
    r1: number,
    g1: number,
    b1: number,
    alpha0: number,
    alpha1: number,
    drag = 0,
    buoy = 0,
  ) {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.s0[i] = size0;
    this.s1[i] = size1;
    this.c0[i * 3] = r0;
    this.c0[i * 3 + 1] = g0;
    this.c0[i * 3 + 2] = b0;
    this.c1[i * 3] = r1;
    this.c1[i * 3 + 1] = g1;
    this.c1[i * 3 + 2] = b1;
    this.a0[i] = alpha0;
    this.a1[i] = alpha1;
    this.drag[i] = drag;
    this.buoy[i] = buoy;
  }

  update(dt: number) {
    let active = 0;
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) {
        if (this.size[i] !== 0) {
          this.size[i] = 0;
          this.col[i * 4 + 3] = 0;
        }
        continue;
      }
      active++;
      this.life[i] -= dt;
      const t = 1 - Math.max(0, this.life[i]) / this.maxLife[i];
      const k = Math.exp(-this.drag[i] * dt);
      const j = i * 3;
      this.vel[j] *= k;
      this.vel[j + 1] = this.vel[j + 1] * k + this.buoy[i] * dt;
      this.vel[j + 2] *= k;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      this.size[i] = this.life[i] > 0 ? this.s0[i] + (this.s1[i] - this.s0[i]) * t : 0;
      const q = i * 4;
      this.col[q] = this.c0[j] + (this.c1[j] - this.c0[j]) * t;
      this.col[q + 1] = this.c0[j + 1] + (this.c1[j + 1] - this.c0[j + 1]) * t;
      this.col[q + 2] = this.c0[j + 2] + (this.c1[j + 2] - this.c0[j + 2]) * t;
      this.col[q + 3] = this.a0[i] + (this.a1[i] - this.a0[i]) * t;
    }
    this.activeCount = active;
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('pcolor') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('psize') as THREE.BufferAttribute).needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
  }
}
