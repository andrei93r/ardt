#!/usr/bin/env bash
# Generated with AI for personal use.
#
# scripts/windows/vm.sh — the Linux side of the Windows VM harness.
#
# The SSH session is a file channel, never the place GUI scenarios run. `run`
# drops a job spec into C:\adrt\jobs; Adrt.VmAgent (started at logon in the
# interactive session) executes it and writes C:\adrt\results\<id>.json plus
# optional evidence. `wait` polls for that result and copies it back.
#
# This script is deliberately plain bash + POSIX tools (plus iconv/base64 for
# encoding PowerShell, and python3 for reading a result when available).
#
# Exit codes: 0 ok, 1 test failure, 2 usage/precondition, 3 timeout.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

VM_HOST="${ADRT_VM_HOST:-}"
VM_USER="${ADRT_VM_USER:-}"
VM_PORT="${ADRT_VM_PORT:-22}"
VM_ROOT="${ADRT_VM_ROOT:-C:\\adrt}"
WAIT_SECONDS="${ADRT_VM_WAIT_SECONDS:-600}"
POLL_SECONDS="${ADRT_VM_POLL_SECONDS:-1}"
SCENARIO_TIMEOUT_MS="${ADRT_SCENARIO_TIMEOUT_MS:-300000}"

# C:\adrt -> C:/adrt: PowerShell and scp both accept forward slashes, and the
# job JSON stays readable on both sides.
ROOT_FWD="${VM_ROOT//\\//}"
ROOT_FWD="${ROOT_FWD%/}"
REMOTE_REPO="$ROOT_FWD/repo"
REMOTE_JOBS="$ROOT_FWD/jobs"
REMOTE_RESULTS="$ROOT_FWD/results"
REMOTE_BIN="$ROOT_FWD/bin"
REMOTE_LOGS="$ROOT_FWD/logs"

LOCAL_RESULTS="$ROOT/tests/windows/results"
TARGET="$VM_USER@$VM_HOST"

SSH=()
SCP=()

usage() {
  cat <<'EOF'
scripts/windows/vm.sh — drive the Adrt Windows VM from Linux

Usage:
  vm.sh push [--no-build]           copy the source tree to the VM and build it
  vm.sh run <scenario>              drop one scenario job and wait for its result
  vm.sh smoke [scenario ...]        run tests/windows/smoke.list (or the named ones)
  vm.sh unit                        run `dotnet test windows/Adrt.slnx` on the VM
  vm.sh shot                        take a screenshot in the interactive session
  vm.sh wait [id]                   wait for a result (default: newest result)
  vm.sh --help                      this text

Environment:
  ADRT_VM_HOST            required, VM address or name
  ADRT_VM_USER            required, local admin account on the VM
  ADRT_VM_PORT            SSH port (default 22)
  ADRT_VM_SSH_KEY         private key passed to ssh/scp
  ADRT_VM_SSH_OPTS        extra ssh options, word-split (e.g. "-o StrictHostKeyChecking=accept-new")
  ADRT_VM_ROOT            VM agent root (default C:\adrt)
  ADRT_VM_WAIT_SECONDS    result poll timeout (default 600)
  ADRT_VM_POLL_SECONDS    result poll interval (default 1)
  ADRT_SCENARIO_TIMEOUT_MS  per-scenario timeout in the job (default 300000)
  ADRT_VM_SKIP_BUILD=1    push copies but does not build

Preconditions:
  * key-based SSH to the VM (BatchMode is on; passwords are not prompted);
  * scripts/windows/bootstrap-vm.ps1 has run (C:\adrt folders, .NET 10, pwsh);
  * Adrt.VmAgent or an equivalent job runner watches C:\adrt\jobs and writes
    C:\adrt\results\<id>.json. See scripts/windows/README.md for the job schema.

Examples:
  export ADRT_VM_HOST=192.168.122.42 ADRT_VM_USER=andrei
  scripts/windows/vm.sh push
  scripts/windows/vm.sh run T00-self-test
  scripts/windows/vm.sh smoke
  scripts/windows/vm.sh shot
EOF
}

