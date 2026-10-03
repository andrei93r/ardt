#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
#
# Approximate Adrt's runtime cost from its own instrumentation, plus the
# compositor's CPU time. This is an APPROXIMATION, not a profiler: it samples
# `DumpState` counters over time and converts rates into "ms of Adrt work per
# second" — the number that decides whether the extension can be felt at all.
#
# Usage:
#   scripts/measure-adrt-cost.sh [SECONDS] [INTERVAL] [--churn] [--json]
#
#   SECONDS   sampling window (default 20)
#   INTERVAL  sample period in seconds (default 1)
#   --churn   drive a window loop over D-Bus (CREATES WINDOWS on the live
#             session; default off)
#   --json    machine-readable aggregate only
#
# Read-only sampling; the optional workload only touches the windows it spawns.
set -u

SECONDS_ARG=${1:-20}
INTERVAL=${2:-1}
CHURN=0
JSON=0
for a in "$@"; do
  case "$a" in
    --churn) CHURN=1;;
    --json)  JSON=1;;
  esac
done
case "$SECONDS_ARG" in ''|*[!0-9]*) SECONDS_ARG=20;; esac
case "$INTERVAL"    in ''|*[!0-9.]*) INTERVAL=1;; esac

DEST=org.adrt.Adrt
OBJPATH=/org/adrt/Adrt
HERE="$(cd "$(dirname "$0")" && pwd)"
HZ=$(getconf CLK_TCK 2>/dev/null || echo 100)

dump() {
  timeout 10 gdbus call --session --dest "$DEST" --object-path "$OBJPATH" \
    --method "$DEST.DumpState" 2>/dev/null \
    | python3 "$HERE/../tests/agent/parse.py" 2>/dev/null
}

# The live Shell: the user session, not a nested test Shell.
shell_pid() {
  ps -C gnome-shell -o pid=,args= 2>/dev/null \
    | grep -v -- '--devkit' | grep -v -- '--headless' \
    | grep -E -- '--mode=' | awk '{print $1}' | head -1
}
cpu_ticks() { awk '{print $14+$15}' "/proc/$1/stat" 2>/dev/null || echo 0; }

snap() {
  dump | python3 -c '
import json,sys
c=(json.load(sys.stdin).get("counters") or {})
ks=("sweeps","drains","classifyCalls","plansComputed","plansApplied","clampsApplied",
    "configBuilds","rulesParses","logEvents","drainMsP50","drainMsP95","drainMsMax",
    "sweepMsAvg","sweepMsMax","hostLookups")
print(*[c.get(k,0) for k in ks])
' 2>/dev/null
}

workload() {
  gdbus call --session --dest "$DEST" --object-path "$OBJPATH" \
    --method "$DEST.SpawnWindow" "gnome-text-editor --new-window" >/dev/null 2>&1
  sleep 0.3
  gdbus call --session --dest "$DEST" --object-path "$OBJPATH" \
    --method "$DEST.SpawnWindow" "gnome-calculator" >/dev/null 2>&1
  sleep 0.3
  ids=$(gdbus call --session --dest "$DEST" --object-path "$OBJPATH" \
    --method "$DEST.ListWindows" 2>/dev/null | grep -oE '[0-9]{6,}' | head -2)
  for id in $ids; do
    gdbus call --session --dest "$DEST" --object-path "$OBJPATH" \
      --method "$DEST.CloseWindow" "$id" >/dev/null 2>&1 || true
  done
}

PID=$(shell_pid)
[ -n "$PID" ] || { echo "measure-adrt-cost: no live gnome-shell found" >&2; exit 1; }

ROWS=$(mktemp)
prev=$(snap); prev_ticks=$(cpu_ticks "$PID"); prev_t=$(date +%s.%N)
[ -n "$prev" ] || { echo "measure-adrt-cost: DumpState unavailable (is adrt@adrt.dev enabled?)" >&2; exit 1; }

end=$(( $(date +%s) + SECONDS_ARG ))
while [ "$(date +%s)" -lt "$end" ]; do
  [ "$CHURN" = 1 ] && workload
  sleep "$INTERVAL"
  cur=$(snap); ticks=$(cpu_ticks "$PID"); now=$(date +%s.%N)
  printf '%s|%s|%s|%s|%s\n' "$prev" "$cur" "$prev_ticks" "$ticks" "$(awk -v a="$prev_t" -v b="$now" 'BEGIN{print b-a}')" >>"$ROWS"
  prev=$cur; prev_ticks=$ticks; prev_t=$now
