// Port of tests/core/rules.test.ts.
using System.Text.Json.Nodes;
using Adrt.Core;
using Xunit;

namespace Adrt.Core.Tests;

public class RulesTests
{
    private static Rule Rule(
        string? appId = null,
        string? title = null,
        IReadOnlyList<SurfaceKind>? kind = null,
        bool? transient = null,
        TileMode tile = TileMode.Full,
        bool? enabled = null) => new()
        {
            Match = new RuleMatch { AppId = appId, Title = title, Kind = kind, Transient = transient },
            Tile = tile,
            Enabled = enabled,
        };

    [Fact]
    public void TileModesListsEveryModeInOrderIncludingFloat()
    {
        Assert.Equal(
            new[] { TileMode.Full, TileMode.LeftHalf, TileMode.RightHalf, TileMode.Float },
            Rules.TileModes);
    }

    [Fact]
    public void GlobMatchMatchesWildcardsCaseInsensitively()
    {
        Assert.True(Rules.GlobMatch("org.gnome.*", "org.gnome.Nautilus"));
        Assert.True(Rules.GlobMatch("*firefox*", "org.mozilla.Firefox"));
        Assert.True(Rules.GlobMatch("code?", "codex"));
        Assert.False(Rules.GlobMatch("code", "codex"));
    }

    [Fact]
    public void GlobToRegExpEscapesRegexMetacharacters()
    {
        Assert.Matches(Rules.GlobToRegExp("a.b"), "a.b");
        Assert.DoesNotMatch(Rules.GlobToRegExp("a.b"), "axb");
    }

    [Fact]
    public void CompileGlobReusesTheCompiledPatternForRepeatedCalls()
    {
        var first = Rules.CompileGlob("org.gnome.*");
        Assert.Same(first, Rules.CompileGlob("org.gnome.*"));
    }

    [Fact]
    public void CompileGlobCompilesToTheSamePatternAsGlobToRegExp()
    {
        const string glob = "*firefox*";
        Assert.Equal(Rules.GlobToRegExp(glob).ToString(), Rules.CompileGlob(glob).ToString());
        Assert.Matches(Rules.CompileGlob(glob), "org.mozilla.Firefox");
        Assert.DoesNotMatch(Rules.CompileGlob(glob), "org.gnome.Nautilus");
    }

    [Fact]
    public void KeepsGlobMatchResultsIdenticalAcrossCalls()
    {
        Assert.True(Rules.GlobMatch("code?", "codex"));
        Assert.True(Rules.GlobMatch("code?", "codex"));
        Assert.False(Rules.GlobMatch("code", "codex"));
    }

    private static readonly RuleContext MozillaContext =
        Rules.ContextFor(H.Surface(appId: "org.mozilla.Firefox", title: "Inbox — Firefox"));

    [Fact]
    public void RuleMatchesAndsAllPresentFields()
    {
        Assert.True(Rules.RuleMatches(Rule(appId: "org.mozilla.*", title: "*Firefox*"), MozillaContext));
        Assert.False(Rules.RuleMatches(Rule(appId: "org.mozilla.*", title: "Inbox"), MozillaContext));
    }

    [Fact]
    public void RuleMatchesFiltersByKindList()
    {
        Assert.True(Rules.RuleMatches(Rule(kind: new[] { SurfaceKind.Normal }), MozillaContext));
        Assert.False(Rules.RuleMatches(Rule(kind: new[] { SurfaceKind.Dialog }), MozillaContext));
    }

    [Fact]
    public void RuleMatchesFiltersByTransientFlag()
    {
        Assert.True(Rules.RuleMatches(Rule(transient: false), MozillaContext));
        Assert.False(Rules.RuleMatches(Rule(transient: true), MozillaContext));
    }

    [Fact]
    public void FirstMatchReturnsTheFirstMatchingRuleInListOrder()
    {
        var rules = new[]
        {
            Rule(appId: "org.mozilla.*", tile: TileMode.LeftHalf),
            Rule(appId: "*", tile: TileMode.Full),
        };
        Assert.Same(rules[0], Rules.FirstMatch(rules, MozillaContext));
        Assert.Null(Rules.FirstMatch(Array.Empty<Rule>(), MozillaContext));
    }

    [Fact]
    public void FirstMatchSkipsADisabledRuleAndTakesTheNextMatch()
    {
        var rules = new[]
        {
            Rule(appId: "org.mozilla.*", tile: TileMode.LeftHalf, enabled: false),
            Rule(appId: "*", tile: TileMode.Full),
        };
        Assert.Same(rules[1], Rules.FirstMatch(rules, MozillaContext));
        Assert.Null(Rules.FirstMatch(new[] { rules[0] }, MozillaContext));
    }

