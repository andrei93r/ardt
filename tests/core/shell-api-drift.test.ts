// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';

/**
 * The adapters talk to the Shell through GJS, and the Shell's API moves under
 * them: a property that existed in GNOME 47 is gone in 48, and the code that
 * used it throws at *runtime*, on the user's screen, with nothing in the core
 * suite to catch it.
 *
 * The observation prompt was the proof: `St.BoxLayout({ vertical: true })`
 * worked for years and then stopped — GNOME 48 removed the property, so every
 * attempt to open the prompt threw "No property vertical on StBoxLayout" and
 * the "Record a bug" shortcut silently stopped asking for the description of
 * the bug. This test pins the API facts that broke it, so the next removal is
 * a failing test instead of a broken shortcut.
 *
 * The rules below are shell facts, not style: each one says what the running
 * Shell does, and the source must match it.
 */

/** Every `.ts` file under the GNOME adapter directory. */
function adapterSources(dir: string): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }) as Dirent[]) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...adapterSources(path));
      continue;
    }
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.d.ts')) continue;
    out.push({ file: path, text: readFileSync(path, 'utf8') });
  }
  return out;
}

const ADAPTERS = 'src/adapters/gnome';
const sources = adapterSources(ADAPTERS);

describe('the shell API the adapters use', () => {
  it('finds the adapter sources', () => {
    // A silent scan over zero files would make every rule below vacuous.
    expect(sources.length).toBeGreaterThan(10);
  });

  it('never builds an St.BoxLayout with the removed `vertical` property', () => {
    // GNOME 48 removed `St.BoxLayout`'s `vertical`; the direction is the
    // layout's `orientation` now (`Clutter.Orientation.VERTICAL`). Passing
    // `vertical` throws "No property vertical on StBoxLayout" and the widget
    // is never built.
    const offenders = sources.filter((source) => /new St\.BoxLayout\(\{[^}]*\bvertical\s*:/.test(source.text));
    expect(offenders.map((source) => source.file)).toEqual([]);
  });

  it('builds a vertical box with the orientation the Shell understands', () => {
    const prompt = sources.find((source) => source.file.endsWith('recording-prompt.ts'));
    expect(prompt).toBeDefined();
    expect(prompt?.text).toMatch(/orientation:\s*Clutter\.Orientation\.VERTICAL/);
  });

  it('keeps the grab handle that Main.pushModal returns', () => {
    // GNOME 42+: `Main.pushModal` returns a `Clutter.Grab` and `Main.popModal`
    // takes *that handle*. Releasing the grab with the actor instead makes the
    // Shell throw `incorrect pop`, drop the stage's key focus and keep the
    // grab — and a kept grab leaves the Shell in `ActionMode.NONE`, which
    // filters out every keybinding, the recording shortcut included.
    const offenders = sources.filter((source) => /popModal\(\s*(overlay|actor|built)\s*\)/.test(source.text));
    expect(offenders.map((source) => source.file)).toEqual([]);
    const prompt = sources.find((source) => source.file.endsWith('recording-prompt.ts'));
    expect(prompt?.text).toMatch(/=\s*pushModal\(/);
  });

  it('passes an action mode to every Main.pushModal call', () => {
    // `Main.pushModal`'s default action mode is `Shell.ActionMode.NONE`, and
    // GNOME documents that mode as "will filter out all keybindings". A modal
    // that leaves the Shell in NONE kills every shortcut for as long as it is
    // open, so the mode is always stated.
    for (const source of sources) {
      const calls = source.text.match(/pushModal\([^;]*?\)/g) ?? [];
      for (const call of calls) {
        expect(`${source.file}: ${call}`).toContain('actionMode');
      }
    }
  });
});
