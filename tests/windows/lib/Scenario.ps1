#Requires -Version 5.1
<#
.SYNOPSIS
  Shared helpers for tests/windows/T*.ps1.

.DESCRIPTION
  A scenario is a PowerShell script that:
    * dot-sources this file,
    * calls Start-AdrtScenario,
    * records checks with Add-AdrtCheck,
    * ends with `exit (Complete-AdrtScenario)`.

  Complete-AdrtScenario writes <ADRT_RESULTS_DIR>\<id>.json atomically and, on
  failure, captures DumpState/DumpDecisions/DumpEvents plus the transcript under
  <id>.evidence\. It never throws on the normal path, so a failing scenario always
  leaves a result file and evidence behind.

  Environment:
    ADRT_CLI          path to adrt-cli.exe (otherwise searched)
    ADRT_RESULTS_DIR  result directory (default %LOCALAPPDATA%\Adrt\results)
    ADRT_JOB_ID       job id supplied by Adrt.VmAgent (default generated)
#>

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$script:Utf8 = New-Object System.Text.UTF8Encoding($false)
$script:Checks = New-Object System.Collections.ArrayList
$script:Started = $false
$script:AdrtCli = $null
$script:AdrtCliError = $null
$script:ScenarioName = $null
$script:RunId = $null
$script:ResultsDir = $null
$script:EvidenceDir = $null
$script:TranscriptPath = $null
$script:StartedAt = $null

function Get-AdrtValue {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [string]$Default = ''
  )

  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) { return $Default }
  return $value
}

function Resolve-AdrtCli {
  $configured = Get-AdrtValue -Name 'ADRT_CLI'
  if ($configured.Length -gt 0) {
    if (-not (Test-Path -LiteralPath $configured)) {
      throw "ADRT_CLI points at '$configured', which does not exist"
    }
    return (Resolve-Path -LiteralPath $configured).Path
  }

  $repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\..')).Path
  $candidates = @(
    'C:\adrt\bin\cli\adrt-cli.exe',
    (Join-Path $repoRoot 'windows\src\Adrt.Cli\bin\Debug\net10.0-windows\adrt-cli.exe'),
    (Join-Path $repoRoot 'windows\src\Adrt.Cli\bin\Release\net10.0-windows\adrt-cli.exe')
  )

  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) { return (Resolve-Path -LiteralPath $candidate).Path }
  }

  $command = Get-Command 'adrt-cli' -ErrorAction SilentlyContinue
  if ($null -ne $command) { return $command.Source }

  throw 'adrt-cli not found; set ADRT_CLI or run scripts/windows/vm.sh push'
}

function Start-AdrtScenario {
  param([Parameter(Mandatory = $true)][string]$Name)

  $script:ScenarioName = $Name
  $script:RunId = Get-AdrtValue -Name 'ADRT_JOB_ID'
  if ($script:RunId.Length -eq 0) {
    $script:RunId = '{0}-{1}-{2}' -f $Name, (Get-Date -Format 'yyyyMMdd-HHmmss'), $PID
  }

  $script:ResultsDir = Get-AdrtValue -Name 'ADRT_RESULTS_DIR' -Default (Join-Path $env:LOCALAPPDATA 'Adrt\results')
  $script:EvidenceDir = Join-Path $script:ResultsDir ('{0}.evidence' -f $script:RunId)
  New-Item -ItemType Directory -Path $script:ResultsDir -Force | Out-Null
  New-Item -ItemType Directory -Path $script:EvidenceDir -Force | Out-Null

  $script:TranscriptPath = Join-Path $script:EvidenceDir 'transcript.log'
  [IO.File]::WriteAllText($script:TranscriptPath, '', $script:Utf8)
  $script:StartedAt = [DateTimeOffset]::UtcNow
  $script:Started = $true

  try {
    $script:AdrtCli = Resolve-AdrtCli
  }
  catch {
    $script:AdrtCli = $null
    $script:AdrtCliError = $_.Exception.Message
  }

  Write-AdrtTranscript ('scenario {0} run {1}' -f $Name, $script:RunId)
  Write-AdrtTranscript ('results {0}' -f $script:ResultsDir)
  Write-AdrtTranscript ('cli {0}' -f $(if ($null -ne $script:AdrtCli) { $script:AdrtCli } else { '<not found>' }))
  Write-AdrtTranscript ('host {0} / user {1} / ps {2}' -f $env:COMPUTERNAME, $env:USERNAME, $PSVersionTable.PSVersion)
}

function Write-AdrtTranscript {
  param([Parameter(Mandatory = $true)][string]$Text)

  if (-not $script:Started) { return }
  $line = '[{0:HH:mm:ss.fff}] {1}{2}' -f (Get-Date), $Text, [Environment]::NewLine
  [IO.File]::AppendAllText($script:TranscriptPath, $line, $script:Utf8)
}

