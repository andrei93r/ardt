#!/usr/bin/env python3
"""Anti-drift test-coverage guard.

The requirement: every feature must have a full-suite scenario *and* a smoke
entry, and that must stay true as features are added. This script is the guard
that makes the second half real. It parses the scenario files, the four smoke
lists, tests/coverage.map and tests/full-only.list and fails when:

  1. a smoke-list entry names no scenario file (the runners already do this;
     the guard keeps it checkable without a nested Shell);
  2. a scenario file is in no smoke list and is not explicitly recorded as
     full-suite-only with a reason (tests/full-only.list, or a coverage.map row
     carrying `full-only: <reason>`);
  3. a tests/coverage.map feature row names a scenario that does not exist;
  4. a feature row has no smoke representation (none of its scenarios is in any
     smoke list) and does not carry a `full-only: <reason>`;
  5. a smoke-list entry is not named by any feature row (the smoke grew a
     scenario that maps to no feature).

Run: python3 scripts/check-test-coverage.py   (or scripts/check-test-coverage.sh)
"""
from __future__ import annotations

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AGENT_DIR = os.path.join(ROOT, "tests", "agent")
SESSION_DIR = os.path.join(ROOT, "tests", "session")

AGENT_FILE = re.compile(r"^A\d+-.*\.sh$")
SESSION_FILE = re.compile(r"^S\d+-.*\.sh$")

# (directory, smoke list file, whether it is the multi-screen list)
SMOKE_LISTS = [
    (AGENT_DIR, "smoke.list", False),
    (AGENT_DIR, "smoke-multi.list", True),
    (SESSION_DIR, "smoke.list", False),
    (SESSION_DIR, "smoke-multi.list", True),
]

errors: list[str] = []
warnings: list[str] = []


def fail(message: str) -> None:
    errors.append(message)


def scenario_files(directory: str, pattern: re.Pattern[str]) -> dict[str, str]:
    """id -> path for every scenario file in `directory`."""
    found: dict[str, str] = {}
    for name in os.listdir(directory):
        if pattern.match(name):
            found[name[: -len(".sh")]] = os.path.join(directory, name)
    return found


def parse_smoke(path: str) -> list[str]:
    """The scenario ids a smoke list names, in order. `#` starts a comment."""
    ids: list[str] = []
    if not os.path.isfile(path):
        return ids
    with open(path, encoding="utf8") as handle:
        for line in handle:
            line = line.split("#", 1)[0].strip()
            if not line:
                continue
            token = line.split()[0]
            if token.endswith(".sh"):
                token = token[: -len(".sh")]
            ids.append(token)
    return ids


def parse_full_only(path: str) -> dict[str, str]:
    """id -> reason, from a `# reason:` grouped allow-list."""
    entries: dict[str, str] = {}
    reason = ""
    if not os.path.isfile(path):
        return entries
    with open(path, encoding="utf8") as handle:
        for raw in handle:
            line = raw.rstrip("\n")
            stripped = line.strip()
            if not stripped:
                continue
            if stripped.startswith("#"):
                match = re.match(r"#\s*reason:\s*(.*)", stripped)
                if match:
                    reason = match.group(1).strip()
                elif line.lstrip().startswith("#") and line.lstrip("#").strip():
                    # A wrapped continuation of the previous reason line.
                    continuation = line.lstrip("#").strip()
                    if reason and continuation and not continuation.startswith("#"):
                        reason = f"{reason} {continuation}".strip()
                continue
            token = stripped.split()[0]
            if token.endswith(".sh"):
                token = token[: -len(".sh")]
            entries[token] = reason
    return entries


def parse_coverage(path: str) -> list[dict[str, object]]:
    """Feature rows: {feature, ids, full_only, line}."""
    rows: list[dict[str, object]] = []
    if not os.path.isfile(path):
        return rows
    with open(path, encoding="utf8") as handle:
        for lineno, raw in enumerate(handle, 1):
            line = raw.split("#", 1)[0].strip()
            if not line or "|" not in line:
                continue
            parts = [part.strip() for part in line.split("|")]
            feature = parts[0]
            ids: list[str] = []
            if len(parts) >= 2:
                for token in parts[1].split():
                    if token.endswith(".sh"):
                        token = token[: -len(".sh")]
                    ids.append(token)
            note = " | ".join(parts[2:]) if len(parts) > 2 else ""
            full_only = note.startswith("full-only:")
            rows.append(
                {
                    "feature": feature,
                    "ids": ids,
                    "full_only": full_only,
                    "note": note,
                    "line": lineno,
                }
            )
    return rows


