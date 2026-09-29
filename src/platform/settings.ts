// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

export type SettingValue = number | boolean | string | string[];

export interface SettingsStore {
  keys(): string[];
  read(key: string): SettingValue | undefined;
  write(key: string, value: unknown): boolean;
  onChanged(key: string, cb: (value: SettingValue) => void): () => void;
}
