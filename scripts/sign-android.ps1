param([ValidateSet('upload','debug')][string]$Kind = 'upload')
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$keyRoot = Join-Path $env:USERPROFILE '.android\jokers-run-signing'
$credential = Import-Clixml -LiteralPath (Join-Path $keyRoot "$Kind-password.xml")
$env:JOKERS_SIGN_PASS = [System.Net.NetworkCredential]::new('', $credential).Password
try {
    $keyFile = Join-Path $keyRoot "$Kind.jks"
    $alias = "jokers-run-$Kind"
    if ($Kind -eq 'upload') {
        Copy-Item -LiteralPath (Join-Path $repoRoot 'android\app\build\outputs\bundle\release\app-release.aab') -Destination (Join-Path $repoRoot 'release-artifacts\jokers-run-1.0.0-upload-signed.aab') -Force
        & "$env:JAVA_HOME\bin\jarsigner.exe" -keystore $keyFile -storepass:env JOKERS_SIGN_PASS -keypass:env JOKERS_SIGN_PASS -sigalg SHA256withRSA -digestalg SHA-256 (Join-Path $repoRoot 'release-artifacts\jokers-run-1.0.0-upload-signed.aab') $alias
        if ($LASTEXITCODE -ne 0) { throw 'Bundle signing failed' }
        $inputApk = Join-Path $repoRoot 'android\app\build\outputs\apk\release\app-release-unsigned.apk'
    } else { $inputApk = Join-Path $repoRoot 'android\app\build\outputs\apk\debug\app-debug-unsigned.apk' }
    $outputApk = Join-Path $repoRoot "release-artifacts\jokers-run-1.0.0-$Kind-signed.apk"
    & "$env:ANDROID_HOME\build-tools\36.0.0\apksigner.bat" sign --ks $keyFile --ks-key-alias $alias --ks-pass env:JOKERS_SIGN_PASS --key-pass env:JOKERS_SIGN_PASS --out $outputApk $inputApk
    if ($LASTEXITCODE -ne 0) { throw 'APK signing failed' }
    & "$env:ANDROID_HOME\build-tools\36.0.0\apksigner.bat" verify --verbose --print-certs $outputApk
    if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed' }
} finally { Remove-Item Env:JOKERS_SIGN_PASS -ErrorAction SilentlyContinue }
