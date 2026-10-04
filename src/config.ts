// Tuning values. Distances are metres, speeds m/s, angles radians.

export const SIM_STEP = 1 / 120;

export const PLAYER = {
  cruise: 235,
  boost: 410,
  brake: 140,
  minSpeed: 105,
  maxSpeed: 480,
  pitchRate: 1.4,
  rollRate: 3.2,
  yawRate: 0.5,
  bankTurn: 0.6,
  hp: 100,
  boostDrain: 0.14,
  boostRegen: 0.16,
  boostRegenDelay: 0.8,
  rollDuration: 0.6,
  rollCooldown: 1.0,
  rollJink: 70,
  ceiling: 6500,
  regenDelay: 7,
  regenRate: 2.5,
};

export const GUN = {
  rate: 18,
  speed: 1150,
  life: 1.25,
  damage: 6,
  spread: 0.004,
  assistCone: 0.08,
  assistMax: 0.045,
};

export const MISSILE = {
  reload: 2.0,
  launchBoost: 40,
  maxSpeed: 640,
  accel: 320,
  turn: 2.6,
  life: 6.5,
  damage: 100,
  lockCone: 0.36,
  lockRange: 3300,
  lockTime: 0.5,
  proximity: 14,
};

export const ENEMY_MISSILE = {
  maxSpeed: 520,
  accel: 250,
  turn: 2.0,
  life: 6,
  damage: 24,
  proximity: 10,
};

export const SCORE = {
  missileKill: 1000,
  gunKill: 1500,
  closeRange: 500,
  closeDist: 420,
  noDamage: 500,
  scout: 3000,
  ace: 10000,
  aceCombo: 5000,
  checkpoint: 300,
  clean: 500,
  bullseye: 250,
  comboWindow: 10,
  comboHitRefresh: 5,
  comboDamagePenalty: 2,
};

export const WORLD = {
  fleetSpeed: 18,
  boundaryX: 17200,
  areaRadius: 32000,
};
