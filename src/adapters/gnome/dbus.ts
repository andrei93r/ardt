// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * D-Bus exposure on `org.adrt.Adrt` / `/org/adrt/Adrt` (§22). The handler
 * object is implemented by `extension.ts`; this file only exports it.
 */

import Gio from 'gi://Gio';

import type { DbusBackend, DbusHandlers } from '../../platform/dbus.js';

export const DBUS_NAME = 'org.adrt.Adrt';
export const DBUS_PATH = '/org/adrt/Adrt';

const INTERFACE_XML = `
<node>
  <interface name="org.adrt.Adrt">
    <method name="DumpState"><arg type="s" direction="out"/></method>
    <method name="LookupWindow"><arg type="u" direction="in"/><arg type="s" direction="out"/></method>
    <method name="ListWindows"><arg type="s" direction="out"/></method>
    <method name="ListMonitors"><arg type="s" direction="out"/></method>
    <method name="GetSplitRatio">
      <arg type="i" direction="in"/><arg type="s" direction="in"/><arg type="s" direction="in"/>
      <arg type="d" direction="out"/>
    </method>
    <method name="SetSplitRatio">
      <arg type="i" direction="in"/><arg type="s" direction="in"/><arg type="s" direction="in"/>
      <arg type="d" direction="in"/><arg type="b" direction="out"/>
    </method>
    <method name="Undo"><arg type="b" direction="out"/></method>
    <method name="NudgeSplit"><arg type="s" direction="in"/><arg type="d" direction="in"/><arg type="b" direction="out"/></method>
    <method name="MoveFocusedToWorkspace"><arg type="i" direction="in"/><arg type="b" direction="out"/></method>
    <method name="ReloadRules"><arg type="b" direction="out"/></method>
    <method name="ResetPerApp"><arg type="s" direction="in"/><arg type="b" direction="out"/></method>
    <method name="GetAdaptations"><arg type="s" direction="out"/></method>
    <method name="ForgetAdaptation"><arg type="s" direction="in"/><arg type="b" direction="out"/></method>
    <method name="GetFloats"><arg type="s" direction="out"/></method>
    <method name="ForgetFloat"><arg type="s" direction="in"/><arg type="b" direction="out"/></method>
    <method name="ExportConfig"><arg type="s" direction="out"/></method>
    <method name="ImportConfig"><arg type="s" direction="in"/><arg type="b" direction="in"/><arg type="s" direction="out"/></method>
    <method name="ListHistoryDays"><arg type="s" direction="out"/></method>
    <method name="SimulateGesture">
      <arg type="s" direction="in"/><arg type="d" direction="in"/><arg type="d" direction="in"/>
      <arg type="i" direction="in"/><arg type="b" direction="out"/>
    </method>
    <method name="InjectSignal"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="b" direction="out"/></method>
    <method name="SimulateSessionMode"><arg type="s" direction="in"/><arg type="b" direction="out"/></method>
    <method name="SimulateOverview"><arg type="b" direction="in"/><arg type="b" direction="out"/></method>
    <!-- argv + env are JSON; argv may be a legacy space-separated command string. -->
    <method name="SpawnWindow"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="i" direction="out"/></method>
    <method name="CloseWindow"><arg type="u" direction="in"/><arg type="b" direction="out"/></method>
    <method name="BeginDrag"><arg type="u" direction="in"/><arg type="b" direction="out"/></method>
    <method name="EndDrag"><arg type="u" direction="in"/><arg type="b" direction="out"/></method>
    <method name="MoveWindow">
      <arg type="u" direction="in"/><arg type="i" direction="in"/><arg type="i" direction="in"/>
      <arg type="i" direction="in"/><arg type="i" direction="in"/><arg type="b" direction="out"/>
    </method>
    <method name="MinimizeWindow"><arg type="u" direction="in"/><arg type="b" direction="out"/></method>

    <!-- Test triggers used by the autonomous agent harness (§40.4). -->
    <method name="ActivateWindow"><arg type="u" direction="in"/><arg type="b" direction="out"/></method>
    <method name="ActivateWorkspace"><arg type="i" direction="in"/><arg type="b" direction="out"/></method>
    <method name="ToggleFloat"><arg type="u" direction="in"/><arg type="b" direction="out"/></method>
    <method name="SimulateResize">
      <arg type="u" direction="in"/><arg type="u" direction="in"/><arg type="d" direction="in"/>
      <arg type="b" direction="out"/>
    </method>
    <method name="SwapPair"><arg type="u" direction="in"/><arg type="u" direction="in"/><arg type="b" direction="out"/></method>
    <method name="InjectVerifyFailure"><arg type="u" direction="in"/><arg type="i" direction="in"/><arg type="b" direction="out"/></method>
    <method name="FocusDirection"><arg type="s" direction="in"/><arg type="b" direction="out"/></method>
    <method name="FocusCycle"><arg type="b" direction="out"/></method>
    <method name="MoveToward"><arg type="s" direction="in"/><arg type="b" direction="out"/></method>
    <method name="MaximizeWindow"><arg type="u" direction="in"/><arg type="b" direction="out"/></method>
    <method name="UnmaximizeWindow"><arg type="u" direction="in"/><arg type="b" direction="out"/></method>
    <method name="ResetLayoutState"><arg type="b" direction="out"/></method>
    <method name="SimulateWorkspaceSwitch"><arg type="i" direction="in"/><arg type="b" direction="out"/></method>
    <method name="MoveToWorkspace"><arg type="u" direction="in"/><arg type="i" direction="in"/><arg type="b" direction="out"/></method>
    <method name="MarkWorkspaceCached"><arg type="u" direction="in"/><arg type="i" direction="in"/><arg type="b" direction="out"/></method>
    <method name="MoveDirection"><arg type="s" direction="in"/><arg type="b" direction="out"/></method>
    <method name="ToggleFullscreen"><arg type="u" direction="in"/><arg type="b" direction="out"/></method>
    <method name="QuitFocused"><arg type="b" direction="out"/></method>
    <method name="SimulateAbove"><arg type="u" direction="in"/><arg type="b" direction="out"/></method>
    <method name="SimulateSticky"><arg type="u" direction="in"/><arg type="b" direction="in"/><arg type="b" direction="out"/></method>
    <method name="SimulateWorkspaceReorder"><arg type="u" direction="in"/><arg type="u" direction="in"/><arg type="b" direction="out"/></method>
    <method name="SimulateWorkspaceOrientation"><arg type="b" direction="in"/><arg type="b" direction="out"/></method>
    <method name="CursorToCentre"><arg type="b" direction="out"/></method>
    <method name="ActivatePanelItem"><arg type="s" direction="in"/><arg type="b" direction="out"/></method>
    <method name="InjectFault"><arg type="s" direction="in"/><arg type="b" direction="out"/></method>
    <!-- §Shell stability: destroy adrt's chrome actors the way a Shell session
         end does, so a scenario can disable() against already-destroyed chrome. -->
    <method name="SimulateChromeTeardown"><arg type="b" direction="out"/></method>
    <!-- Bounded animation-frame sampler (DumpState.animRecords); never on by default. -->
    <method name="StartFrameRecording"><arg type="b" direction="out"/></method>
    <method name="StopFrameRecording"><arg type="b" direction="out"/></method>

    <!-- §22 extension: the start/stop bug recorder. maxSeconds 0 means the default. -->
    <method name="StartRecording"><arg type="i" direction="in"/><arg type="s" direction="out"/></method>
    <method name="StopRecording"><arg type="s" direction="out"/></method>
    <method name="RecordingStatus"><arg type="s" direction="out"/></method>
    <method name="ToggleRecording"><arg type="s" direction="out"/></method>
    <method name="SubmitRecordingNote"><arg type="s" direction="in"/><arg type="b" direction="out"/></method>
    <method name="PromptSetText"><arg type="s" direction="in"/><arg type="b" direction="out"/></method>
    <method name="PromptPressSave"><arg type="b" direction="out"/></method>
    <method name="PromptPressCancel"><arg type="b" direction="out"/></method>

    <!-- Stage 4/5: the app registry and the display fixtures. -->
    <method name="GetRegistry"><arg type="s" direction="out"/></method>
    <method name="SetNeverTile"><arg type="s" direction="in"/><arg type="b" direction="in"/><arg type="b" direction="out"/></method>
    <method name="ToggleNeverTile"><arg type="s" direction="in"/><arg type="b" direction="out"/></method>
    <method name="ForgetApp"><arg type="s" direction="in"/><arg type="b" direction="out"/></method>
    <method name="GetDisplayMemory"><arg type="s" direction="out"/></method>
    <method name="ForgetDisplayMemory"><arg type="b" direction="out"/></method>
    <method name="SimulateScreens"><arg type="s" direction="in"/><arg type="b" direction="out"/></method>
    <method name="SimulateWorkArea">
      <arg type="s" direction="in"/><arg type="i" direction="in"/><arg type="i" direction="in"/>
      <arg type="i" direction="in"/><arg type="i" direction="in"/><arg type="b" direction="out"/>
    </method>

    <!-- Stage 0: the capability probe, the event journal and real input. -->
    <method name="ProbePlatform"><arg type="s" direction="out"/></method>
    <method name="DumpEvents">
      <arg type="i" direction="in"/><arg type="s" direction="in"/><arg type="s" direction="out"/>
    </method>
    <method name="DumpDecisions"><arg type="i" direction="in"/><arg type="s" direction="out"/></method>
    <method name="DumpTrace"><arg type="i" direction="in"/><arg type="s" direction="out"/></method>
    <method name="InjectPointerMove">
      <arg type="i" direction="in"/><arg type="i" direction="in"/><arg type="b" direction="out"/>
    </method>
    <method name="InjectPointerButton">
      <arg type="i" direction="in"/><arg type="b" direction="in"/><arg type="b" direction="out"/>
    </method>
    <method name="SimulateBurst">
      <arg type="i" direction="in"/><arg type="s" direction="in"/><arg type="i" direction="out"/>
    </method>
    <method name="SimulateNotice">
      <arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="b" direction="out"/>
    </method>
    <method name="InjectKey">
      <arg type="i" direction="in"/><arg type="b" direction="in"/><arg type="b" direction="out"/>
    </method>

    <!--
      Test-only settings writers (section 40.4). An external gsettings set is
      invisible to the running Shell when the host's per-user inotify budget is
      exhausted (the keyfile backend cannot create its file monitor); writing
      through this process makes the in-process changed signal fire exactly as
      a settings-daemon change would. Gated on ADRT_TEST_TRIGGERS=1.
    -->
    <method name="SetSetting">
      <arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="b" direction="out"/>
    </method>
    <method name="SetSchemaSetting">
      <arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="s" direction="in"/>
      <arg type="b" direction="out"/>
    </method>
  </interface>
</node>`;

export class GnomeDbus implements DbusBackend {
  private exported: any = null;
  private ownerId = 0;

  expose(handlers: DbusHandlers): void {
    this.exported = Gio.DBusExportedObject.wrapJSObject(INTERFACE_XML, handlers);
    this.exported.export(Gio.DBus.session, DBUS_PATH);
    this.ownerId = Gio.bus_own_name(Gio.BusType.SESSION, DBUS_NAME, Gio.BusNameOwnerFlags.NONE, null, null, null);
  }

  unexpose(): void {
    if (this.exported === null) return;
    this.exported.unexport();
    this.exported = null;
    if (this.ownerId !== 0) {
      Gio.bus_unown_name(this.ownerId);
      this.ownerId = 0;
    }
  }
}
