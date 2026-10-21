// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The core determinism gate is a shell script, so its behaviour is only
 * observable by running it. This runs the real script against a throwaway
 * `src/core` tree — the script resolves its own root from its own path
 * (`cd "$(dirname "$0")/.."`), so copying it into a temporary tree is enough to
 * point it at that tree.
 *
 * The regression this guards: the gate used to flag *every* `new Date(...)` in
 * `src/core`, including the parameter-default injection seam
 * (`now: Date = new Date()`) that its own `Date.now` rule allows, and a date
 * built from explicit components (`new Date(year, month, …)`), which reads no
 * clock at all. The real tree was full of both, so `npm run check:core` — a
 * step of the CI *Core* job — failed on a clean checkout.
 */

const GATE = 'scripts/check-core-purity.sh';

interface GateResult {
  status: number;
  output: string;
}

/** Run the purity gate against a `src/core` holding exactly `source`. */
function runGate(source: string): GateResult {
  const root = mkdtempSync(join(tmpdir(), 'adrt-purity-'));
  try {
    mkdirSync(join(root, 'scripts'), { recursive: true });
    mkdirSync(join(root, 'src', 'core'), { recursive: true });
    // The gate greps `src/platform` as well; an empty directory keeps its
    // output free of "No such file or directory" noise.
    mkdirSync(join(root, 'src', 'platform'), { recursive: true });
    copyFileSync(GATE, join(root, 'scripts', 'check-core-purity.sh'));
    writeFileSync(join(root, 'src', 'core', 'probe.ts'), source);
    try {
      const output = execFileSync('bash', [join(root, 'scripts', 'check-core-purity.sh')], {
        encoding: 'utf8',
        stdio: 'pipe',
      });
      return { status: 0, output };
    } catch (error) {
      const failure = error as { status?: number; stdout?: string; stderr?: string };
      return { status: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const CLEAN = 'export const answer = 42;\n';

describe('the core purity gate', () => {
  it('passes a core that reads nothing from the outside world', () => {
    const result = runGate(CLEAN);
    expect(result.output).toContain('check-core-purity: OK');
    expect(result.status).toBe(0);
  });

  it('accepts the clock injection seam', () => {
    // The same seam the `Date.now` rule allows: the caller injects the clock,
    // and the default is only used when it does not.
    const source = [
      'export function cutoff(now: Date = new Date()): number {',
      '  return now.getTime();',
      '}',
      '',
    ].join('\n');
    const result = runGate(source);
    expect(result.output).toContain('check-core-purity: OK');
    expect(result.status).toBe(0);
  });

  it('accepts a seam that continues a signature on the next line', () => {
    const source = [
      'export function cutoff(',
      '  now: Date = new Date(),',
      '  days: number = 31,',
      '): number {',
      '  return now.getTime() - days;',
      '}',
      '',
    ].join('\n');
    const result = runGate(source);
    expect(result.output).toContain('check-core-purity: OK');
    expect(result.status).toBe(0);
  });

  it('accepts a date built from explicit components', () => {
    // `new Date(year, month, day, …)` reads no clock: it is a pure function of
    // its arguments, so it is deterministic and belongs in the core.
    const source = [
      'export function at(year: number, month: number, day: number): Date {',
      '  return new Date(year, month - 1, day);',
      '}',
      '',
    ].join('\n');
    const result = runGate(source);
    expect(result.output).toContain('check-core-purity: OK');
    expect(result.status).toBe(0);
  });

  it('accepts a comment that merely names the API', () => {
    const source = ['// Pass new Date() to read the wall clock.', 'export const answer = 42;', ''].join('\n');
    const result = runGate(source);
    expect(result.output).toContain('check-core-purity: OK');
    expect(result.status).toBe(0);
  });

  it('still rejects a wall-clock read outside a seam', () => {
    const source = ['export function now(): Date {', '  return new Date();', '}', ''].join('\n');
    const result = runGate(source);
    expect(result.status).toBe(1);
    expect(result.output).toContain('new Date() clock read found in core');
  });

  it('still rejects Date.now, Math.random and IO outside a seam', () => {
    const clock = runGate('export function now(): number {\n  return Date.now();\n}\n');
    expect(clock.status).toBe(1);
    expect(clock.output).toContain('Date.now() clock read found in core');

    const random = runGate('export function roll(): number {\n  return Math.random();\n}\n');
    expect(random.status).toBe(1);
    expect(random.output).toContain('Math.random found in core');

    const io = runGate('export async function read(): Promise<string> {\n  return fetch("x");\n}\n');
    expect(io.status).toBe(1);
    expect(io.output).toContain('IO call found in core');
  });
});
