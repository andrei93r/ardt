#!/usr/bin/env python3
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
"""Normalize `gdbus call` output into plain JSON on stdout."""

import ast
import json
import re
import sys


def main() -> int:
    raw = sys.stdin.read().strip()
    if not raw:
        print("null")
        return 0
    # `gdbus call` prints GVariant text: lowercase true/false/null.
    normalized = re.sub(r"\btrue\b", "True", raw)
    normalized = re.sub(r"\bfalse\b", "False", normalized)
    normalized = re.sub(r"\bnull\b", "None", normalized)
    try:
        value = ast.literal_eval(normalized)
    except (ValueError, SyntaxError):
        print("null")
        return 1
    if isinstance(value, tuple):
        value = value[0] if value else None
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            pass
    print(json.dumps(value))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
