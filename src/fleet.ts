import * as THREE from 'three';
import { buildAircraft, buildCarrier, buildDestroyer, buildWake } from './models';
import { WORLD } from './config';

// The carrier group steams north (-Z) at a constant speed. Positions are a pure function of
// fleet time so checkpoints can restore them exactly.

const OFFSETS: { kind: 'carrier' | 'destroyer'; x: number; z: number; scale: number }[] = [
  { kind: 'carrier', x: 0, z: 0, scale: 1 },
  { kind: 'destroyer', x: -620, z: -700, scale: 1 },
  { kind: 'destroyer', x: 560, z: 520, scale: 1 },
  { kind: 'destroyer', x: -480, z: 1100, scale: 1.25 },
];

export const CATAPULT = { x: 8, y: 24.2, zStart: -40, zEnd: -168 };

export class Fleet {
  readonly ships: THREE.Group[] = [];
  readonly carrier: THREE.Group;
  time = 0;
  private radar: THREE.Object3D | null;

  constructor(scene: THREE.Scene) {
    for (const o of OFFSETS) {
      const g = o.kind === 'carrier' ? buildCarrier() : buildDestroyer();
      g.scale.setScalar(o.scale);
      const wake = buildWake(o.kind === 'carrier' ? 44 : 20, o.kind === 'carrier' ? 900 : 520);
      wake.position.z = o.kind === 'carrier' ? 140 : 70;
      g.add(wake);
      g.userData.offset = new THREE.Vector3(o.x, 0, o.z);
      scene.add(g);
      this.ships.push(g);
    }
    this.carrier = this.ships[0];
    this.radar = this.carrier.getObjectByName('radar') ?? null;
    // Parked jets on the deck.
    const parked: [number, number, number][] = [
      [-26, 118, 0.5],
      [-18, 126, 0.5],
      [-30, 96, 0.4],
      [25, 72, -0.4],
      [22, -8, Math.PI],
    ];
    for (const [x, z, ry] of parked) {
      const m = buildAircraft('joker');
      m.root.position.set(x, 24.2, z);
      m.root.rotation.y = ry;
      for (const b of m.burners) b.visible = false;
      this.carrier.add(m.root);
    }
    this.setTime(0);
  }

  carrierPos(out = new THREE.Vector3()) {
    return out.set(0, 0, -WORLD.fleetSpeed * this.time);
  }

  setTime(t: number) {
    this.time = t;
    const base = this.carrierPos();
    for (const s of this.ships) {
      const o = s.userData.offset as THREE.Vector3;
      s.position.set(base.x + o.x, 0, base.z + o.z);
    }
  }

  update(dt: number, realTime: number) {
    this.setTime(this.time + dt);
    for (let i = 0; i < this.ships.length; i++) {
      const s = this.ships[i];
      s.rotation.z = Math.sin(realTime * 0.5 + i) * 0.006;
      s.rotation.x = Math.sin(realTime * 0.37 + i * 2) * 0.004;
      s.position.y = Math.sin(realTime * 0.6 + i) * 0.4;
    }
    if (this.radar) this.radar.rotation.y = realTime * 2;
  }

  /** World position of a point on the carrier deck (local carrier coordinates). */
  deckPoint(x: number, y: number, z: number, out = new THREE.Vector3()) {
    return this.carrierPos(out).add(new THREE.Vector3(x, y, z));
  }
}
