import * as THREE from 'three';
import { Aircraft, Kind, Team, Weapon } from './aircraft';
import { AceBrain, DroneBrain, DroneMode, FighterBrain, FighterMode, ScoutBrain, WingmanBrain } from './ai';
import { AudioEngine } from './audio';
import { CameraRig } from './camera';
import { ENEMY_MISSILE, GUN, MISSILE, PLAYER, SCORE, SIM_STEP, WORLD } from './config';
import { Effects } from './effects';
import { Environment } from './environment';
import { Fleet } from './fleet';
import { Hud } from './hud';
import { ControlState, Input, NEUTRAL } from './input';
import { clamp, formatClock, formatScore, quatFromFwdUp, rand, randSign, rotateToward, UP } from './math';
import { CheckpointName, Mission } from './mission';
import { buildAircraft, ModelKind } from './models';
import { PlayerController } from './player';
import { Score } from './score';
import { Terrain } from './terrain';
import { TouchControls } from './touch';
import { MissileSpec, Weapons, Bullet, Missile } from './weapons';

export type GameState = 'title' | 'play' | 'paused' | 'failed' | 'clear' | 'debrief';
export type WingOrder = 'cover' | 'scouts' | 'split';

export interface Settings {
  invertPitch: boolean;
  voice: boolean;
  music: boolean;
  reducedMotion: boolean;
  mute: boolean;
  /** Touch: assisted steering (stick asks for a turn, the jet banks and pulls). */
  assist: boolean;
  tilt: boolean;
  haptics: boolean;
}

const PLAYER_MISSILE: MissileSpec = {
  maxSpeed: MISSILE.maxSpeed,
  accel: MISSILE.accel,
  turn: MISSILE.turn,
  life: MISSILE.life,
  damage: MISSILE.damage,
  proximity: MISSILE.proximity,
};
const AI_MISSILE: MissileSpec = { ...ENEMY_MISSILE };