die() {
  local message="$1"
  local code="${2:-2}"
  printf 'vm.sh: %s\n' "$message" >&2
  return "$code"
}

init_ssh() {
  SSH=(ssh -p "$VM_PORT" -o BatchMode=yes -o ConnectTimeout=10)
  SCP=(scp -P "$VM_PORT" -o BatchMode=yes -o ConnectTimeout=10)

  if [[ -n "${ADRT_VM_SSH_KEY:-}" ]]; then
    SSH+=(-i "$ADRT_VM_SSH_KEY")
    SCP+=(-i "$ADRT_VM_SSH_KEY")
  fi

  if [[ -n "${ADRT_VM_SSH_OPTS:-}" ]]; then
    # Intentionally word-split: a list of ssh options, not a single argument.
    # shellcheck disable=SC2206
    local extra=(${ADRT_VM_SSH_OPTS})
    SSH+=("${extra[@]}")
    SCP+=("${extra[@]}")
  fi
}

check_environment() {
  if [[ -z "$VM_HOST" || -z "$VM_USER" ]]; then
    die "set ADRT_VM_HOST and ADRT_VM_USER (see --help)" 2
    return
  fi
  if [[ ! "$ROOT_FWD" =~ ^[A-Za-z]:/ ]]; then
    die "ADRT_VM_ROOT must be an absolute Windows path like C:\\adrt" 2
    return
  fi
  if [[ ! "$WAIT_SECONDS" =~ ^[0-9]+$ || ! "$POLL_SECONDS" =~ ^[0-9]+$ || ! "$SCENARIO_TIMEOUT_MS" =~ ^[0-9]+$ ]]; then
    die "ADRT_VM_WAIT_SECONDS, ADRT_VM_POLL_SECONDS and ADRT_SCENARIO_TIMEOUT_MS must be integers" 2
    return
  fi
  init_ssh
}

ps_quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/''/g")"
}

encode_pskript() {
  if ! command -v iconv >/dev/null 2>&1; then
    die "iconv is required to encode PowerShell commands" 2
    return 1
  fi
  if ! command -v base64 >/dev/null 2>&1; then
    die "base64 is required to encode PowerShell commands" 2
    return 1
  fi
  printf '%s' "$1" | iconv -f UTF-8 -t UTF-16LE | base64 | tr -d '\r\n'
}

# Run a PowerShell script over SSH; stdout/stderr pass through.
ps_remote() {
  local script="$1" encoded
  encoded="$(encode_pskript "$script")" || return 1
  "${SSH[@]}" "$TARGET" "powershell -NoProfile -NonInteractive -EncodedCommand $encoded"
}

scp_to() {
  "${SCP[@]}" "$1" "$TARGET:$2"
}

scp_from() {
  "${SCP[@]}" "$TARGET:$1" "$2"
}

remote_mkdirs() {
  local paths=() path joined=""
  for path in "$REMOTE_REPO" "$REMOTE_JOBS" "$REMOTE_RESULTS" "$REMOTE_LOGS" \
              "$REMOTE_BIN/cli" "$REMOTE_BIN/host"; do
    paths+=("$(ps_quote "$path")")
  done
  joined="$(IFS=,; printf '%s' "${paths[*]}")"
  ps_remote "New-Item -ItemType Directory -Force -Path @($joined) | Out-Null" >/dev/null
}

remote_repo_present() {
  local answer
  answer="$(ps_remote "if (Test-Path -LiteralPath $(ps_quote "$REMOTE_REPO/windows")) { 'yes' } else { 'no' }" 2>/dev/null | tr -d '\r')"
  [[ "$answer" == *yes* ]]
}

remote_cli_present() {
  local answer
  answer="$(ps_remote "if (Test-Path -LiteralPath $(ps_quote "$REMOTE_BIN/cli/adrt-cli.exe")) { 'yes' } else { 'no' }" 2>/dev/null | tr -d '\r')"
  [[ "$answer" == *yes* ]]
}

