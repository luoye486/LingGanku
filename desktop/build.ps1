param([switch]$Debug)
$ErrorActionPreference = 'Stop'
$sourceDir = $PSScriptRoot
$projectDir = Split-Path -Parent $sourceDir
$toolsDir = Join-Path $projectDir '_toolchain'
$cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
if (Test-Path (Join-Path $cargoBin 'cargo.exe')) { $env:PATH = "$cargoBin;$env:PATH" }
$mappedDrive = $null
$oldDir = Get-Location
try {
    $toolchain = (& rustup show active-toolchain | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Install Rust with rustup first.' }
    $gnu = $toolchain -match 'windows-gnu'
    if ($gnu) {
        # Legacy GNU support for this checkout. MSVC is the portable recommendation.
        foreach ($rel in @('pp\gcc.exe', 'mingw64\bin\dlltool.exe', 'mingw64\bin\as.exe')) {
            if (!(Test-Path (Join-Path $toolsDir $rel))) { throw "Missing legacy tool: _toolchain/$rel. Use MSVC or restore the local GNU tools." }
        }
        $stage = Join-Path $toolsDir 'desktop-build'
        New-Item -ItemType Directory -Force $stage | Out-Null
        foreach ($name in @('src', 'ui', 'icons', 'capabilities', 'Cargo.toml', 'Cargo.lock', 'build.rs', 'tauri.conf.json')) {
            Copy-Item -LiteralPath (Join-Path $sourceDir $name) -Destination $stage -Recurse -Force
        }
        $iconDir = Join-Path $toolsDir 'icon'
        New-Item -ItemType Directory -Force $iconDir | Out-Null
        Copy-Item -LiteralPath (Join-Path $sourceDir 'icons\icon.ico') -Destination (Join-Path $iconDir 'icon.ico') -Force
        # windres needs an ASCII icon path. Never replace an existing drive mapping.
        foreach ($letter in @('L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W')) {
            if (!(Test-Path ($letter + ':\'))) {
                & subst.exe ($letter + ':') $projectDir
                if ($LASTEXITCODE -eq 0) { $mappedDrive = $letter; break }
            }
        }
        if (!$mappedDrive) { throw 'No unused drive letter is available for windres.' }
        $env:TAURI_ICON_PATH = $mappedDrive + ':\_toolchain\icon\icon.ico'
        $env:PATH = (Join-Path $toolsDir 'pp') + ';' + $env:PATH + ';' + (Join-Path $toolsDir 'mingw64\bin')
        $tmpDir = Join-Path $toolsDir 'tmp'
        New-Item -ItemType Directory -Force $tmpDir | Out-Null
        $env:TEMP = $tmpDir; $env:TMP = $tmpDir; $env:TMPDIR = $tmpDir.Replace('\', '/')
        $env:CARGO_TARGET_DIR = Join-Path $toolsDir 'target'
        $rustc = (& rustup which rustc | Out-String).Trim()
        if ($LASTEXITCODE -ne 0) { throw 'Cannot locate rustc.' }
        $toolchainDir = Split-Path -Parent (Split-Path -Parent $rustc)
        $linker = Join-Path $toolchainDir 'lib\rustlib\x86_64-pc-windows-gnu\bin\rust-lld.exe'
        if (!(Test-Path $linker)) { throw 'Missing rust-lld in the GNU toolchain.' }
        $env:RUSTFLAGS = '-C linker=' + $linker.Replace('\', '/')
        Set-Location -LiteralPath $stage
        Write-Host 'Building with the legacy GNU workaround (requires the local patched tauri registry).'
    } else {
        $env:CARGO_TARGET_DIR = Join-Path $toolsDir 'target-msvc'
        Set-Location -LiteralPath $sourceDir
    }
    $argsList = @('build', '--locked')
    $profile = 'debug'
    if (!$Debug) { $argsList += '--release'; $profile = 'release' }
    & cargo @argsList
    if ($LASTEXITCODE -ne 0) { throw 'Cargo build failed; see the compiler output above.' }
    $artifactDir = Join-Path $env:CARGO_TARGET_DIR $profile
    $dist = Join-Path $sourceDir 'dist'
    New-Item -ItemType Directory -Force $dist | Out-Null
    $loader = Join-Path $artifactDir 'WebView2Loader.dll'
    if (!(Test-Path $loader)) { throw 'Missing WebView2Loader.dll in this build. Refusing to mix a new executable with a stale loader.' }
    Copy-Item -LiteralPath (Join-Path $artifactDir 'linganhe.exe') -Destination (Join-Path $dist 'LingGanWu.exe') -Force
    Copy-Item -LiteralPath $loader -Destination $dist -Force
    Write-Host "Built: $dist\LingGanWu.exe"
    Write-Host 'Keep the loader DLL alongside the executable. Assets and notes are external.'
} catch {
    Write-Error $_ -ErrorAction Continue
    exit 1
} finally {
    Set-Location $oldDir
    if ($mappedDrive) { & subst.exe ($mappedDrive + ':') /D }
}
