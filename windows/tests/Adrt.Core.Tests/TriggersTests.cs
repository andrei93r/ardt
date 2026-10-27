// Port of tests/core/triggers.test.ts.
using System.Text.RegularExpressions;
using Adrt.Core;
using Xunit;

namespace Adrt.Core.Tests;

public class TriggersTests
{
    private const string InterfaceName = "org.adrt.Adrt";

    /// <summary>
    /// The hand-maintained introspection XML this table replaced, kept verbatim as
    /// the wire-contract golden. Generated XML must describe exactly these methods,
    /// so P6a cannot silently change the D-Bus surface while deduplicating it.
    /// </summary>
    private const string LegacyInterfaceXml = """
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
    <method name="ResizeFocused"><arg type="s" direction="in"/><arg type="d" direction="in"/><arg type="b" direction="out"/></method>
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
    <method name="WarpPointerToMonitor"><arg type="i" direction="in"/><arg type="b" direction="out"/></method>
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
</node>
""";

    private sealed record ParsedMethod(string Name, IReadOnlyList<string> In, IReadOnlyList<string> Out);

    private static readonly Regex MethodPattern = new("<method name=\"([^\"]+)\">([\\s\\S]*?)</method>", RegexOptions.CultureInvariant);
    private static readonly Regex ArgPattern = new("<arg type=\"([^\"]+)\" direction=\"(in|out)\"\\s*/>", RegexOptions.CultureInvariant);
    private static readonly Regex CommentPattern = new("<!--[\\s\\S]*?-->", RegexOptions.CultureInvariant);

    private static List<ParsedMethod> ParseMethods(string xml)
    {
        var body = xml[xml.IndexOf("<interface", StringComparison.Ordinal)..xml.IndexOf("</interface>", StringComparison.Ordinal)];
        var withoutComments = CommentPattern.Replace(body, "");
        var methods = new List<ParsedMethod>();
        foreach (Match method in MethodPattern.Matches(withoutComments))
        {
            var inTypes = new List<string>();
            var outTypes = new List<string>();
            foreach (Match arg in ArgPattern.Matches(method.Groups[2].Value))
            {
                if (arg.Groups[2].Value == "in") inTypes.Add(arg.Groups[1].Value);
                else outTypes.Add(arg.Groups[1].Value);
            }
            methods.Add(new ParsedMethod(method.Groups[1].Value, inTypes, outTypes));
        }
        return methods;
    }

    private static string Signature(ParsedMethod method) =>
        $"{method.Name}|{string.Join(',', method.In)}|{string.Join(',', method.Out)}";

    private static string Signature(Trigger trigger) =>
        $"{trigger.Name}|{string.Join(',', trigger.In)}|{string.Join(',', trigger.Out)}";

    [Fact]
    public void HasANonEmptyUniquelyNamedEntryPerMethod()
    {
        Assert.NotEmpty(Triggers.All);
        var names = Triggers.All.Select(trigger => trigger.Name).ToList();
        Assert.Equal(names.Count, names.Distinct().Count());
    }

    [Fact]
    public void GivesEveryEntryAHandlerName()
    {
        foreach (var trigger in Triggers.All) Assert.NotEmpty(trigger.Handler);
    }

    [Fact]
    public void KeepsTaxonomyConsistentWithTheNamePrefix()
    {
        foreach (var trigger in Triggers.All)
        {
            Assert.Equal(Triggers.TaxonomyFor(trigger.Name), trigger.Taxonomy);
        }
        Assert.Contains(Triggers.All, trigger => trigger.Taxonomy == TriggerTaxonomy.Inject);
        Assert.Contains(Triggers.All, trigger => trigger.Taxonomy == TriggerTaxonomy.Simulate);
        Assert.Contains(Triggers.All, trigger => trigger.Taxonomy == TriggerTaxonomy.Api);
    }

    [Fact]
    public void GeneratesXmlWhoseSignaturesMatchTheTable()
    {
        var generated = ParseMethods(Triggers.BuildInterfaceXml(InterfaceName, Triggers.All));
        Assert.Equal(Triggers.All.Select(Signature), generated.Select(Signature));
    }

    [Fact]
    public void PreservesTheMethodSurfaceOfTheReplacedHandMaintainedXml()
    {
        var generated = ParseMethods(Triggers.BuildInterfaceXml(InterfaceName, Triggers.All));
        Assert.Equal(ParseMethods(LegacyInterfaceXml).Select(Signature), generated.Select(Signature));
    }

    [Fact]
    public void IncludesTheInterfaceNameInTheNode()
    {
        Assert.Contains($"<interface name=\"{InterfaceName}\">", Triggers.BuildInterfaceXml(InterfaceName, Triggers.All));
    }

    [Fact]
    public void BuildDispatchMapsEveryTableMethodToItsHandlerWrapped()
    {
        var impls = Triggers.All.ToDictionary(trigger => trigger.Handler, _ => new Func<int, int>(value => value + 1));
        var calls = new List<string>();
        var dispatch = Triggers.BuildDispatch(Triggers.All, impls, (name, handler) =>
        {
            calls.Add(name);
            return handler;
        });
        Assert.Equal(Triggers.All.Select(trigger => trigger.Name), dispatch.Keys);
        Assert.Equal(Triggers.All.Select(trigger => trigger.Name), calls);
        Assert.Equal(2, dispatch["DumpState"](1));
    }

    [Fact]
    public void BuildDispatchThrowsWhenATableEntryHasNoHandler()
    {
        var impls = Triggers.All.ToDictionary(trigger => trigger.Handler, _ => new Func<int, int>(value => value));
        impls.Remove("Undo");
        var error = Assert.Throws<InvalidOperationException>(
            () => Triggers.BuildDispatch(Triggers.All, impls, (_name, handler) => handler));
        Assert.Matches("no handler for trigger Undo", error.Message);
    }

    [Fact]
    public void BuildDispatchThrowsWhenAHandlerHasNoTableEntry()
    {
        var impls = Triggers.All.ToDictionary(trigger => trigger.Handler, _ => new Func<int, int>(value => value));
        impls["Orphan"] = value => value;
        var error = Assert.Throws<InvalidOperationException>(
            () => Triggers.BuildDispatch(Triggers.All, impls, (_name, handler) => handler));
        Assert.Matches("Orphan has no trigger", error.Message);
    }
}