build_remote() {
  local script
  printf -v script '%s\n' \
    "Set-Location $(ps_quote "$REMOTE_REPO")" \
    "\$ErrorActionPreference = 'Stop'" \
    "& dotnet build 'windows/src/Adrt.Cli/Adrt.Cli.csproj' -c Release -o $(ps_quote "$REMOTE_BIN/cli") -warnaserror" \
    "if (\$LASTEXITCODE -ne 0) { exit \$LASTEXITCODE }" \
    "& dotnet build 'windows/src/Adrt.Windows/Adrt.Windows.csproj' -c Release -o $(ps_quote "$REMOTE_BIN/host") -warnaserror" \
    "exit \$LASTEXITCODE"
  ps_remote "$script"
}

cmd_push() {
  local no_build=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --no-build) no_build=1 ;;
      *) usage >&2; die "unknown push option '$1'" 2; return ;;
    esac
    shift
  done

  check_environment || return
  echo "vm.sh: pushing $ROOT -> $TARGET:$REMOTE_REPO"
  remote_mkdirs || { die "cannot create $VM_ROOT folders"; return; }

  local tarball
  tarball="$(mktemp "${TMPDIR:-/tmp}/adrt-push.XXXXXX.tar.gz")" || {
    die "cannot create a temporary archive"
    return
  }

  if ! tar -C "$ROOT" \
      --exclude='*/bin' --exclude='*/obj' --exclude='*/bin/*' --exclude='*/obj/*' \
      --exclude='tests/windows/results' \
      -czf "$tarball" windows tests/windows scripts/windows; then
    rm -f "$tarball"
    die "tar failed"
    return
  fi

  if ! scp_to "$tarball" "$ROOT_FWD/adrt-push.tar.gz"; then
    rm -f "$tarball"
    die "scp failed; is key-based SSH working?"
    return
  fi
  rm -f "$tarball"

  local unpack
  printf -v unpack '%s\n' \
    "& tar -xzf $(ps_quote "$ROOT_FWD/adrt-push.tar.gz") -C $(ps_quote "$REMOTE_REPO")" \
    "if (\$LASTEXITCODE -ne 0) { exit \$LASTEXITCODE }" \
    "Remove-Item -LiteralPath $(ps_quote "$ROOT_FWD/adrt-push.tar.gz") -Force"
  ps_remote "$unpack" || { die "cannot unpack on the VM"; return; }

  echo "vm.sh: source pushed."
  if [[ "$no_build" == 1 || "${ADRT_VM_SKIP_BUILD:-0}" == 1 ]]; then
    echo "vm.sh: build skipped (--no-build / ADRT_VM_SKIP_BUILD)."
    return 0
  fi

  echo "vm.sh: building Adrt.Cli and Adrt.Windows on the VM..."
  build_remote || { die "remote build failed"; return; }
  echo "vm.sh: build OK (bin/cli, bin/host)."
}

make_job_id() {
  local label="${1:-job}"
  printf '%s-%s-%s' "$(date -u '+%Y%m%d-%H%M%S')" "$$" "$label"
}

result_ok() {
  local file="$1"
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import json,sys
try:
    print("true" if json.load(open(sys.argv[1], encoding="utf-8")).get("ok") is True else "false")
except Exception:
    print("false")' "$file"
    return 0
  fi
  if grep -Eq '"ok"[[:space:]]*:[[:space:]]*true' "$file"; then
    echo true
  else
    echo false
  fi
}

print_failed_checks() {
  local file="$1"
  command -v python3 >/dev/null 2>&1 || return 0
  python3 -c 'import json,sys
try:
    data = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception:
    sys.exit(0)
for check in data.get("checks", []):
    if not check.get("ok"):
        print("  FAIL  {0}{1}".format(check.get("name", "?"), (" — " + check.get("detail", "")) if check.get("detail") else ""))' "$file" 2>/dev/null || true
}

pull_evidence() {
  local id="$1"
  local remote_dir="$REMOTE_RESULTS/$id.evidence"
  local answer
  answer="$(ps_remote "if (Test-Path -LiteralPath $(ps_quote "$remote_dir")) { 'yes' } else { 'no' }" 2>/dev/null | tr -d '\r')"
  if [[ "$answer" == *yes* ]]; then
    "${SCP[@]}" -r "$TARGET:$remote_dir" "$LOCAL_RESULTS/" >/dev/null || {
      echo "vm.sh: warning: could not copy $id.evidence" >&2
    }
  fi
}

