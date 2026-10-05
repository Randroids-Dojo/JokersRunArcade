# Run interactively on randroid-pc after reviewing this file. Never run through a
# rejected automation action. Private keys and DPAPI passwords stay on this host.
param([switch]$CreateSigningKeys)
$ErrorActionPreference = 'Stop'
if (-not $CreateSigningKeys) { throw 'Review this script, then run it yourself with -CreateSigningKeys to authorize local signing identity creation.' }
if (-not $env:JAVA_HOME -or -not $env:ANDROID_HOME) { throw 'JAVA_HOME and ANDROID_HOME must point to the existing JDK17 and SDK36 installations.' }
$repoRoot = Split-Path -Parent $PSScriptRoot
$keyRoot = Join-Path $env:USERPROFILE '.android\jokers-run-signing'
$outRoot = Join-Path $repoRoot 'release-artifacts'
foreach ($file in @('android\app\build\outputs\bundle\release\app-release.aab', 'android\app\build\outputs\apk\release\app-release-unsigned.apk', 'android\app\build\outputs\apk\debug\app-debug-unsigned.apk')) {
    if (-not (Test-Path -LiteralPath (Join-Path $repoRoot $file) -PathType Leaf)) { throw "Build missing: $file. Run the documented unsigned build first." }
}
New-Item -ItemType Directory -Path $keyRoot,$outRoot -Force | Out-Null
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = [System.Security.AccessControl.DirectorySecurity]::new()
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true, $false)
$acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
Set-Acl -LiteralPath $keyRoot -AclObject $acl
foreach ($kind in @('upload','debug')) {
    $keyFile = Join-Path $keyRoot "$kind.jks"
    $passwordFile = Join-Path $keyRoot "$kind-password.xml"
    $certificateFile = Join-Path $keyRoot "$kind-public-certificate.pem"
    $alias = "jokers-run-$kind"
    $hasKey = Test-Path -LiteralPath $keyFile
    $hasPassword = Test-Path -LiteralPath $passwordFile
    if ($hasKey -ne $hasPassword) { throw "Incomplete $kind signing identity. Preserve the existing files and resolve manually; no overwrite performed." }
    try {
        if (-not $hasKey) {
            $randomBytes = [byte[]]::new(48)
            $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
            try { $rng.GetBytes($randomBytes) } finally { $rng.Dispose() }
            $env:JOKERS_NEW_PASS = [Convert]::ToBase64String($randomBytes)
            $securePassword = ConvertTo-SecureString $env:JOKERS_NEW_PASS -AsPlainText -Force
            $securePassword | Export-Clixml -LiteralPath $passwordFile
            & "$env:JAVA_HOME\bin\keytool.exe" -genkeypair -keystore $keyFile -alias $alias -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=Randroid LLC, O=Randroid LLC' -storepass:env JOKERS_NEW_PASS -keypass:env JOKERS_NEW_PASS
            if ($LASTEXITCODE -ne 0) { throw 'Key generation failed. Preserve files and review the error; do not overwrite or retry blindly.' }
        } else {
            $securePassword = Import-Clixml -LiteralPath $passwordFile
            $env:JOKERS_NEW_PASS = [System.Net.NetworkCredential]::new('', $securePassword).Password
        }
        & "$env:JAVA_HOME\bin\keytool.exe" -exportcert -rfc -keystore $keyFile -alias $alias -storepass:env JOKERS_NEW_PASS -file $certificateFile
        if ($LASTEXITCODE -ne 0) { throw 'Public certificate export failed' }
    } finally {
        Remove-Item Env:JOKERS_NEW_PASS -ErrorAction SilentlyContinue
        $securePassword = $null
        $randomBytes = $null
    }
    & (Join-Path $PSScriptRoot 'sign-android.ps1') -Kind $kind
}
$versionMatch = [regex]::Match((Get-Content -Raw -LiteralPath (Join-Path $repoRoot 'android\app\build.gradle')), "versionName '([0-9]+\.[0-9]+\.[0-9]+)'")
if (-not $versionMatch.Success) { throw 'Cannot determine the release version from build.gradle' }
& "$env:JAVA_HOME\bin\jarsigner.exe" -verify (Join-Path $outRoot "jokers-run-$($versionMatch.Groups[1].Value)-upload-signed.aab")
if ($LASTEXITCODE -ne 0) { throw 'Bundle signature verification failed' }
Write-Output 'Signed AAB, release APK and separate debug APK are in release-artifacts. Private keys and DPAPI-protected passwords remain in the current-user-only signing directory. Retain this directory and Windows user access for future updates; do not upload it.'
