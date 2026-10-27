// Port of src/core/triggers.ts. Keep names and semantics 1:1 with the TypeScript.
using System.Text.Json.Serialization;

namespace Adrt.Core;

/// <summary>
/// How a trigger reaches the system. <c>inject</c> performs real input;
/// <c>simulate</c> only mutates adrt's model; <c>api</c> is a real query or
/// control call.
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum TriggerTaxonomy
{
    [JsonStringEnumMemberName("inject")] Inject,
    [JsonStringEnumMemberName("simulate")] Simulate,
    [JsonStringEnumMemberName("api")] Api,
}

/// <summary>One D-Bus method: its wire signature, its handler and its honest taxonomy.</summary>
public sealed record Trigger
{
    /// <summary>
    /// The D-Bus method name and, because the exported object dispatches by name,
    /// the key of the JS handler object.
    /// </summary>
    [JsonPropertyName("name")] public required string Name { get; init; }

    /// <summary>
    /// The key the extension supplies the implementation under. Kept explicit so a
    /// future indirection (a name mapping) does not need a table rewrite.
    /// </summary>
    [JsonPropertyName("handler")] public required string Handler { get; init; }

    /// <summary>Argument D-Bus type signatures, in wire order, all <c>direction="in"</c>.</summary>
    [JsonPropertyName("in")] public required IReadOnlyList<string> In { get; init; }

    /// <summary>Return D-Bus type signatures, in wire order, all <c>direction="out"</c>.</summary>
    [JsonPropertyName("out")] public required IReadOnlyList<string> Out { get; init; }

    [JsonPropertyName("taxonomy")] public required TriggerTaxonomy Taxonomy { get; init; }
}

/// <summary>
/// The one trigger table (§22, quality plan P6a). Every method exposed on the IPC
/// surface is described here exactly once; the adapter derives its introspection
/// XML from it and the app builds its dispatch map from it, so a method can no
/// longer be added to one without the other. This module is pure data and pure
/// functions — no <c>gi://</c>, no I/O (core purity §2.2).
/// </summary>
public static class Triggers
{
    /// <summary>The taxonomy implied by the name prefix; the table must agree with it.</summary>
    public static TriggerTaxonomy TaxonomyFor(string name)
    {
        if (name.StartsWith("Inject", StringComparison.Ordinal)) return TriggerTaxonomy.Inject;
        if (name.StartsWith("Simulate", StringComparison.Ordinal)) return TriggerTaxonomy.Simulate;
        return TriggerTaxonomy.Api;
    }