wait_for_result() {
  local id="$1"
  local remote_result="$REMOTE_RESULTS/$id.json"
  local local_result="$LOCAL_RESULTS/$id.json"
  local deadline=$((SECONDS + WAIT_SECONDS))
  local answer

  mkdir -p "$LOCAL_RESULTS" || {
    die "cannot create $LOCAL_RESULTS"
    return
  }

  while (( SECONDS < deadline )); do
    answer="$(ps_remote "if (Test-Path -LiteralPath $(ps_quote "$remote_result")) { 'yes' } else { 'no' }" 2>/dev/null | tr -d '\r')"
    if [[ "$answer" == *yes* ]]; then
      if ! scp_from "$remote_result" "$local_result"; then
        die "cannot copy $remote_result"
        return 2
      fi
      pull_evidence "$id"

      echo "vm.sh: result   $local_result"
      if [[ -d "$LOCAL_RESULTS/$id.evidence" ]]; then
        echo "vm.sh: evidence $LOCAL_RESULTS/$id.evidence"
      fi

      if [[ "$(result_ok "$local_result")" == "true" ]]; then
        echo "vm.sh: PASS $id"
        return 0
      fi

      echo "vm.sh: FAIL $id"
      print_failed_checks "$local_result"
      return 1
    fi
    sleep "$POLL_SECONDS"
  done

  die "timed out after ${WAIT_SECONDS}s waiting for $remote_result (is Adrt.VmAgent running?)" 3
}

run_scenario() {
  local name="$1"
  local script id remote_job job tmp

  name="${name%.ps1}"
  script="$ROOT/tests/windows/$name.ps1"
  if [[ ! "$name" =~ ^[A-Za-z0-9._-]+$ ]]; then
    die "invalid scenario name '$name'" 2
    return
  fi
  if [[ ! -f "$script" ]]; then
    die "scenario not found: $script" 2
    return
  fi
  if ! remote_cli_present; then
    die "adrt-cli is not built on the VM; run 'vm.sh push' first" 2
    return
  fi

  id="$(make_job_id "$name")"
  remote_job="$REMOTE_JOBS/$id.json"

  job=$(cat <<EOF
{"id":"$id","kind":"scenario","scenario":"$name","path":"$REMOTE_REPO/tests/windows/$name.ps1","timeoutMs":$SCENARIO_TIMEOUT_MS,"env":{"ADRT_RESULTS_DIR":"$REMOTE_RESULTS","ADRT_CLI":"$REMOTE_BIN/cli/adrt-cli.exe"}}
EOF
)
  tmp="$(mktemp "${TMPDIR:-/tmp}/adrt-job.XXXXXX")" || {
    die "cannot create a temporary job file"
    return
  }
  printf '%s\n' "$job" >"$tmp"

  echo "vm.sh: job      $id ($name)"
  if ! scp_to "$tmp" "$remote_job"; then
    rm -f "$tmp"
    die "cannot upload the job to $remote_job"
    return
  fi
  rm -f "$tmp"

  wait_for_result "$id"
}

