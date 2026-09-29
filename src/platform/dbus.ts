// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/** Method surface exposed on `org.adrt.Adrt` (§22). JSON payloads are strings. */
export interface DbusHandlers {
  DumpState(): string;
  LookupWindow(id: number): string;
  ListWindows(): string;
  ListMonitors(): string;
  GetSplitRatio(workspace: number, monitor: string, axis: string): number;
  SetSplitRatio(workspace: number, monitor: string, axis: string, ratio: number): boolean;
  Undo(): boolean;
  NudgeSplit(direction: string, step: number): boolean;
  ReloadRules(): boolean;
  ResetPerApp(appId: string): boolean;
  GetAdaptations(): string;
  ForgetAdaptation(appId: string): boolean;
  GetFloats(): string;
  ForgetFloat(appId: string): boolean;
  ExportConfig(): string;
  ImportConfig(json: string, merge: boolean): string;
  ListHistoryDays(): string;
  SimulateGesture(kind: string, deltaX: number, deltaY: number, touchPoints: number): boolean;
  InjectSignal(type: string, payload: string): boolean;
  SimulateSessionMode(mode: string): boolean;
}

export interface DbusBackend {
  expose(handlers: DbusHandlers): void;
  unexpose(): void;
}
