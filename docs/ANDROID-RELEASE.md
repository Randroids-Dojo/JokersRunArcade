# Joker's Run Android release handoff

Prepared 2026-10-05 for Randroid LLC / Toyboxes. The Play Console parent task owns pricing, listing and submission. Submission is held while the publisher confirms the expected update and recording rights.

## Identity and packaging

- Package `app.toyboxes.jokersrun`; no prior Android identity existed in the source and the parent confirmed no existing Toyboxes Play app.
- Version `1.0.1`, version code `2`, incorporates main's recorded-radio update `ea123d2386a6239b1502a9a5eebb297340258f19`. Code 1 is already uploaded to a saved Console draft and must be replaced before submission.
- Minimum API26, target/compile API36. JDK17, Gradle8.13 with pinned checksum, AGP8.12.2, build-tools36.0.0, AndroidX WebKit1.14.0.
- Java Activity serves the complete bundled production game through WebViewAssetLoader's local HTTPS origin. No INTERNET permission; external requests/navigation are blocked. No bundled native `.so` libraries. Updates require an app release.
- Adaptive icon uses parent-supplied original jet artwork padded for launcher masks. Store artwork belongs to the parent task.

## Build and signing

Run `npm ci` and `npm run build` at the root, then `android/gradlew.bat -p android bundleRelease assembleRelease assembleDebug lintRelease` with the existing JDK17/SDK36 environment. Outputs under `android/app/build/outputs/` are deliberately unsigned, including debug. The project never generates signing credentials during a build.

The publisher manually created and retained separate upload/debug identities on this PC. Version 1.0.1 signing uses only these existing identities via `scripts/sign-android.ps1 -Kind upload` and `-Kind debug`. Output filenames derive from versionName; never regenerate keys for an update. Private keys and Windows DPAPI password files stay in the user's `.android/jokers-run-signing` directory. Do not put that directory in Git, Library, evidence archives or screenshots. Public certificates may be shared.

Upload certificate SHA256: `0e6da2776f5ad1932ee49c2f0ccc4816fc9f4d0b4606a77bb5d49debae879553`. Separate debug certificate SHA256: `b9e4cb9b6285a2dae8ce68adc7beaa2489cc4e3db3e009010698337132fa80a1`. Play App Signing owns the distribution identity; the local upload key signs uploads. Self-signed/PKIX jarsigner warnings alone do not mean a corrupt signature. Verify final bundles with bundletool/jarsigner and APKs with apksigner.

## Verification

- Locked npm install: zero audit vulnerabilities. TypeScript and Vite production build pass.
- `scripts/mobile.mjs`: 28 touch-control checks, including simultaneous touch and synthetic tilt conventions; fails on failed checks or page errors.
- `scripts/release-qa.mjs`: production offline resources, privacy, Back event contract, background/audio suspension, local settings, four phone/tablet/portrait layouts and real gameplay captures. `scripts/radio-qa.mjs` checks decoding/durations of all 35 clips plus playback, mute and RADIO VOICE off.
- `scripts/mission-qa.mjs`: full mission through actual bot inputs, direct steering, 2x simulation, god mode off. This does not measure human difficulty.
- Android bundle/APK compilation and release lint pass. API36 may ignore landscape requests on large screens; portrait shows the rotate prompt and pauses. Portrait play is not implemented.
- Isolated API36 Android16 AOSP x86_64 emulator, Pixel6 profile, WHPX/host GPU, WebView133. `scripts/android-qa.mjs` uses WebView CDP and actual Android Back/Home to test WebGL2, touch, simultaneous stick/guns, boost/brake, lifecycle pause/audio, privacy, local radio decoding, haptics/motion API availability. Release APK smoke testing is separate because release debugging is disabled.
- Physical phones/tablets remain untested. Actual tilt mapping/comfort, vibration, speaker quality and human difficulty need publisher device testing. Emulator API availability does not measure those properties.

Exact final outputs, hashes, screenshots and source commit are in the delivered release report/evidence archive.

## Privacy and data safety

- Only declared permission: `android.permission.VIBRATE`, a normal permission for optional local haptics.
- No accounts, ads, IAP, analytics/crash SDK, tracking identifiers, backend, server calls, sharing or uploads.
- Private localStorage: `jokersrun.best` (best score), `jokersrun.settings` (controls/audio/accessibility). Erase via Clear storage/uninstall. Android backup and transfer excluded.
- Optional motion readings steer locally, are not stored/transmitted and are not used for activity, fitness or location.
- Music/effects and 35 prerecorded radio clips play locally. ElevenLabs generation and Whisper transcription are development tooling, not packaged/executed by the game. No ElevenLabs API/key/SDK in the app.
- No app-defined encryption or cryptography libraries found. HTTPS-looking origin is intercepted local assets. Publisher owns the legal export declaration.
- Suggested Data safety answers for this build: no collected/shared user data, accounts, ads, advertising ID or in-app purchases. Reassess if networking/SDKs are added.
- Policy: `public/privacy.html`, Randroid LLC, `support@toyboxes.app`; in-app offline. Public URL `https://jokers-run-arcade.vercel.app/privacy.html`. Verify deployed text matches recorded-radio wording.

## Assets and rights

Game models, terrain, ocean/effects are procedural source content. Three.js MIT, unmodified Chakra Petch SIL OFL1.1, AndroidX Apache2.0; notices under `public/licenses`. Launcher artwork is original art supplied by the parent task.

Main introduced 35 ElevenLabs clips, five designed fictional cast voices, model eleven_v3, ffmpeg radio filtering. Source/text/manifest: `scripts/voice`, `src/voice-manifest.json`. Commercial permission depends on the generating account/plan and terms; repo provenance alone does not establish rights. Parent must obtain publisher confirmation before paid release. No additional generation, paid requests or new terms were used during preparation.

Play screenshots are actual production game renders in Chrome touch emulation, 1920x1080 from a 960x540 CSS viewport at 2x scale, god mode off. Separate emulator screenshots are actual Android screencaps. No fabricated gameplay or generated/composited UI.

## Release notes (en-US)

Mission 01: launch from the carrier, master your flight controls, and stop enemy scouts before they transmit the fleet's position. Fight through dogfights, a canyon chase and an ace encounter. Play offline with touch controls, optional tilt steering, recorded radio voices, local best scores and checkpoint retries.

## Remaining release gates

1. Confirm whether recorded radio is the expected update or another is coming; integrate/rebuild/retest new gameplay commits. Keep Android work on its draft PR until settled.
2. Confirm commercial recording rights and check physical phone/tablet touch, tilt, haptics/audio.
3. Parent verifies final public policy/listing, app access, rating, Data safety, pricing/distribution.
4. Replace saved code 1 with signed code 2+; inspect Play processing/pre-launch results and account access/testing requirements. Saved drafts/build success do not establish publication.
