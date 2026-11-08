# Application UI Description content

This is source content for Samsung's mandatory presentation template. The completed
14-slide v1.42 PPTX is at `release-artifacts/samsung/JokersRun-UI-Description-1.0.0.pptx`.
All required sections are filled and seven real UI captures are included. The file
was rendered and visually checked; its Seller Office attachment/save is unverified.
Regenerate with `scripts/samsung-ui-description.py` and the official downloaded template.

Application: Joker's Run. Content provider: Randroid LLC. Application version:
1.0.0. Description version: 1.0. Date: November 7, 2026. Author: Randroid LLC.
Initial revision: Samsung TV edition of Mission 01.

## UI structure

Title → Mission → Paused → Resume / Restart checkpoint / Restart mission / Title.
Mission → Failed → Retry checkpoint / Restart mission. Mission → Debrief → Fly
again / Title. Title and Paused → Privacy → Previous menu. Title → Exit
confirmation → Keep playing / Smart Hub. Exit key → Smart Hub from every screen.
Background/power/Home → suspended mission; foreground → Paused until Resume.

## Use cases

1. Fly the mission. From Title choose Launch with OK/A. Complete the five maneuver
   rings, destroy the three training drones, then destroy recon planes before
   their transmission clocks expire. Fight escorts, follow the canyon chase,
   engage the ace and intercept the last scout. Hold a target inside the lock
   circle before firing a missile. The jamming training drone requires guns.
2. Use flight commands. During flight press Return. Navigate to Boost or Brake
   and press OK to toggle that throttle mode and resume. Selecting one cancels
   the other. Other commands cycle targets, fire a locked missile, evade, or
   change wingman orders. Disabled commands are unavailable in the current phase.
3. Recover after failure. In Failed select Retry from checkpoint to replay the
   current phase with its checkpoint score, or Restart mission to begin again.
4. Change settings. Title and Paused offer invert pitch, radio voice, music and
   reduced shake. Paused also offers all sound. Toggle the focused setting with
   OK/A. Settings and best score persist locally. There is no language selector.
5. Read privacy. Select Privacy Policy on Title or Paused. Scroll with up/down.
   Return or Close restores the prior menu focus. All policy text is local.
6. Exit. Return on Title opens confirmation. Keep playing cancels. Exit to Smart
   Hub terminates the app. Samsung Exit / long Return exits immediately.

## Menus and functions

Use `assets/01-title.jpg` for Title and actual runtime screenshots under
`release-artifacts/samsung/` for Paused, Failed and Debrief. The completed document includes Privacy and Exit confirmation from the packaged
browser build. Replace them with final signed-device captures after physical QA
if required by Samsung; no existing capture is presented as device evidence.
Label the screenshot elements and provide the following corresponding functions.

| Screen | Elements and functions |
| --- | --- |
| Title | Mission title/story; Launch starts Mission 01; four settings toggles; local best score; Privacy opens offline policy; Exit opens confirmation; remote/gamepad help |
| Mission | Score, Hot Start/combo, objective and clocks, scout upload bars, selected target and lock, lead pipper, speed/boost, altitude, radar, missile rails, hull, captioned radio, incoming missile warnings, contextual tutorial prompts |
| Paused | Resume; Restart checkpoint; Restart mission; Quit to title; six flight commands; invert pitch/radio/music/reduced shake/all sound toggles; Privacy |
| Failed | Failure reason, retry current checkpoint, restart mission |
| Debrief | Rank and mission statistics; local best score; Fly again; Title; Breakout is a non-playable next-mission teaser |
| Privacy | Scrollable policy and Close; Return restores focus |
| Exit confirmation | Keep playing returns to title; Exit to Smart Hub terminates |

## Remote control keys

Arrows fly with assisted steering; holding OK fires guns and locked missiles.
Double left/right evades. In menus arrows move focus and OK selects. Return pauses
flight, resumes the pause menu, closes dialogs, or offers exit on Title. Exit
terminates immediately. Home and volume/power remain platform-controlled.
Optional color keys are red evade, green boost, yellow brake, blue next target;
they are not required to play. Optional Media Play/Pause opens/closes pause.

Gamepad: left stick fly, X guns, A missile, B evade, Y target, RT boost, LT brake,
LB/RB rudder, D-pad up/left/right issue cover/scouts/split orders, Start pauses.
Menus accept D-pad/left stick, A select, B back. Disconnect pauses the mission.

## Language options

English only, including UI, captions and recorded radio. No language-switching
feature. No login, device activation, account, trivia, payment, voucher, Smart View
mobile integration, server geo-filter, or external content is present.

## QA access and provenance

Mission 01 is the only playable level. For direct checkpoint access in the Web
Inspector, reload the local entry with `?debug`, then use
`__joker.start('launch'|'training'|'scouts'|'chase'|'ace'|'final')`. Use
`__joker.god(true)` only for certification navigation when necessary; disable it
for gameplay validation. These are existing development hooks, not player menus.

The prepared marketing captures are actual desktop-browser renders of the
packaged TV build with no invulnerability or bot, using checkpoint selection.
They are not presented as physical TV evidence. The Samsung author certificate is issued and backed up. The distributor certificate,
physical TV playtest and Seller Office submission remain unverified until the
release status records their actual results.
