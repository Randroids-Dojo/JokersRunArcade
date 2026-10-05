import * as THREE from 'three';
import type { Game } from './game';
import { Aircraft, Weapon } from './aircraft';
import { buildRing } from './models';
import { CATAPULT } from './fleet';
import { canyonZ, chaseRoute } from './terrain';
import { AceBrain, avoidTerrain, FighterBrain, ScoutBrain, steer } from './ai';
import { clamp, formatClock, horizontal, lerp, rand, randSign } from './math';
import { SCORE, WORLD } from './config';
import type { ShotFrame } from './camera';

export type CheckpointName = 'launch' | 'training' | 'scouts' | 'chase' | 'ace' | 'final';

class Cancelled extends Error {}

interface Ring {
  pos: THREE.Vector3;
  normal: THREE.Vector3;
  label: string;
  kind: 'climb' | 'bank' | 'boost' | 'brake' | 'roll';
  obj: ReturnType<typeof buildRing>;
  prevSide: number;
  done: boolean;
}

interface Waiter {
  gen: number;
  test: () => boolean;
  resolve: () => void;
  reject: (e: Error) => void;
}

const RADIUS = 58;

export class Mission {
  private g: Game;
  private gen = 0;
  private waiters: Waiter[] = [];
  checkpoint: CheckpointName = 'launch';
  phase = '';
  /** Sim-time clock used by sleep(). */
  private clock = 0;
  private perFrame: ((dt: number) => void) | null = null;

  rings: Ring[] = [];
  private ringIdx = 0;
  private ringGroup = new THREE.Group();
  tutorialClock = 0;
  private tutorialRunning = false;

  scouts: Aircraft[] = [];
  lead: Aircraft | null = null;
  last: Aircraft | null = null;
  ace: Aircraft | null = null;
  private scoutKills = 0;
  private dataTimer = 90;
  private uploadWarned = false;
  private waveTimer = 0;
  private waves = 0;
  private dogfight = false;
  private finalTimer = -1;
  private lastCount = 99;
  private aceTime = 0;
  private stage2Time = 0;
  private comboBrokeDuringAce = false;
  private aceActive = false;
  private aceKilled = false;
  private lastRadio = 0;
  private cp: { scoutKills: number; aceKilled: boolean } = { scoutKills: 0, aceKilled: false };

  constructor(g: Game) {
    this.g = g;
    g.scene.add(this.ringGroup);
    g.score.onBreak = () => {
      if (this.aceActive) this.comboBrokeDuringAce = true;
    };
  }

  // ---------------------------------------------------------------- Scheduling

  private sleep(sec: number): Promise<void> {
    const until = this.clock + sec;
    return this.until(() => this.clock >= until);
  }

