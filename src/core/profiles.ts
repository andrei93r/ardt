// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Hardcoded app families (§10). Shared by every adapter; pure data + lookup.
 */

export interface Profile {
  readonly name: string;
  readonly unmaximizeDelayMs: number;
  readonly retriesMs: readonly number[];
  readonly animate: boolean;
}

const CHROME_FAMILY: readonly string[] = [
  'google-chrome',
  'chrome',
  'chromium',
  'chromium-browser',
  'brave-browser',
  'brave',
  'vivaldi-stable',
  'vivaldi',
  'microsoft-edge',
  'edge',
  'opera',
];

const ELECTRON: readonly string[] = [
  'code',
  'code-insiders',
  'vscode',
  'slack',
  'discord',
  'signal',
  'element',
  'obsidian',
  'notion',
  'figma',
  'postman',
  'insomnia',
  'spotify',
  '1password',
  'bitwarden',
  'joplin',
  'logseq',
  'todoist',
  'zulip',
  'mattermost',
  'teams',
  'whatsapp',
  'standard-notes',
  'thunderbird-beta',
];

const GTK_TERMINAL: readonly string[] = [
  'org.gnome.terminal',
  'gnome-terminal',
  'kgx',
  'kitty',
  'alacritty',
  'foot',
  'footclient',
  'wezterm',
  'konsole',
];

const JAVA_SWING: readonly string[] = [
  'jetbrains-idea',
  'jetbrains-idea-ce',
  'jetbrains-pycharm',
  'jetbrains-pycharm-ce',
  'jetbrains-webstorm',
  'jetbrains-goland',
  'jetbrains-clion',
  'jetbrains-rider',
  'jetbrains-datagrip',
  'idea',
];

export const PROFILES: Record<string, Profile> = {
  'chrome-family': { name: 'chrome-family', unmaximizeDelayMs: 48, retriesMs: [80, 200, 500], animate: true },
  electron: { name: 'electron', unmaximizeDelayMs: 48, retriesMs: [80, 200, 500], animate: true },
  'gtk-terminal': { name: 'gtk-terminal', unmaximizeDelayMs: 0, retriesMs: [50], animate: true },
  'java-swing': { name: 'java-swing', unmaximizeDelayMs: 48, retriesMs: [80, 200, 500], animate: false },
  default: { name: 'default', unmaximizeDelayMs: 16, retriesMs: [50, 150], animate: true },
};

function normalize(appId: string): string {
  return appId.toLowerCase().replace(/\s+/g, '');
}

function belongs(appId: string, family: readonly string[]): boolean {
  const id = normalize(appId);
  for (const entry of family) {
    const candidate = normalize(entry);
    if (id === candidate) return true;
    if (id.endsWith(`.${candidate}`)) return true;
  }
  return false;
}

/** Resolve the profile for an app class. Unknown apps get `default`. */
export function profileFor(appId: string): Profile {
  if (belongs(appId, CHROME_FAMILY)) return PROFILES['chrome-family'];
  if (belongs(appId, ELECTRON)) return PROFILES.electron;
  if (belongs(appId, GTK_TERMINAL)) return PROFILES['gtk-terminal'];
  if (belongs(appId, JAVA_SWING)) return PROFILES['java-swing'];
  return PROFILES.default;
}