cmd_run() {
  if [[ $# -ne 1 ]]; then
    usage >&2
    die "run needs exactly one scenario name" 2
    return
  fi
  check_environment || return
  run_scenario "$1"
}

smoke_names() {
  local list="$ROOT/tests/windows/smoke.list"
  local line name
  if [[ ! -f "$list" ]]; then
    die "missing $list" 2
    return
  fi
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%%#*}"
    read -r name _ <<<"$line" || true
    [[ -z "${name:-}" ]] && continue
    printf '%s\n' "$name"
  done <"$list"
}

cmd_smoke() {
  check_environment || return

  local names=() name rc=0 failures=0 timeouts=0 passes=0
  if [[ $# -gt 0 ]]; then
    names=("$@")
  else
    while IFS= read -r name; do
      names+=("$name")
    done < <(smoke_names)
  fi

  if [[ ${#names[@]} -eq 0 ]]; then
    die "no scenarios (tests/windows/smoke.list is empty)" 2
    return
  fi

  for name in "${names[@]}"; do
    echo
    echo "=== $name ==="
    if run_scenario "$name"; then
      passes=$((passes + 1))
    else
      rc=$?
      if [[ "$rc" -eq 3 ]]; then
        timeouts=$((timeouts + 1))
      else
        failures=$((failures + 1))
      fi
    fi
  done

  echo
  echo "vm.sh: smoke summary: $passes passed, $failures failed, $timeouts timed out"
  if [[ "$failures" -gt 0 ]]; then
    return 1
  fi
  if [[ "$timeouts" -gt 0 ]]; then
    return 3
  fi
  return 0
}

cmd_unit() {
  check_environment || return
  if ! remote_repo_present; then
    die "source tree missing on the VM; run 'vm.sh push' first" 2
    return
  fi

  local script
  printf -v script '%s\n' \
    "Set-Location $(ps_quote "$REMOTE_REPO")" \
    "\$ErrorActionPreference = 'Stop'" \
    "& dotnet test 'windows/Adrt.slnx' -c Release --nologo" \
    "exit \$LASTEXITCODE"
  echo "vm.sh: dotnet test windows/Adrt.slnx (VM)"
  ps_remote "$script"
}

cmd_shot() {
  check_environment || return
  if ! remote_cli_present; then
    die "adrt-cli is not built on the VM; run 'vm.sh push' first" 2
    return
  fi

  local id remote_png remote_job job tmp rc local_png
  id="$(make_job_id shot)"
  remote_png="$REMOTE_RESULTS/$id.png"
  remote_job="$REMOTE_JOBS/$id.json"

  job=$(cat <<EOF
{"id":"$id","kind":"shot","path":"$remote_png","timeoutMs":30000}
EOF
)
  tmp="$(mktemp "${TMPDIR:-/tmp}/adrt-shot.XXXXXX")" || {
    die "cannot create a temporary job file"
    return
  }
  printf '%s\n' "$job" >"$tmp"

  echo "vm.sh: screenshot job $id"
  if ! scp_to "$tmp" "$remote_job"; then
    rm -f "$tmp"
    die "cannot upload the screenshot job"
    return
  fi
  rm -f "$tmp"

  wait_for_result "$id"
  rc=$?

  local_png="$LOCAL_RESULTS/$id.png"
  mkdir -p "$LOCAL_RESULTS"
  if scp_from "$remote_png" "$local_png"; then
    echo "vm.sh: shot     $local_png"
  else
    echo "vm.sh: warning: screenshot $remote_png was not produced" >&2
    if [[ "$rc" -eq 0 ]]; then
      rc=1
    fi
  fi

  return "$rc"
}

cmd_wait() {
  check_environment || return
  local id="${1:-${ADRT_JOB_ID:-}}"
  if [[ $# -gt 1 ]]; then
    usage >&2
    die "wait takes at most one job id" 2
    return
  fi

  if [[ -z "$id" ]]; then
    id="$(ps_remote "Get-ChildItem -LiteralPath $(ps_quote "$REMOTE_RESULTS") -Filter '*.json' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty BaseName" 2>/dev/null | tr -d '\r' | head -n 1)"
    if [[ -z "$id" ]]; then
      die "no result found in $REMOTE_RESULTS; pass a job id or run a scenario first" 3
      return
    fi
    echo "vm.sh: newest result is $id"
  fi

  wait_for_result "$id"
}

main() {
  local verb="${1:-}"
  if [[ -z "$verb" ]]; then
    usage
    return 2
  fi
  shift || true

  case "$verb" in
    --help|-h|help)
      usage
      return 0
      ;;
    push) cmd_push "$@" ;;
    run) cmd_run "$@" ;;
    smoke) cmd_smoke "$@" ;;
    unit) cmd_unit "$@" ;;
    shot) cmd_shot "$@" ;;
    wait) cmd_wait "$@" ;;
    *)
      usage >&2
      die "unknown verb '$verb'" 2
      ;;
  esac
}

main "$@"
exit $?