    [Fact]
    public void FirstMatchReturnsTheMatchingRuleSoItsTileActionIsRead()
    {
        var rule = Rule(appId: "org.mozilla.*", tile: TileMode.RightHalf);
        Assert.Equal(TileMode.RightHalf, Rules.FirstMatch(new[] { rule }, MozillaContext)?.Tile);
    }

    [Fact]
    public void FirstMatchReturnsAMatchingFloatRule()
    {
        var rule = Rule(appId: "org.mozilla.*", tile: TileMode.Float);
        Assert.Equal(TileMode.Float, Rules.FirstMatch(new[] { rule }, MozillaContext)?.Tile);
    }

    private static Rule? ValidateRule(string json, string where, List<string> errors) =>
        Rules.ValidateRule(JsonNode.Parse(json), where, errors);

    [Fact]
    public void ValidateRuleAcceptsAWellFormedTileRuleWithNoErrors()
    {
        var errors = new List<string>();
        var rule = ValidateRule("{\"match\":{\"appId\":\"a*\",\"title\":\"*Docs*\"},\"tile\":\"left-half\"}", "rule[0]", errors);
        Assert.Empty(errors);
        Assert.Equal(TileMode.LeftHalf, rule?.Tile);
        Assert.Equal("a*", rule?.Match.AppId);
    }

    [Fact]
    public void ValidateRuleAcceptsAPerRuleEnabledSwitch()
    {
        var errors = new List<string>();
        var rule = ValidateRule("{\"match\":{\"appId\":\"a*\"},\"tile\":\"full\",\"enabled\":false}", "rule[0]", errors);
        Assert.Empty(errors);
        Assert.False(rule?.Enabled);
    }

    [Fact]
    public void ValidateRuleAcceptsTheFloatAction()
    {
        var errors = new List<string>();
        var rule = ValidateRule("{\"match\":{\"appId\":\"pavu*\"},\"tile\":\"float\"}", "rule[0]", errors);
        Assert.Empty(errors);
        Assert.Equal(TileMode.Float, rule?.Tile);
    }

    [Fact]
    public void ValidateRuleRequiresATileAction()
    {
        var errors = new List<string>();
        Assert.Null(ValidateRule("{\"match\":{\"appId\":\"a*\"}}", "rule[0]", errors));
        Assert.Contains("tile", string.Join(' ', errors));
    }

    [Fact]
    public void ValidateRuleRetiresTheFloatActionWithAPointerToTheNeverTileList()
    {
        var errors = new List<string>();
        Assert.Null(ValidateRule("{\"match\":{\"appId\":\"pavu*\"},\"float\":true}", "rule[0]", errors));
        Assert.Contains("Never-tile", string.Join(' ', errors));
    }

    [Fact]
    public void ValidateRuleRequiresAtLeastOneMatchField()
    {
        var errors = new List<string>();
        Assert.Null(ValidateRule("{\"match\":{},\"tile\":\"full\"}", "rule[0]", errors));
        Assert.Contains("at least one", string.Join(' ', errors));
    }

    [Fact]
    public void ValidateRuleRejectsAnUnknownTileModeAndAnUnknownKind()
    {
        var errors = new List<string>();
        Assert.Null(ValidateRule("{\"match\":{\"appId\":\"a\"},\"tile\":\"nope\"}", "rule[0]", errors));
        Rules.ValidateRule(JsonNode.Parse("{\"match\":{\"kind\":[\"bogus\"]},\"tile\":\"full\"}"), "rule[1]", errors);
        Assert.Contains("tile must be one of", string.Join(' ', errors));
        Assert.Contains("unknown kind", string.Join(' ', errors));
    }

    [Fact]
    public void ValidateRuleRejectsANonObjectEntry()
    {
        var errors = new List<string>();
        Assert.Null(Rules.ValidateRule(null, "rule[0]", errors));
        Assert.Equal(new[] { "rule[0]: must be an object" }, errors);
    }

    [Fact]
    public void ValidateRuleReportsTheEnabledTypeError()
    {
        var errors = new List<string>();
        Rules.ValidateRule(
            JsonNode.Parse("{\"match\":{\"appId\":\"a\"},\"tile\":\"full\",\"enabled\":\"yes\"}"),
            "rule[0]",
            errors);
        Assert.Contains("enabled must be a boolean", string.Join(' ', errors));
    }

    [Fact]
    public void ValidateRulesAcceptsWellFormedRulesAndKeepsEntriesInOrder()
    {
        var result = Rules.ValidateRules(JsonNode.Parse(
            "[{\"match\":{\"appId\":\"a*\"},\"tile\":\"full\"},{\"match\":{\"title\":\"b\"},\"tile\":\"right-half\"}]"));
        Assert.Empty(result.Errors);
        Assert.Equal(2, result.Rules.Count);
        Assert.Equal(TileMode.RightHalf, result.Rules[1].Tile);
    }