done

python3 - "$ROWS" "$HZ" "$JSON" "$SECONDS_ARG" "$INTERVAL" "$PID" "$CHURN" <<'PY'
import sys, json
rows_path, hz, json_mode, secs, interval, pid, churn = sys.argv[1:8]
KEYS = ["sweeps","drains","classifyCalls","plansComputed","plansApplied","clampsApplied",
        "configBuilds","rulesParses","logEvents"]
total = {k: 0.0 for k in KEYS}
span = 0.0
cpu_s = 0.0
last = None
for line in open(rows_path):
    line = line.strip()
    if not line:
        continue
    a, b, tk0, tk1, dt = line.split("|")
    A = [float(x) for x in a.split()]
    B = [float(x) for x in b.split()]
    dt = float(dt)
    if dt <= 0:
        continue
    span += dt
    cpu_s += (float(tk1) - float(tk0)) / float(hz)
    last = B
    for i, k in enumerate(KEYS):
        total[k] = total.get(k, 0.0) + (B[i] - A[i])

if last is None or span <= 0:
    print("measure-adrt-cost: no samples collected")
    raise SystemExit(0)

sweep_avg, sweep_max = last[12], last[13]
drain_p50, drain_p95, drain_max = last[9], last[10], last[11]
rate = {k: total[k] / span for k in KEYS}

sweep_ms_s = rate["sweeps"] * sweep_avg
drain_ms_s = rate["drains"] * drain_p50
drain_ms_s_p95 = rate["drains"] * drain_p95
adrt_ms_s = sweep_ms_s + drain_ms_s

if json_mode == "1":
    print(json.dumps({
        "seconds": span,
        "rates_per_s": {k: round(v, 3) for k, v in rate.items()},
        "counts": {k: int(total[k]) for k in KEYS},
        "sweep_avg_ms": sweep_avg, "sweep_max_ms": sweep_max,
        "drain_p50_ms": drain_p50, "drain_p95_ms": drain_p95, "drain_max_ms": drain_max,
        "adrt_work_ms_per_s": round(adrt_ms_s, 3),
        "adrt_work_ms_per_s_p95": round(sweep_ms_s + drain_ms_s_p95, 3),
        "frame_budget_share_pct": round(100.0 * adrt_ms_s / 1000.0, 3),
        "shell_cpu_pct_of_one_core": round(100.0 * cpu_s / span, 2),
        "shell_pid": int(pid), "churn": churn == "1",
    }))
    raise SystemExit(0)

print("== Adrt cost approximation ==")
print(f"window {float(secs):.0f}s  interval {interval}s  live gnome-shell pid {pid}  churn {'on' if churn=='1' else 'off'}")
print()
print(f"{'activity':>14} {'per s':>9} {'count':>8}")
for k in KEYS:
    print(f"{k:>14} {rate[k]:9.2f} {int(total[k]):8d}")
print()
print("Adrt work per second (its own timers x observed rates):")
print(f"  sweeps : {rate['sweeps']:8.2f}/s x avg {sweep_avg:.3f} ms = {sweep_ms_s:8.3f} ms/s")
print(f"  drains : {rate['drains']:8.2f}/s x p50 {drain_p50:.3f} ms = {drain_ms_s:8.3f} ms/s")
print(f"           worst case (p95 {drain_p95:.3f} ms)          = {drain_ms_s_p95:8.3f} ms/s")
print(f"           single worst drain observed               = {drain_max:.3f} ms"
      f"  ({100.0*drain_max/16.7:.0f}% of a 60 Hz frame)")
print()
print(f"  => Adrt work ≈ {adrt_ms_s:.3f} ms/s of compositor time")
print(f"     = {100.0*adrt_ms_s/1000.0:.2f}% of the 60 Hz frame budget (1000 ms/s of frames)")
print()
print(f"gnome-shell CPU during the window: {cpu_s:.2f} s / {span:.1f} s"
      f" = {100.0*cpu_s/span:.1f}% of one core")
print()
print("Interpretation: the ms/s figure is the ceiling on any optimisation gain.")
print("If it is well under ~1% of the frame budget, allocation work cannot be felt.")
PY
rm -f "$ROWS"
