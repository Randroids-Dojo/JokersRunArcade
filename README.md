# Joker's Run — Mission 01

An arcade flight combat demo for the browser. You launch off a retreating carrier, run a timed flight check, shoot three training drones, then stop enemy recon planes before they send the fleet's position out: dogfight, canyon chase, two-stage ace, final 25-second intercept, epilogue.

Three.js + TypeScript + Vite. All models, terrain, ocean, sky, effects, music, and sound effects are procedural. The only asset files are the recorded radio voices.

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

### Phones and tablets

Touch controls appear automatically on touch devices. Play in landscape; the game pauses and asks you to rotate in portrait. Launching goes fullscreen and locks landscape where the browser allows it (Android). On iPhone, **Share → Add to Home Screen** gives the same fullscreen, landscape app.

| Touch | Action |
| --- | --- |
| Left thumb, anywhere on the left half | Floating flight stick. It appears under your thumb and follows if you drift past the rim |
| Assisted steering (default) | Push the stick where you want to go: sideways banks and turns for you, up/down sets a climb or dive angle, let go to fly level. Turn it off in Settings for direct roll/pitch with full aerobatics |
| GUN (hold) | Guns. The button lights up when your lead is on target |
| MSL (tap) | Missile. The ring fills as the lock builds and turns red when locked; the pips show both rails reloading |
| BOOST | Tap to latch the afterburner (tap again, brake, or an empty tank cancels it); press and hold for a momentary burst. The button shows remaining fuel |
| BRAKE (hold) | Slow down and turn tighter |
| ROLL / EVADE | Barrel roll. It turns red and reads EVADE when a missile is closing |
| TGT | Tap for the next target, hold to look at it. You can also tap any enemy on screen to target it |
| Blue buttons | Wingman orders while the scouts are up |
| ❚❚ | Pause |

Settings (title or pause): assisted steering, tilt steering (turn the phone like a wheel; pull the top edge toward you to climb; it calibrates to how you hold it when the mission starts), haptics, invert pitch. The tutorial highlights the control each step asks for. Render resolution adapts to hold the frame rate.

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
| `src/audio.ts` | WebAudio engine, weapons, alerts, sequenced music, radio voice clips |

## Playtest tooling

`?debug` exposes `window.__joker` (start any checkpoint, god mode, autopilot, sim speed, event log). `?debug&bot` turns on a test pilot that writes the same control fields as the keyboard, so it exercises the real flight model and weapons.

```sh
npm run dev                                   # in one terminal
node scripts/playtest.mjs launch 2 300        # full bot run at 2x, screenshots to artifacts/
GOD=1 node scripts/playtest.mjs ace 1 120     # one phase, invulnerable
node scripts/mobile.mjs                       # phone emulation, real multi-touch, 28 checks
```

The scripts drive the installed Google Chrome through `playwright-core`. `node scripts/radio.mjs` flies the mission and logs whether each radio line played its clip.

## Radio voices

The radio chatter is pre-recorded with ElevenLabs, the same way the Animal-Sounds clips are made, and played through Web Audio, so mute, pause and the RADIO VOICE setting all apply to it. Each speaker has a voice designed for the part:

| Speaker | Who | Voice |
|---|---|---|
| HALCYON | Carrier air operations | Deep, calm baritone, fifties |
| LANTERN | Airborne early-warning controller | Crisp, clipped, thirties |
| JOKER 2 | Veteran lead wingman | Smooth, dry, mid-thirties |
| JOKER 3 | Younger wingman | Bright, quick, late twenties |
| JOKER 4 | Wingman of few words | Low and gravelly, forties |

- `scripts/voice/cast.json` holds each voice's description and ElevenLabs id. The model is `eleven_v3`.
- `scripts/voice/lines.json` holds every radio line. Each line has a delivery tag such as `[urgent]`, and can carry a `say` override where the spoken text needs a nudge.
- `scripts/voice/generate.py` renders the lines and runs each through a radio filter (300-3400 Hz band, compression, light clipping, faint hiss). It writes `public/voice/*.mp3` and `src/voice-manifest.json`.
- The unfiltered takes are cached in `scripts/voice/raw/`, so only new or changed lines cost API calls.

```sh
PY=../ChannelKnowledgeBase/.venv/bin/python   # numpy + mlx_whisper; key from ELEVENLABS_API_KEY or ../ChannelKnowledgeBase/.env
$PY scripts/voice/generate.py check     # lines.json matches every radio call in src/
$PY scripts/voice/generate.py lines     # render new or changed lines
$PY scripts/voice/generate.py verify    # transcribe every clip with Whisper and compare it with its caption
```

To re-roll a take, give its line a new `seed`. To recast a speaker, run `design WHO` (three previews land in the gitignored `scripts/voice/auditions/`), then `create WHO N`, then `lines`.

## Known limits

- Difficulty was tuned against the bot, which aims perfectly and flies poorly. It clears the mission in about 2.5 minutes of game time. The 8–10 minute target for a human first run is an estimate, not measured.
- Sound was not judged by ear. Every radio clip was transcribed with Whisper and matches its caption; the voices were picked by measured pitch, brightness, roughness and pace, and the delivery of each take was not judged by ear. Radio text always appears on screen.
- Touch controls were verified in Chrome's phone emulation with real multi-touch events, not on a physical phone. Tilt steering was checked with synthetic orientation events against the W3C angle conventions; the feel on real hardware, iOS Safari behaviour, and haptics (Android only; iOS Safari has no vibration API) still need a device.
- Chakra Petch fonts are bundled locally under the SIL Open Font License; the game needs no font network requests. Radio speech uses local system voices only and always has captions.

## Android / Google Play

The Android app bundles the production game for offline play in a native WebView. It does not load the website. Package `app.toyboxes.jokersrun`, version `1.0.0` / code `1`, minimum Android 8 / API 26, target Android 16 / API 36. The only permission is vibration for optional haptics. No ads, in-app purchases, accounts, analytics, network permission, or data uploads.

Build with JDK 17, Android SDK platform/build-tools 36, and the checked-in Gradle wrapper:

```powershell
npm ci
npm run build
.\android\gradlew.bat -p android :app:bundleRelease :app:assembleRelease :app:assembleDebug :app:lintRelease
```

Outputs are unsigned by default. See [Android release handoff](docs/ANDROID-RELEASE.md) for signing, native QA, privacy disclosures and remaining release gates. [Privacy policy](public/privacy.html) is bundled in the title and pause menus and available at `/privacy.html` on web deployments. Source-native tests use installed Chrome: `npm run test:mobile` against port 5190; `npm run test:release` and `npm run test:mission` against the production preview on port 5191.
