// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.
//
// The few Node APIs the core suite needs to drive the *tooling* (the
// core-purity gate is a shell script, so its behaviour is only observable by
// running it). `tsconfig.json` sets `"types": []`, so `@types/node` is not
// pulled in and the globals are not declared either; these are the exact
// shapes the tests use. The extension itself never imports them: `src/core`
// stays free of Node (and the purity gate enforces that).

declare module 'node:child_process' {
  export function execFileSync(
    file: string,
    args?: readonly string[],
    options?: { encoding?: string; cwd?: string; stdio?: string },
  ): string;
}

declare module 'node:fs' {
  /** One entry of a directory listing. */
  export interface Dirent {
    name: string;
    isDirectory(): boolean;
    isFile(): boolean;
  }
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function mkdtempSync(prefix: string): string;
  export function readFileSync(path: string, encoding: string): string;
  export function readdirSync(path: string, options?: { withFileTypes?: boolean }): (string | Dirent)[];
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
  export function writeFileSync(path: string, data: string): void;
  export function copyFileSync(source: string, destination: string): void;
}

declare module 'node:os' {
  export function tmpdir(): string;
}

declare module 'node:path' {
  export function join(...parts: string[]): string;
}
