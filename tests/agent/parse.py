#!/usr/bin/env python3
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
"""Normalize `gdbus call` output into plain JSON on stdout.

`gdbus call` prints GVariant text. JSON payloads arrive as a string element of
a one-tuple; boolean/None returns use GVariant's lowercase `true`/`false`.
The string form is parsed first so JSON bodies are never rewritten.
"""

import ast
import json
import re
import sys


def parse(raw: str):
    try:
        return ast.literal_eval(raw)
    except (ValueError, SyntaxError):
        normalized = re.sub(r"\btrue\b", "True", raw)
        normalized = re.sub(r"\bfalse\b", "False", normalized)
        normalized = re.sub(r"\bnull\b", "None", normalized)
        try:
            return ast.literal_eval(normalized)
        except (ValueError, SyntaxError):
            return None


def main() -> int:
    raw = sys.stdin.read().strip()
    if not raw:
        print("null")
        return 0
    value = parse(raw)
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
