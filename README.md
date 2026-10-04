# Joker's Run — Mission 01

An arcade flight combat demo for the browser. You launch off a retreating carrier, run a timed flight check, shoot three training drones, then stop enemy recon planes before they send the fleet's position out: dogfight, canyon chase, two-stage ace, final 25-second intercept, epilogue.

Three.js + TypeScript + Vite. All models, terrain, ocean, sky, effects, music, and sound are procedural. There are no asset files.

**[Play it](https://jokers-run-arcade.vercel.app)**

## Run

```sh
npm install
npm run dev        # http://localhost:5190
npm run build      # type-check + production bundle in dist/
npm run preview    # serve dist/ on :5190
```

Click **LAUNCH** or press Enter. Audio starts on the first key press or click.

## Deployment

[Randroids-Dojo/JokersRunArcade](https://github.com/Randroids-Dojo/JokersRunArcade) is connected to the `jokers-run-arcade` Vercel project in `randroid88s-projects` through the native GitHub integration. Pushing to `main` deploys production at **https://jokers-run-arcade.vercel.app**; other branches get preview deployments. `vercel.json` sets the Vite preset, `npm ci`, and `npm run build` (type check, then bundle) with `dist/` as output, so a type error stops the deploy. No secrets or environment variables are needed.

## Controls

| Input | Action |
| --- | --- |
| W / S (or ↑ ↓) | Climb / dive (invert in the title or pause menu) |
| A / D (or ← →) | Bank. Banking turns the jet; pull back while banked to turn hard |
| Q / E | Rudder |
| Shift | Boost (meter recharges when released) |
| X | Brake: slower, tighter turns |
| Double-tap A or D, or R | Barrel roll: dodges missiles that are close |
| Space / left mouse | Guns. The lead circle shows where to aim |
| F / right mouse | Missile. Lock first: hold the target in the dashed circle until the diamond turns red |
| Tab / T | Next target |
| V (hold) | Look at target |
| 1 / 2 / 3 | Wingmen: cover me / attack scouts / split |
| Esc / P | Pause (settings, restart checkpoint) |
| M | Mute |

Gamepad (standard mapping): left stick flies, LB/RB rudder, RT boost, LT brake, X guns, A missile, B roll, Y target, D-pad wingman orders, Start pause.

## Mission flow

| Storyboard beat | In game |
| --- | --- |
| Opening | Deck shot, one radio line, catapult launch in about 5 s (Enter skips the wait) |
| 1 · Launch + movement | Five rings: CLIMB, BANK LEFT, BOOST, BRAKE, ROLL. Each ring scores a pass, a clean execution (doing the named maneuver), and a bullseye. Time plus clean passes set the **Hot Start** multiplier (up to x2.0) for the rest of the mission |
| 2 · Target practice | Drone A teaches lock-on. Drone B jams missiles, so only guns work. Drone C is fast and evasive. COMBO x3, TRAINING COMPLETE |
| Warning | Radar fills with red contacts, WARNING banner, klaxon, combat music, training HUD clears |
| 3 · Stop the scouts | Three scouts with live upload meters and a 01:30 transmission clock. Damaging a scout jams its upload; each escort kill adds 10 s. Wingmen orders decide who they harass |
| 4 · First dogfight | Fighters dive from behind ("Two on your six!"), more waves arrive while you fight |
| 5 · Escape chase | Killing the first scout sends the lead scout low through the sea cliffs, the canyon gap, under the suspension bridge and out to open water. Boost lowers lock speed and the scout flares often, so guns matter. Lose it past the boundary and the mission fails |
| 6 · Reinforcements | Escorts scatter, ENEMY ACE APPROACHING, the ace dives in head-on |
| 7 · Mini-boss | Stage 1: high-energy loops, dodges most missiles. Stay on its tail to fill **PRESSURE** and force it low, where it is vulnerable. At 50%: ACE ENRAGED, head-on attacks. Optional: kill it without breaking your combo |
| 8 · Final scout | FINAL TARGET ESCAPING, 00:25 clock, 10…1 countdown. The ace keeps harassing you if it is still alive |
| Clear + epilogue | Music drops, radio lines, squad turns home, shot of the carrier, pan to the storm front, NEXT MISSION: BREAKOUT, debrief with rank |

Scoring: MISSILE KILL +1,000 · GUN KILL +1,500 · CLOSE RANGE +500 · NO DAMAGE BONUS +500 · SCOUT +3,000 · ACE DESTROYED +10,000. Kills chain into a combo (10 s window; hits keep it alive, damage shortens it). Kill score is multiplied by the combo and Hot Start. Each phase is a checkpoint: failing offers a retry from the start of that phase with the score you had there.

## Code map

| File | Role |
| --- | --- |
| `src/game.ts` | World ownership, fixed 120 Hz simulation, weapons/lock-on, damage and kills, screens |
| `src/mission.ts` | The storyboard as async scripts on simulation time; checkpoint setups |
| `src/player.ts` | Player flight model (banked turns, boost/brake, barrel roll, collisions) |
| `src/ai.ts` | Fighter, escort, scout, drone, wingman, and ace pilots |
| `src/weapons.ts` | Tracers, homing missiles, flares, spoofing |
| `src/terrain.ts` | Height field (coast, cliffs, canyon, sea stacks) and the bridge |
| `src/environment.ts` | Sky, ocean shader, clouds, storm front |
| `src/hud.ts` | HUD overlay: target boxes, lead pipper, ladder, radar |
| `src/audio.ts` | WebAudio engine, weapons, alerts, sequenced music, spoken radio |

## Playtest tooling

`?debug` exposes `window.__joker` (start any checkpoint, god mode, autopilot, sim speed, event log). `?debug&bot` turns on a test pilot that writes the same control fields as the keyboard, so it exercises the real flight model and weapons.

```sh
npm run dev                                   # in one terminal
node scripts/playtest.mjs launch 2 300        # full bot run at 2x, screenshots to artifacts/
GOD=1 node scripts/playtest.mjs ace 1 120     # one phase, invulnerable
```

The scripts drive the installed Google Chrome through `playwright-core`.

## Known limits

- Difficulty was tuned against the bot, which aims perfectly and flies poorly. It clears the mission in about 2.5 minutes of game time. The 8–10 minute target for a human first run is an estimate, not measured.
- Sound and the spoken radio (browser speech synthesis; quality depends on the system voices) were not judged by ear. Radio text always appears on screen.
- No touch controls. The fonts load from Google Fonts with a system fallback.
