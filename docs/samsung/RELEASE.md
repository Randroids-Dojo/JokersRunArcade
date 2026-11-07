# Joker's Run for Samsung Smart TV

## Release identity and scope

Version 1.0.0. Tizen package `JkRunTv001`, application ID `JkRunTv001.JokersRun`.
These are independent of any Seller Office application ID. Confirm no existing
Samsung release uses a different identity before the first upload.

This is a packaged Tizen Web application (`.wgt`), the Samsung-supported route used
for this edition. It is not a C++ or C# rewrite, a remotely hosted website, or an
Android APK. The full Mission 01 and its assets run locally.

Target: Samsung TV Tizen 8.0 and later (2024, 2025 and 2026 model years), compiled
for Chromium 108. Samsung documents Tizen 10 / Chromium 130 for its 2026 TVs.
Do not select older model groups or claim certification before testing them.
The UI fits 720p, 1080p and 4K CSS viewports; GPU rendering is capped at 1080p.

## Build and sign

Run `npm ci`, then `npm run build:samsung`. The production files are in
`dist-samsung/`. The build writes a content hash manifest and
`release-artifacts/samsung/JokersRun-1.0.0.unsigned.wgt`. The filename and accompanying
`package-status.json` explicitly identify the package as unsigned and not uploadable.

Use an existing Samsung certificate profile for an existing app. For a first
release, create the publisher's Samsung author and distributor certificates using
Samsung's certificate workflow; retain the author identity for future updates.
Register the target TV's DUID when creating a development distributor certificate.
Never substitute the SDK's bundled Tizen distributor or a self-signed identity.

```sh
TIZEN_CLI=/absolute/path/to/tizen \
SAMSUNG_CERT_PROFILE=YourSamsungProfile npm run package:samsung
```

The signing command requires a profile and writes the signed artifact/hash receipt
in `release-artifacts/samsung/`. A successful local signature is distinct from
Seller Office accepting the certificate and package. Do not modify a signed WGT.
Keys, password files and profiles must stay outside Git and release attachments.

## Controls and lifecycle

| Input | Function |
| --- | --- |
| Smart Remote arrows | Assisted climb/dive and bank/turn; centered input levels flight |
| Hold OK during flight | Guns, plus missiles whenever locked on a non-jamming target |
| Double-tap left/right | Evade with a barrel roll |
| Return during flight | Pause and show flight commands |
| Return while paused | Resume |
| Flight commands | Toggle boost/brake, cycle target, fire a locked missile, roll, cycle wingman orders |
| Return in privacy/exit dialog | Close dialog and restore menu focus |
| Return on title | Confirm exit to Smart Hub |
| Exit (10182; long Return on supported remotes) | Exit immediately through Tizen |
| Optional red / green / yellow / blue keys | Roll / boost / brake / next target |
| Gamepad | Left stick fly, X guns, A missile, B roll, Y target, RT boost, LT brake, LB/RB rudder |
| Gamepad D-pad in flight | Up cover, left scouts, right split |
| Gamepad menus | D-pad/left stick navigate, A select, B back, Start pause/resume |

Flight commands unavailable in the current phase are disabled. Return, Home,
power/background events and controller loss must not leave a held weapon or an
unattended mission running. Visibility loss suspends the mission and audio;
returning requires explicit Resume. The screensaver is suppressed during play and
restored in menus/background. No network or sensitive-data privileges are declared.

## Verification and its limits

`npm run test:samsung` exercises the actual production files through `file:` URLs,
using installed Chrome with file access enabled. Tests inject Samsung platform API
stubs, numeric remote events and the standard Gamepad API. No server or external
network service supplies game content. Evidence is saved to
`release-artifacts/samsung/runtime-qa.json`.

`npm run test:samsung:mission` uses the existing automated pilot through normal
flight and weapon inputs at 2x simulation speed, from carrier launch through the
debrief, with no invulnerability or checkpoint skips. Evidence is in
`release-artifacts/samsung/mission-qa.json`. This proves the mission can finish in
the browser harness; it does not establish human difficulty or TV performance.

The store screenshots are real game renders at 1920x1080 from selected checkpoints,
with no invulnerability or bot active during capture. They are browser captures,
not Samsung device screenshots. Screenshots, foreground wordmark, background and
legacy/square icons are under `release/samsung/assets/`.

Before requesting certification, install the **signed** package on a supported
Samsung TV and test launch/relaunch, a complete mission, remote key rollover and
feel, Bluetooth/USB gamepad, disconnect, Back/Exit/Home/power/resume, speakers and
captions, privacy scrolling, local score persistence, and sustained frame rate.
Record the exact model, firmware, Tizen version, package hash and results.

## Seller Office submission

1. Sign in at <https://seller.samsungapps.com/tv/> with the intended publisher's
   Samsung account. Check seller/group identity and existing applications before
   creating a new record. Public sellers are limited to U.S. distribution; partner
   distribution requires the account's applicable approvals.
2. Create or select Joker's Run, Tizen Web application, English default language.
   Read back the immutable Seller Office app ID and publisher/group.
3. Upload the signed package. Resolve validation errors and select only verified
   Tizen 8+ model groups, including the eligible 2026 groups. Read back version,
   package identity and validation result.
4. Fill the listing from `release/samsung/LISTING.json`, upload the two-part 1080p
   icon, legacy icon and four JPEG screenshots. Confirm public privacy URL text
   matches the TV policy; the local public policy update is not automatically live.
5. Complete age/content answers truthfully: aircraft combat and explosions,
   no blood/gore, no gambling, no chat, no purchases, no ads, no accounts or data
   collection. Do not invent an issued rating certificate. Region-specific rating
   certificates and seller permissions determine available territories.
6. Download the current Application UI Description template from Samsung and fill
   it without changing its required structure. The prepared source content is
   `release/samsung/UI-DESCRIPTION.md`. The public download endpoint returned HTML
   in the unauthenticated session; no PPTX template or completed PPTX is claimed.
   Add any test code/checkpoint access using the existing `?debug` tooling through
   the Web Inspector; Mission 01 is the only playable level.
7. Register verification information: no test login, no geo-block, no payment or
   voucher. Confirm distribution/pricing choices in the live account.
8. Request New Release / submit certification, then reload and record the actual
   resulting status and timestamp in `STATUS.json`. Upload, submission, approval
   and public availability are separate milestones.

Do not report this app as submitted based on local files, a draft app record,
successful signing, or screenshots alone.

## Official requirements consulted

- [2026 platform user agents](https://developer.samsung.com/smarttv/develop/guides/fundamentals/retrieving-platform-information.html)
- [Web application configuration](https://developer.samsung.com/smarttv/develop/guides/fundamentals/configuring-tv-applications.html)
- [Remote control](https://developer.samsung.com/smarttv/develop/guides/user-interaction/remote-control.html)
- [Certificates](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/creating-certificates.html)
- [Icons and screenshots](https://developer.samsung.com/smarttv/design/app-icons-and-screenshots.html)
- [Application UI Description](https://developer.samsung.com/tv-seller-office/checklists-for-distribution/application-ui-description.html)
- [Registering applications](https://developer.samsung.com/tv-seller-office/guides/applications/registering-application.html)
- [Distributing applications](https://developer.samsung.com/tv-seller-office/guides/applications/distributing-application.html)