  private until(test: () => boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      if (test()) {
        resolve();
        return;
      }
      this.waiters.push({ gen: this.gen, test, resolve, reject });
    });
  }

  cancel() {
    this.gen++;
    const ws = this.waiters;
    this.waiters = [];
    for (const w of ws) w.reject(new Cancelled());
    this.perFrame = null;
  }

  update(dt: number) {
    this.clock += dt;
    this.perFrame?.(dt);
    this.updateRings();
    this.updateUploads(dt);
    this.updateDogfight(dt);
    this.updateAce(dt);
    this.updateFinal(dt);
    if (this.tutorialRunning) {
      this.tutorialClock += dt;
      this.g.hud.timer('FLIGHT CHECK', this.tutorialClock, true, true);
    }
    const ready = this.waiters.filter((w) => w.gen === this.gen && w.test());
    if (ready.length) {
      this.waiters = this.waiters.filter((w) => !ready.includes(w));
      for (const w of ready) w.resolve();
    }
  }

  private radio(who: string, text: string, priority = false) {
    this.g.hud.radio(who, text, priority);
    this.lastRadio = this.clock;
  }

  private key(k: 'pitchUp' | 'left' | 'boost' | 'brake' | 'roll' | 'missile' | 'guns' | 'target'): string {
    const pad = this.g.input.usingPad;
    const inv = this.g.settings.invertPitch;
    if (this.g.input.usingTouch) {
      const t: Record<string, string> = {
        pitchUp: inv ? 'STICK ↓' : 'STICK ↑',
        left: 'STICK ←',
        boost: 'BOOST',
        brake: 'BRAKE',
        roll: 'ROLL',
        missile: 'MSL',
        guns: 'GUN',
        target: 'TGT',
      };
      return `<kbd class="t">${t[k]}</kbd>`;
    }
    const map: Record<string, string> = pad
      ? { pitchUp: inv ? 'L-STICK ↑' : 'L-STICK ↓', left: 'L-STICK ←', boost: 'RT', brake: 'LT', roll: 'B', missile: 'A', guns: 'X', target: 'Y' }
      : { pitchUp: inv ? 'S' : 'W', left: 'A', boost: 'SHIFT', brake: 'X', roll: 'A A', missile: 'F', guns: 'SPACE', target: 'TAB' };
    if (pad && !inv) map.pitchUp = 'L-STICK ↑';
    return `<kbd>${map[k]}</kbd>`;
  }

  activeCheckpoint(): { pos: THREE.Vector3; label: string } | null {
    if (!this.tutorialRunning) return null;
    const r = this.rings[this.ringIdx];
    return r ? { pos: r.pos, label: r.label } : null;
  }

  // ---------------------------------------------------------------- Entry

  start(cp: CheckpointName, retry: boolean) {
    this.cancel();
    const gen = this.gen;
    if (retry) this.g.score.restore();
    else this.g.score.reset();
    if (cp === 'launch') this.cp = { scoutKills: 0, aceKilled: false };
    this.scoutKills = this.cp.scoutKills;
    this.aceKilled = this.cp.aceKilled;
    this.resetFlags();
    this.run(cp).catch((e) => {
      if (!(e instanceof Cancelled)) {
        console.error(e);
        throw e;
      }
    });
    void gen;
  }

  private resetFlags() {
    this.tutorialRunning = false;
    this.clearRings();
    this.scouts = [];
    this.lead = null;
    this.last = null;
    this.ace = null;
    this.dogfight = false;
    this.aceActive = false;
    this.uploadWarned = false;
    this.waves = 0;
    this.waveTimer = 0;
    this.lastCount = 99;
    const g = this.g;
    g.uploadsActive = false;
    g.showBoundary = false;
    g.lockPenalty = 1;
    g.boostRegenMult = 1;
    g.formation = true;
    g.hud.timer(null);
    g.hud.subtimer('');
    g.hud.countdown(null);
    g.hud.boss(null);
    g.hud.scouts(null);
    g.hud.wingOrder(null);
    g.hud.prompt(null);
    g.hud.clearBanners();
    g.hud.clearRadio();
    g.audio.stopSpeech();
    g.hud.setRadarRange(4500);
    g.hud.setVisible(true);
    g.touchTeach = null;
    g.skippable = false;
    g.setCinematic(false);
    g.rig.play(null);
    this.finalTimer = -1;
  }

  private save(cp: CheckpointName) {
    this.checkpoint = cp;
    this.cp = { scoutKills: this.scoutKills, aceKilled: this.aceKilled };
    this.g.score.save();
  }

  private async run(cp: CheckpointName) {
    let fresh = true;
    if (cp === 'launch') {
      this.save('launch');
      await this.opening();
      await this.tutorial();
      cp = 'training';
      fresh = false;
    }
    if (cp === 'training') {
      this.save('training');
      await this.training(fresh);
      cp = 'scouts';
      fresh = false;
    }
    if (cp === 'scouts') {
      this.save('scouts');
      await this.warning(fresh);
      await this.scoutPhase();
      cp = 'chase';
      fresh = false;
    }
    if (cp === 'chase') {
      this.save('chase');
      await this.chase(fresh);
      cp = 'ace';
      fresh = false;
    }
    if (cp === 'ace') {
      this.save('ace');
      await this.reinforcements(fresh);
      await this.aceFight();
      cp = 'final';
      fresh = false;
    }
    if (cp === 'final') {
      this.save('final');
      await this.finalScout(fresh);
    }
    await this.missionClear();
  }

  // ---------------------------------------------------------------- Opening + Phase 1

  private async opening() {
    const g = this.g;
    g.resetWorld();
    g.fleet.setTime(0);
    g.setControls(false);
    g.setCinematic(true);
    g.hud.setVisible(true);
    g.spawnWingmen();
    // Wingmen already airborne ahead of the carrier.
    const wingStart = [
      new THREE.Vector3(-260, 260, -900),
      new THREE.Vector3(240, 300, -1150),
      new THREE.Vector3(30, 340, -1500),
    ];
    g.wingmen.forEach((w, i) => {
      w.pos.copy(g.fleet.carrierPos()).add(wingStart[i]);
      w.quat.identity();
      w.speed = 150;
      w.updateBasis();
    });
    const p = g.player;
    const deck = new THREE.Vector3();
    let launchT = -1;
    const launchDur = 1.7;
    const placeOnDeck = () => {
      const z = launchT < 0 ? CATAPULT.zStart : lerp(CATAPULT.zStart, CATAPULT.zEnd, Math.pow(Math.min(1, launchT / launchDur), 2));
      g.fleet.deckPoint(CATAPULT.x, CATAPULT.y, z, deck);
      p.pos.copy(deck);
      p.quat.identity();
      p.speed = launchT < 0 ? 0 : (2 * (CATAPULT.zStart - CATAPULT.zEnd) * Math.min(1, launchT / launchDur)) / launchDur + 18;
      p.throttle = launchT < 0 ? 0.35 : 1;
      p.updateBasis();
    };
    g.pc.autopilot = () => {
      placeOnDeck();
      p.vel.set(0, 0, 0);
    };
    placeOnDeck();
    let steamT = 0;
    this.perFrame = (dt) => {
      if (launchT >= 0) launchT += dt;
      steamT -= dt;
      if (steamT <= 0 && launchT < 0) {
        steamT = 0.05;
        g.fx.steam(g.fleet.deckPoint(CATAPULT.x + 2, 23.2, CATAPULT.zStart - 10));
      }
    };
    // Low deck shot, slowly creeping forward.
    g.rig.play((t, f: ShotFrame) => {
      const base = p.pos;
      if (launchT < 0) {
        f.pos.set(base.x - 16 + t * 0.6, base.y + 4.5, base.z + 26 - t * 1.2);
        f.look.set(base.x + 2, base.y + 2.5, base.z - 40);
      } else {
        f.pos.set(base.x - 10, base.y + 5, base.z + 34);
        f.look.set(base.x, base.y + 2, base.z - 60);
      }
      f.up.set(0, 1, 0);
      f.fov = 62;
    });
    g.rig.snap();
    g.audio.setTrack('calm', true);
    g.fadeIn();
    g.hud.banner('MISSION 01', "JOKER'S RUN", 'info', 3);
    const t0 = this.clock;
    await this.sleep(0.9);
    this.radio('HALCYON', "We're almost safe. Keep the skies clear until we reach the coast.");
    g.skippable = true;
    await this.until(() => this.clock - t0 > 4.6 || g.input.skip);
    g.skippable = false;
    g.hud.bannerNow('LAUNCH', 'JOKER 1 CLEARED', 'gold', 1.6);
    g.audio.catapult();
    await this.sleep(0.35);
    launchT = 0;
    g.rig.play(null);
    g.rig.snap();
    g.setCinematic(false);
    await this.until(() => launchT >= launchDur);
    // Off the bow: hand over control with a slight nose-up.
    g.pc.autopilot = null;
    p.quat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.1);
    p.speed = 150;
    p.updateBasis();
    g.pc.reset();
    g.setControls(true);
    this.perFrame = null;
  }

  private async tutorial() {
    const g = this.g;
    const p = g.player;
    this.phase = 'PHASE 1 · LAUNCH';
    g.hud.phase(this.phase);
    g.hud.objective('FLIGHT CHECK — FLY THROUGH THE CHECKPOINTS');
    const L = p.pos.clone();
    L.y = 30;
    const defs: { off: THREE.Vector3; label: string; kind: Ring['kind'] }[] = [
      { off: new THREE.Vector3(0, 380, -2100), label: 'CLIMB', kind: 'climb' },
      { off: new THREE.Vector3(-1500, 60, -700), label: 'BANK LEFT', kind: 'bank' },
      { off: new THREE.Vector3(-2800, 40, 900), label: 'BOOST', kind: 'boost' },
      { off: new THREE.Vector3(-350, -120, 2100), label: 'BRAKE', kind: 'brake' },
      { off: new THREE.Vector3(1650, -60, 1500), label: 'ROLL', kind: 'roll' },
    ];
    let prev = L;
    this.rings = defs.map((d) => {
      const pos = prev.clone().add(d.off);
      const normal = pos.clone().sub(prev).normalize();
      const obj = buildRing(RADIUS, d.label);
      obj.group.position.copy(pos);
      obj.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      this.ringGroup.add(obj.group);
      prev = pos;
      return { pos, normal, label: d.label, kind: d.kind, obj, prevSide: -1, done: false };
    });
    this.ringIdx = 0;
    this.styleRings();
    this.tutorialClock = 0;
    this.tutorialRunning = true;
    g.hud.subtimer('PAR 01:15');
    g.score.cleanCount = 0;
    for (let i = 0; i < this.rings.length; i++) {
      this.ringIdx = i;
      this.styleRings();
      this.ringPrompt(i);
      await this.until(() => this.rings[i].done);
    }
    this.tutorialRunning = false;
    g.hud.prompt(null);
    g.touchTeach = null;
    g.hud.timer(null);
    g.hud.subtimer('');
    const t = this.tutorialClock;
    g.score.tutorialTime = t;
    const timeBonus = clamp((115 - t) / (115 - 55), 0, 1) * 0.5;
    const mult = Math.round((1 + g.score.cleanCount * 0.1 + timeBonus) * 10) / 10;
    g.score.hotStart = Math.min(2, mult);
    g.showHotStart = true;
    g.audio.bonus();
    g.hud.banner('FLIGHT CHECK COMPLETE', `TIME ${formatClock(t, true)} · CLEAN ${g.score.cleanCount}/5`, 'info', 2.4);
    g.hud.banner(`HOT START x${g.score.hotStart.toFixed(1)}`, 'SCORE MULTIPLIER FOR THIS MISSION', 'gold', 2.6);
    this.radio('JOKER 2', 'Looking sharp, lead.');
    await this.sleep(2.0);
    this.clearRings();
  }

  private ringPrompt(i: number) {
    const k = (x: Parameters<Mission['key']>[0]) => this.key(x);
    const step = `<span class="step">CHECKPOINT ${i + 1} / 5</span>`;
    const touch = this.g.input.usingTouch;
    const assisted = touch && this.g.settings.assist;
    const lines: Record<Ring['kind'], string> = {
      climb: `${step}<span class="big">CLIMB</span>Pull the nose up with ${k('pitchUp')}`,
      bank: assisted
        ? `${step}<span class="big">BANK LEFT</span>Hold ${k('left')} and the jet banks and turns for you`
        : `${step}<span class="big">BANK LEFT</span>Roll left ${k('left')} then pull ${k('pitchUp')} to carve the turn`,
      boost: touch
        ? `${step}<span class="big">BOOST</span>Tap ${k('boost')} to light the afterburner, tap again to cancel`
        : `${step}<span class="big">BOOST</span>Hold ${k('boost')} — pass through while boosting`,
      brake: `${step}<span class="big">BRAKE</span>Hold ${k('brake')} — slow below 630 km/h and turn tight`,
      roll: touch
        ? `${step}<span class="big">ROLL</span>Tap ${k('roll')} to barrel roll through`
        : `${step}<span class="big">ROLL</span>Double-tap ${this.g.input.usingPad ? '' : '<kbd>A</kbd> or <kbd>D</kbd>'}${this.g.input.usingPad ? k('roll') : ''} to barrel roll through`,
    };
    const teach: Record<Ring['kind'], string> = { climb: 'stick', bank: 'stick', boost: 'boost', brake: 'brake', roll: 'roll' };
    this.g.touchTeach = teach[this.rings[i].kind];
    this.g.hud.prompt(lines[this.rings[i].kind]);
  }

  private styleRings() {
    this.rings.forEach((r, i) => {
      const active = i === this.ringIdx && !r.done;
      r.obj.group.visible = !r.done && i <= this.ringIdx + 1;
      (r.obj.ring.material as THREE.MeshBasicMaterial).opacity = active ? 0.95 : 0.3;
      (r.obj.disc.material as THREE.MeshBasicMaterial).opacity = active ? 1 : 0.2;
      r.obj.label.visible = active;
    });
  }

  private clearRings() {
    for (const r of this.rings) this.ringGroup.remove(r.obj.group);
    this.rings = [];
    this.tutorialRunning = false;
  }

  private updateRings() {
    if (!this.tutorialRunning) return;
    const g = this.g;
    const r = this.rings[this.ringIdx];
    if (!r || r.done) return;
    const pulse = 1 + Math.sin(g.realTime * 5) * 0.04;
    r.obj.ring.scale.setScalar(pulse);
    const rel = g.player.pos.clone().sub(r.pos);
    const side = rel.dot(r.normal);
    if (Math.sign(side) !== Math.sign(r.prevSide) && Math.abs(r.prevSide) < 500) {
      const radial = rel.addScaledVector(r.normal, -side).length();
      if (radial < RADIUS + 10) this.passRing(r, radial);
    }
    r.prevSide = side;
  }

  private passRing(r: Ring, radial: number) {
    const g = this.g;
    const p = g.player;
    r.done = true;
    let clean = false;
    let cleanLabel = '';
    switch (r.kind) {
      case 'climb':
        clean = p.vel.y > 12;
        cleanLabel = 'CLEAN CLIMB';
        break;
      case 'bank':
        clean = g.pc.leftBankAt > g.time - 4;
        cleanLabel = 'CLEAN BANK';
        break;
      case 'boost':
        clean = g.pc.boosting;
        cleanLabel = 'FULL BOOST';
        break;
      case 'brake':
        clean = p.speed < 175;
        cleanLabel = 'CLEAN BRAKE';
        break;
      case 'roll':
        clean = g.pc.lastRollAt > g.time - 3.5 || g.pc.rollTime > 0;
        cleanLabel = 'CLEAN ROLL';
        break;
    }
    const lines: { text: string; points?: number; kind?: 'bonus' | 'gold' }[] = [{ text: 'CHECKPOINT', points: SCORE.checkpoint, kind: 'bonus' }];
    let pts = SCORE.checkpoint;
    if (clean) {
      lines.push({ text: cleanLabel, points: SCORE.clean, kind: 'gold' });
      pts += SCORE.clean;
      g.score.cleanCount++;
    }
    if (radial < 18) {
      lines.push({ text: 'BULLSEYE', points: SCORE.bullseye, kind: 'bonus' });
      pts += SCORE.bullseye;
    }
    g.score.add(pts);
    g.hud.popup(lines);
    g.audio.chime(this.ringIdx);
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2;
      const q = new THREE.Vector3(Math.cos(a) * RADIUS, Math.sin(a) * RADIUS, 0).applyQuaternion(r.obj.group.quaternion).add(r.pos);
      g.fx.fire.emit(q.x, q.y, q.z, 0, 0, 0, 0.6, 9, 1, 1, 0.85, 0.4, 1, 0.6, 0.1, 1, 0);
    }
    r.obj.group.visible = false;
    if (this.ringIdx + 1 < this.rings.length) {
      this.ringIdx++;
      this.styleRings();
    }
  }

  // ---------------------------------------------------------------- Phase 2

  private async training(fresh: boolean) {
    const g = this.g;
    const p = g.player;
    if (fresh) {
      g.resetWorld();
      g.fleet.setTime(95);
      g.spawnWingmen();
      p.pos.set(-1500, 650, 1300);
      p.quat.setFromUnitVectors(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0.45, 0, -1).normalize());
      p.speed = 235;
      p.updateBasis();
      g.placeWingmenInFormation();
      g.setControls(true);
      g.showHotStart = true;
      g.rig.snap();
      g.audio.setTrack('calm', true);
      g.fadeIn();
    }
    this.phase = 'PHASE 2 · TARGET PRACTICE';
    g.hud.phase(this.phase);
    g.hud.objective('DESTROY 3 DRONES  0 / 3');
    g.formation = true;
    g.score.comboFrozen = true;
    g.hud.banner('TARGET PRACTICE', 'THREE TRAINING DRONES DEPLOYED', 'info', 2.4);
    this.radio('HALCYON', 'Drones away. Three targets, Joker.');
    await this.sleep(1.2);
    const modes: ('lock' | 'guns' | 'evasive')[] = ['lock', 'guns', 'evasive'];
    for (let i = 0; i < 3; i++) {
      const fwd = horizontal(p.fwd);
      const side = new THREE.Vector3(-fwd.z, 0, fwd.x).multiplyScalar(randSign() * rand(150, 350));
      const alt = clamp(p.pos.y, 450, 1600);
      const pos = p.pos.clone().addScaledVector(fwd, i === 2 ? 1500 : 1700).add(side);
      pos.y = alt + rand(-40, 80);
      const heading = fwd.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), i === 0 ? 0.6 : rand(-0.8, 0.8));
      const d = g.spawnDrone(pos, heading, modes[i], alt);
      g.target = d;
      g.audio.radioBlip();
      g.touchTeach = ['msl', 'gun', 'brake'][i];
      if (i === 0) g.hud.prompt(`<span class="big">LOCK ON</span>Keep the drone inside the dashed circle until the diamond turns red, then fire ${this.key('missile')}`);
      if (i === 1) {
        g.hud.prompt(`<span class="big">GUNS ONLY</span>This drone jams missiles. Close in, line the gun cross up with the lead circle, fire ${this.key('guns')}`);
        this.radio('HALCYON', 'Number two jams missiles. Guns only.');
      }
      if (i === 2) {
        g.hud.prompt(`<span class="big">FAST MOVER</span>Evasive drone. Brake ${this.key('brake')} to turn tighter. Any weapon.`);
        this.radio('HALCYON', "Last one's quick. Stay on him.");
      }
      await this.until(() => !d.alive);
      g.hud.objective(`DESTROY 3 DRONES  ${i + 1} / 3`, false);
      await this.sleep(1.4);
    }
    g.hud.prompt(null);
    g.touchTeach = null;
    g.hud.banner(`COMBO x${Math.max(3, g.score.combo)}`, '', 'combo', 1.6);
    g.hud.banner('TRAINING COMPLETE', '', 'gold', 2.2);
    await this.sleep(1.2);
    this.radio('JOKER 2', 'Not bad. Looks like you remember how to shoot.');
    await this.sleep(4.2);
  }

  // ---------------------------------------------------------------- Phase 3/4

  private async warning(fresh: boolean) {
    const g = this.g;
    const p = g.player;
    if (fresh) {
      g.resetWorld();
      g.fleet.setTime(190);
      g.spawnWingmen();
      p.pos.set(-300, 900, -1800);
      p.quat.identity();
      p.speed = 235;
      p.updateBasis();
      g.placeWingmenInFormation();
      g.setControls(true);
      g.showHotStart = true;
      g.rig.snap();
      g.fadeIn();
    }
    g.score.combo = 0;
    g.score.comboTimer = 0;
    g.hud.prompt(null);
    g.hud.objective('');
    g.hud.phase('');
    // Radar fills with red contacts out of the west.
    const fwd = horizontal(p.fwd);
    const west = new THREE.Vector3(-1, 0, 0);
    const center = p.pos.clone().addScaledVector(west, 7600).addScaledVector(fwd, 1400);
    center.y = 1700;
    const heading = new THREE.Vector3(1, 0, 0.12).normalize();
    const names = ['SCOUT-1', 'SCOUT-2', 'SCOUT-3'];
    this.scouts = [0, 1, 2].map((i) => {
      const pos = center.clone().add(new THREE.Vector3(i * 500 - 500, i * 60, (i - 1) * 1100));
      const s = g.spawnScout(pos, heading, names[i]);
      s.upload = [0.02, 0.06, 0.0][i];
      return s;
    });
    for (let i = 0; i < 6; i++) {
      const ward = this.scouts[i % 3];
      const off = new THREE.Vector3((i < 3 ? -1 : 1) * rand(220, 380), rand(40, 160), rand(-200, 260));
      const f = g.spawnFighter(ward.pos.clone().add(off), heading, 'escort', 0.55);
      const b = f.brain as FighterBrain;
      b.escortOf = ward;
      b.escortOffset.copy(off);
      f.tag = 'escort';
    }
    g.hud.setRadarRange(11000);
    g.hud.ping();
    g.audio.klaxon(4);
    g.audio.setTrack('combat', true);
    g.hud.bannerNow('WARNING', 'UNKNOWN AIRCRAFT APPROACHING', 'warning', 3.4);
    this.radio('LANTERN', "Multiple contacts, bearing two-seven-zero. They're not ours!", true);
    await this.sleep(3.6);
  }

  private async scoutPhase() {
    const g = this.g;
    this.phase = 'PHASE 3 · STOP THE SCOUTS';
    g.hud.phase(this.phase);
    g.hud.objective('DESTROY THE SCOUTS BEFORE THEY ESCAPE');
    g.formation = false;
    g.wingOrder = 'cover';
    g.hud.wingOrder('cover');
    g.uploadsActive = true;
    g.showBoundary = true;
    g.score.comboFrozen = false;
    g.hud.setRadarRange(7000);
    this.dataTimer = 90;
    g.hud.banner('STOP THE SCOUTS', 'DATA TRANSMISSION 01:30', 'info', 2.6);
    this.radio('JOKER 3', 'Recon planes, three of them. Escorts too.');
    g.hud.prompt(
      g.input.usingTouch
        ? `Scouts are uploading the fleet's position. Damage jams them; escort kills buy time.<br>Order your wingmen with the blue buttons.`
        : `Scouts are uploading the fleet's position. Damage interrupts them. Escort kills buy time.<br>Wingmen: <kbd>1</kbd> cover me · <kbd>2</kbd> attack scouts · <kbd>3</kbd> split`,
    );
    g.touchTeach = 'orders';
    await this.sleep(6.5);
    g.hud.prompt(null);
    g.touchTeach = null;
    // Phase 4: fighters dive on the player.
    this.phase = 'PHASE 4 · DOGFIGHT';
    g.hud.phase(this.phase);
    this.spawnDivers(4);
    this.radio('JOKER 2', 'Two on your six!', true);
    let released = 0;
    for (const a of g.aircraft) {
      if (a.tag === 'escort' && released < 2) {
        (a.brain as FighterBrain).mode = 'engage';
        a.tag = 'hunter';
        released++;
      }
    }
    this.dogfight = true;
    this.waveTimer = 14;
    await this.until(() => this.scoutKills >= 1);
    this.dogfight = false;
  }

  private spawnDivers(n: number) {
    const g = this.g;
    const p = g.player;
    const back = horizontal(p.fwd).negate();
    for (let i = 0; i < n; i++) {
      const pos = p.pos
        .clone()
        .addScaledVector(back, 1700 + i * 120)
        .add(new THREE.Vector3((i - (n - 1) / 2) * 220, 900 + i * 60, 0));
      const dir = p.pos.clone().sub(pos).normalize();
      const f = g.spawnFighter(pos, dir, 'engage', 0.5 + i * 0.08);
      f.speed = 330;
      f.tag = 'hunter';
    }
  }

  private updateDogfight(dt: number) {
    if (!this.dogfight) return;
    const g = this.g;
    this.waveTimer -= dt;
    const hunters = g.aircraft.filter((a) => a.alive && a.team === 'red' && a.kind === 'fighter' && a.tag === 'hunter').length;
    if (hunters < 2 && this.waveTimer <= 0 && this.waves < 4) {
      this.waves++;
      this.waveTimer = 16;
      const p = g.player;
      const ang = rand(0, Math.PI * 2);
      const dir = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
      for (let i = 0; i < 3; i++) {
        const pos = p.pos.clone().addScaledVector(dir, 3200 + i * 150).add(new THREE.Vector3(i * 160, rand(200, 600), 0));
        pos.y = Math.max(pos.y, 500);
        const f = g.spawnFighter(pos, p.pos.clone().sub(pos).normalize(), 'engage', 0.55);
        f.tag = 'hunter';
      }
      g.hud.ping();
      if (this.clock - this.lastRadio > 4) this.radio('LANTERN', 'More bandits inbound!');
    }
  }

  private updateUploads(dt: number) {
    const g = this.g;
    if (!g.uploadsActive) {
      if (this.scouts.length) this.pushScoutRows();
      return;
    }
    let maxUp = 0;
    for (const s of this.scouts) {
      if (!s.alive || s.frozen || s.hidden) continue;
      if (s.uploadPause > 0) s.uploadPause -= dt;
      else s.upload = Math.min(1, s.upload + dt / 90);
      maxUp = Math.max(maxUp, s.upload);
    }
    this.dataTimer = (1 - maxUp) * 90;
    g.hud.timer('DATA TRANSMISSION', this.dataTimer);
    if (!this.uploadWarned && maxUp > 0.6) {
      this.uploadWarned = true;
      this.radio('JOKER 3', "Don't let them transmit!");
    }
    this.pushScoutRows();
    if (this.dataTimer <= 0) g.fail('DATA TRANSMITTED', "The scouts finished their upload. The fleet's position is out.");
  }

  private pushScoutRows() {
    this.g.hud.scouts(
      this.scouts.map((s) => ({
        name: s.label,
        upload: s.upload,
        state: !s.alive ? 'down' : s.hidden ? 'dark' : s.uploadPause > 0 ? 'paused' : 'up',
      })),
    );
  }

  /** Called by Game when anything dies. */
  onKill(a: Aircraft, byPlayer: boolean, weapon: Weapon) {
    const g = this.g;
    void weapon;
    if (a.kind === 'scout') {
      this.scoutKills++;
      g.slowmo(0.3, 0.9);
      if (this.scouts.length && this.scouts.filter((s) => s.alive).length === 2 && g.uploadsActive) {
        g.hud.bannerNow('SCOUT DOWN', `${this.scouts.filter((s) => s.alive).length} REMAINING`, 'gold', 1.8);
      }
    }
    if (g.uploadsActive && a.team === 'red' && a.kind === 'fighter') {
      for (const s of this.scouts) if (s.alive) s.upload = Math.max(0, s.upload - 10 / 90);
      if (byPlayer) g.hud.popup([{ text: '+10 SEC', kind: 'time' }]);
    }
    if (a.kind === 'fighter' && !byPlayer && a.team === 'red' && this.clock - this.lastRadio > 5 && Math.random() < 0.6) {
      this.radio(['JOKER 2', 'JOKER 3', 'JOKER 4'][Math.floor(Math.random() * 3)], 'Splash one!');
    }
    if (a.kind === 'fighter' && byPlayer && this.clock - this.lastRadio > 8 && Math.random() < 0.3) {
      this.radio('JOKER 3', ['Good kill!', 'Nice shooting, lead.', "That's another one."][Math.floor(Math.random() * 3)]);
    }
  }

  onDamaged(a: Aircraft) {
    if (a.kind === 'scout' && this.g.uploadsActive) a.uploadPause = 2.5;
  }

  // ---------------------------------------------------------------- Phase 5

  private async chase(fresh: boolean) {
    const g = this.g;
    const p = g.player;
    const route = chaseRoute();
    if (fresh) {
      g.resetWorld();
      g.fleet.setTime(260);
      g.spawnWingmen();
      g.audio.setTrack('combat', true);
      g.showHotStart = true;
      const names = ['SCOUT-1', 'SCOUT-2', 'SCOUT-3'];
      this.scouts = names.map((n, i) => {
        const s = g.spawnScout(new THREE.Vector3(0, 1600, -2000 - i * 400), new THREE.Vector3(1, 0, 0), n);
        s.upload = 0.55;
        return s;
      });
      const downIdx = 2;
      this.scouts[downIdx].alive = false;
      g.despawn(this.scouts[downIdx]);
      this.lead = this.scouts[0];
      this.last = this.scouts[1];
    } else {
      const alive = this.scouts.filter((s) => s.alive);
      alive.sort((a, b) => a.pos.distanceTo(p.pos) - b.pos.distanceTo(p.pos));
      this.lead = alive[0] ?? null;
      this.last = alive[1] ?? null;
    }
    g.uploadsActive = false;
    g.hud.timer(null);
    const lead = this.lead;
    if (!lead) return;
    if (!fresh) {
      await this.sleep(0.9);
      this.radio('JOKER 2', 'Scout breaking east!', true);
      // Brief cut to the lead scout peeling off and diving.
      g.setCinematic(true);
      const sb = lead.brain as ScoutBrain;
      sb.cruiseAlt = 200;
      sb.heading.set(1, 0, 0.05).normalize();
      g.rig.play((t, f) => {
        const hf = horizontal(lead.fwd);
        const hr = new THREE.Vector3(-hf.z, 0, hf.x);
        f.pos.copy(lead.pos).addScaledVector(hf, -75 + t * 6).addScaledVector(hr, 38).add(new THREE.Vector3(0, 16, 0));
        f.look.copy(lead.pos).addScaledVector(hf, 25);
        f.up.set(0, 1, 0);
        f.fov = 52;
      });
      g.hud.bannerNow('SCOUT BREAKING EAST', '', 'red', 2);
      await this.sleep(2.3);
      g.flashWhite();
      await this.sleep(0.15);
    }
    // Set piece: the lead scout runs the cliffs, canyon and bridge.
    for (const a of g.aircraft) {
      if (a === p || a === lead) continue;
      a.frozen = true;
    }
    g.weapons.clear();
    const startIdx = route.findIndex((r) => r.pos.x >= 4300);
    const sb = lead.brain as ScoutBrain;
    sb.mode = 'chase';
    sb.route = route;
    sb.routeIdx = startIdx + 1;
    sb.evadeChance = 0.8;
    lead.pos.copy(route[startIdx].pos);
    lead.quat.setFromUnitVectors(new THREE.Vector3(0, 0, -1), route[startIdx + 1].pos.clone().sub(route[startIdx].pos).normalize());
    lead.speed = 285;
    lead.hp = lead.maxHp = 230;
    lead.flares = 7;
    lead.label = 'LEAD SCOUT';
    lead.updateBasis();
    const pIdx = route.findIndex((r) => r.pos.x >= 3150);
    p.pos.copy(route[pIdx].pos).add(new THREE.Vector3(0, 70, 0));
    p.quat.setFromUnitVectors(new THREE.Vector3(0, 0, -1), route[pIdx + 1].pos.clone().sub(route[pIdx].pos).normalize());
    p.speed = 300;
    p.updateBasis();
    g.pc.reset();
    g.pc.boostEnergy = 1;
    g.boostRegenMult = 2.2;
    g.lockPenalty = 1.8;
    g.target = lead;
    g.setCinematic(false);
    g.rig.play(null);
    g.rig.snap();
    g.setControls(true);
    if (fresh) g.fadeIn();
    this.phase = 'PHASE 5 · THE CHASE';
    g.hud.phase(this.phase);
    g.hud.objective('INTERCEPT THE LEAD SCOUT');
    g.showBoundary = true;
    g.hud.setRadarRange(5000);
    this.radio('JOKER 3', "We'll keep the rest busy. Go!");
    g.hud.prompt(`Missiles struggle at high speed and in the canyon.<br>Boost ${this.key('boost')} to close, then finish it with guns ${this.key('guns')}.`);
    let promptT = 7;
    g.touchTeach = 'gun';
    this.perFrame = (dt) => {
      promptT -= dt;
      if (promptT <= 0) {
        g.hud.prompt(null);
        g.touchTeach = null;
      }
      const remain = Math.max(0, WORLD.boundaryX - lead.pos.x);
      g.hud.subtimer(`LEAD SCOUT → BOUNDARY  ${(remain / 1000).toFixed(1)} KM`);
    };
    await this.until(() => !lead.alive);
    this.perFrame = null;
    g.hud.prompt(null);
    g.hud.subtimer('');
    g.hud.bannerNow('TRANSMISSION STOPPED', 'LEAD SCOUT DOWN', 'gold', 2.6);
    g.lockPenalty = 1;
    g.boostRegenMult = 1;
  }

  // ---------------------------------------------------------------- Phase 6/7

  private async reinforcements(fresh: boolean) {
    const g = this.g;
    const p = g.player;
    if (fresh) {
      g.resetWorld();
      g.fleet.setTime(330);
      g.spawnWingmen();
      g.showHotStart = true;
      const x = 14300;
      p.pos.set(x, 600, canyonZ(x));
      p.quat.setFromUnitVectors(new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0));
      p.speed = 260;
      p.updateBasis();
      g.setControls(true);
      g.rig.snap();
      g.audio.setTrack('combat', true);
      g.fadeIn();
      const names = ['SCOUT-1', 'SCOUT-2', 'SCOUT-3'];
      this.scouts = names.map((n, i) => {
        const s = g.spawnScout(new THREE.Vector3(9000, 300, 4000 + i * 300), new THREE.Vector3(1, 0, 0), n);
        s.upload = 0.6;
        return s;
      });
      this.scouts[0].alive = false;
      g.despawn(this.scouts[0]);
      this.scouts[2].alive = false;
      g.despawn(this.scouts[2]);
      this.last = this.scouts[1];
      await this.sleep(0.5);
    } else {
      await this.sleep(2.4);
    }
    this.phase = 'PHASE 6 · REINFORCEMENTS';
    g.hud.phase(this.phase);
    g.hud.objective('');
    // Everything left in the old fight is far behind; the last scout went dark.
    for (const a of [...g.aircraft]) {
      if (a.team === 'red' && a !== this.last) g.despawn(a);
    }
    if (this.last && this.last.alive) {
      this.last.hidden = true;
      this.last.frozen = true;
    }
    g.unfreezeWingmenBehindPlayer();
    g.formation = true;
    this.radio('JOKER 2', 'Right behind you, lead. Lost the last scout in the clouds.');
    // Escorts ahead break formation and scatter.
    const fwd = horizontal(p.fwd);
    const escorts: Aircraft[] = [];
    for (let i = 0; i < 3; i++) {
      const pos = p.pos.clone().addScaledVector(fwd, 2600 + i * 90).add(new THREE.Vector3((i - 1) * 140, 250 + i * 30, 0));
      const f = g.spawnFighter(pos, fwd, 'engage', 0.5);
      f.tag = 'escort';
      escorts.push(f);
    }
    await this.sleep(2.0);
    escorts.forEach((e, i) => {
      const b = e.brain as FighterBrain;
      const away = e.pos.clone().add(new THREE.Vector3((i - 1) * 3000, 0, i === 1 ? -3000 : 0));
      b.flee(e.pos.clone().sub(away.sub(e.pos)), e);
    });
    this.radio('JOKER 3', 'Escorts are breaking formation... why?');
    await this.sleep(2.6);
    g.hud.bannerNow('WARNING', 'ENEMY ACE APPROACHING', 'warning', 3.2);
    g.audio.klaxon(3);
    g.hud.ping();
    g.audio.setTrack('boss', true);
    await this.sleep(2.2);
    const pos = p.pos.clone().addScaledVector(horizontal(p.fwd), 3300).add(new THREE.Vector3(0, 1700, 0));
    this.ace = g.spawnAce(pos, p.pos.clone().sub(pos).normalize());
    g.target = this.ace;
    this.radio('JOKER 2', "That one's different.", true);
    await this.sleep(0.5);
  }

  private async aceFight() {
    const g = this.g;
    const ace = this.ace;
    if (!ace) return;
    this.phase = 'PHASE 7 · ACE';
    g.hud.phase(this.phase);
    g.hud.objective('SHOOT DOWN THE ACE');
    g.formation = false;
    this.aceTime = 0;
    this.stage2Time = 0;
    this.comboBrokeDuringAce = false;
    this.aceActive = true;
    g.hud.prompt(`<span class="step">OPTIONAL</span>Destroy the ace without breaking your combo.<br>Stay on his tail to build <b>PRESSURE</b> and force him low.`);
    let promptT = 7;
    this.perFrame = (dt) => {
      promptT -= dt;
      if (promptT <= 0) {
        g.hud.prompt(null);
        promptT = 1e9;
      }
    };
    await this.until(() => !ace.alive || this.stage2Time > 28 || this.aceTime > 100);
    this.perFrame = null;
    g.hud.prompt(null);
    this.aceActive = false;
    if (!ace.alive) await this.sleep(2.6);
  }

  private updateAce(dt: number) {
    const g = this.g;
    const ace = this.ace;
    if (!ace || !ace.alive) {
      if (ace && !ace.alive) g.hud.boss(null);
      return;
    }
    const b = ace.brain as AceBrain;
    if (this.aceActive || ace.targetable) {
      this.aceTime += dt;
      if (b.stage === 2) this.stage2Time += dt;
    }
    const low = b.forcedLowT > 0;
    const status = low ? 'FORCED LOW — ATTACK NOW' : b.stage === 2 ? 'HEAD-ON ATTACKS' : ace.pos.y > 1300 ? 'HIGH ENERGY — HARD TO HIT' : '';
    g.hud.boss({ hp: ace.hp / ace.maxHp, pressure: low ? b.forcedLowT / 9 : b.pressure, stage: b.stage, status, low });
  }

  onAceKilled() {
    const g = this.g;
    this.aceKilled = true;
    g.score.aceBonus = true;
    g.hud.bannerNow('ACE DESTROYED', `+${(SCORE.ace).toLocaleString('en-US')}`, 'gold', 2.8);
    if (!this.comboBrokeDuringAce) {
      g.score.aceComboBonus = true;
      const bonus = Math.round(SCORE.aceCombo * g.score.hotStart);
      g.score.add(bonus);
      g.hud.popup([{ text: 'UNBROKEN COMBO', points: bonus, kind: 'gold' }]);
    }
    this.radio('JOKER 3', 'Splash the ace!', true);
    g.slowmo(0.25, 1.2);
  }

  onAceEnraged() {
    this.g.hud.bannerNow('ACE ENRAGED', 'HE IS COMING HEAD-ON', 'red', 2.2);
    this.radio('JOKER 4', "He's coming straight at you!", true);
  }

  onAceForcedLow() {
    this.g.hud.popup([{ text: 'ACE FORCED LOW', kind: 'gold' }]);
    if (this.clock - this.lastRadio > 4) this.radio('JOKER 2', "He's losing altitude. Hit him now!");
  }

  // ---------------------------------------------------------------- Phase 8

  private async finalScout(fresh: boolean) {
    const g = this.g;
    const p = g.player;
    if (fresh) {
      g.resetWorld();
      g.fleet.setTime(420);
      g.spawnWingmen();
      g.showHotStart = true;
      p.pos.set(15200, 1100, -2600);
      p.quat.setFromUnitVectors(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0.3, 0, -1).normalize());
      p.speed = 260;
      p.updateBasis();
      g.placeWingmenInFormation();
      g.setControls(true);
      g.rig.snap();
      g.fadeIn();
      const names = ['SCOUT-1', 'SCOUT-2', 'SCOUT-3'];
      this.scouts = names.map((n, i) => {
        const s = g.spawnScout(new THREE.Vector3(9000, 300, 4000 + i * 300), new THREE.Vector3(1, 0, 0), n);
        s.upload = 0.7;
        return s;
      });
      for (const i of [0, 2]) {
        this.scouts[i].alive = false;
        g.despawn(this.scouts[i]);
      }
      this.last = this.scouts[1];
      this.last.hidden = true;
      this.last.frozen = true;
      if (!this.aceKilled) {
        const pos = p.pos.clone().addScaledVector(p.fwd, -1800).add(new THREE.Vector3(400, 300, 0));
        this.ace = g.spawnAce(pos, p.fwd);
        this.ace.hp = this.ace.maxHp * 0.48;
        const ab = this.ace.brain as AceBrain;
        ab.stage = 2;
        ab.state = 'attack';
      }
      g.formation = false;
    }
    const last = this.last;
    if (!last || !last.alive) return;
    const fwd = horizontal(p.fwd);
    const dir = fwd.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), randSign() * rand(0.8, 1.2));
    const pos = p.pos.clone().addScaledVector(dir, 3000);
    pos.y = g.terrain.ground(pos.x, pos.z) + 230;
    last.pos.copy(pos);
    last.quat.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
    last.speed = 225;
    last.hp = last.maxHp = 220;
    last.flares = 5;
    last.hidden = false;
    last.frozen = false;
    last.label = 'LAST SCOUT';
    last.updateBasis();
    const sb = last.brain as ScoutBrain;
    sb.startFinal(last, dir);
    sb.evadeChance = 0.65;
    g.target = last;
    this.phase = 'PHASE 8 · FINAL SCOUT';
    g.hud.phase(this.phase);
    g.hud.objective('FINAL TARGET ESCAPING');
    g.hud.bannerNow('FINAL TARGET ESCAPING', 'TRANSMISSION IN 00:25', 'red', 2.4);
    g.hud.ping();
    g.audio.setTrack('final', true);
    this.radio('LANTERN', "Last scout's running low. It's about to transmit!", true);
    this.finalTimer = 25;
    this.lastCount = 99;
    g.hud.setRadarRange(6000);
    await this.until(() => !last.alive);
    this.finalTimer = -1;
    g.hud.countdown(null);
    g.hud.timer(null);
  }

  private updateFinal(dt: number) {
    if (this.finalTimer < 0 || !this.last || !this.last.alive || this.last.hidden || this.last.frozen) return;
    const g = this.g;
    this.finalTimer -= dt;
    g.hud.timer('FINAL TRANSMISSION', Math.max(0, this.finalTimer), true);
    const n = Math.ceil(this.finalTimer);
    if (n <= 10 && n >= 1) {
      g.hud.countdown(n);
      if (n !== this.lastCount) {
        this.lastCount = n;
        g.audio.countdownBeep(n <= 3);
      }
    }
    if (this.finalTimer <= 0) {
      this.finalTimer = -1;
      g.hud.countdown(null);
      g.fail('TRANSMISSION COMPLETE', 'The last scout got its data out.');
    }
  }

  // ---------------------------------------------------------------- Clear + epilogue

  private async missionClear() {
    const g = this.g;
    const p = g.player;
    this.finalTimer = -1;
    g.uploadsActive = false;
    g.showBoundary = false;
    g.hud.timer(null);
    g.hud.countdown(null);
    g.hud.prompt(null);
    g.hud.boss(null);
    g.hud.objective('');
    g.slowmo(0.3, 1.2);
    g.hud.bannerNow('MISSION CLEAR', '', 'gold', 3.6);
    g.audio.setTrack('none', true);
    g.audio.explosion(0.25, true);
    g.state = 'clear';
    if (this.ace && this.ace.alive) (this.ace.brain as AceBrain).retreat();
    for (const a of g.aircraft) {
      if (a.team === 'red' && a.kind === 'fighter' && a.brain instanceof FighterBrain) a.brain.flee(p.pos, a);
    }
    await this.sleep(1.4);
    g.setControls(false);
    g.formation = true;
    // Autopilot: level off and turn for home.
    const home = new THREE.Vector3();
    g.pc.autopilot = (a, dt) => {
      home.copy(g.fleet.carrierPos()).sub(a.pos).setY(0).normalize();
      home.y = clamp((900 - a.pos.y) / 1500, -0.2, 0.25);
      avoidTerrain(a, g, home, 150);
      steer(a, home, 0.45, dt, 230, 0.5);
      a.throttle = 0.4;
    };
    this.radio('HALCYON', 'All scouts destroyed.');
    if (this.ace && this.ace.alive) this.radio('JOKER 3', 'The ace is bugging out.');
    g.setCinematic(true);
    const hf = horizontal(p.fwd);
    g.rig.play((t, f) => {
      horizontal(p.fwd, hf);
      const hr = new THREE.Vector3(-hf.z, 0, hf.x);
      f.pos.copy(p.pos).addScaledVector(hr, -70 - t * 3).addScaledVector(hf, 45 - t * 7).add(new THREE.Vector3(0, 14, 0));
      f.look.copy(p.pos).addScaledVector(hf, 12);
      f.up.set(0, 1, 0);
      f.fov = 48;
    });
    await this.until(() => !g.hud.radioBusy);
    await this.sleep(1.8);
    this.radio('HALCYON', 'Carrier is still safe.');
    await this.until(() => !g.hud.radioBusy);
    await this.sleep(1.0);
    this.radio('HALCYON', 'Enemy forces were closer than expected.');
    await this.until(() => !g.hud.radioBusy);
    this.radio('LANTERN', 'We may have been detected anyway.');
    // Cut: high over the carrier, then pan to the storm front.
    g.flashBlack();
    await this.sleep(0.6);
    const storm = new THREE.Vector3(-9000, 1800, 26000);
    g.rig.play((t, f) => {
      const c = g.fleet.carrierPos();
      f.pos.set(c.x + 520, 720 - t * 12, c.z - 760 + t * 30);
      const lookCarrier = c.clone().add(new THREE.Vector3(0, 20, 60));
      const k = clamp((t - 3.4) / 4.6, 0, 1);
      const e = k * k * (3 - 2 * k);
      f.look.copy(lookCarrier).lerp(storm, e);
      f.up.set(0, 1, 0);
      f.fov = lerp(36, 58, e);
    });
    g.fadeIn();
    await this.sleep(8.5);
    g.audio.stinger();
    g.showCard();
    await this.sleep(4.5);
    g.showDebrief();
  }
}
