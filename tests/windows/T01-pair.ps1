#Requires -Version 5.1
<#
.SYNOPSIS
  T01 — two spawned windows become a left/right pair.

.DESCRIPTION
  Spawns two Notepad windows through the test trigger, waits for the tiler to
  place them, and asserts the v2 pair invariants:
    * both are tileable with slots 0 and 1,
    * they share a monitor and workspace,
    * together they cover the monitor work area, meeting in the middle.

  The scenario only closes windows it created. On failure the shared helper
  captures DumpState/DumpDecisions/DumpEvents into <id>.evidence\.
#>

. (Join-Path $PSScriptRoot 'lib\Scenario.ps1')

Start-AdrtScenario 'T01-pair'

$initialIds = @()
$newIds = @()
$initialStateOk = $false
$script:T01State = $null
$script:T01Pair = @()

function Get-T01WorkArea {
  param($State, $Window)

  $monitor = @($State.monitors | Where-Object { [int]$_.index -eq [int]$Window.monitor } | Select-Object -First 1)
  if ($monitor.Count -eq 0) {
    $monitor = @($State.monitors | Select-Object -First 1)
  }
  if ($monitor.Count -eq 0) { return $null }
  if ($null -ne $monitor[0].workArea) { return $monitor[0].workArea }
  return $monitor[0].geometry
}

