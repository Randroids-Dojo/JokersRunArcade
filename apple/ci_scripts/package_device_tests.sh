#!/bin/bash
set -euo pipefail

joker_apple_dir="$(cd "$(dirname "$0")/.." && pwd)"
joker_device_output="${1:-$joker_apple_dir/build-device-tests}"
mkdir -p "$joker_device_output"
joker_device_output="$(cd "$joker_device_output" && pwd)"
cd "$joker_apple_dir"

# The device provider must re-sign these packages. They are not store archives.
xcodebuild -project JokersRun.xcodeproj -scheme JokersRun \
    -destination 'generic/platform=iOS' -configuration Debug \
    -derivedDataPath "$joker_device_output" \
    CODE_SIGNING_ALLOWED=NO build-for-testing \
    > "$joker_device_output/build-for-testing.log" 2>&1

joker_products="$joker_device_output/Build/Products/Debug-iphoneos"
test -d "$joker_products/JokersRun.app"
test -d "$joker_products/JokersRunUITests-Runner.app"
joker_package_dir="$(mktemp -d "$joker_device_output/package.XXXXXX")"
trap 'rm -rf "$joker_package_dir"' EXIT
mkdir -p "$joker_package_dir/Payload"
ditto "$joker_products/JokersRun.app" "$joker_package_dir/Payload/JokersRun.app"
ditto -c -k --keepParent "$joker_package_dir/Payload" "$joker_device_output/JokersRun-device.ipa"
ditto -c -k --keepParent "$joker_products/JokersRunUITests-Runner.app" "$joker_device_output/JokersRun-XCTestUI.zip"
cd "$joker_device_output"
unzip -tq JokersRun-device.ipa
unzip -tq JokersRun-XCTestUI.zip
shasum -a 256 JokersRun-device.ipa JokersRun-XCTestUI.zip > SHA256SUMS.txt
cat SHA256SUMS.txt
