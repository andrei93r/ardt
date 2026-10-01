#!/usr/bin/env python3
"""Refresh the counters in docs/V2_PLAN.md from its checkboxes.

* every `## Stage N — Title` heading gets `(done/total)`
* the tonight section heading gets `(done/total)`
* the Progress table (between the plan-status markers) gets each stage's done count and
  state: not started / in progress / done

Run it after ticking, adding or removing boxes:  python3 scripts/plan-status.py
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLAN = os.path.join(ROOT, "docs/V2_PLAN.md")
START = "<!-- plan-status -->"
END = "<!-- /plan-status -->"


def count(block):
    return sum(1 for l in block if re.match(r"\s*- \[ \]", l)), \
           sum(1 for l in block if re.match(r"\s*- \[[xX]\]", l))


def main():
    lines = open(PLAN, encoding="utf8").read().split("\n")
    # split into sections at "## " headings
    heads = [i for i, l in enumerate(lines) if l.startswith("## ")]
    sections = []
    for k, i in enumerate(heads):
        end = heads[k + 1] if k + 1 < len(heads) else len(lines)
        sections.append((i, end))
    counts = {}
    for i, end in sections:
        todo, done = count(lines[i:end])
        m = re.match(r"## Stage (\d+) — (.*?)(?: \(\d+/\d+\))?$", lines[i].replace(" \u2014 ", " \u2014 "))
        if m:
            lines[i] = f"## Stage {m.group(1)} \u2014 {m.group(2)} ({done}/{done + todo})"
            counts[int(m.group(1))] = (done, done + todo)
        elif lines[i].startswith("## Tonight"):
            base = re.sub(r" \(\d+/\d+\)$", "", lines[i])
            lines[i] = f"{base} ({done}/{done + todo})"
    # the progress table
    if START in lines and END in lines:
        a, b = lines.index(START), lines.index(END)
        for i in range(a, b):
            if not lines[i].startswith("| ") or lines[i].startswith("| ---") or "Stage" in lines[i]:
                continue
            cells = [c.strip() for c in lines[i].strip().strip("|").split("|")]
            m = re.match(r"(\d+) ", cells[0])
            if not m:
                continue
            n = int(m.group(1))
            done, total = counts.get(n, (0, 0))
            state = "not started" if done == 0 else ("done" if done == total else "in progress")
            cells[1], cells[2] = state, f"{done}/{total}"
            lines[i] = "| " + " | ".join(cells) + " |"
    open(PLAN, "w", encoding="utf8").write("\n".join(lines))
    for n in sorted(counts):
        print(f"stage {n}: {counts[n][0]}/{counts[n][1]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