def main() -> int:
    agent = scenario_files(AGENT_DIR, AGENT_FILE)
    session = scenario_files(SESSION_DIR, SESSION_FILE)
    files = {**agent, **session}

    smoke_ids: dict[str, list[str]] = {}
    for directory, list_name, _multi in SMOKE_LISTS:
        path = os.path.join(directory, list_name)
        if not os.path.isfile(path):
            fail(f"smoke list is missing: {os.path.relpath(path, ROOT)}")
            continue
        for sid in parse_smoke(path):
            # Rule 1: every smoke entry names a scenario file in its own dir.
            expected = os.path.join(directory, f"{sid}.sh")
            if not os.path.isfile(expected):
                fail(
                    f"smoke entry '{sid}' in {list_name} has no "
                    f"{os.path.relpath(expected, ROOT)}"
                )
            smoke_ids.setdefault(sid, []).append(list_name)

    full_only = parse_full_only(os.path.join(ROOT, "tests", "full-only.list"))

    # A full-only entry must exist and must not also be smoke-covered.
    for sid, reason in full_only.items():
        if sid not in files:
            fail(f"full-only.list names '{sid}' but no scenario file exists")
        if sid in smoke_ids:
            fail(f"full-only.list names '{sid}' but it is already in the smoke ({', '.join(smoke_ids[sid])})")
        if not reason:
            fail(f"full-only.list entry '{sid}' has no `# reason:` above it")

    rows = parse_coverage(os.path.join(ROOT, "tests", "coverage.map"))
    referenced: set[str] = set()

    # A scenario listed by two smoke lists is run twice by the runner: surface it.
    for sid, lists in sorted(smoke_ids.items()):
        if len(lists) > 1:
            warnings.append(f"smoke entry '{sid}' appears in {' and '.join(lists)}; it will run twice")

    # Rule 3 + 4: rows point at real scenarios and each feature is covered.
    for row in rows:
        feature = str(row["feature"])
        ids = list(row["ids"])  # type: ignore[arg-type]
        if not ids:
            fail(f"coverage.map:{row['line']} feature '{feature}' names no scenario")
            continue
        for sid in ids:
            referenced.add(sid)
            if sid not in files:
                fail(f"coverage.map:{row['line']} feature '{feature}' names '{sid}' but no scenario file exists")
        smoke_repr = [sid for sid in ids if sid in smoke_ids]
        if row["full_only"]:
            note = str(row["note"])
            reason = note[len("full-only:") :].strip()
            if not reason:
                fail(f"coverage.map:{row['line']} feature '{feature}' has `full-only:` with no reason")
        elif not smoke_repr:
            fail(
                f"coverage.map:{row['line']} feature '{feature}' has no smoke entry "
                f"(none of its scenarios is in a smoke list); add one or mark the row `full-only: <reason>`"
            )

    # Rule 5: every smoke entry is feature-mapped.
    for sid in smoke_ids:
        if sid not in referenced:
            fail(f"smoke entry '{sid}' is not named by any coverage.map feature row")

    # Rule 2: every scenario is accounted for.
    full_only_ids = set(full_only)
    for sid in sorted(files):
        if sid in smoke_ids or sid in full_only_ids:
            continue
        if any(row["full_only"] and sid in row["ids"] for row in rows):
            continue
        fail(
            f"'{sid}' is in no smoke list and is not full-suite-only: add it to a smoke list "
            f"or to tests/full-only.list with a `# reason:`"
        )

    total_smoke = len(smoke_ids)
    print(
        f"coverage guard: {len(agent)} agent + {len(session)} session scenarios, "
        f"{total_smoke} smoke entries, {len(rows)} features, {len(full_only)} full-only"
    )
    for warning in warnings:
        print(f"WARN  {warning}")
    if errors:
        print()
        for message in errors:
            print(f"FAIL  {message}")
        print(f"\ncoverage guard: {len(errors)} problem(s)")
        return 1
    print("PASS  every feature has a full-suite scenario and a smoke entry (or a recorded reason)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