const WING_SLOTS = [new THREE.Vector3(-55, 4, 50), new THREE.Vector3(55, 4, 50), new THREE.Vector3(110, 9, 100)];
const SPANS: Record<Kind, number> = { player: 7, wingman: 7, fighter: 7, ace: 7.4, scout: 15, drone: 3.4 };

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const X = new THREE.Vector3(1, 0, 0);
const Z = new THREE.Vector3(0, 0, 1);

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;
  readonly terrain: Terrain;
  readonly env: Environment;
  readonly fleet: Fleet;
  readonly fx: Effects;
  readonly weapons: Weapons;
  readonly input: Input;
  readonly touch: TouchControls;
  /** Touch UI: which control the tutorial is teaching right now. */
  touchTeach: string | null = null;
  /** A cinematic that a tap can skip is waiting. */
  skippable = false;
  private dpr = 1;
  private dprMax = 1.75;
  private perfLast = performance.now();
  private perfAcc = 0;
  private perfN = 0;
  private perfGood = 0;
  private perfHoldUntil = 0;
  readonly audio = new AudioEngine();
  readonly hud = new Hud();
  readonly score = new Score();
  readonly mission: Mission;
  readonly pc = new PlayerController();
  readonly player: Aircraft;
  aircraft: Aircraft[] = [];
  wingmen: Aircraft[] = [];

  time = 0;
  realTime = 0;
  timeScale = 1;
  private slowT = 0;
  private slowScale = 1;
  missionTime = 0;

  target: Aircraft | null = null;
  lockProgress = 0;
  locked = false;
  missileRails = [0, 0];
  private railIdx = 0;
  private gunCd = 0;
  private muzzleSide = 1;

  controlsEnabled = false;
  cinematic = false;
  formation = true;
  wingOrder: WingOrder = 'cover';
  uploadsActive = false;
  showBoundary = false;
  showHotStart = false;
  outOfArea = false;
  areaCenter = new THREE.Vector3(4000, 0, -2000);
  areaRadius = WORLD.areaRadius;
  boostRegenMult = 1;
  lockPenalty = 1;
  state: GameState = 'title';
  settings: Settings;
  god = false;
  /** Recent notable events for diagnosis (read by ?debug tooling). */
  readonly events: string[] = [];

  private enemyLaunchCd = 0;
  private failTimer = -1;
  private failInfo = { reason: '', detail: '' };
  private lastHitSound = 0;
  private lastEnemyGunSound = 0;
  private lastPopupJam = 0;
  private lastDodgePopup = 0;
  private lastMissileRadio = -100;
  private vignette = 0;
  private fadeEl = document.getElementById('fade')!;
  private vignetteEl = document.getElementById('vignette')!;
  private cloudEl = document.getElementById('cloudfog')!;
  private fpsSamples: number[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    this.dprMax = Math.min(window.devicePixelRatio, coarse ? 1.5 : 1.75);
    this.dpr = this.dprMax;
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.rig = new CameraRig(window.innerWidth / window.innerHeight);
    this.terrain = new Terrain();
    this.env = new Environment(this.scene, this.terrain);
    this.fleet = new Fleet(this.scene);
    this.fx = new Effects(this.scene);
    this.fx.groundAt = (x, z) => this.terrain.ground(x, z);
    this.weapons = new Weapons(this.scene);
    this.input = new Input(canvas);
    this.touch = new TouchControls();
    this.input.touch = this.touch;
    this.touch.onEnable = () => requestAnimationFrame(() => this.resize());
    this.settings = loadSettings();
    this.audio.voiceOn = this.settings.voice;
    this.audio.muted = this.settings.mute;
    this.rig.reducedMotion = this.settings.reducedMotion;
    this.input.touchAssist = this.settings.assist;
    this.touch.haptics = this.settings.haptics;
    this.player = this.makePlayer();
    this.mission = new Mission(this);
    this.hud.onRadio = (who, text) => {
      this.audio.radioBlip();
      return this.audio.speak(text, who);
    };
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.toTitle();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(w, h, false);
    this.rig.camera.aspect = w / h;
    this.rig.camera.updateProjectionMatrix();
    this.hud.resize(w, h, Math.min(window.devicePixelRatio, 2));
    this.fx.setViewport(h * this.renderer.getPixelRatio(), this.rig.camera.fov);
  }

  // ---------------------------------------------------------------- Spawning

  private makePlayer(): Aircraft {
    const m = buildAircraft('joker');
    const a = new Aircraft('player', 'blue', m, 'JOKER 1');
    a.callsign = 'J1';
    a.hp = a.maxHp = PLAYER.hp;
    a.radius = 9;
    this.scene.add(m.root);
    this.aircraft.push(a);
    a.vaporTrails = [this.fx.trails.alloc(), this.fx.trails.alloc()];
    return a;
  }

  private add(kind: Kind, team: Team, model: ModelKind, label: string, pos: THREE.Vector3, fwd: THREE.Vector3, speed: number): Aircraft {
    const m = buildAircraft(model);
    const a = new Aircraft(kind, team, m, label);
    a.pos.copy(pos);
    quatFromFwdUp(_v.copy(fwd).normalize(), UP, a.quat);
    a.speed = speed;
    a.updateBasis();
    this.scene.add(m.root);
    this.aircraft.push(a);
    a.vaporTrails = [this.fx.trails.alloc(), this.fx.trails.alloc()];
    return a;
  }

  spawnFighter(pos: THREE.Vector3, fwd: THREE.Vector3, mode: FighterMode, skill = 0.55): Aircraft {
    const a = this.add('fighter', 'red', 'enemy', 'BANDIT', pos, fwd, 270);
    a.brain = new FighterBrain(mode, skill);
    a.hp = a.maxHp = 100;
    a.radius = 11;
    a.flares = 1;
    return a;
  }

  spawnScout(pos: THREE.Vector3, fwd: THREE.Vector3, label: string): Aircraft {
    const a = this.add('scout', 'red', 'scout', label, pos, fwd, 135);
    a.brain = new ScoutBrain();
    a.hp = a.maxHp = 320;
    a.radius = 18;
    a.missionTarget = true;
    a.hpFloorFromOthers = 0.3;
    a.flares = 2;
    return a;
  }

  spawnDrone(pos: THREE.Vector3, fwd: THREE.Vector3, mode: DroneMode, alt: number): Aircraft {
    const label = mode === 'lock' ? 'DRONE A' : mode === 'guns' ? 'DRONE B' : 'DRONE C';
    const a = this.add('drone', 'red', 'drone', label, pos, fwd, mode === 'evasive' ? 250 : 130);
    a.brain = new DroneBrain(mode, alt);
    a.hp = a.maxHp = mode === 'guns' ? 60 : 50;
    a.radius = 8.5;
    if (mode === 'guns') {
      a.ecm = true;
      a.missileJammer = true;
    }
    return a;
  }

  spawnAce(pos: THREE.Vector3, fwd: THREE.Vector3): Aircraft {
    const a = this.add('ace', 'red', 'ace', 'ACE', pos, fwd, 400);
    a.brain = new AceBrain();
    a.hp = a.maxHp = 900;
    a.radius = 11.5;
    a.flares = 8;
    a.hpFloorFromOthers = 0.52;
    return a;
  }

  spawnWingmen() {
    for (const w of this.wingmen) this.despawn(w);
    this.wingmen = [];
    ['JOKER 2', 'JOKER 3', 'JOKER 4'].forEach((name, i) => {
      const a = this.add('wingman', 'blue', 'joker', name, this.player.pos, this.player.fwd, this.player.speed);
      a.callsign = `J${i + 2}`;
      a.brain = new WingmanBrain(WING_SLOTS[i], i);
      a.invulnerable = true;
      a.radius = 9;
      this.wingmen.push(a);
    });
    this.placeWingmenInFormation();
  }

  placeWingmenInFormation() {
    const p = this.player;
    this.wingmen.forEach((w, i) => {
      w.pos.copy(WING_SLOTS[i]).applyQuaternion(p.quat).add(p.pos);
      w.quat.copy(p.quat);
      w.speed = p.speed;
      w.updateBasis();
    });
  }

  unfreezeWingmenBehindPlayer() {
    const p = this.player;
    this.wingmen.forEach((w, i) => {
      w.frozen = false;
      w.hidden = false;
      w.pos.copy(WING_SLOTS[i]).applyQuaternion(p.quat).add(p.pos).addScaledVector(p.fwd, -1400);
      w.quat.copy(p.quat);
      w.speed = p.speed + 80;
      w.updateBasis();
    });
  }

  despawn(a: Aircraft) {
    const i = this.aircraft.indexOf(a);
    if (i >= 0) this.aircraft.splice(i, 1);
    this.scene.remove(a.mesh);
    this.fx.trails.free(a.vaporTrails[0]);
    this.fx.trails.free(a.vaporTrails[1]);
    a.vaporTrails = [-1, -1];
    if (this.target === a) {
      this.target = null;
      this.lockProgress = 0;
    }
  }

  resetWorld() {
    for (const a of [...this.aircraft]) if (a !== this.player) this.despawn(a);
    this.wingmen = [];
    this.weapons.clear();
    this.fx.clear();
    const p = this.player;
    p.alive = true;
    p.wreck = false;
    p.hidden = false;
    p.frozen = false;
    p.hp = p.maxHp;
    p.rollVisual = 0;
    p.lastHitTime = -100;
    if (!this.aircraft.includes(p)) {
      this.aircraft.push(p);
      this.scene.add(p.mesh);
    }
    p.vaporTrails = [this.fx.trails.alloc(), this.fx.trails.alloc()];
    this.target = null;
    this.lockProgress = 0;
    this.locked = false;
    this.missileRails = [0, 0];
    this.pc.reset();
    this.formation = true;
    this.wingOrder = 'cover';
    this.vignette = 0;
  }

  // ---------------------------------------------------------------- Flow

  toTitle() {
    this.mission.cancel();
    this.resetWorld();
    this.state = 'title';
    this.fleet.setTime(0);
    this.player.hidden = true;
    this.player.pos.set(0, -500, 0);
    this.setControls(false);
    this.hud.setVisible(false);
    this.setCinematic(false);
    this.showScreen('title');
    this.updateBest();
    this.rig.play((t, f) => {
      const c = this.fleet.carrierPos();
      const a = 2.3 + t * 0.045;
      f.pos.set(c.x + Math.cos(a) * 560, 95 + Math.sin(t * 0.12) * 25, c.z + Math.sin(a) * 560);
      f.look.set(c.x - 40, 30, c.z - 60);
      f.up.set(0, 1, 0);
      f.fov = 48;
    });
    if (this.audio.ctx) this.audio.setTrack('calm', true);
    this.fadeIn();
  }

  startMission(cp: CheckpointName = 'launch') {
    if (this.touch.enabled) this.enterFullscreen();
    this.touch.tilt.recalibrate();
    this.audio.init();
    this.applyAudioSettings();
    this.showScreen(null);
    this.hideCard();
    this.state = 'play';
    this.player.hidden = false;
    this.missionTime = 0;
    this.time = 0;
    this.fadeEl.style.transition = 'none';
    this.fadeEl.style.opacity = '1';
    this.mission.start(cp, cp !== 'launch');
  }

  retry() {
    this.showScreen(null);
    this.hideCard();
    this.state = 'play';
    this.failTimer = -1;
    this.timeScale = 1;
    this.slowT = 0;
    this.fadeEl.style.transition = 'none';
    this.fadeEl.style.opacity = '1';
    this.audio.init();
    this.mission.start(this.mission.checkpoint, true);
  }

  restart() {
    this.failTimer = -1;
    this.slowT = 0;
    this.startMission('launch');
  }

  pause() {
    if (this.state !== 'play') return;
    this.state = 'paused';
    this.input.releaseAll();
    this.showScreen('pause');
    void this.audio.ctx?.suspend();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'play';
    this.showScreen(null);
    void this.audio.ctx?.resume();
  }

  setControls(on: boolean) {
    this.controlsEnabled = on;
  }

  setCinematic(on: boolean) {
    this.cinematic = on;
    this.hud.setCinematic(on);
  }

  slowmo(scale: number, durReal: number) {
    if (this.settings.reducedMotion) scale = Math.max(scale, 0.6);
    this.slowScale = scale;
    this.slowT = durReal;
  }

  fadeIn() {
    this.fadeEl.classList.remove('white');
    this.fadeEl.style.transition = 'opacity 0.9s';
    requestAnimationFrame(() => (this.fadeEl.style.opacity = '0'));
  }

  flashWhite() {
    this.fadeEl.classList.add('white');
    this.fadeEl.style.transition = 'none';
    this.fadeEl.style.opacity = '1';
    setTimeout(() => {
      this.fadeEl.style.transition = 'opacity 0.5s';
      this.fadeEl.style.opacity = '0';
    }, 120);
  }

  flashBlack() {
    this.fadeEl.classList.remove('white');
    this.fadeEl.style.transition = 'opacity 0.4s';
    this.fadeEl.style.opacity = '1';
  }

  showCard() {
    document.getElementById('card')!.classList.remove('hidden');
  }

  hideCard() {
    document.getElementById('card')!.classList.add('hidden');
  }

  showScreen(name: 'title' | 'pause' | 'fail' | 'debrief' | null) {
    for (const s of ['title', 'pause', 'fail', 'debrief']) {
      document.getElementById(`screen-${s}`)!.classList.toggle('hidden', s !== name);
    }
  }

  fail(reason: string, detail: string) {
    if (this.state !== 'play') return;
    this.state = 'failed';
    this.failInfo = { reason, detail };
    this.mission.cancel();
    this.setControls(false);
    this.hud.prompt(null);
    this.hud.countdown(null);
    this.hud.bannerNow('MISSION FAILED', reason, 'red', 3);
    this.audio.setTrack('none', true);
    this.audio.stopSpeech();
    this.slowmo(0.35, 1.4);
    this.failTimer = 2.8;
  }

  showDebrief() {
    this.state = 'debrief';
    this.hideCard();
    this.setCinematic(false);
    this.hud.setVisible(false);
    const s = this.score;
    const best = Number(localStorage.getItem('jokersrun.best') ?? 0);
    const isBest = s.total > best;
    if (isBest) localStorage.setItem('jokersrun.best', String(Math.round(s.total)));
    document.getElementById('deb-rank')!.textContent = s.rank();
    const acc = s.shotsFired ? Math.round((s.shotsHit / Math.max(1, s.shotsFired + s.missilesFired)) * 100) : 0;
    const rows: [string, string, string?][] = [
      ['FLIGHT CHECK', `${formatClock(s.tutorialTime, true)} · ${s.cleanCount}/5 CLEAN`],
      ['HOT START', `x${s.hotStart.toFixed(1)}`],
      ['MISSILE KILLS', String(s.missileKills)],
      ['GUN KILLS', String(s.gunKills)],
      ['MAX COMBO', `x${s.comboMax}`],
      ['ACE', s.aceBonus ? (s.aceComboBonus ? 'DESTROYED · UNBROKEN COMBO' : 'DESTROYED') : 'ESCAPED'],
      ['ACCURACY', `${acc}%`],
      ['HULL DAMAGE TAKEN', String(Math.round(s.damageTaken))],
      ['MISSION TIME', formatClock(this.missionTime)],
      ['SCORE', formatScore(s.total) + (isBest ? '  NEW BEST' : ''), 'total'],
    ];
    document.getElementById('deb-stats')!.innerHTML = rows
      .map(([k, v, cls]) => `<dt class="${cls ?? ''}">${k}</dt><dd class="${cls ?? ''}">${v}</dd>`)
      .join('');
    this.showScreen('debrief');
    this.audio.setTrack('calm', true);
    this.updateBest();
  }

  private updateBest() {
    const best = Number(localStorage.getItem('jokersrun.best') ?? 0);
    document.getElementById('best')!.textContent = best ? `BEST SCORE ${formatScore(best)}` : '';
  }

  applyAudioSettings() {
    this.audio.voiceOn = this.settings.voice;
    if (!this.settings.voice) this.audio.stopSpeech();
    this.audio.setMuted(this.settings.mute);
    this.audio.setMusicVolume(this.settings.music ? 0.5 : 0);
    this.rig.reducedMotion = this.settings.reducedMotion;
    this.input.touchAssist = this.settings.assist;
    this.touch.haptics = this.settings.haptics;
  }

  toggleSetting(key: keyof Settings) {
    this.settings[key] = !this.settings[key];
    saveSettings(this.settings);
    this.applyAudioSettings();
  }

  // ---------------------------------------------------------------- Main loop

  tick(rawDt: number) {
    this.realTime += rawDt;
    const inp = this.input;
    // Phones: rotating to portrait mid-flight pauses rather than flying blind.
    if (this.touch.enabled && this.state === 'play' && window.innerHeight > window.innerWidth) this.pause();
    if (inp.taps.length && this.state === 'play' && this.controlsEnabled) {
      for (const t of inp.taps) this.pickTargetAt(t.x, t.y);
    }
    if (this.state === 'title' && inp.confirm) this.startMission();
    else if (this.state === 'play' && inp.pause) this.pause();
    else if (this.state === 'paused' && inp.pause) this.resume();
    else if (this.state === 'failed' && this.failTimer < 0 && inp.confirm) this.retry();
    else if (this.state === 'debrief' && inp.confirm) this.restart();

    const live = this.state === 'play' || this.state === 'clear' || this.state === 'failed';
    if (this.slowT > 0) {
      this.slowT -= rawDt;
      this.timeScale = this.slowScale;
    } else this.timeScale = 1;
    let vdt = 0;
    if (live) {
      const dt = rawDt * this.timeScale;
      vdt = dt;
      const steps = Math.max(1, Math.ceil(dt / SIM_STEP - 1e-6));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        this.step(h);
        if (i === 0) inp.consumeEdges();
      }
      if (this.state === 'play') this.missionTime += rawDt;
      if (this.failTimer > 0) {
        this.failTimer -= rawDt;
        if (this.failTimer <= 0) {
          this.failTimer = -1;
          document.getElementById('fail-reason')!.textContent = `${this.failInfo.reason} — ${this.failInfo.detail}`;
          this.showScreen('fail');
        }
      }
    } else if (this.state === 'title' || this.state === 'debrief') {
      vdt = rawDt;
      this.fleet.update(rawDt, this.realTime);
    }
    this.renderFrame(rawDt, vdt);
    this.fpsSamples.push(rawDt);
    if (this.fpsSamples.length > 120) this.fpsSamples.shift();
  }

  get fps() {
    const avg = this.fpsSamples.reduce((a, b) => a + b, 0) / Math.max(1, this.fpsSamples.length);
    return avg > 0 ? 1 / avg : 0;
  }

  private step(dt: number) {
    this.time += dt;
    this.mission.update(dt);
    this.fleet.update(dt, this.realTime);
    const p = this.player;
    const inp: ControlState = this.controlsEnabled ? this.input : NEUTRAL;
    if (p.alive) {
      this.pc.update(p, inp, this, dt);
      if (this.touch.boostLatched && (this.pc.boostEnergy <= 0.01 || this.input.brake || !this.controlsEnabled)) this.touch.unlatchBoost();
      if (this.time - p.lastHitTime > PLAYER.regenDelay && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + PLAYER.regenRate * dt);
      if (this.controlsEnabled) this.playerWeapons(dt);
    } else if (p.wreck) this.updateWreck(p, dt);
    this.updateTargeting(dt);
    if (this.input.order && this.controlsEnabled && !this.formation) this.orderWingmen(this.input.order);
    for (const a of [...this.aircraft]) {
      if (a === p || a.frozen) continue;
      if (!a.alive) {
        this.updateWreck(a, dt);
        continue;
      }
      a.brain?.update(a, this, dt);
      const gh = this.terrain.ground(a.pos.x, a.pos.z);
      if (a.pos.y < gh + 2 || (a.kind !== 'scout' && this.terrain.hitsStructure(a.pos, 3))) {
        if (a.invulnerable) a.pos.y = gh + 30;
        else {
          const credit = a.lastHitByPlayer && this.time - a.lastHitTime < 4;
          this.kill(a, a.lastHitWeapon ?? 'missile', credit, 'crash');
          continue;
        }
      }
      if (a.brain instanceof FighterBrain && a.brain.mode === 'flee' && a.pos.distanceTo(p.pos) > 8500) {
        this.despawn(a);
        continue;
      }
      a.whooshCooldown -= dt;
      if (p.alive && a.whooshCooldown <= 0 && a.pos.distanceToSquared(p.pos) < 170 * 170) {
        a.whooshCooldown = 2.5;
        this.audio.whoosh(0.35, this.panOf(a.pos));
      }
    }
    this.weapons.update(dt, this);
    if (this.state === 'play') this.score.tick(dt);
    this.enemyLaunchCd -= dt;
  }

  private orderWingmen(order: number) {
    const o: WingOrder = order === 1 ? 'cover' : order === 2 ? 'scouts' : 'split';
    if (o === this.wingOrder) return;
    this.wingOrder = o;
    this.hud.wingOrder(o);
    this.audio.radioBlip();
    const lines: Record<WingOrder, string> = {
      cover: 'Copy. Covering you, lead.',
      scouts: 'Going after the scouts.',
      split: 'Splitting up. Four, take the scouts.',
    };
    this.hud.radio('JOKER 2', lines[o], true);
  }

  private playerWeapons(dt: number) {
    const p = this.player;
    const inp = this.input;
    this.gunCd -= dt;
    if (inp.guns) {
      let n = 0;
      while (this.gunCd <= 0 && n < 2) {
        this.gunCd += 1 / GUN.rate;
        n++;
        const dir = _v.copy(p.fwd);
        const t = this.target;
        if (t && t.targetable) {
          const d = t.pos.distanceTo(p.pos);
          const lead = _v2.copy(t.pos).addScaledVector(t.vel, d / (GUN.speed + p.speed)).sub(p.pos).normalize();
          if (d < 1500 && p.fwd.angleTo(lead) < GUN.assistCone) rotateToward(dir, lead, GUN.assistMax, dir);
        }
        dir.x += rand(-GUN.spread, GUN.spread);
        dir.y += rand(-GUN.spread, GUN.spread);
        dir.z += rand(-GUN.spread, GUN.spread);
        dir.normalize();
        this.muzzleSide = -this.muzzleSide;
        const muzzle = _v2.copy(p.pos).addScaledVector(p.fwd, 9).addScaledVector(p.right, 1.1 * this.muzzleSide).addScaledVector(p.up, -0.3);
        this.weapons.fireBullet(p, muzzle, dir, GUN.speed, GUN.damage, GUN.life);
        this.fx.muzzle(muzzle, p.vel);
        this.score.shotsFired++;
      }
      this.audio.gunshot(0.32);
    } else if (this.gunCd < 0) this.gunCd = 0;
    for (let i = 0; i < 2; i++) this.missileRails[i] = Math.max(0, this.missileRails[i] - dt);
    if (inp.missile) {
      const idx = this.missileRails[this.railIdx] <= 0 ? this.railIdx : this.missileRails[1 - this.railIdx] <= 0 ? 1 - this.railIdx : -1;
      if (idx >= 0) {
        const t = this.target;
        const tgt = this.locked && t && t.targetable && !t.ecm ? t : null;
        const m = this.weapons.fireMissile(p, tgt, PLAYER_MISSILE, MISSILE.launchBoost);
        if (m) {
          m.pos.addScaledVector(p.right, idx === 0 ? -2.2 : 2.2);
          this.missileRails[idx] = MISSILE.reload;
          this.railIdx = 1 - idx;
          this.audio.missileLaunch(0.5);
          this.score.missilesFired++;
          this.touch.vibrate(12);
          this.logEvent(`player missile ${tgt ? 'at ' + tgt.label : 'dumbfire'}`);
        }
      } else this.audio.tone(260, 0.05, 'square', 0.05);
    }
  }

  private targetScore(a: Aircraft): number {
    const p = this.player;
    const d = a.pos.distanceTo(p.pos);
    const ang = p.fwd.angleTo(_v.subVectors(a.pos, p.pos));
    return ang * 3500 + d * 0.5 - (a.missionTarget ? 900 : 0) - (a.kind === 'ace' ? 900 : 0);
  }

  private updateTargeting(dt: number) {
    const p = this.player;
    if (!p.alive) {
      this.target = null;
      this.lockProgress = 0;
      this.locked = false;
      return;
    }
    if (this.target && !this.target.targetable) this.target = null;
    const cands = this.aircraft.filter((a) => a.team === 'red' && a.targetable && a.pos.distanceTo(p.pos) < 15000);
    if (!this.target && cands.length) {
      let best = cands[0];
      let bs = Infinity;
      for (const c of cands) {
        const s = this.targetScore(c);
        if (s < bs) {
          bs = s;
          best = c;
        }
      }
      this.target = best;
      this.lockProgress = 0;
    }
    if (this.input.targetNext && this.controlsEnabled && cands.length > 1) {
      const sorted = cands.map((c) => ({ c, s: this.targetScore(c) })).sort((a, b) => a.s - b.s).map((x) => x.c);
      const i = this.target ? sorted.indexOf(this.target) : -1;
      this.target = sorted[(i + 1) % sorted.length];
      this.lockProgress = 0;
      this.audio.tone(1900, 0.04, 'square', 0.05);
    }
    const t = this.target;
    let inCone = false;
    if (t && !t.ecm) {
      const d = t.pos.distanceTo(p.pos);
      inCone = d < MISSILE.lockRange && p.fwd.angleTo(_v.subVectors(t.pos, p.pos)) < MISSILE.lockCone;
    }
    const lockTime = MISSILE.lockTime * (1 + Math.max(0, (p.speed - 260) / 150)) * this.lockPenalty;
    this.lockProgress = inCone ? Math.min(1, this.lockProgress + dt / lockTime) : Math.max(0, this.lockProgress - dt * 3);
    const was = this.locked;
    this.locked = this.lockProgress >= 1;
    if (this.locked && !was) this.touch.vibrate(8);
  }

  /** Touch: select the enemy nearest a tap on screen. */
  pickTargetAt(x: number, y: number): boolean {
    const cam = this.rig.camera;
    let best: Aircraft | null = null;
    let bd = 72 * 72;
    for (const a of this.aircraft) {
      if (a.team !== 'red' || !a.targetable) continue;
      _v.copy(a.pos).applyMatrix4(cam.matrixWorldInverse);
      if (_v.z > 0) continue;
      _v.copy(a.pos).project(cam);
      const sx = (_v.x * 0.5 + 0.5) * window.innerWidth;
      const sy = (-_v.y * 0.5 + 0.5) * window.innerHeight;
      const d2 = (sx - x) ** 2 + (sy - y) ** 2;
      if (d2 < bd) {
        bd = d2;
        best = a;
      }
    }
    if (!best) return false;
    if (best !== this.target) {
      this.target = best;
      this.lockProgress = 0;
      this.audio.tone(1900, 0.04, 'square', 0.05);
      this.touch.vibrate(6);
    }
    return true;
  }

  // ---------------------------------------------------------------- Combat events

  onBulletHit(a: Aircraft, b: Bullet) {
    const byPlayer = b.owner === this.player;
    if (byPlayer) {
      this.score.hit();
      if (this.realTime - this.lastHitSound > 0.06) {
        this.lastHitSound = this.realTime;
        this.audio.hitTick(0.12);
      }
    }
    this.fx.hitSparks(b.pos, a.vel);
    this.damage(a, b.damage, 'gun', byPlayer);
  }

  onMissileHit(a: Aircraft, m: Missile) {
    const byPlayer = m.owner === this.player;
    this.fx.explosion(m.pos, 0.6, a.vel);
    this.audio.explosion(this.volOf(m.pos) * 0.8, false, this.panOf(m.pos));
    if (byPlayer) {
      this.score.missilesHit++;
      this.score.hit();
    }
    this.damage(a, m.spec.damage, 'missile', byPlayer);
  }

  onMissileGround(m: Missile) {
    this.fx.explosion(m.pos, 0.5);
    if (m.pos.y < 3) this.fx.splash(m.pos, 0.7);
    this.audio.explosion(this.volOf(m.pos) * 0.6, false, this.panOf(m.pos));
  }

  onMissileJammed(_t: Aircraft, m: Missile) {
    this.fx.hitSparks(m.pos, undefined, true);
    if (m.owner === this.player && this.realTime - this.lastPopupJam > 2) {
      this.lastPopupJam = this.realTime;
      this.hud.popup([{ text: 'MISSILE JAMMED — USE GUNS', kind: 'bad' }]);
    }
  }

  private damage(a: Aircraft, amount: number, weapon: Weapon, byPlayer: boolean) {
    if (!a.alive) return;
    if (a === this.player) {
      this.playerDamaged(amount, weapon);
      return;
    }
    if (a.invulnerable) return;
    const before = a.hp;
    a.hp -= amount * a.armor;
    // Wingmen can wear a target down to a floor but never finish it (or heal it).
    if (!byPlayer && a.hpFloorFromOthers > 0) a.hp = Math.max(a.hp, Math.min(before, a.hpFloorFromOthers * a.maxHp));
    if (weapon === 'missile') this.logEvent(`hit ${a.label} ${weapon} ${(before - a.hp).toFixed(0)} hp=${a.hp.toFixed(0)}${byPlayer ? '' : ' (other)'}`);
    a.lastHitTime = this.time;
    a.lastHitWeapon = weapon;
    if (byPlayer) {
      a.lastHitByPlayer = true;
      a.lastHitDist = a.pos.distanceTo(this.player.pos);
    }
    a.brain?.onHit?.(a, this, weapon);
    this.mission.onDamaged(a);
    if (a.hp <= 0) this.kill(a, weapon, byPlayer);
  }

  private playerDamaged(amount: number, weapon: Weapon) {
    const p = this.player;
    if (!this.controlsEnabled && this.state !== 'play') return;
    if (this.god) amount = 0;
    p.hp -= amount;
    p.lastHitTime = this.time;
    this.score.damaged(amount);
    this.audio.playerHit(weapon === 'missile');
    this.touch.vibrate(weapon === 'missile' ? [70, 40, 90] : 18);
    this.rig.addTrauma(weapon === 'missile' ? 0.75 : 0.16);
    this.vignette = Math.max(this.vignette, weapon === 'missile' ? 1 : 0.4);
    this.fx.hitSparks(_v.copy(p.pos).addScaledVector(p.right, rand(-4, 4)), p.vel, weapon === 'missile');
    if (weapon === 'missile') this.fx.explosion(_v.copy(p.pos).addScaledVector(p.fwd, -6), 0.4, p.vel);
    if (p.hp <= 0) this.playerDestroyed();
  }

  private playerDestroyed() {
    const p = this.player;
    p.alive = false;
    p.wreck = true;
    p.wreckTime = 0;
    p.wreckVel.copy(p.vel).multiplyScalar(0.6);
    p.wreckSpin = randSign() * 2.5;
    this.fx.explosion(p.pos, 1.6, p.vel);
    this.fx.burningDebris(p.pos, p.vel, 4);
    this.audio.explosion(0.9, true);
    this.rig.addTrauma(1);
    this.fail('AIRCRAFT DESTROYED', 'Joker 1 is down.');
  }

  logEvent(e: string) {
    this.events.push(`${this.time.toFixed(1)} ${e}`);
    if (this.events.length > 300) this.events.shift();
  }

  kill(a: Aircraft, weapon: Weapon, byPlayer: boolean, cause = 'shot') {
    if (!a.alive) return;
    this.logEvent(`kill ${a.label} by ${byPlayer ? 'player' : 'other'} ${weapon} ${cause} alt=${Math.round(a.pos.y)} gnd=${Math.round(this.terrain.ground(a.pos.x, a.pos.z))}`);
    a.alive = false;
    a.wreck = true;
    a.wreckTime = 0;
    a.wreckVel.copy(a.vel).multiplyScalar(0.65);
    a.wreckSpin = randSign() * rand(1.5, 4);
    const big = a.kind === 'scout' || a.kind === 'ace';
    this.fx.explosion(a.pos, big ? 2.3 : 1.3, a.vel);
    this.fx.burningDebris(a.pos, a.vel, big ? 5 : 3);
    this.audio.explosion(this.volOf(a.pos), true, this.panOf(a.pos));
    const d = a.pos.distanceTo(this.player.pos);
    this.rig.addTrauma(d < 500 ? 0.4 : d < 1500 ? 0.15 : 0.04);
    if (this.target === a) {
      this.target = null;
      this.lockProgress = 0;
    }
    if (byPlayer) {
      const base = a.kind === 'scout' ? SCORE.scout : a.kind === 'ace' ? SCORE.ace : undefined;
      const label = a.kind === 'scout' ? 'SCOUT DOWN' : a.kind === 'ace' ? 'ACE DESTROYED' : undefined;
      const lines = this.score.kill({ weapon, dist: a.lastHitDist || d, base, label });
      this.hud.popup(lines);
      this.audio.comboTick(this.score.combo);
      this.touch.vibrate(a.kind === 'scout' || a.kind === 'ace' ? [30, 30, 60] : 22);
    }
    if (a.kind === 'ace') this.mission.onAceKilled();
    this.mission.onKill(a, byPlayer, weapon);
  }

  private updateWreck(a: Aircraft, dt: number) {
    a.wreckTime += dt;
    a.wreckVel.y -= 32 * dt;
    a.wreckVel.multiplyScalar(Math.exp(-0.3 * dt));
    a.pos.addScaledVector(a.wreckVel, dt);
    a.quat.multiply(_q.setFromAxisAngle(Z, a.wreckSpin * dt));
    a.quat.multiply(_q.setFromAxisAngle(X, -0.35 * dt));
    a.quat.normalize();
    a.updateBasis();
    a.vel.copy(a.wreckVel);
    a.throttle = 0;
    a.wreckEmit -= dt;
    if (a.wreckEmit <= 0) {
      a.wreckEmit = 0.03;
      this.fx.fire.emit(a.pos.x, a.pos.y, a.pos.z, 0, 0, 0, 0.35, 9, 3, 1, 0.75, 0.3, 0.9, 0.25, 0.05, 1, 0);
      const g = 0.14;
      this.fx.smoke.emit(a.pos.x, a.pos.y, a.pos.z, 0, 4, 0, 3, 6, 26, g, g, g, 0.3, 0.3, 0.32, 0.65, 0, 0.3, 3);
    }
    const gh = this.terrain.ground(a.pos.x, a.pos.z);
    if (a.pos.y <= gh + 1 || a.wreckTime > 9) {
      if (a.pos.y <= gh + 3) {
        if (gh <= 0.5) this.fx.splash(a.pos, 1.4);
        else this.fx.explosion(a.pos, 0.8);
      }
      if (a === this.player) {
        a.wreck = false;
        a.hidden = true;
      } else this.despawn(a);
    }
  }

  onPlayerCrash(kind: 'sea' | 'terrain' | 'structure') {
    const dmg = kind === 'structure' ? 45 : 34;
    this.hud.popup([{ text: kind === 'sea' ? 'WATER IMPACT' : kind === 'structure' ? 'COLLISION' : 'TERRAIN IMPACT', kind: 'bad' }]);
    if (kind === 'sea') this.fx.splash(this.player.pos, 1.2);
    else this.fx.explosion(this.player.pos, 0.5);
    this.playerDamaged(dmg, 'missile');
  }

  onPlayerBarrelRoll() {
    const p = this.player;
    this.audio.whoosh(0.25, 0);
    let evaded = 0;
    for (const m of this.weapons.incomingMissiles(p)) {
      if (m.pos.distanceTo(p.pos) < 1100 && Math.random() < 0.8) {
        this.weapons.spoof(m, p);
        evaded++;
      }
    }
    if (evaded) {
      this.weapons.dropFlares(p);
      this.hud.popup([{ text: evaded > 1 ? `EVADED x${evaded}` : 'EVADED', kind: 'gold' }]);
    }
  }

  onAiGunShot(a: Aircraft) {
    if (this.realTime - this.lastEnemyGunSound < 0.07) return;
    const d = a.pos.distanceTo(this.player.pos);
    if (d > 1500) return;
    this.lastEnemyGunSound = this.realTime;
    this.audio.enemyGun((1 - d / 1500) * 0.22, this.panOf(a.pos));
  }

  canLaunchAt(t: Aircraft): boolean {
    if (t === this.player) {
      return this.controlsEnabled && this.enemyLaunchCd <= 0 && this.weapons.incomingMissiles(t).length < 2;
    }
    return this.weapons.missiles.filter((m) => m.active && m.team === 'red').length < 5;
  }

  fireAiMissile(a: Aircraft, t: Aircraft) {
    const m = this.weapons.fireMissile(a, t, a.team === 'red' ? AI_MISSILE : PLAYER_MISSILE, 30);
    if (!m) return;
    this.audio.missileLaunch(this.volOf(a.pos) * 0.5, this.panOf(a.pos));
    if (t === this.player) {
      this.enemyLaunchCd = 2.5;
      if (this.realTime - this.lastMissileRadio > 14 && !this.hud.radioBusy) {
        this.lastMissileRadio = this.realTime;
        this.hud.radio('JOKER 2', 'Missile on you, lead! Break!');
      }
    }
  }

  onFlares(a: Aircraft) {
    this.fx.flareBurst(a.pos);
    if (a.pos.distanceTo(this.player.pos) < 1500) this.audio.flare();
  }

  onScoutEscaped(a: Aircraft) {
    if (a === this.mission.lead && a.alive) this.fail('LEAD SCOUT ESCAPED', "It crossed the boundary with the fleet's position.");
  }

  onAceForcedLow(_a: Aircraft) {
    this.logEvent('ace forced low');
    this.mission.onAceForcedLow();
  }

  onAceRecovered(_a: Aircraft) {
    this.hud.popup([{ text: 'ACE RECOVERED', kind: 'bad' }]);
  }

  onAceEnraged(_a: Aircraft) {
    this.mission.onAceEnraged();
  }

  onAceDodge(_a: Aircraft) {
    this.logEvent('ace dodge');
    if (this.realTime - this.lastDodgePopup > 2.5) {
      this.lastDodgePopup = this.realTime;
      this.hud.popup([{ text: 'ACE DODGED — PRESSURE HIM LOW', kind: 'bad' }]);
    }
  }

  private volOf(pos: THREE.Vector3) {
    const d = pos.distanceTo(this.rig.camera.position);
    return clamp(1 / (1 + d / 450), 0, 1);
  }

  private panOf(pos: THREE.Vector3) {
    const v = _v2.copy(pos).applyMatrix4(this.rig.camera.matrixWorldInverse);
    return clamp(v.x / Math.max(80, Math.abs(v.z)), -0.8, 0.8);
  }

  // ---------------------------------------------------------------- Render

  private renderFrame(rawDt: number, vdt: number) {
    const paused = this.state === 'paused';
    this.fx.update(vdt);
    const cam = this.rig.camera;
    for (const a of this.aircraft) {
      a.syncMesh(this.realTime);
      if (paused || a.frozen || a.hidden) continue;
      // Wingtip vapour under load.
      if (a.alive) {
        const s = clamp((a.gLoad - 12) / 18, 0, 1);
        const span = SPANS[a.kind];
        for (let k = 0; k < 2; k++) {
          const side = k === 0 ? -1 : 1;
          _v.copy(a.pos).addScaledVector(a.right, side * span).addScaledVector(a.fwd, -2);
          this.fx.trails.push(a.vaporTrails[k], _v, s);
        }
        a.smokeTimer -= vdt;
        if (a.hp < a.maxHp * 0.5 && a.smokeTimer <= 0 && !a.invulnerable) {
          a.smokeTimer = 0.04;
          const sev = 1 - a.hp / (a.maxHp * 0.5);
          this.fx.damageSmoke(_v.copy(a.pos).addScaledVector(a.fwd, -8), a.vel, clamp(sev, 0, 1));
        }
      }
    }
    if (!paused) this.fx.trails.update(cam.position);
    this.weapons.render();
    this.rig.update(paused ? 0 : rawDt, this);
    this.env.update(vdt, this.realTime, cam);
    const cloud = this.env.cloudDensityAt(cam.position);
    this.cloudEl.style.opacity = String(clamp(cloud * 1.6, 0, 0.92));
    this.vignette = Math.max(0, this.vignette - rawDt * 1.8);
    const p = this.player;
    const lowHull = p.alive && this.state === 'play' && p.hp < p.maxHp * 0.3 ? 0.25 + 0.15 * Math.sin(this.realTime * 6) : 0;
    this.vignetteEl.style.opacity = String(Math.max(this.vignette, lowHull));
    this.hud.update(paused ? 0 : rawDt, this);
    this.hud.draw(this);
    // Audio.
    const active = (this.state === 'play' || this.state === 'clear') && p.alive && !p.hidden;
    this.audio.updateEngine(p.speed, p.throttle, this.pc.boosting, active, this.realTime);
    const t = this.target;
    const lockState = !this.controlsEnabled || !t || t.ecm ? 'none' : this.locked ? 'locked' : this.lockProgress > 0 ? 'locking' : 'none';
    this.audio.setLockTone(lockState, this.realTime);
    const incoming = this.controlsEnabled ? this.weapons.incomingMissiles(p) : [];
    const close = incoming.some((m) => m.pos.distanceTo(p.pos) < 900);
    this.audio.setMissileAlert(incoming.length ? (close ? 2 : 1) : 0, this.realTime);
    this.updateTouchUi();
    this.adaptResolution();
    this.renderer.render(this.scene, cam);
  }

  private updateTouchUi() {
    const t = this.touch;
    if (!t.enabled) return;
    const p = this.player;
    const tg = this.target && this.target.targetable ? this.target : null;
    let gunHot = false;
    if (tg && p.alive) {
      const d = tg.pos.distanceTo(p.pos);
      if (d < 1300) {
        _v2.copy(tg.pos).addScaledVector(tg.vel, d / (GUN.speed + p.speed)).sub(p.pos).normalize();
        gunHot = p.fwd.angleTo(_v2) < 0.035;
      }
    }
    const incoming = this.weapons.incomingMissiles(p).some((m) => m.pos.distanceTo(p.pos) < 1300);
    t.render({
      live: this.state === 'play',
      controls: this.controlsEnabled && !this.cinematic,
      lock: tg && !tg.ecm ? this.lockProgress : 0,
      locked: this.locked && !!tg && !tg.ecm,
      ecm: !!tg?.ecm,
      rails: [this.railFill(0), this.railFill(1)],
      boost: this.pc.boostEnergy,
      boosting: this.pc.boosting,
      gunHot,
      evade: incoming && this.controlsEnabled,
      orders: !this.formation && this.hud.wingOrderShown ? this.wingOrder : null,
      teach: this.touchTeach,
      hint: this.skippable && this.state === 'play' ? 'TAP TO LAUNCH' : '',
    });
  }

  private railFill(i: number) {
    return this.missileRails[i] <= 0 ? 1 : 1 - this.missileRails[i] / MISSILE.reload;
  }

  private enterFullscreen() {
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    if (document.fullscreenElement) return;
    try {
      const req = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : (el.webkitRequestFullscreen?.(), undefined);
      const lock = () => {
        const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
        o?.lock?.('landscape').catch(() => {});
      };
      if (req) req.then(lock).catch(() => {});
      else lock();
    } catch {
      /* fullscreen is best-effort (iPhone Safari has none) */
    }
  }

  /** Hold frame rate by trading render resolution, mainly for phones. */
  private adaptResolution() {
    const now = performance.now();
    const dt = now - this.perfLast;
    this.perfLast = now;
    if (this.state === 'paused' || this.state === 'debrief' || dt > 250) return;
    this.perfAcc += dt;
    this.perfN++;
    if (this.perfAcc < 2000) return;
    const fps = (1000 * this.perfN) / this.perfAcc;
    this.perfAcc = 0;
    this.perfN = 0;
    if (fps < 48 && this.dpr > 0.7) {
      this.dpr = Math.max(0.7, this.dpr * 0.85);
      this.perfHoldUntil = now + 20000;
      this.perfGood = 0;
      this.resize();
    } else if (fps > 57 && this.dpr < this.dprMax && now > this.perfHoldUntil) {
      if (++this.perfGood >= 3) {
        this.dpr = Math.min(this.dprMax, this.dpr * 1.12);
        this.perfGood = 0;
        this.resize();
      }
    } else this.perfGood = 0;
  }

  get renderScale() {
    return this.dpr;
  }
}

function loadSettings(): Settings {
  const def: Settings = { invertPitch: false, voice: true, music: true, reducedMotion: false, mute: false, assist: true, tilt: false, haptics: true };
  try {
    const raw = localStorage.getItem('jokersrun.settings');
    if (raw) return { ...def, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return def;
}

function saveSettings(s: Settings) {
  try {
    localStorage.setItem('jokersrun.settings', JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