    /// <summary>
    /// Every method the extension exposes, in a stable declaration order. The order
    /// is the XML declaration order.
    /// </summary>
    public static readonly IReadOnlyList<Trigger> All =
    [
        new Trigger { Name = "DumpState", Handler = "DumpState", In = [], Out = ["s"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "LookupWindow", Handler = "LookupWindow", In = ["u"], Out = ["s"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "ListWindows", Handler = "ListWindows", In = [], Out = ["s"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "ListMonitors", Handler = "ListMonitors", In = [], Out = ["s"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "GetSplitRatio", Handler = "GetSplitRatio", In = ["i", "s", "s"], Out = ["d"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "SetSplitRatio", Handler = "SetSplitRatio", In = ["i", "s", "s", "d"], Out = ["b"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "Undo", Handler = "Undo", In = [], Out = ["b"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "NudgeSplit", Handler = "NudgeSplit", In = ["s", "d"], Out = ["b"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "ResizeFocused", Handler = "ResizeFocused", In = ["s", "d"], Out = ["b"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "MoveFocusedToWorkspace", Handler = "MoveFocusedToWorkspace", In = ["i"], Out = ["b"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "ReloadRules", Handler = "ReloadRules", In = [], Out = ["b"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "ResetPerApp", Handler = "ResetPerApp", In = ["s"], Out = ["b"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "GetAdaptations", Handler = "GetAdaptations", In = [], Out = ["s"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "ForgetAdaptation", Handler = "ForgetAdaptation", In = ["s"], Out = ["b"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "GetFloats", Handler = "GetFloats", In = [], Out = ["s"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "ForgetFloat", Handler = "ForgetFloat", In = ["s"], Out = ["b"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "ExportConfig", Handler = "ExportConfig", In = [], Out = ["s"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "ImportConfig", Handler = "ImportConfig", In = ["s", "b"], Out = ["s"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "ListHistoryDays", Handler = "ListHistoryDays", In = [], Out = ["s"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "SimulateGesture", Handler = "SimulateGesture", In = ["s", "d", "d", "i"], Out = ["b"], Taxonomy = TriggerTaxonomy.Simulate },
        new Trigger { Name = "InjectSignal", Handler = "InjectSignal", In = ["s", "s"], Out = ["b"], Taxonomy = TriggerTaxonomy.Inject },
        new Trigger { Name = "SimulateSessionMode", Handler = "SimulateSessionMode", In = ["s"], Out = ["b"], Taxonomy = TriggerTaxonomy.Simulate },
        new Trigger { Name = "SimulateOverview", Handler = "SimulateOverview", In = ["b"], Out = ["b"], Taxonomy = TriggerTaxonomy.Simulate },
        new Trigger { Name = "SpawnWindow", Handler = "SpawnWindow", In = ["s", "s"], Out = ["i"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "CloseWindow", Handler = "CloseWindow", In = ["u"], Out = ["b"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "BeginDrag", Handler = "BeginDrag", In = ["u"], Out = ["b"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "EndDrag", Handler = "EndDrag", In = ["u"], Out = ["b"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "MoveWindow", Handler = "MoveWindow", In = ["u", "i", "i", "i", "i"], Out = ["b"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "MinimizeWindow", Handler = "MinimizeWindow", In = ["u"], Out = ["b"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "ActivateWindow", Handler = "ActivateWindow", In = ["u"], Out = ["b"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "ActivateWorkspace", Handler = "ActivateWorkspace", In = ["i"], Out = ["b"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "ToggleFloat", Handler = "ToggleFloat", In = ["u"], Out = ["b"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "SimulateResize", Handler = "SimulateResize", In = ["u", "u", "d"], Out = ["b"], Taxonomy = TriggerTaxonomy.Simulate },
        new Trigger { Name = "SwapPair", Handler = "SwapPair", In = ["u", "u"], Out = ["b"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "InjectVerifyFailure", Handler = "InjectVerifyFailure", In = ["u", "i"], Out = ["b"], Taxonomy = TriggerTaxonomy.Inject },
        new Trigger { Name = "FocusDirection", Handler = "FocusDirection", In = ["s"], Out = ["b"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "FocusCycle", Handler = "FocusCycle", In = [], Out = ["b"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "MoveToward", Handler = "MoveToward", In = ["s"], Out = ["b"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "MaximizeWindow", Handler = "MaximizeWindow", In = ["u"], Out = ["b"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "UnmaximizeWindow", Handler = "UnmaximizeWindow", In = ["u"], Out = ["b"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "ResetLayoutState", Handler = "ResetLayoutState", In = [], Out = ["b"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "SimulateWorkspaceSwitch", Handler = "SimulateWorkspaceSwitch", In = ["i"], Out = ["b"], Taxonomy = TriggerTaxonomy.Simulate },
        new Trigger { Name = "MoveToWorkspace", Handler = "MoveToWorkspace", In = ["u", "i"], Out = ["b"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "MarkWorkspaceCached", Handler = "MarkWorkspaceCached", In = ["u", "i"], Out = ["b"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "MoveDirection", Handler = "MoveDirection", In = ["s"], Out = ["b"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "ToggleFullscreen", Handler = "ToggleFullscreen", In = ["u"], Out = ["b"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "QuitFocused", Handler = "QuitFocused", In = [], Out = ["b"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "SimulateAbove", Handler = "SimulateAbove", In = ["u"], Out = ["b"], Taxonomy = TriggerTaxonomy.Simulate },
        new Trigger { Name = "SimulateSticky", Handler = "SimulateSticky", In = ["u", "b"], Out = ["b"], Taxonomy = TriggerTaxonomy.Simulate },
        new Trigger { Name = "SimulateWorkspaceReorder", Handler = "SimulateWorkspaceReorder", In = ["u", "u"], Out = ["b"], Taxonomy = TriggerTaxonomy.Simulate },
        new Trigger { Name = "SimulateWorkspaceOrientation", Handler = "SimulateWorkspaceOrientation", In = ["b"], Out = ["b"], Taxonomy = TriggerTaxonomy.Simulate },
        new Trigger { Name = "CursorToCentre", Handler = "CursorToCentre", In = [], Out = ["b"], Taxonomy = TriggerTaxonomy.Api },
        // Test-only: park the pointer on a monitor centre so new windows open there
        // (Mutter places a window under the pointer); the live suite uses it to keep
        // spawns on the primary monitor when the user's windows fill another one.
        new Trigger { Name = "WarpPointerToMonitor", Handler = "WarpPointerToMonitor", In = ["i"], Out = ["b"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "TogglePause", Handler = "TogglePause", In = [], Out = ["b"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "InjectFault", Handler = "InjectFault", In = ["s"], Out = ["b"], Taxonomy = TriggerTaxonomy.Inject },
        new Trigger { Name = "SimulateChromeTeardown", Handler = "SimulateChromeTeardown", In = [], Out = ["b"], Taxonomy = TriggerTaxonomy.Simulate },
        new Trigger { Name = "StartFrameRecording", Handler = "StartFrameRecording", In = [], Out = ["b"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "StopFrameRecording", Handler = "StopFrameRecording", In = [], Out = ["b"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "StartRecording", Handler = "StartRecording", In = ["i"], Out = ["s"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "StopRecording", Handler = "StopRecording", In = [], Out = ["s"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "RecordingStatus", Handler = "RecordingStatus", In = [], Out = ["s"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "ToggleRecording", Handler = "ToggleRecording", In = [], Out = ["s"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "SubmitRecordingNote", Handler = "SubmitRecordingNote", In = ["s"], Out = ["b"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "PromptSetText", Handler = "PromptSetText", In = ["s"], Out = ["b"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "PromptPressSave", Handler = "PromptPressSave", In = [], Out = ["b"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "PromptPressCancel", Handler = "PromptPressCancel", In = [], Out = ["b"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "GetRegistry", Handler = "GetRegistry", In = [], Out = ["s"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "SetNeverTile", Handler = "SetNeverTile", In = ["s", "b"], Out = ["b"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "ToggleNeverTile", Handler = "ToggleNeverTile", In = ["s"], Out = ["b"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "ForgetApp", Handler = "ForgetApp", In = ["s"], Out = ["b"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "GetDisplayMemory", Handler = "GetDisplayMemory", In = [], Out = ["s"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "ForgetDisplayMemory", Handler = "ForgetDisplayMemory", In = [], Out = ["b"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "SimulateScreens", Handler = "SimulateScreens", In = ["s"], Out = ["b"], Taxonomy = TriggerTaxonomy.Simulate },
        new Trigger { Name = "SimulateWorkArea", Handler = "SimulateWorkArea", In = ["s", "i", "i", "i", "i"], Out = ["b"], Taxonomy = TriggerTaxonomy.Simulate },
        new Trigger { Name = "ProbePlatform", Handler = "ProbePlatform", In = [], Out = ["s"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "DumpEvents", Handler = "DumpEvents", In = ["i", "s"], Out = ["s"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "DumpDecisions", Handler = "DumpDecisions", In = ["i"], Out = ["s"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "DumpTrace", Handler = "DumpTrace", In = ["i"], Out = ["s"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "InjectPointerMove", Handler = "InjectPointerMove", In = ["i", "i"], Out = ["b"], Taxonomy = TriggerTaxonomy.Inject },
        new Trigger { Name = "InjectPointerButton", Handler = "InjectPointerButton", In = ["i", "b"], Out = ["b"], Taxonomy = TriggerTaxonomy.Inject },
        new Trigger { Name = "SimulateBurst", Handler = "SimulateBurst", In = ["i", "s"], Out = ["i"], Taxonomy = TriggerTaxonomy.Simulate },
        new Trigger { Name = "SimulateNotice", Handler = "SimulateNotice", In = ["s", "s"], Out = ["b"], Taxonomy = TriggerTaxonomy.Simulate },
        new Trigger { Name = "InjectKey", Handler = "InjectKey", In = ["i", "b"], Out = ["b"], Taxonomy = TriggerTaxonomy.Inject },
        new Trigger { Name = "SetSetting", Handler = "SetSetting", In = ["s", "s"], Out = ["b"], Taxonomy = TriggerTaxonomy.Api },
        new Trigger { Name = "SetSchemaSetting", Handler = "SetSchemaSetting", In = ["s", "s", "s"], Out = ["b"], Taxonomy = TriggerTaxonomy.Api },
    ];

    /// <summary>
    /// Render the introspection XML from a trigger table. Arguments are emitted in
    /// then out, in table order, matching the hand-maintained XML this replaced.
    /// </summary>
    public static string BuildInterfaceXml(string interfaceName, IReadOnlyList<Trigger> triggers)
    {
        var lines = new List<string> { "<node>", $"  <interface name=\"{interfaceName}\">" };
        foreach (var trigger in triggers)
        {
            var arguments = string.Concat(
                trigger.In.Select(type => $"<arg type=\"{type}\" direction=\"in\"/>")
                    .Concat(trigger.Out.Select(type => $"<arg type=\"{type}\" direction=\"out\"/>")));
            lines.Add($"    <method name=\"{trigger.Name}\">{arguments}</method>");
        }
        lines.Add("  </interface>");
        lines.Add("</node>");
        return string.Join('\n', lines);
    }

    /// <summary>
    /// Build the dispatch map from the table and a handler registry keyed by
    /// <c>Trigger.Handler</c>. Throws (never silently drops a method) when a table
    /// entry has no implementation, or when a registered handler is not in the
    /// table — the failure surfaces at <c>enable()</c>.
    /// </summary>
    public static Dictionary<string, T> BuildDispatch<T>(
        IReadOnlyList<Trigger> triggers,
        IReadOnlyDictionary<string, T> handlers,
        Func<string, T, T> wrap)
    {
        var dispatch = new Dictionary<string, T>(StringComparer.Ordinal);
        var used = new HashSet<string>(StringComparer.Ordinal);
        foreach (var trigger in triggers)
        {
            if (!handlers.TryGetValue(trigger.Handler, out var handler))
            {
                throw new InvalidOperationException(
                    $"no handler for trigger {trigger.Name} (expected {trigger.Handler})");
            }
            used.Add(trigger.Handler);
            dispatch[trigger.Name] = wrap(trigger.Name, handler);
        }
        foreach (var key in handlers.Keys)
        {
            if (!used.Contains(key)) throw new InvalidOperationException($"handler {key} has no trigger table entry");
        }
        return dispatch;
    }
}
