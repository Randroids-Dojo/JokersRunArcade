import { SCORE } from './config';
import { Weapon } from './aircraft';

export interface PopLine {
  text: string;
  points?: number;
  kind?: 'kill' | 'bonus' | 'combo' | 'time' | 'gold' | 'bad';
}

export interface KillInfo {
  weapon: Weapon;
  dist: number;
  base?: number;
  label?: string;
}

export class Score {
  total = 0;
  hotStart = 1;
  combo = 0;
  comboTimer = 0;
  comboMax = 0;
  comboBreaks = 0;
  /** Decay pauses outside of live combat beats. */
  comboFrozen = true;
  missileKills = 0;
  gunKills = 0;
  damageTaken = 0;
  damageSinceKill = 0;
  shotsFired = 0;
  shotsHit = 0;
  missilesFired = 0;
  missilesHit = 0;
  aceBonus = false;
  aceComboBonus = false;
  tutorialTime = 0;
  cleanCount = 0;
  private snapshot: Partial<Score> | null = null;
  onBreak: (() => void) | null = null;

  get comboMult() {
    return 1 + Math.min(this.combo - 1, 10) * 0.2;
  }

  add(points: number) {
    this.total += points;
  }

  /** Apply combat multipliers and return the popup lines. */
  kill(info: KillInfo): PopLine[] {
    const lines: PopLine[] = [];
    this.combo += 1;
    this.comboMax = Math.max(this.comboMax, this.combo);
    this.comboTimer = SCORE.comboWindow;
    let sum = 0;
    if (info.base !== undefined) {
      lines.push({ text: info.label ?? 'TARGET DESTROYED', points: info.base, kind: 'gold' });
      sum += info.base;
    }
    const wBase = info.weapon === 'gun' ? SCORE.gunKill : SCORE.missileKill;
    lines.push({ text: info.weapon === 'gun' ? 'GUN KILL' : 'MISSILE KILL', points: wBase, kind: 'kill' });
    sum += wBase;
    if (info.weapon === 'gun') this.gunKills++;
    else this.missileKills++;
    if (info.dist < SCORE.closeDist) {
      lines.push({ text: 'CLOSE RANGE', points: SCORE.closeRange, kind: 'bonus' });
      sum += SCORE.closeRange;
    }
    if (this.damageSinceKill <= 0) {
      lines.push({ text: 'NO DAMAGE BONUS', points: SCORE.noDamage, kind: 'bonus' });
      sum += SCORE.noDamage;
    }
    this.damageSinceKill = 0;
    const mult = this.comboMult * this.hotStart;
    const final = Math.round(sum * mult);
    if (this.combo >= 2) lines.push({ text: `COMBO x${this.combo}`, kind: 'combo' });
    this.total += final;
    lines.push({ text: `+${final.toLocaleString('en-US')}`, kind: 'gold' });
    return lines;
  }

  hit() {
    this.shotsHit++;
    if (this.combo > 0) this.comboTimer = Math.max(this.comboTimer, SCORE.comboHitRefresh);
  }

  damaged(amount: number) {
    this.damageTaken += amount;
    this.damageSinceKill += amount;
    if (this.combo > 0) this.comboTimer -= SCORE.comboDamagePenalty * Math.min(1, amount / 10);
  }

  tick(dt: number) {
    if (this.combo <= 0 || this.comboFrozen) return;
    this.comboTimer -= dt;
    if (this.comboTimer <= 0) {
      this.combo = 0;
      this.comboTimer = 0;
      this.comboBreaks++;
      this.onBreak?.();
    }
  }

  save() {
    this.snapshot = {
      total: this.total,
      hotStart: this.hotStart,
      combo: this.combo,
      comboTimer: this.comboTimer,
      comboMax: this.comboMax,
      comboBreaks: this.comboBreaks,
      missileKills: this.missileKills,
      gunKills: this.gunKills,
      damageTaken: this.damageTaken,
      shotsFired: this.shotsFired,
      shotsHit: this.shotsHit,
      missilesFired: this.missilesFired,
      missilesHit: this.missilesHit,
      aceBonus: this.aceBonus,
      aceComboBonus: this.aceComboBonus,
      tutorialTime: this.tutorialTime,
      cleanCount: this.cleanCount,
    };
  }

  restore() {
    if (this.snapshot) Object.assign(this, this.snapshot);
    this.damageSinceKill = 0;
  }

  reset() {
    this.total = 0;
    this.hotStart = 1;
    this.combo = 0;
    this.comboTimer = 0;
    this.comboMax = 0;
    this.comboBreaks = 0;
    this.missileKills = 0;
    this.gunKills = 0;
    this.damageTaken = 0;
    this.damageSinceKill = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.missilesFired = 0;
    this.missilesHit = 0;
    this.aceBonus = false;
    this.aceComboBonus = false;
    this.tutorialTime = 0;
    this.cleanCount = 0;
    this.snapshot = null;
  }

  rank(): string {
    const s = this.total;
    if (s >= 170000) return 'S';
    if (s >= 115000) return 'A';
    if (s >= 70000) return 'B';
    if (s >= 35000) return 'C';
    return 'D';
  }
}