function ConvertTo-AdrtArgument {
  param([string]$Value)

  if ($Value -notmatch '[\s"]') { return $Value }

  $escaped = [regex]::Replace($Value, '(\\*)"', {
      param($match)
      $slashes = $match.Groups[1].Value
      return $slashes + $slashes + '\"'
    })
  $escaped = [regex]::Replace($escaped, '(\\+)$', {
      param($match)
      return $match.Groups[1].Value + $match.Groups[1].Value
    })
  return '"' + $escaped + '"'
}

<#
.SYNOPSIS
  Run adrt-cli and return its exit code, streams and parsed stdout.

  stdout is parsed as JSON unless -ParseJson:$false is passed. A parse failure is
  not itself a command failure: JsonError is set and the caller decides.
#>
function Invoke-AdrtCli {
  param(
    [string[]]$Arguments = @(),
    [int]$TimeoutMs = 15000,
    [string]$Stdin,
    [bool]$ParseJson = $true,
    [switch]$Quiet,
    [switch]$TranscriptOutput
  )

  if ($null -eq $script:AdrtCli) {
    throw $(if ($script:AdrtCliError) { $script:AdrtCliError } else { 'adrt-cli is not available' })
  }

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  if ([IO.Path]::GetExtension($script:AdrtCli) -eq '.dll') {
    $psi.FileName = 'dotnet'
    $cliArguments = @($script:AdrtCli) + $Arguments
  }
  else {
    $psi.FileName = $script:AdrtCli
    $cliArguments = $Arguments
  }

  $psi.Arguments = ($cliArguments | ForEach-Object { ConvertTo-AdrtArgument ([string]$_) }) -join ' '
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.RedirectStandardInput = $true

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $psi

  Write-AdrtTranscript ('$ adrt-cli {0}' -f $psi.Arguments)

  if (-not $process.Start()) {
    throw 'failed to start adrt-cli'
  }

  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  if ($null -ne $Stdin) { $process.StandardInput.Write($Stdin) }
  $process.StandardInput.Close()

  $timedOut = -not $process.WaitForExit($TimeoutMs)
  if ($timedOut) {
    try { $process.Kill() } catch { }
    try { $process.WaitForExit(2000) | Out-Null } catch { }
  }

  try { $stdout = $stdoutTask.Result } catch { $stdout = '' }
  try { $stderr = $stderrTask.Result } catch { $stderr = '' }
  $exitCode = if ($timedOut) { 3 } else { $process.ExitCode }
  $process.Dispose()

  Write-AdrtTranscript ('  exit={0} timedOut={1}' -f $exitCode, $timedOut)
  if ($stderr.Length -gt 0) { Write-AdrtTranscript ('  stderr: {0}' -f $stderr.TrimEnd()) }
  if ($TranscriptOutput -and $stdout.Length -gt 0) {
    Write-AdrtTranscript ('  stdout: {0}' -f $stdout.TrimEnd())
  }

  $json = $null
  $jsonError = $null
  if ($ParseJson -and $stdout.Trim().Length -gt 0) {
    try { $json = $stdout | ConvertFrom-Json }
    catch { $jsonError = $_.Exception.Message }
  }

  if (-not $Quiet) {
    if ($timedOut) {
      Write-Host ('TIMEOUT  adrt-cli {0} after {1} ms' -f $psi.Arguments, $TimeoutMs) -ForegroundColor Yellow
    }
    elseif ($exitCode -ne 0) {
      Write-Host ('FAIL     adrt-cli {0} (exit {1}): {2}' -f $psi.Arguments, $exitCode, $stderr.Trim()) -ForegroundColor Red
    }
  }

  return [pscustomobject]@{
    ExitCode = $exitCode
    TimedOut = $timedOut
    Stdout   = $stdout
    Stderr   = $stderr
    Json     = $json
    JsonError = $jsonError
  }
}

function Get-AdrtState {
  param([int]$TimeoutMs = 15000)

  $result = Invoke-AdrtCli -Arguments @('dump-state') -TimeoutMs $TimeoutMs -Quiet
  if ($result.ExitCode -ne 0) {
    throw ('dump-state failed (exit {0}): {1}' -f $result.ExitCode, $result.Stderr.Trim())
  }
  if ($null -eq $result.Json) {
    throw ('dump-state returned no JSON: {0}' -f $result.JsonError)
  }
  return $result.Json
}

function Add-AdrtCheck {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [bool]$Ok,
    [string]$Detail = '',
    [string[]]$Evidence = @()
  )

  $entry = [pscustomobject]@{
    name     = $Name
    ok       = $Ok
    detail   = $Detail
    evidence = @($Evidence)
    at       = (Get-Date).ToString('o')
  }
  $script:Checks.Add($entry) | Out-Null

  if ($Ok) {
    Write-Host ('PASS  {0}{1}' -f $Name, $(if ($Detail) { " — $Detail" } else { '' })) -ForegroundColor Green
  }
  else {
    Write-Host ('FAIL  {0}{1}' -f $Name, $(if ($Detail) { " — $Detail" } else { '' })) -ForegroundColor Red
  }
  Write-AdrtTranscript (('check {0}: {1}{2}' -f $Name, $(if ($Ok) { 'PASS' } else { 'FAIL' }), $(if ($Detail) { " — $Detail" } else { '' })))
}