try {
  $initial = Get-AdrtState
  $initialIds = @($initial.windows | ForEach-Object { [int]$_.id })
  $initialStateOk = $true

  $spawnedPids = @()
  for ($i = 1; $i -le 2; $i += 1) {
    # SpawnWindow(argvJson, envJson): the first argument is the argv array as a
    # JSON string, the second is the extra environment as a JSON object.
    $spawnArguments = @('["notepad.exe"]', '{}') | ConvertTo-Json -Compress
    $spawn = Invoke-AdrtCli -Arguments @('trigger', 'SpawnWindow', $spawnArguments) -TimeoutMs 20000
    $pidValue = 0
    if ($null -ne $spawn.Json) { $pidValue = [int]$spawn.Json }
    if ($pidValue -gt 0) { $spawnedPids += $pidValue }
    Add-AdrtCheck ('SpawnWindow #{0} returns a pid' -f $i) (
      $spawn.ExitCode -eq 0 -and $pidValue -gt 0
    ) ('exit={0} pid={1} {2}' -f $spawn.ExitCode, $pidValue, $spawn.Stderr.Trim())
  }

  # Wait until both windows are tracked, have slots, and the pair covers the
  # work area. The last observed state is kept for the assertions below.
  $settled = Wait-AdrtCondition -TimeoutMs 25000 -IntervalMs 300 -Condition {
      $state = Get-AdrtState
      $fresh = @($state.windows | Where-Object {
          $initialIds -notcontains [int]$_.id -and -not [bool]$_.minimized
        })
      if ($fresh.Count -lt 2) { return $false }

      $pair = @($fresh | Sort-Object { [double]$_.rect.x } | Select-Object -First 2)
      $script:T01State = $state
      $script:T01Pair = $pair

      if ($null -eq $pair[0].slot -or $null -eq $pair[1].slot) { return $false }
      if ([int]$pair[0].monitor -ne [int]$pair[1].monitor) { return $false }

      $workArea = Get-T01WorkArea -State $state -Window $pair[0]
      if ($null -eq $workArea) { return $false }

      $left = $pair[0].rect
      $right = $pair[1].rect
      $tolerance = 3.0
      $leftEdge = [math]::Abs([double]$left.x - [double]$workArea.x) -le $tolerance
      $rightEdge = [math]::Abs(([double]$right.x + [double]$right.width) - ([double]$workArea.x + [double]$workArea.width)) -le $tolerance
      $meet = [math]::Abs(([double]$left.x + [double]$left.width) - [double]$right.x) -le $tolerance
      $height = [math]::Abs([double]$left.height - [double]$workArea.height) -le $tolerance -and
                [math]::Abs([double]$right.height - [double]$workArea.height) -le $tolerance
      return ($leftEdge -and $rightEdge -and $meet -and $height)
    }

  $state = if ($null -ne $script:T01State) { $script:T01State } else { Get-AdrtState }
  $fresh = @($state.windows | Where-Object { $initialIds -notcontains [int]$_.id -and -not [bool]$_.minimized })
  $newIds = @($fresh | ForEach-Object { [int]$_.id })
  $stateEvidence = Save-AdrtEvidence -Name 'dump-state.json' -Content ($state | ConvertTo-Json -Depth 12)

  Add-AdrtCheck 'two new windows are tracked' ($fresh.Count -ge 2) ('new={0}' -f $fresh.Count) @($stateEvidence)

  $pair = @($script:T01Pair)
  if ($pair.Count -lt 2) {
    $pair = @($fresh | Sort-Object { [double]$_.rect.x } | Select-Object -First 2)
  }

  $tileable = $pair.Count -eq 2 -and [bool]$pair[0].tileable -and [bool]$pair[1].tileable
  Add-AdrtCheck 'both pair members are tileable' $tileable ''

  $sameMonitor = $pair.Count -eq 2 -and [int]$pair[0].monitor -eq [int]$pair[1].monitor
  Add-AdrtCheck 'pair members share a monitor' $sameMonitor ''

  $sameWorkspace = $pair.Count -eq 2 -and [int]$pair[0].workspace -eq [int]$pair[1].workspace
  Add-AdrtCheck 'pair members share a workspace' $sameWorkspace ''

  $slots = @()
  if ($pair.Count -eq 2) { $slots = @([int]($pair[0].slot), [int]($pair[1].slot)) }
  $slotsOk = $slots.Count -eq 2 -and ($slots -contains 0) -and ($slots -contains 1)
  Add-AdrtCheck 'pair occupies slots 0 and 1' $slotsOk ('slots={0}' -f ($slots -join ','))

  $geometryOk = $false
  $geometryDetail = 'pair not available'
  if ($pair.Count -eq 2) {
    $workArea = Get-T01WorkArea -State $state -Window $pair[0]
    if ($null -ne $workArea) {
      $left = $pair[0].rect
      $right = $pair[1].rect
      $tolerance = 3.0
      $leftEdge = [math]::Abs([double]$left.x - [double]$workArea.x) -le $tolerance
      $rightEdge = [math]::Abs(([double]$right.x + [double]$right.width) - ([double]$workArea.x + [double]$workArea.width)) -le $tolerance
      $meet = [math]::Abs(([double]$left.x + [double]$left.width) - [double]$right.x) -le $tolerance
      $height = [math]::Abs([double]$left.height - [double]$workArea.height) -le $tolerance -and
                [math]::Abs([double]$right.height - [double]$workArea.height) -le $tolerance
      $width = [double]$left.width -ge ([double]$workArea.width * 0.35) -and
               [double]$right.width -ge ([double]$workArea.width * 0.35)
      $geometryOk = $leftEdge -and $rightEdge -and $meet -and $height -and $width
      $geometryDetail = 'left={0:0},{1:0} {2:0}x{3:0} right={4:0},{5:0} {6:0}x{7:0} area={8:0},{9:0} {10:0}x{11:0}' -f `
        $left.x, $left.y, $left.width, $left.height,
        $right.x, $right.y, $right.width, $right.height,
        $workArea.x, $workArea.y, $workArea.width, $workArea.height
    }
  }
  Add-AdrtCheck 'the pair fills the work area as two halves' $geometryOk $geometryDetail @($stateEvidence)

  Add-AdrtCheck 'the tiler settled within the timeout' $settled 'waited up to 25 s' @($stateEvidence)
}
catch {
  Add-AdrtCheck 'scenario completed without an exception' $false $_.Exception.Message
}
finally {
  $exitCode = Complete-AdrtScenario

  # Only clean up windows this run created; leave anything the user had open.
  if ($initialStateOk) {
    try {
      $cleanupState = Get-AdrtState -TimeoutMs 5000
      $cleanup = @($cleanupState.windows | Where-Object { $initialIds -notcontains [int]$_.id } | ForEach-Object { [int]$_.id })
      if ($cleanup.Count -gt 0) { $newIds = $cleanup }
    }
    catch {
      # Fall back to the ids observed during the run.
    }
  }

  foreach ($id in ($newIds | Select-Object -Unique)) {
    if ($id -le 0) { continue }
    try {
      $closeArguments = '[{0}]' -f $id
      Invoke-AdrtCli -Arguments @('trigger', 'CloseWindow', $closeArguments) -TimeoutMs 5000 -Quiet | Out-Null
    }
    catch {
      # Best-effort cleanup; the result is already written.
    }
  }

  exit $exitCode
}
