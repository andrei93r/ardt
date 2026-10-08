// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';

import { TRIGGERS, buildDispatch, buildInterfaceXml, taxonomyFor } from '../../src/core/triggers.js';
import type { Trigger } from '../../src/core/triggers.js';

const INTERFACE_NAME = 'org.adrt.Adrt';

/**
 * The hand-maintained introspection XML this table replaced, kept verbatim as
 * the wire-contract golden. Generated XML must describe exactly these methods,
 * so P6a cannot silently change the D-Bus surface while deduplicating it.
 */
const LEGACY_INTERFACE_XML = `
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
    <method name="TogglePause"><arg type="b" direction="out"/></method>
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

interface ParsedMethod {
  name: string;
  in: string[];
  out: string[];
}

/** Minimal, dependency-free reader for the shape this file generates. */
function parseMethods(xml: string): ParsedMethod[] {
  const body = xml.slice(xml.indexOf('<interface'), xml.indexOf('</interface>'));
  const withoutComments = body.replace(/<!--[\s\S]*?-->/g, '');
  const methods: ParsedMethod[] = [];
  const methodPattern = /<method name="([^"]+)">([\s\S]*?)<\/method>/g;
  let method: RegExpExecArray | null;
  while ((method = methodPattern.exec(withoutComments)) !== null) {
    const inTypes: string[] = [];
    const outTypes: string[] = [];
    const argPattern = /<arg type="([^"]+)" direction="(in|out)"\s*\/>/g;
    let arg: RegExpExecArray | null;
    while ((arg = argPattern.exec(method[2])) !== null) {
      if (arg[2] === 'in') inTypes.push(arg[1]);
      else outTypes.push(arg[1]);
    }
    methods.push({ name: method[1], in: inTypes, out: outTypes });
  }
  return methods;
}

/** One canonical string per method: name and ordered in/out type signatures. */
function signature(method: { name: string; in: readonly string[]; out: readonly string[] }): string {
  return `${method.name}|${method.in.join(',')}|${method.out.join(',')}`;
}

function signatureOf(trigger: Trigger): string {
  return signature(trigger);
}

describe('trigger table', () => {
  it('has a non-empty, uniquely named entry per method', () => {
    expect(TRIGGERS.length).toBeGreaterThan(0);
    const names = TRIGGERS.map((trigger) => trigger.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives every entry a handler name', () => {
    for (const trigger of TRIGGERS) {
      expect(trigger.handler.length).toBeGreaterThan(0);
    }
  });

  it('keeps taxonomy consistent with the name prefix', () => {
    for (const trigger of TRIGGERS) {
      expect(trigger.taxonomy).toBe(taxonomyFor(trigger.name));
    }
    expect(TRIGGERS.some((trigger) => trigger.taxonomy === 'inject')).toBe(true);
    expect(TRIGGERS.some((trigger) => trigger.taxonomy === 'simulate')).toBe(true);
    expect(TRIGGERS.some((trigger) => trigger.taxonomy === 'api')).toBe(true);
  });

  it('generates XML whose signatures match the table', () => {
    const generated = parseMethods(buildInterfaceXml(INTERFACE_NAME, TRIGGERS));
    expect(generated.map(signature)).toEqual(TRIGGERS.map(signatureOf));
  });

  it('preserves the method surface of the replaced hand-maintained XML', () => {
    const generated = parseMethods(buildInterfaceXml(INTERFACE_NAME, TRIGGERS));
    expect(generated.map(signature)).toEqual(parseMethods(LEGACY_INTERFACE_XML).map(signature));
  });

  it('includes the interface name in the node', () => {
    expect(buildInterfaceXml(INTERFACE_NAME, TRIGGERS)).toContain(`<interface name="${INTERFACE_NAME}">`);
  });
});

describe('buildDispatch', () => {
  it('maps every table method to its handler, wrapped', () => {
    const impls: Record<string, (value: number) => number> = {};
    for (const trigger of TRIGGERS) impls[trigger.handler] = (value) => value + 1;
    const calls: string[] = [];
    const dispatch = buildDispatch(TRIGGERS, impls, (name, handler) => {
      calls.push(name);
      return handler;
    });
    expect(Object.keys(dispatch)).toEqual(TRIGGERS.map((trigger) => trigger.name));
    expect(calls).toEqual(TRIGGERS.map((trigger) => trigger.name));
    expect(dispatch.DumpState(1)).toBe(2);
  });

  it('throws when a table entry has no handler', () => {
    const impls: Record<string, (value: number) => number> = {};
    for (const trigger of TRIGGERS) impls[trigger.handler] = (value) => value;
    delete impls.Undo;
    expect(() => buildDispatch(TRIGGERS, impls, (_name, handler) => handler)).toThrow(/no handler for trigger Undo/);
  });

  it('throws when a handler has no table entry', () => {
    const impls: Record<string, (value: number) => number> = {};
    for (const trigger of TRIGGERS) impls[trigger.handler] = (value) => value;
    impls.Orphan = (value) => value;
    expect(() => buildDispatch(TRIGGERS, impls, (_name, handler) => handler)).toThrow(/Orphan has no trigger/);
  });
});
