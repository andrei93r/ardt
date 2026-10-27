#Requires -Version 5.1
#Requires -RunAsAdministrator
<#
.SYNOPSIS
  One-shot bootstrap for the Adrt Windows test VM.

.DESCRIPTION
  Run this once on a fresh Windows 11 VM as Administrator. It installs and
  enables everything the Adrt Windows port needs so an agent can take over
  over SSH:

    * OpenSSH Server (service + firewall), ready for key/password login
    * .NET 10 SDK (winget, with the official dotnet-install.ps1 as fallback)
    * Git for Windows
    * PowerShell 7 (the SSH default shell uses it when present)
    * Sysinternals (psexec is useful for session-1 launches; optional)
    * optional test apps for the app-compat matrix (-TestApps): VS Code, Chrome
    * autologon for a local account, so the VM always comes up on a real
      desktop (window-management tests need the interactive session, not the
      session-0 SSH desktop)
    * determinism settings (no sleep/lock, no fast startup, animations off,
      long paths, developer mode, no Windows-Update auto-reboot,
      Defender exclusions for the test tree)
    * the C:\adrt job/result/log folders

  Every step is idempotent and reports OK/WARN/FAIL at the end. Only the SSH
  and folder steps are fatal; everything else warns and continues so a flaky
  network never leaves a half-configured VM with no remote access.

.PARAMETER Username
  The account to configure autologon for. Defaults to the current user. It must
  be a LOCAL account (a Microsoft account cannot autologon reliably).

.PARAMETER Autologon
  True by default. Pass -Autologon:$false to skip. When enabled and no
  -Password is given, the script prompts for it (secure input) and writes it to
  the VM's Winlogon configuration; it is never written to the repo.

.PARAMETER Password
  Non-interactive password for autologon. Omit to be prompted.

.PARAMETER TestApps
  Also install VS Code and Chrome for the app-compatibility matrix.

.PARAMETER NoSysinternals
  Skip the Sysinternals install.

.PARAMETER SkipDeterminism
  Skip the power/lock/animation/update tweaks.

.PARAMETER AdrtRoot
  Root for the agent's job folders. Default C:\adrt.

.EXAMPLE
  Copy this file and bootstrap-vm.cmd to the VM, right-click the .cmd, Run as
  administrator. Or from PowerShell:
      .\bootstrap-vm.ps1 -Autologon -TestApps

.NOTES
  After it finishes: SNAPSHOT THE VM (this is the clean baseline), note the IP
  it prints, and send the SSH details to the dev box. Test VM only — autologon
  stores the password in the registry (LSA), which is fine for a throwaway VM
  and nowhere else.
#>
[CmdletBinding()]
param(
  [string]$Username = $env:USERNAME,
  [bool]$Autologon = $true,
  [string]$Password,
  [switch]$TestApps,
  [switch]$NoSysinternals,
  [switch]$SkipDeterminism,
  [string]$AdrtRoot = 'C:\adrt'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$script:Results = [System.Collections.Generic.List[object]]::new()
$script:Failed = 0

function Write-Head([string]$Text) {
  Write-Host ''
  Write-Host "=== $Text ===" -ForegroundColor Cyan
}

function Step {
  param([string]$Name, [scriptblock]$Body, [switch]$Fatal)
  Write-Head $Name
  try {
    & $Body
    $script:Results.Add([pscustomobject]@{ Step = $Name; Result = 'OK'; Detail = '' })
    Write-Host "OK   $Name" -ForegroundColor Green
  } catch {
    $detail = $_.Exception.Message
    $result = if ($Fatal) { 'FAIL' } else { 'WARN' }
    if ($Fatal) { $script:Failed++ }
    $script:Results.Add([pscustomobject]@{ Step = $Name; Result = $result; Detail = $detail })
    Write-Host "$result $Name — $detail" -ForegroundColor $(if ($Fatal) { 'Red' } else { 'Yellow' })
  }
}

function Have([string]$Command) {
  return [bool](Get-Command $Command -ErrorAction SilentlyContinue)
}

function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machine;$user"
}

function Add-MachinePath([string]$Dir) {
  $current = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $parts = $current -split ';' | Where-Object { $_ -ne '' }
  if ($parts -notcontains $Dir) {
    [Environment]::SetEnvironmentVariable('Path', ($parts + $Dir) -join ';', 'Machine')
    Write-Host "PATH += $Dir"
  }
  Refresh-Path
}

function Test-Winget {
  return (Have 'winget')
}