    [Fact]
    public void ValidateRulesReportsInvalidEntriesAndKeepsTheValidOnes()
    {
        var result = Rules.ValidateRules(JsonNode.Parse(
            "[null,{\"match\":{\"appId\":5}},{\"match\":{},\"tile\":\"nope\"},{\"match\":{\"kind\":[\"bogus\"]},\"tile\":\"full\"},{\"match\":{\"appId\":\"ok\"},\"tile\":\"full\"}]"));
        Assert.Single(result.Rules);
        Assert.Equal(TileMode.Full, result.Rules[0].Tile);
        Assert.True(result.Errors.Count >= 5);
    }

    [Fact]
    public void ValidateRulesRejectsNonArrayInput()
    {
        Assert.Contains("array", Rules.ValidateRules(JsonNode.Parse("{}")).Errors[0]);
    }

    [Fact]
    public void ParseRulesJsonParsesValidJson()
    {
        Assert.Single(Rules.ParseRulesJson("[{\"match\":{\"appId\":\"*\"},\"tile\":\"full\"}]").Rules);
    }

    [Fact]
    public void ParseRulesJsonReportsMalformedJsonWithoutThrowing()
    {
        var result = Rules.ParseRulesJson("{not json");
        Assert.Empty(result.Rules);
        Assert.Contains("not valid JSON", result.Errors[0]);
    }

    [Fact]
    public void ParseRulesJsonSurfacesARuleErrorWithoutDroppingTheValidRules()
    {
        var result = Rules.ParseRulesJson("[{\"match\":{\"appId\":\"a\"},\"tile\":\"full\"},{\"match\":{}}]");
        Assert.Single(result.Rules);
        Assert.Contains("tile", string.Join(' ', result.Errors));
    }

    private static RuleMigration Migrate(string json, bool rulesEnabled) =>
        Rules.MigrateRules(JsonNode.Parse(json), rulesEnabled);

    [Fact]
    public void MigrateRulesMovesALegacyFloatRuleToTheNeverTileListAndDropsIt()
    {
        var migration = Migrate("[{\"match\":{\"appId\":\"pavucontrol\"},\"float\":true}]", true);
        Assert.Equal(new[] { "pavucontrol" }, migration.NeverTile);
        Assert.Empty(migration.Rules);
        Assert.True(migration.Changed);
    }

    [Fact]
    public void MigrateRulesKeepsATileRuleAndStripsTheLegacyFloatFlag()
    {
        var migration = Migrate("[{\"match\":{\"appId\":\"a\"},\"tile\":\"left-half\",\"float\":true}]", true);
        Assert.Equal(new[] { "a" }, migration.NeverTile);
        Assert.Single(migration.Rules);
        Assert.Equal(TileMode.LeftHalf, migration.Rules[0].Tile);
        Assert.True(migration.Changed);
    }

    [Fact]
    public void MigrateRulesCarriesALegacyGlobalDisableIntoPerRuleEnabledFalse()
    {
        var migration = Migrate("[{\"match\":{\"appId\":\"a\"},\"tile\":\"full\"}]", false);
        Assert.False(migration.Rules[0].Enabled);
        Assert.True(migration.Changed);
    }

    [Fact]
    public void MigrateRulesDoesNotMigrateRuleFloatsWhenTheGlobalGateWasOff()
    {
        var migration = Migrate("[{\"match\":{\"appId\":\"a\"},\"float\":true}]", false);
        Assert.Empty(migration.NeverTile);
        Assert.Empty(migration.Rules);
    }

    [Fact]
    public void MigrateRulesIsANoOpOnceTheRulesAreInTheNewShape()
    {
        var migration = Migrate("[{\"match\":{\"appId\":\"a\"},\"tile\":\"full\"}]", true);
        Assert.False(migration.Changed);
        Assert.Empty(migration.NeverTile);
        Assert.Single(migration.Rules);
    }

    [Fact]
    public void MigrateRulesReportsAnInvalidEntryWithoutRewritingALegacyCleanList()
    {
        var migration = Migrate("[{\"match\":{},\"tile\":\"full\"}]", true);
        Assert.False(migration.Changed);
        Assert.Empty(migration.Rules);
        Assert.NotEmpty(migration.Errors);
    }

    [Fact]
    public void MigrateRulesJsonReportsMalformedJsonWithoutRewritingIt()
    {
        var migration = Rules.MigrateRulesJson("{not json", true);
        Assert.Empty(migration.Rules);
        Assert.False(migration.Changed);
        Assert.Contains("not valid JSON", migration.Errors[0]);
    }
}
