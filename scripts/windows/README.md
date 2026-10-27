# Windows harness (`Adrt.Cli`, named pipe, `vm.sh`, T-scenarios)

This directory and `tests/windows/` are the Windows equivalent of the GNOME
`tests/agent`, `tests/session` and `scripts/session-test.sh` machinery. Three
separate pieces:

| Piece | Location | Role |
| --- | --- | --- |
| Pipe server | `windows/src/Adrt.Windows/Host/Ipc/**` | exposes the 85-trigger table on `\\.\pipe\adrt-<sid>` |
| Pipe client / CLI | `windows/src/Adrt.Cli/**` | `adrt-cli` for scenarios and humans |
| VM channel + scenarios | `scripts/windows/vm.sh`, `tests/windows/**` | Linux → VM jobs, result JSON, evidence |

The server has no host wiring: `IpcServer.Start(dispatch)` takes the app's
trigger delegate. The CLI has no trigger policy: it frames a request and unwraps
the envelope. That is the same split as `gdbus call` + the GNOME adapter.

## The pipe protocol

Name: `\\.\pipe\adrt-<sid>` (the current user's SID, e.g.
`\\.\pipe\adrt-S-1-5-21-…`). The server also creates it with
`PipeOptions.CurrentUserOnly`, so the ACL is the current user only.
`ADRT_PIPE` overrides the name for isolated/parallel runs.

One JSON object per line, UTF-8, request → response:

```json
{"id":"cli-abc","trigger":"DumpState","args":null}
{"id":"cli-abc","ok":true,"result":"{\"format\":\"adrt.state\",…}"}
```

```json
{"id":"cli-abc","trigger":"MoveWindow","args":[1234,0,0,640,480]}
{"id":"cli-abc","ok":true,"result":true}
```

```json
{"id":"cli-abc","ok":false,"error":"unknown trigger: NoSuchMethod"}
```

* `id` is any JSON value; the response echoes it verbatim (the CLI uses a string).
* `trigger` must be one of the 85 names in `Adrt.Core.Triggers.All`.
* `args` is the trigger's positional argument array (`null`/absent when the
  trigger takes no arguments). It is handed to the delegate unmodified.
* `ok:false` is used for malformed requests, unknown triggers and exceptions
  thrown by the delegate; it is never a process crash.
* `ping` is a transport control request, not a trigger. It returns
  `{"pong":true,"pid":…,"pipe":…,"triggers":85,"startedAtMs":…,"nowMs":…}`.
* Connections may carry multiple requests; each response is one line.

`DumpState`, `DumpDecisions`, `DumpEvents` and `DumpTrace` return a JSON
*document* in a JSON string (their D-Bus `out` type is `s`). `adrt-cli`'s
`dump-*` commands unwrap that string, so `jq` sees the document; the plain
`trigger` command preserves the exact wire result.

### Wiring the server

Add one line after `host.Start()` in `windows/src/Adrt.Windows/Program.cs`
(`IpcServer` lives in the `Adrt.Windows` namespace, so no `using` is needed):

```csharp
using var ipc = new IpcServer().Start((trigger, args) => triggerDispatch.Invoke(trigger, args));
```

`triggerDispatch` is the host-side map from trigger name to a `JsonNode?` result
(the same map the GNOME adapter builds with `Triggers.BuildDispatch`). `Start`
returns the server, so `using var` stops it during shutdown. `Stop()` is
idempotent; `Dispose()` calls it.

## `adrt-cli`

```text
adrt-cli [options] <command> [arguments]

  trigger <name> [json|-]     any trigger; "-" reads the args from stdin
  dump-state                  DumpState
  dump-decisions [limit]      default 200
  dump-events [limit] [filter] default 200, empty filter
  dump-trace [limit]          default 200
  ping                        transport health
  list-triggers               print the 85-row table (no server needed)
  help

Options:
  --pipe <name>               default adrt-<sid> or $ADRT_PIPE
  --timeout <ms>              default 10000 (also $ADRT_IPC_TIMEOUT_MS)
  --pretty                    indent JSON
```

Examples:

```sh
adrt-cli dump-state | jq .
adrt-cli trigger TogglePause
adrt-cli trigger MoveWindow '[1234,0,0,640,480]'
echo '[1234,0,0,640,480]' | adrt-cli trigger MoveWindow -
adrt-cli trigger SpawnWindow '["notepad.exe"]' '{}'
adrt-cli --timeout 2000 ping
```

Exit codes:

| Code | Meaning |
| --- | --- |
| 0 | success |
| 1 | server answered `ok:false` (trigger error) |
| 2 | bad usage / bad JSON args |
| 3 | request or connect timeout |
| 4 | cannot connect, or malformed/mismatched response |

`adrt-cli` runs on Windows only (named pipes + `WindowsIdentity`). It builds on
Linux with `EnableWindowsTargeting`.

## `scripts/windows/vm.sh`

The SSH session is a file channel only. GUI scenarios must run in the
autologged-in interactive session, so `run` writes a job file and polls for the
result instead of executing PowerShell over SSH directly.

```sh
export ADRT_VM_HOST=192.168.122.42
export ADRT_VM_USER=andrei
export ADRT_VM_SSH_KEY=$HOME/.ssh/adrt_vm

scripts/windows/vm.sh push              # copy + build bin/cli and bin/host
scripts/windows/vm.sh run T00-self-test
scripts/windows/vm.sh smoke             # tests/windows/smoke.list
scripts/windows/vm.sh unit              # dotnet test windows/Adrt.slnx
scripts/windows/vm.sh shot              # screenshot from the interactive session
scripts/windows/vm.sh wait <job-id>     # poll an existing/slow job
```