function Install-Winget {
  param([string]$Id, [string]$Label = $Id)
  if (-not (Test-Winget)) { throw 'winget is not available' }
  Write-Host "winget: installing $Label ($Id)"
  & winget install --id $Id --exact --source winget --silent `
      --accept-source-agreements --accept-package-agreements --disable-interactivity | Out-Host
  # winget returns 0x8A150061 ("already installed") on some builds; treat any
  # non-zero as a warning and let the verification step decide.
}

function Get-GitHubAsset {
  param([string]$Repo, [string]$Pattern)
  $release = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest" -UseBasicParsing
  $asset = $release.assets | Where-Object { $_.name -match $Pattern } | Select-Object -First 1
  if (-not $asset) { throw "no release asset matching $Pattern in $Repo" }
  return $asset.browser_download_url
}

# ---------------------------------------------------------------- start log ---
$logDir = Join-Path $AdrtRoot 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$transcript = Join-Path $logDir ("bootstrap-{0:yyyyMMdd-HHmmss}.log" -f (Get-Date))
Start-Transcript -Path $transcript -Force | Out-Null

Write-Host 'Adrt Windows VM bootstrap' -ForegroundColor White
$os = Get-CimInstance Win32_OperatingSystem
Write-Host ("host={0} os={1} build={2} user={3}" -f $env:COMPUTERNAME, $os.Caption, $os.BuildNumber, "$env:USERDOMAIN\$env:USERNAME")
Write-Host "log=$transcript"

# ----------------------------------------------------------------- folders ---
Step 'Create the agent folders' -Fatal {
  foreach ($dir in @($AdrtRoot, (Join-Path $AdrtRoot 'jobs'), (Join-Path $AdrtRoot 'results'), (Join-Path $AdrtRoot 'reports'), $logDir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }
  @"
Adrt Windows test VM
====================
This machine is driven by the Adrt project's agent over SSH.
Jobs:    $AdrtRoot\jobs     (one JSON spec per run)
Results: $AdrtRoot\results  (result JSON + evidence bundles)
Logs:    $logDir
Bootstrap log: $transcript

Do not edit files here by hand while the agent is running.
"@ | Set-Content -Path (Join-Path $AdrtRoot 'README.txt') -Encoding ascii
}

# ----------------------------------------------------------------- OpenSSH ---
Step 'Enable OpenSSH Server' -Fatal {
  $capName = 'OpenSSH.Server~~~~0.0.1.0'
  $cap = Get-WindowsCapability -Online -Name $capName
  if ($cap.State -ne 'Installed') {
    Add-WindowsCapability -Online -Name $capName | Out-Null
  }
  Set-Service -Name sshd -StartupType Automatic
  Start-Service -Name sshd
  $rule = Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue
  if ($null -eq $rule) {
    New-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -DisplayName 'OpenSSH Server (sshd)' `
      -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 | Out-Null
  } else {
    Enable-NetFirewallRule -Name 'OpenSSH-Server-In-TCP'
  }
  # Client capability is only needed on-device; harmless if already present.
  $client = Get-WindowsCapability -Online -Name 'OpenSSH.Client~~~~0.0.1.0'
  if ($client.State -ne 'Installed') { Add-WindowsCapability -Online -Name $client.Name | Out-Null }
  Write-Host 'sshd:'
  Get-Service sshd | Format-Table -AutoSize | Out-Host
}

# --------------------------------------------------------------- toolchain ---
Step 'Install .NET 10 SDK' {
  if ((Have 'dotnet') -and (dotnet --list-sdks | Select-String -Quiet '^10\.')) {
    Write-Host 'dotnet 10 already present:'
    dotnet --list-sdks | Out-Host
    return
  }
  $installed = $false
  if (Test-Winget) {
    try { Install-Winget -Id 'Microsoft.DotNet.SDK.10' -Label '.NET 10 SDK'; $installed = (Have 'dotnet') } catch { Write-Host "winget failed: $_" }
  }
  if (-not $installed) {
    Write-Host 'falling back to dotnet-install.ps1'
    $scriptPath = Join-Path $env:TEMP 'dotnet-install.ps1'
    Invoke-WebRequest 'https://dot.net/v1/dotnet-install.ps1' -OutFile $scriptPath -UseBasicParsing
    $dotnetDir = Join-Path $env:ProgramFiles 'dotnet'
    & $scriptPath -Channel '10.0' -InstallDir $dotnetDir -NoPath | Out-Host
    Add-MachinePath $dotnetDir
  }
  Refresh-Path
  if (-not (Have 'dotnet')) { throw 'dotnet still not on PATH' }
  dotnet --list-sdks | Out-Host
}

