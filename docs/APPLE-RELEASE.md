# Joker's Run for iPhone and iPad

The Apple target bundles the same production game as the published Android app.
It serves local assets through a WKURLSchemeHandler, with no network fallback,
blocked external navigation, and a content security policy. The native host adds
local haptics, optional motion permission, and background/audio interruption pause.
Game content, mission simulation, touch controls, radio clips, and saves are shared.

Requested bundle ID: `app.toyboxes.jokersrun`. Version 1.0.2, Apple build 1. The
owner requested a USD 2.99 one-time download. No Apple record or price is saved yet.

## Build and test

Use Node, Xcode 27, and XcodeGen from their official distributions:

```sh
npm ci
node scripts/build-apple.mjs
xcodebuild -project apple/JokersRun.xcodeproj -scheme JokersRun \
  -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' \
  -derivedDataPath apple/build-device CODE_SIGNING_ALLOWED=NO build
xcodebuild -project apple/JokersRun.xcodeproj -scheme JokersRun \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -derivedDataPath apple/build CODE_SIGNING_ALLOWED=NO test
```

Generated web copies, plists, Xcode projects, and build products stay out of Git.
Signing is deliberately not assigned to the existing Individual membership.
After Apple confirms Randroid LLC, select the verified organization team in
Xcode, archive, validate, and upload through its App Store Connect team.

## Release checks

The launch and background-pause XCTest runs on iPhone 17 Pro and iPad Pro 13-inch
simulators passed. Simulator checks do not prove physical touch, tilt comfort,
haptic strength, speaker quality, thermal performance, or human difficulty.
The initial app-cropped landscape screenshots had orientation/cropping problems;
capture the full simulator screen and visually verify each image before it is
used in the store. Do not publish a clipped image because a test passed.

Before submission, verify the entire mission on a physical iPhone and iPad,
simultaneous stick/fire/boost, both landscape directions and cutout safe areas,
motion permission allow/deny, radio and effects, mute settings, interruption pause,
and local settings/best score after relaunch. Use genuine Apple gameplay captures.

The privacy policy now describes both mobile platforms and distinguishes iOS
system backups from disabled Android backup. There are no accounts, analytics,
ads, tracking SDKs, in-app purchases, or server uploads. The native host uses no
required-reason APIs; WKWebView's localStorage remains inside its website store.
Review privacy declarations again if native persistence or plugins change.

Apple organization identity/association verification is pending. Paid-app agreements, banking/tax setup, developer branding, app
records, final metadata, pricing, TestFlight, and App Review are not completed by
a successful local build.


## Verification recorded October 21, 2026

- Production web build and unsigned ARM64 iOS Release build pass.
- iPhone 17 Pro and iPad Pro 13-inch (M5) simulator UI checks pass for launch,
  privacy content, mission start, background pause, and explicit resume.
- A follow-up phone check verifies the privacy link stays above the home
  indicator. WebKit text autosizing is disabled for the game layout, compact
  title content fits the phone, and overflow remains scrollable on smaller screens.
- Full-screen XCTest captures are visually checked. Earlier app-cropped captures
  are retained only as failed capture evidence and must not be used for the store.
- npm's locked Vite update to 8.3.5 removes the reported development-server
  advisories; `npm audit` reports zero vulnerabilities.

The requested Google Play version is already public at USD 2.99. The App Store
copy in `apple/store/en-US.json` is prepared locally, with live support/marketing
URLs checked. Physical-device play, motion/haptics/audio, the full native mission,
App Store screenshots, organization signing and submission remain outstanding.
