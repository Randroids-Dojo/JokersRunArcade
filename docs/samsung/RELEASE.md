# Joker's Run for Samsung Smart TV

## Release identity and scope

Version 1.0.0. Tizen package `JkRunTv001`, application ID `JkRunTv001.JokersRun`.
Seller Office app ID: `3202611050850`, created in the verified Randroid LLC
business group using `randy@randroid.dev`. Reuse that record. The package identity
is independent of the Seller Office ID. No earlier Samsung release was present.

This is a packaged Tizen Web application (`.wgt`), the Samsung-supported route used
for this edition. It is not a C++ or C# rewrite, a remotely hosted website, or an
Android APK. The full Mission 01 and its assets run locally.

Target: Samsung TV Tizen 8.0 and later (2024, 2025 and 2026 model years), compiled
for Chromium 108. Samsung documents Tizen 10 / Chromium 130 for its 2026 TVs.
Do not select older model groups or claim certification before testing them.
The UI fits 720p, 1080p and 4K CSS viewports; GPU rendering is capped at 1080p.

## Build and sign

The official SDK is installed at `/Users/randroid/tizen-sdk`, with data at
`/Users/randroid/tizen-sdk-data.1`. The current CLI reports `10.3.9`; TV resources
`10.0.0` and Samsung Certificate Extension `2.0.75` are installed. Fresh login
shells resolve both `tz` and `tizen` through the SDK path configuration. The official
`tizen build-web` command passes on `dist-samsung/`. An optional IDE component's
Finder-shortcut script timed out; that does not negate the successful CLI build.
No IDE launch or emulator verification is claimed.

Samsung issued the author certificate for `RandroidSamsungTV` using the intended
work account. Its encrypted certificate and password records are backed up locally
outside this repository. Keep this author identity for updates. It expires on
November 7, 2027. The distributor certificate and complete signing profile still
require the target TV's DUID; `sdb devices` currently reports no connected TV.

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

1. Reuse the verified Randroid LLC business group and work Samsung account at
   <https://seller.samsungapps.com/tv/>. The Public Group is limited to U.S.
   distribution; further territories require Samsung Partner Group approval.
2. Reuse Joker's Run (`3202611050850`), Tizen Web application, English default
   language. Its English title/description, Game category, Samsung 12+ self-rating
   and no-personal-information declaration were saved and reloaded. U.S. service
   territory was saved. The optional gamepad feature save still needs readback.
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
6. Upload `release-artifacts/samsung/JokersRun-UI-Description-1.0.0.pptx`.
   The completed 14-slide document uses the current [v1.42 template](https://d1oxlq5h9kq8q5.cloudfront.net/tvstore/App_Description_template_eng_v.1.42.zip)
   linked by the live verification form. Its required sections, masters, layouts,
   themes and embedded fonts are retained. Seven actual browser-rendered UI
   screens are included; all slides were reviewed through a LibreOffice PDF
   render. The file's hash and verification are in `ui-description-receipt.json`.
   Its attachment/save in Seller Office was interrupted by another Chrome
   activity and was not verified. Resume in an idle Samsung browser context.
7. Register verification information: no app login, no geo-block, no in-app
   purchases or voucher. Mission 01 is the only playable mission. Target the
   verified Google Play U.S. price of **USD 2.99**. Samsung supports Paid App
   distribution through its [Checkout DPI portal](https://dpi.samsungcheckout.com/),
   whose sign-in currently requires the user to add phone-based two-step
   verification. Do not publish this paid game as free to bypass that gate.
   The image-use/copyright agreement also awaits action-time user approval
   before saving the staged icon, background and screenshot uploads.
8. Request New Release / submit certification, then reload and record the actual
   resulting status and timestamp in `STATUS.json`. Upload, submission, approval
   and public availability are separate milestones.

To regenerate the UI Description after updating captures, download and extract the
current template, run the TV runtime and complete-mission QA commands, then run:

```sh
python3 scripts/samsung-ui-description.py /path/to/App_Description_template_eng_v.1.42.pptx
```

Re-render and inspect the resulting PPTX before uploading. The filler preserves
Samsung's required sections, removes the guide/example pages, and uses the real
QA captures. It does not claim that those captures came from a physical TV.

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