Step 'Install Git for Windows' {
  if (Have 'git') { git --version; return }
  $installed = $false
  if (Test-Winget) {
    try { Install-Winget -Id 'Git.Git' -Label 'Git'; $installed = (Have 'git') } catch { Write-Host "winget failed: $_" }
  }
  if (-not $installed) {
    $url = Get-GitHubAsset -Repo 'git-for-windows/git' -Pattern '^Git-.*-64-bit\.exe$'
    $exe = Join-Path $env:TEMP 'git-setup.exe'
    Invoke-WebRequest $url -OutFile $exe -UseBasicParsing
    Start-Process $exe -ArgumentList '/VERYSILENT', '/NORESTART', '/NOCANCEL', '/SP-' -Wait
    Add-MachinePath (Join-Path $env:ProgramFiles 'Git\cmd')
  }
  Refresh-Path
  if (-not (Have 'git')) { throw 'git still not on PATH' }
  git --version
}

Step 'Install PowerShell 7' {
  $pwsh = Join-Path $env:ProgramFiles 'PowerShell\7\pwsh.exe'
  if (Test-Path $pwsh) { & $pwsh -NoProfile -Command '$PSVersionTable.PSVersion.ToString()'; return }
  $installed = $false
  if (Test-Winget) {
    try { Install-Winget -Id 'Microsoft.PowerShell' -Label 'PowerShell 7'; $installed = (Test-Path $pwsh) } catch { Write-Host "winget failed: $_" }
  }
  if (-not $installed) {
    $url = Get-GitHubAsset -Repo 'PowerShell/PowerShell' -Pattern '^PowerShell-.*-win-x64\.msi$'
    $msi = Join-Path $env:TEMP 'pwsh.msi'
    Invoke-WebRequest $url -OutFile $msi -UseBasicParsing
    Start-Process 'msiexec.exe' -ArgumentList "/i `"$msi`" /qn /norestart ADD_PATH=1" -Wait
  }
  if (-not (Test-Path $pwsh)) { throw 'pwsh.exe not found after install' }
  Add-MachinePath (Join-Path $env:ProgramFiles 'PowerShell\7')
  & $pwsh -NoProfile -Command '$PSVersionTable.PSVersion.ToString()'
}

if (-not $NoSysinternals) {
  Step 'Install Sysinternals (psexec for session-1 launches)' {
    if (Have 'psexec') { return }
    if (-not (Test-Winget)) { throw 'winget unavailable' }
    Install-Winget -Id 'Microsoft.Sysinternals' -Label 'Sysinternals'
    Write-Host 'note: psexec lives in the Sysinternals folder; use its full path or install to PATH later.'
  }
}

if ($TestApps) {
  Step 'Install test apps (VS Code, Chrome)' {
    if (-not (Have 'code')) { Install-Winget -Id 'Microsoft.VisualStudioCode' -Label 'VS Code' }
    Install-Winget -Id 'Google.Chrome' -Label 'Chrome'
  }
}

Step 'Set PowerShell 7 as the SSH shell (now that it is installed)' {
  $pwsh = Join-Path $env:ProgramFiles 'PowerShell\7\pwsh.exe'
  if (Test-Path $pwsh) {
    New-Item -Path 'HKLM:\SOFTWARE\OpenSSH' -Force | Out-Null
    New-ItemProperty -Path 'HKLM:\SOFTWARE\OpenSSH' -Name DefaultShell -Value $pwsh -PropertyType String -Force | Out-Null
    New-ItemProperty -Path 'HKLM:\SOFTWARE\OpenSSH' -Name DefaultShellCommandOption -Value '-c' -PropertyType String -Force | Out-Null
    Restart-Service sshd -ErrorAction SilentlyContinue
  } else {
    Write-Host 'pwsh not found; sshd keeps the default shell.'
  }
}

# -------------------------------------------------------------- autologon ----
Step 'Configure autologon (interactive session for tests)' {
  if (-not $Autologon) { Write-Host 'skipped (-Autologon:$false)'; return }
  $local = Get-LocalUser -Name $Username -ErrorAction SilentlyContinue
  if ($null -eq $local) {
    throw "no local account named '$Username' — autologon needs a local account (create one, or rerun with -Username <local>)"
  }
  if ([string]::IsNullOrEmpty($Password)) {
    $secure = Read-Host -Prompt "Password for $Username (used for autologon; stored in the VM's Winlogon settings)" -AsSecureString
    $Password = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
      [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
  }
  if ([string]::IsNullOrEmpty($Password)) { throw 'no password given; autologon skipped' }

  $winlogon = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
  New-ItemProperty -Path $winlogon -Name 'AutoAdminLogon' -Value '1' -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $winlogon -Name 'DefaultUserName' -Value $Username -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $winlogon -Name 'DefaultDomainName' -Value $env:COMPUTERNAME -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $winlogon -Name 'DefaultPassword' -Value $Password -PropertyType String -Force | Out-Null
  Remove-ItemProperty -Path $winlogon -Name 'AutoLogonCount' -ErrorAction SilentlyContinue
  Write-Host "autologon configured for $Username (test VM only; password stored per Windows' own autologon mechanism)"
}

# ----------------------------------------------------------- determinism -----
if (-not $SkipDeterminism) {
  Step 'Power and boot determinism' {
    powercfg /change monitor-timeout-ac 0
    powercfg /change monitor-timeout-dc 0
    powercfg /change standby-timeout-ac 0
    powercfg /change standby-timeout-dc 0
    powercfg /change disk-timeout-ac 0
    powercfg /hibernate off
    # Fast startup hides the logon path and makes reboots non-deterministic.
    New-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power' `
      -Name HiberbootEnabled -Value 0 -PropertyType DWord -Force | Out-Null
    # Long paths and Developer Mode for builds and tools.
    New-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' `
      -Name LongPathsEnabled -Value 1 -PropertyType DWord -Force | Out-Null
    New-Item -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock' -Force | Out-Null
    New-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock' `
      -Name AllowDevelopmentWithoutDevLicense -Value 1 -PropertyType DWord -Force | Out-Null
  }

  Step 'No lock screen, no screensaver, no update auto-reboot' {
    New-Item -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Personalization' -Force | Out-Null
    New-ItemProperty -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Personalization' `
      -Name NoLockScreen -Value 1 -PropertyType DWord -Force | Out-Null
    New-ItemProperty -Path 'HKCU:\Control Panel\Desktop' -Name ScreenSaveActive -Value '0' -PropertyType String -Force | Out-Null
    New-Item -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU' -Force | Out-Null
    New-ItemProperty -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU' `
      -Name NoAutoRebootWithLoggedOnUsers -Value 1 -PropertyType DWord -Force | Out-Null
    New-Item -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\CloudContent' -Force | Out-Null
    New-ItemProperty -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\CloudContent' `
      -Name DisableWindowsConsumerFeatures -Value 1 -PropertyType DWord -Force | Out-Null
  }

  Step 'Animations off (applies to the autologon user after the reboot)' {
    # VisualFXSetting=2 is "Adjust for best performance"; it lands on the user's
    # next logon, and the bootstrap always ends with a reboot, so no per-user
    # SystemParametersInfo call is needed here.
    New-Item -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\VisualEffects' -Force | Out-Null
    New-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\VisualEffects' `
      -Name VisualFXSetting -Value 2 -PropertyType DWord -Force | Out-Null
    # Reduce Defender/AV interference with the build tree (test VM only).
    try { Add-MpPreference -ExclusionPath $AdrtRoot -ErrorAction SilentlyContinue } catch { }
  }

  Step 'Time sync' {
    Start-Service w32time -ErrorAction SilentlyContinue
    w32tm /resync /force | Out-Host
  }
}

