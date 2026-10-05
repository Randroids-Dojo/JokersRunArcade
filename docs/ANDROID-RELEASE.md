# Joker's Run Android release handoff

Prepared 2026-10-05 for Randroid LLC / Toyboxes. This is the offline package of Mission 01, with no monetization SDK. The Play Console parent task owns pricing, listing and submission.

## Identity and artifacts

- Package: `app.toyboxes.jokersrun`; no prior Android identity/signing config existed in this source. Parent confirmed Toyboxes had no existing app entries.
- Version name `1.0.0`, version code `1`; min SDK `26`, compile/target SDK `36`.
- Java Activity + AndroidX WebViewAssetLoader serves bundled `dist/` over a reserved local HTTPS origin. External requests and navigation are blocked, with no INTERNET permission. Changes require an app update.
- Build: JDK17, Gradle8.13 (checksum pinned), AGP8.12.2, SDK build-tools36.0.0. WebKit1.14.0. No packaged native `.so` libraries.
- Release outputs: `android/app/build/outputs/bundle/release/app-release.aab`, `android/app/build/outputs/apk/release/app-release-unsigned.apk`. Debug APK is also deliberately unsigned until signing is authorized.
- Adaptive icon uses parent-supplied original jet artwork (Library `libfile_cd97cfb7632c8191ad6e6a86bad9a041`) with safe padding; original RGB PNG remains the legacy fallback. Store assets belong to the parent task.

## Signing and submission gate

The build config never silently creates a debug or release keystore. No private credentials belong in Git, Library, build archives or screenshots. The upload-signed AAB is needed for Play; an unsigned AAB cannot be submitted. Google Play App Signing should own the app signing key, while the publisher retains its separate upload key.

Proposed local retention: `%USERPROFILE%/.android/jokers-run-signing/`, protected to the current user, with separate `upload.jks` / alias `jokers-run-upload` and `debug.jks` / alias `jokers-run-debug`, each with a random password retained using Windows DPAPI (`*-password.xml`). Public PEM certificates may be shared; private keys/passwords must remain local. `scripts/sign-android.ps1` uses this approved workflow without printing passwords and verifies APK signatures. The script does not generate keys.

At this handoff, automatic approval review rejected generation twice because it did not accept the forwarded parent approval as a confirmed handoff, even after checking the source task's official record. No keys were generated. A direct approval question is pending in the randroid-pc task. Do not substitute another key/tool/host to bypass this block.

The current execution tools provide no way to change auto-review into a human action-time permission prompt. If that remains blocked, the user can review and run `scripts/prepare-and-sign-android.ps1 -CreateSigningKeys` themselves on randroid-pc using PowerShell. This script checks that all unsigned build outputs exist, generates separate local identities without hardcoded passwords, restricts the signing directory to the current user, protects passwords with Windows DPAPI, signs the AAB/release APK/debug APK, and verifies signatures. It refuses to overwrite an incomplete existing identity. The agent has only parsed/reviewed this script, not executed it.

## Verification and limits

- Locked `npm ci`: succeeds, audit reports zero vulnerabilities.
- TypeScript check and Vite production build: pass.
- Existing Chrome mobile suite: 28/28 pass, including real multi-touch via CDP and synthetic tilt conventions. Script now returns failure on failed checks/page errors.
- Production Chrome suite: offline local fonts/assets and in-app privacy policy; Back behavior through the native event contract; background freezes simulation/audio and foreground stays paused; local settings; landscape 640x360 / 960x540 / 1280x800 and portrait 800x1280; no remote requests or resource/page/console errors.
- Full mission: real input bot, direct steering setting, 2x simulation, god mode off; reaches debrief with score67,790 and hull100, no page errors. This is automation coverage; human difficulty/comfort and audio quality remain unmeasured.
- Android bundle/APK compilation and release lint pass with zero errors. Remaining lint warnings concern supported newer manifest attributes, pinned tooling, orientation advisory and icon polish. API36 can ignore landscape requests on large screens; portrait shows the existing rotate prompt and pauses. Tablet portrait play is not implemented.
- No adb-connected physical devices; no emulator/system image installed. Native WebView rendering, runtime lifecycle/predictive Back, actual sensor mapping/availability, sound and vibration are **not tested on Android**. Browser event tests do not establish native runtime success. Physical phone/tablet touch/tilt and cutout testing is still required before paid production release.

## Privacy, data safety and permissions

- Only declared permission in the merged release manifest: `android.permission.VIBRATE` (normal, optional haptics; no dangerous permission prompt).
- No accounts, ads, IAP, analytics/crash SDK, cookies, tracking identifiers, backend/API, network permission, sharing or uploads.
- Private WebView localStorage: `jokersrun.best` (best numeric score) and `jokersrun.settings` (control/audio/accessibility choices). Delete via Clear storage/uninstall. Android backup and transfer excluded.
- Optional motion readings steer locally, are not stored or transmitted. No activity/fitness/location sensor purpose.
- Synthesized music/effects local. Radio speech only selects `localService` English voices, with captions if no local voice exists. System WebView/OS updates and user support email have their own provider behavior.
- App-defined cryptography/encryption, export crypto libraries or transmission: none found. HTTPS-looking origin is intercepted local assets, not a connection. Publisher/Console owns the legal export declaration.
- Suggested Data safety answers for this exact Android build: no collected/shared user data, no account creation, no account deletion flow, no advertising ID, no ads, no in-app purchases. Do not describe local-only settings/sensors as server collection. Reassess if a later SDK/network feature is added.
- Public policy source: `public/privacy.html`, publisher Randroid LLC, `support@toyboxes.app`. In-app link works offline. Parent must verify a publicly reachable deployed `/privacy.html` URL for Console; a draft source URL is insufficient.

## Assets and notices

Game models/terrain/ocean/effects/audio are procedural source content. Three.js is MIT (notice bundled). Unmodified Chakra Petch is SIL OFL1.1 (OFL bundled). AndroidX dependencies are Apache2.0 (text bundled). Launcher artwork is original art supplied by the parent release task. No third-party branded recordings/images are introduced.

Screenshots are real Chrome renders of the same production assets in mobile touch emulation, 1920x1080 PNG (16:9). No generated gameplay imagery, artwork composites, upscaling, or fabricated UI. Checkpoint-selected captures have god mode off. Full mission captures use the real-input bot with direct steering. They are not device/emulator screenshots; parent should label the evidence accurately.

## Release notes (en-US)

Mission 01: launch from the carrier, master your flight controls, and stop enemy scouts before they transmit the fleet's position. Fight through dogfights, a canyon chase and an ace encounter. Play offline with touch controls, optional tilt steering, local best scores and checkpoint retries.

## Final release checklist

1. Resolve direct signing approval and create/retain the upload and separate debug identities safely. Sign/verify the final AAB and APK without exporting private keys.
2. Install signed APK on emulator/physical devices and check WebGL, multi-touch, home/background/resume, predictive Back, portrait/tablet behavior, cutouts, tilt, haptics and audio. Request approval if installation presents new terms or charges.
3. Verify final deployed privacy URL and final screenshot/art assets. Parent completes age/content rating, app access, Data safety, pricing and country distribution declarations.
4. Upload signed AAB, inspect Play processing and pre-launch results; satisfy account testing/production-access requirements. Do not infer launch success from building a package or drafting a listing.