function Save-AdrtEvidence {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [AllowNull()][string]$Content = ''
  )

  $path = Join-Path $script:EvidenceDir $Name
  $directory = Split-Path -Parent $path
  if (-not (Test-Path -LiteralPath $directory)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
  }
  if ($null -eq $Content) { $Content = '' }
  [IO.File]::WriteAllText($path, $Content, $script:Utf8)
  return $path
}

function Wait-AdrtCondition {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$Condition,
    [int]$TimeoutMs = 10000,
    [int]$IntervalMs = 250
  )

  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
  while ([DateTime]::UtcNow -lt $deadline) {
    try {
      if (& $Condition) { return $true }
    }
    catch {
      Write-AdrtTranscript ('  poll error: {0}' -f $_.Exception.Message)
    }
    Start-Sleep -Milliseconds $IntervalMs
  }
  return $false
}

function Save-AdrtFailureEvidence {
  if (-not $script:Started) { return }

  foreach ($command in @('dump-state', 'dump-decisions', 'dump-events')) {
    try {
      $result = Invoke-AdrtCli -Arguments @($command) -TimeoutMs 10000 -Quiet -ParseJson:$false
      Save-AdrtEvidence -Name ('{0}.json' -f $command) -Content $result.Stdout | Out-Null
      if ($result.Stderr.Trim().Length -gt 0) {
        Save-AdrtEvidence -Name ('{0}.stderr.txt' -f $command) -Content $result.Stderr | Out-Null
      }
    }
    catch {
      Save-AdrtEvidence -Name ('{0}.error.txt' -f $command) -Content $_.Exception.Message | Out-Null
    }
  }
}

<#
.SYNOPSIS
  Write the result JSON and return the process exit code (0 pass, 1 fail).
#>
function Complete-AdrtScenario {
  if (-not $script:Started) {
    Write-Error 'Complete-AdrtScenario called before Start-AdrtScenario'
    return 1
  }

  $failed = @($script:Checks | Where-Object { -not $_.ok })
  $ok = ($script:Checks.Count -gt 0) -and ($failed.Count -eq 0)

  if (-not $ok) {
    Save-AdrtFailureEvidence
    Save-AdrtEvidence -Name 'checks.txt' -Content (
      ($script:Checks | ForEach-Object {
          '{0}  {1}{2}' -f $(if ($_.ok) { 'PASS' } else { 'FAIL' }), $_.name, $(if ($_.detail) { " — $($_.detail)" } else { '' })
        }) -join [Environment]::NewLine
    ) | Out-Null
  }

  $endedAt = [DateTimeOffset]::UtcNow
  $evidence = @()
  try {
    $evidence = @(Get-ChildItem -LiteralPath $script:EvidenceDir -Recurse -File |
        Sort-Object FullName |
        ForEach-Object { $_.FullName })
  }
  catch {
    $evidence = @($script:EvidenceDir)
  }

  $result = [ordered]@{
    id           = $script:RunId
    scenario     = $script:ScenarioName
    ok           = $ok
    startedAt    = $script:StartedAt.ToString('o')
    endedAt      = $endedAt.ToString('o')
    durationMs   = [int]($endedAt - $script:StartedAt).TotalMilliseconds
    host         = $env:COMPUTERNAME
    user         = $env:USERNAME
    platform     = [Environment]::OSVersion.VersionString
    powershell   = $PSVersionTable.PSVersion.ToString()
    cli          = $script:AdrtCli
    evidenceDir  = $script:EvidenceDir
    transcript   = $script:TranscriptPath
    checks       = @($script:Checks)
    evidence     = $evidence
    error        = $script:AdrtCliError
  }

  $path = Join-Path $script:ResultsDir ('{0}.json' -f $script:RunId)
  $temporary = '{0}.tmp' -f $path
  $json = $result | ConvertTo-Json -Depth 12
  [IO.File]::WriteAllText($temporary, $json, $script:Utf8)
  Move-Item -LiteralPath $temporary -Destination $path -Force

  Write-AdrtTranscript (('result {0}: {1}' -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $path))
  Write-Host ''
  Write-Host ('{0}: {1}/{2} checks passed' -f $script:ScenarioName, ($script:Checks.Count - $failed.Count), $script:Checks.Count) -ForegroundColor $(if ($ok) { 'Green' } else { 'Red' })
  Write-Host ('result:   {0}' -f $path)
  Write-Host ('evidence: {0}' -f $script:EvidenceDir)

  if ($ok) { return 0 }
  return 1
}