Step 'Allow local script execution' {
  Set-ExecutionPolicy -Scope LocalMachine RemoteSigned -Force
  Set-ExecutionPolicy -Scope CurrentUser RemoteSigned -Force -ErrorAction SilentlyContinue
}

# ---------------------------------------------------------------- summary ----
Stop-Transcript | Out-Null
Write-Host ''
Write-Host '================ summary ================' -ForegroundColor White
$script:Results | Format-Table -AutoSize | Out-Host

$ips = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.PrefixOrigin -ne 'WellKnown' } |
  Select-Object -ExpandProperty IPAddress
Write-Host 'SSH endpoints:' -ForegroundColor White
$ips | ForEach-Object { Write-Host ("  ssh {0}@{1}" -f $Username, $_) }
Write-Host ''
Write-Host 'Next steps:' -ForegroundColor White
Write-Host '  1. Reboot:  shutdown /r /t 5   (autologon brings the desktop up by itself)'
Write-Host '  2. SNAPSHOT the VM now — this is the clean baseline.'
Write-Host '  3. Send the SSH endpoint + credentials to the dev box; the agent takes over.'
Write-Host ''
if ($script:Failed -gt 0) {
  Write-Host "$($script:Failed) fatal step(s) failed. Fix those before snapshotting." -ForegroundColor Red
  exit 1
}
Write-Host 'Bootstrap complete.' -ForegroundColor Green
exit 0
