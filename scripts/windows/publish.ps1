<#
.SYNOPSIS
    Publish the Adrt Windows host as a self-contained, single-file win-x64 build.

.DESCRIPTION
    Runs `dotnet publish` for windows/src/Adrt.Windows with the flags from
    docs/WINDOWS_PORT.md §8 and writes the result to:

        dist/windows/Adrt.Windows.exe

    The build is self-contained, so the target machine needs no .NET runtime.
    A SHA256SUMS file is written next to the payload in dist/SHA256SUMS.txt and
    every digest is printed. The Inno Setup script consumes dist/windows
    directly, so run this before compiling windows/installer/adrt.iss.

.PARAMETER Version
    Optional package version, e.g. 0.2.0 or 0.3.0-beta.1. A leading "v" is
    accepted. When omitted, the version from Adrt.Windows.csproj is used.

.PARAMETER Configuration
    Build configuration. Release by default.

.EXAMPLE
    ./scripts/windows/publish.ps1

.EXAMPLE
    ./scripts/windows/publish.ps1 -Version 0.3.0
#>
[CmdletBinding()]
param(
    [string] $Version,
    [string] $Configuration = 'Release'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-DotNet {
    param([Parameter(Mandatory)][string[]] $Arguments)

    & $script:DotNet @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "dotnet $($Arguments[0]) failed with exit code $LASTEXITCODE"
    }
}

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$project = Join-Path $repoRoot 'windows/src/Adrt.Windows/Adrt.Windows.csproj'
$distDir = Join-Path $repoRoot 'dist'
$outDir = Join-Path $distDir 'windows'
$checksumPath = Join-Path $distDir 'SHA256SUMS.txt'
$exePath = Join-Path $outDir 'Adrt.Windows.exe'

if (-not (Test-Path -LiteralPath $project -PathType Leaf)) {
    throw "project not found: $project"
}

$dotnetCommand = Get-Command dotnet -ErrorAction SilentlyContinue
if (-not $dotnetCommand) {
    throw 'dotnet was not found on PATH. Install the .NET 10 SDK or add it to PATH.'
}
$script:DotNet = $dotnetCommand.Source
$sdkVersion = (& $script:DotNet --version).Trim()
if ($LASTEXITCODE -ne 0) {
    throw 'dotnet --version failed'
}

if ($Version) {
    $Version = $Version.Trim()
    if ($Version.StartsWith('v') -or $Version.StartsWith('V')) {
        $Version = $Version.Substring(1)
    }
    if ($Version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+([-.+][0-9A-Za-z.+-]+)?$') {
        throw "invalid -Version '$Version'; expected something like 0.2.0 or 0.3.0-beta.1"
    }
}

# A publish directory is disposable output. Remove it first so a previous
# framework-dependent build cannot leave stale files in the installer payload.
if (Test-Path -LiteralPath $outDir) {
    Remove-Item -LiteralPath $outDir -Recurse -Force
}
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

$publishArguments = @(
    'publish', $project,
    '--configuration', $Configuration,
    '--runtime', 'win-x64',
    '--self-contained', 'true',
    '--output', $outDir,
    '--nologo',
    '--verbosity', 'minimal',
    '-p:PublishSingleFile=true',
    '-p:IncludeNativeLibrariesForSelfExtract=true',
    '-p:PublishTrimmed=false',
    '-p:DebugType=None',
    '-p:DebugSymbols=false'
)
if ($Version) {
    $publishArguments += "-p:Version=$Version"
    $publishArguments += "-p:InformationalVersion=$Version"
}

Write-Host "dotnet $sdkVersion"
Write-Host "publishing Adrt.Windows ($Configuration, win-x64, self-contained, single-file)"
Invoke-DotNet -Arguments $publishArguments

if (-not (Test-Path -LiteralPath $exePath -PathType Leaf)) {
    throw "publish succeeded but $exePath is missing"
}

$exe = Get-Item -LiteralPath $exePath
$displayVersion = $Version
if (-not $displayVersion) {
    $displayVersion = $exe.VersionInfo.ProductVersion
}
if (-not $displayVersion) {
    # FileVersionInfo cannot read the PE resource on every non-Windows host, so
    # fall back to the project's Version property for the log line.
    $projectXml = [xml] (Get-Content -LiteralPath $project)
    $displayVersion = @($projectXml.Project.PropertyGroup.Version) |
        Where-Object { $_ } |
        Select-Object -First 1
}
if (-not $displayVersion) { $displayVersion = 'unknown' }

$files = Get-ChildItem -LiteralPath $outDir -Recurse -File | Sort-Object FullName
$checksumLines = foreach ($file in $files) {
    $relative = $file.FullName.Substring($outDir.Length + 1).Replace('\', '/')
    $digest = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    '{0}  {1}' -f $digest, $relative
}

New-Item -ItemType Directory -Path $distDir -Force | Out-Null
Set-Content -LiteralPath $checksumPath -Value $checksumLines -Encoding ascii

$fileCount = @($files).Count
$sizeMb = [math]::Round($exe.Length / 1MB, 1)
Write-Host ''
Write-Host "Adrt $displayVersion published to $outDir ($sizeMb MB exe, $fileCount file(s))"
Write-Host 'SHA256:'
foreach ($line in $checksumLines) {
    Write-Host "  $line"
}
Write-Host "checksums: $checksumPath"
