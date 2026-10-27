#Requires -Version 5.1
<#
.SYNOPSIS
  T00 — harness self-test: VM channel, pipe protocol, CLI, results and evidence.

.DESCRIPTION
  Proves the whole automation loop before any tiling scenario runs:
    * the job/result channel starts this script in the interactive session,
    * adrt-cli reaches the running app's named pipe,
    * ping and DumpState/DumpDecisions/DumpEvents answer in the wire shape,
    * the results writer produces a parseable result and evidence paths.

  This scenario deliberately does not move windows; T01 is the first tiling test.
#>

. (Join-Path $PSScriptRoot 'lib\Scenario.ps1')

Start-AdrtScenario 'T00-self-test'

try {
  $envEvidence = [ordered]@{
    computer   = $env:COMPUTERNAME
    user       = $env:USERNAME
    os         = [Environment]::OSVersion.VersionString
    powershell = $PSVersionTable.PSVersion.ToString()
    cli        = $script:AdrtCli
    results    = $script:ResultsDir
  } | ConvertTo-Json -Depth 4
  Save-AdrtEvidence -Name 'env.json' -Content $envEvidence | Out-Null

  $ping = Invoke-AdrtCli -Arguments @('ping') -TimeoutMs 5000 -TranscriptOutput
  Add-AdrtCheck 'ping exits 0' ($ping.ExitCode -eq 0) ('exit={0} {1}' -f $ping.ExitCode, $ping.Stderr.Trim())
  Add-AdrtCheck 'ping answers pong' ($null -ne $ping.Json -and $ping.Json.pong -eq $true) $ping.JsonError
  Add-AdrtCheck 'ping names a per-user pipe' (
    $null -ne $ping.Json -and $ping.Json.pipe -match '^\\\\\.\\pipe\\adrt-'
  ) $(if ($null -ne $ping.Json) { [string]$ping.Json.pipe } else { 'no JSON' })
  Add-AdrtCheck 'ping reports the trigger table' (
    $null -ne $ping.Json -and [int]$ping.Json.triggers -eq 85
  ) $(if ($null -ne $ping.Json) { 'triggers={0}' -f $ping.Json.triggers } else { 'no JSON' })
  Add-AdrtCheck 'ping reports a pid' ($null -ne $ping.Json -and [int]$ping.Json.pid -gt 0) ''

  $listed = Invoke-AdrtCli -Arguments @('list-triggers') -TimeoutMs 5000 -ParseJson:$false
  $lines = @()
  if ($listed.Stdout.Trim().Length -gt 0) {
    $lines = @([regex]::Split($listed.Stdout.Trim(), '\r?\n'))
  }
  Add-AdrtCheck 'list-triggers prints all 85 triggers' (
    $listed.ExitCode -eq 0 -and $lines.Count -eq 85
  ) ('exit={0} lines={1}' -f $listed.ExitCode, $lines.Count)

  $state = Invoke-AdrtCli -Arguments @('dump-state') -TimeoutMs 15000
  $stateEvidence = Save-AdrtEvidence -Name 'dump-state.json' -Content $state.Stdout
  Add-AdrtCheck 'dump-state exits 0' ($state.ExitCode -eq 0) ('exit={0} {1}' -f $state.ExitCode, $state.Stderr.Trim()) @($stateEvidence)
  Add-AdrtCheck 'dump-state is the adrt.state document' (
    $null -ne $state.Json -and $state.Json.format -eq 'adrt.state'
  ) $(if ($null -ne $state.Json) { 'format={0} version={1}' -f $state.Json.format, $state.Json.version } else { $state.JsonError }) @($stateEvidence)
  Add-AdrtCheck 'dump-state carries a monitor list' (
    $null -ne $state.Json -and @($state.Json.monitors).Count -ge 1
  ) $(if ($null -ne $state.Json) { 'monitors={0}' -f @($state.Json.monitors).Count } else { 'no JSON' }) @($stateEvidence)
  Add-AdrtCheck 'dump-state carries a window list' (
    $null -ne $state.Json -and $null -ne $state.Json.windows -and $state.Json.windows -is [array]
  ) $(if ($null -ne $state.Json -and $null -ne $state.Json.windows) { 'windows={0}' -f @($state.Json.windows).Count } else { 'no windows field' }) @($stateEvidence)

  $decisions = Invoke-AdrtCli -Arguments @('dump-decisions', '20') -TimeoutMs 15000
  $decisionEvidence = Save-AdrtEvidence -Name 'dump-decisions.json' -Content $decisions.Stdout
  Add-AdrtCheck 'dump-decisions answers JSON' (
    $decisions.ExitCode -eq 0 -and $null -ne $decisions.Json
  ) ('exit={0} {1}' -f $decisions.ExitCode, $(if ($null -ne $decisions.Json) { 'parsed' } else { $decisions.JsonError })) @($decisionEvidence)

  $events = Invoke-AdrtCli -Arguments @('dump-events', '20', '') -TimeoutMs 15000
  $eventEvidence = Save-AdrtEvidence -Name 'dump-events.json' -Content $events.Stdout
  Add-AdrtCheck 'dump-events answers JSON' (
    $events.ExitCode -eq 0 -and $null -ne $events.Json
  ) ('exit={0} {1}' -f $events.ExitCode, $(if ($null -ne $events.Json) { 'parsed' } else { $events.JsonError })) @($eventEvidence)

  $unknown = Invoke-AdrtCli -Arguments @('trigger', 'NotATrigger', '[]') -TimeoutMs 5000 -Quiet
  Add-AdrtCheck 'unknown trigger is a remote error, not a hang' ($unknown.ExitCode -eq 1) ('exit={0}' -f $unknown.ExitCode)
}
catch {
  Add-AdrtCheck 'scenario completed without an exception' $false $_.Exception.Message
}
finally {
  exit (Complete-AdrtScenario)
}