| Verb | What it does |
| --- | --- |
| `push [--no-build]` | tar/scp the source tree (`windows/`, `tests/windows/`, `scripts/windows/`), then build `Adrt.Cli` → `C:\adrt\bin\cli` and `Adrt.Windows` → `C:\adrt\bin\host` on the VM. `ADRT_VM_SKIP_BUILD=1` also skips the build. |
| `run <scenario>` | verify the scenario and CLI exist, write `C:\adrt\jobs\<id>.json`, wait for `C:\adrt\results\<id>.json`, copy it (and `<id>.evidence/`) to `tests/windows/results/`. |
| `smoke [name…]` | run each name from `tests/windows/smoke.list` (or the supplied names) serially; print a pass/fail/timeout summary. |
| `unit` | run the xUnit suite over SSH; unit tests do not need the desktop. |
| `shot` | job `kind:"shot"`; copy the resulting PNG back. |
| `wait [id]` | poll for one result; without an id it uses the newest result, or `ADRT_JOB_ID`. |
| `--help` | full usage and environment table. |

Environment: `ADRT_VM_HOST`, `ADRT_VM_USER` (required), `ADRT_VM_PORT`,
`ADRT_VM_SSH_KEY`, `ADRT_VM_SSH_OPTS`, `ADRT_VM_ROOT` (default `C:\adrt`),
`ADRT_VM_WAIT_SECONDS`, `ADRT_VM_POLL_SECONDS`, `ADRT_SCENARIO_TIMEOUT_MS`,
`ADRT_VM_SKIP_BUILD`.

Exit codes: `0` all passed, `1` a scenario/unit test failed, `2` usage or
precondition (missing env, source/CLI not pushed), `3` timeout.

### Job contract

`run` and `shot` write one JSON file to `C:\adrt\jobs\<id>.json`:

```json
{"id":"20261027-120000-1234-T01-pair","kind":"scenario",
 "scenario":"T01-pair",
 "path":"C:/adrt/repo/tests/windows/T01-pair.ps1",
 "timeoutMs":300000,
 "env":{"ADRT_RESULTS_DIR":"C:/adrt/results",
        "ADRT_CLI":"C:/adrt/bin/cli/adrt-cli.exe"}}
```

```json
{"id":"20261027-120000-1234-shot","kind":"shot",
 "path":"C:/adrt/results/20261027-120000-1234-shot.png",
 "timeoutMs":30000}
```

An `Adrt.VmAgent` (or equivalent) watches that directory, runs the job in the
interactive session, and writes `C:\adrt\results\<id>.json`. It must honour the
`env` entries when it starts `path`. If the session is locked or no agent is
running, `vm.sh` fails with the timeout message rather than hanging forever.

## Scenarios and results

`tests/windows/lib/Scenario.ps1` provides:

```powershell
. (Join-Path $PSScriptRoot 'lib\Scenario.ps1')
Start-AdrtScenario 'T0x-name'
try {
  $r = Invoke-AdrtCli -Arguments @('ping') -TimeoutMs 5000
  Add-AdrtCheck 'ping answers' ($r.ExitCode -eq 0 -and $r.Json.pong -eq $true) $r.Stderr
}
catch { Add-AdrtCheck 'scenario completed' $false $_.Exception.Message }
finally { exit (Complete-AdrtScenario) }
```

`Complete-AdrtScenario` writes `%ADRT_RESULTS_DIR%\<id>.json` atomically
(default `%LOCALAPPDATA%\Adrt\results`; `vm.sh` sets `C:\adrt\results`) and
returns the process exit code. On failure it captures `dump-state.json`,
`dump-decisions.json`, `dump-events.json` and `transcript.log` under
`<id>.evidence\`; on success the transcript and any explicitly saved artifacts
remain. The result carries `ok`, every check (`name/ok/detail/evidence`), the
host/PowerShell/CLI versions and the evidence paths.

Helpers available to scenarios: `Invoke-AdrtCli`, `Get-AdrtState`,
`Wait-AdrtCondition`, `Add-AdrtCheck`, `Save-AdrtEvidence`,
`Save-AdrtFailureEvidence`, `Write-AdrtTranscript`.

### Smoke list

`tests/windows/smoke.list` is the gate list; one scenario name per line, comments
with `#`. Full-suite-only scenarios get their own `full-only.list` with a
reason (coverage guard). Current smoke set:

* `T00-self-test` — VM channel, ping, all four dump surfaces, CLI table, result
  writer.
* `T01-pair` — two spawned Notepad windows become a left/right pair covering the
  work area, with slots/shared monitor/shared workspace checks and cleanup.

## Troubleshooting

* **`adrt-cli: cannot talk to \\.\pipe\adrt-…`** — the app is not running, or
  `ADRT_PIPE` differs between app and CLI. `adrt-cli ping` first.
* **`vm.sh run` times out** — check the VM has an agent in the interactive
  session (`Get-Process`/Scheduled Task) and that the logon session is unlocked.
  Check `C:\adrt\logs` and `C:\adrt\results`.
* **The T01 spawns are not tiled** — confirm the host built from the same commit,
  then read `<id>.evidence\dump-state.json` (windows, layers, slots, rects) and
  `dump-decisions.json`.
* **`adrt-cli` not found on the VM** — `vm.sh push` builds it to
  `C:\adrt\bin\cli\adrt-cli.exe`; `ADRT_CLI` can point elsewhere.
* **SSH asks for a password** — `vm.sh` uses `BatchMode=yes`; install the key
  per `docs/WINDOWS_VM_SETUP.md`, or set `ADRT_VM_SSH_KEY`.
