// Port of tests/core/session.test.ts, notify.test.ts, registry-file.test.ts.
using Adrt.Core;
using Xunit;

namespace Adrt.Core.Tests;

public class SessionTests
{
    [Fact]
    public void StartsInUserModeRunning()
    {
        var session = new SessionMachine();
        Assert.Equal(new SessionState { Mode = SessionMode.User, Paused = false }, session.State);
    }

    [Fact]
    public void PausesAndHidesTheIndicatorForTheLockScreen()
    {
        var session = new SessionMachine();
        var effects = session.SetMode(SessionMode.UnlockDialog);
        Assert.True(effects.Paused);
        Assert.False(effects.IndicatorVisible);
        Assert.Equal(IndicatorSuppression.Pause, effects.IndicatorSuppression);
        Assert.False(effects.ScanTickRunning);
        Assert.False(effects.RetileOnResume);
        Assert.True(session.IsPaused);
    }

    [Fact]
    public void KeepsTilingButHidesTheIndicatorWhileScreenSharing()
    {
        var session = new SessionMachine();
        var effects = session.SetMode(SessionMode.ScreenSharing);
        Assert.False(effects.Paused);
        Assert.True(effects.ScanTickRunning);
        Assert.False(effects.IndicatorVisible);
        Assert.Equal(IndicatorSuppression.Sharing, effects.IndicatorSuppression);
    }

    [Fact]
    public void EmitsAResumeRetileExactlyOnceWhenReturningToUser()
    {
        var session = new SessionMachine();
        session.SetMode(SessionMode.UnlockDialog);
        var resumed = session.SetMode(SessionMode.User);
        Assert.False(resumed.Paused);
        Assert.True(resumed.RetileOnResume);
        Assert.True(session.ConsumeRetile());
        Assert.False(session.ConsumeRetile());
        Assert.False(session.SetMode(SessionMode.User).RetileOnResume);
    }

    [Fact]
    public void DoesNotRetileWhenReturningFromScreenSharing()
    {
        var session = new SessionMachine();
        session.SetMode(SessionMode.ScreenSharing);
        Assert.False(session.SetMode(SessionMode.User).RetileOnResume);
    }

    [Fact]
    public void AnswersPausedTheSameWayThroughSetModeAndState()
    {
        var session = new SessionMachine();
        session.SetManualPause(true);
        Assert.True(session.SetMode(SessionMode.ScreenSharing).Paused);
        Assert.Equal(new SessionState { Mode = SessionMode.ScreenSharing, Paused = true }, session.State);
        session.SetManualPause(false);
        Assert.False(session.SetMode(SessionMode.ScreenSharing).Paused);
    }

    [Fact]
    public void ReturnsAStableStateViewUntilATransitionChangesIt()
    {
        var session = new SessionMachine();
        var initial = session.State;
        Assert.Same(initial, session.State);

        session.SetMode(SessionMode.UnlockDialog);
        Assert.NotSame(initial, session.State);
        Assert.Equal(new SessionState { Mode = SessionMode.UnlockDialog, Paused = true }, session.State);

        var locked = session.State;
        session.SetManualPause(true); // already paused by the mode, but the field flipped
        var pausedBoth = session.State;
        session.SetManualPause(true); // idempotent: no new view
        Assert.Same(pausedBoth, session.State);
        Assert.Equal(new SessionState { Mode = SessionMode.UnlockDialog, Paused = true }, session.State);

        session.SetMode(SessionMode.User);
        Assert.NotSame(locked, session.State);
        Assert.Equal(new SessionState { Mode = SessionMode.User, Paused = true }, session.State);
    }

    [Fact]
    public void FoldsAManualPauseIntoTheOnePredicateWithoutTouchingTheMode()
    {
        var session = new SessionMachine();
        session.SetManualPause(true);
        Assert.True(session.ManualPause);
        Assert.True(session.IsPaused);
        Assert.Equal(new SessionState { Mode = SessionMode.User, Paused = true }, session.State);
        session.SetMode(SessionMode.UnlockDialog);
        Assert.True(session.IsPaused);
        session.SetManualPause(false);
        Assert.True(session.IsPaused);
        session.SetMode(SessionMode.User);
        Assert.False(session.IsPaused);
    }
}

public class NotifyTests
{
    [Fact]
    public void NamesEveryDecisionInTheModelPhrasedAsTheDecision()
    {
        var keys = Notify.NoticeCatalogue.Select(n => n.Key).ToList();
        Assert.True(keys.Count >= 10);
        foreach (var key in new[]
        {
            "workspace-created", "did-not-fit", "sibling-adapted", "no-room-floats",
            "maximize-moved", "minimized-moved", "workspace-reaped", "screen-changed", "normalised",
        })
        {
            Assert.Contains(key, keys);
        }
        foreach (var entry in Notify.NoticeCatalogue)
        {
            Assert.True(entry.Title.Length > 0);
            Assert.False(entry.Title.EndsWith('?'));
        }
        Assert.True(Notify.NoticeCatalogue.Count(n => n.Title.Contains('→')) >= 8);
    }

    [Fact]
    public void KeepsTheNothingHappenedNoticesSeparateAndAlwaysOn()
    {
        Assert.True(Notify.NoticeAlways.Count >= 3);
        Assert.All(Notify.NoticeAlways, n => Assert.True(n.Always == true));
        Assert.All(Notify.NoticeCatalogue, n => Assert.True(n.Always != true));
        Assert.Contains("un-float", Notify.NoticeTitle("un-float-full"));
        Assert.Contains("resize-limit", Notify.NoticeAlways.Select(n => n.Key));
        Assert.Contains("limit", Notify.NoticeTitle("resize-limit"));
    }

    [Fact]
    public void ReturnsNullForAnUnknownKey()
    {
        Assert.Null(Notify.NoticeTitle("nope"));
    }

    [Fact]
    public void NoticeGateAllowsABurstOncePerSubjectAndDedupesInsideTheWindow()
    {
        var gate = new NoticeGate(2000, 3, 10000);
        Assert.True(gate.Allow("did-not-fit", "win-1", 1000));
        Assert.False(gate.Allow("did-not-fit", "win-1", 1500));
        Assert.False(gate.Allow("did-not-fit", "win-1", 2900));
        Assert.True(gate.Allow("did-not-fit", "win-1", 4000));
    }

    [Fact]
    public void NoticeGateTreatsSubjectsIndependently()
    {
        var gate = new NoticeGate(2000, 3, 10000);
        Assert.True(gate.Allow("no-room-floats", "win-1", 0));
        Assert.True(gate.Allow("no-room-floats", "win-2", 0));
        Assert.True(gate.Allow("no-room-floats", "win-3", 0));
        Assert.False(gate.Allow("no-room-floats", "win-4", 0));
    }

    [Fact]
    public void NoticeGateCapsABurstAtTheWindowLimitEvenAcrossKeysAndSubjects()
    {
        var gate = new NoticeGate(1, 3, 10000);
        Assert.True(gate.Allow("workspace-created", "w1", 0));
        Assert.True(gate.Allow("workspace-reaped", "w2", 1));
        Assert.True(gate.Allow("screen-changed", "w3", 2));
        Assert.False(gate.Allow("did-not-fit", "w4", 3));
        Assert.True(gate.Allow("did-not-fit", "w4", 10001));
    }

    [Fact]
    public void NoticeGateForgetsNothingUntilTheWindowPassesAndNeverGrowsWithoutBound()
    {
        var gate = new NoticeGate(100, 10, 1000);
        for (var i = 0; i < 500; i += 1) gate.Allow("workspace-reaped", $"w{i}", i * 10);
        Assert.True(gate.Size <= 200);
    }
}

public class RegistryFileTests
{
    [Fact]
    public void NeverAsksStartupToParseAFileAboveTheCap()
    {
        Assert.Equal(RegistryFileActionKind.Missing, RegistryFile.RegistryFileAction(null));
        Assert.Equal(RegistryFileActionKind.Load, RegistryFile.RegistryFileAction(0));
        Assert.Equal(RegistryFileActionKind.Load, RegistryFile.RegistryFileAction(AppRegistry.MaxRegistryBytes));
        Assert.Equal(RegistryFileActionKind.Quarantine, RegistryFile.RegistryFileAction(AppRegistry.MaxRegistryBytes + 1));
    }

    [Fact]
    public void QuarantinesTheConfirmed201MbRegistryWithoutReadingIt()
    {
        Assert.Equal(RegistryFileActionKind.Quarantine, RegistryFile.RegistryFileAction(201_466_735));
    }

    [Fact]
    public void HonoursASmallerCapForTestsAndImports()
    {
        Assert.Equal(RegistryFileActionKind.Quarantine, RegistryFile.RegistryFileAction(2_000, 1_000));
        Assert.Equal(RegistryFileActionKind.Load, RegistryFile.RegistryFileAction(1_000, 1_000));
    }

    [Fact]
    public void TreatsAnUnreadableSizeAsMissingNotAsAnEmptyExistingFile()
    {
        Assert.Equal(RegistryFileActionKind.Missing, RegistryFile.RegistryFileAction(double.NaN));
        Assert.Equal(RegistryFileActionKind.Missing, RegistryFile.RegistryFileAction(-1));
    }

    [Fact]
    public void NamesTheBackupWithItsReasonAndASortableTimestamp()
    {
        Assert.Equal(
            "registry.oversize-20261018-123830.json.gz",
            RegistryFile.QuarantineFileName(
                RegistryQuarantineReason.Oversize,
                new DateTimeOffset(new DateTime(2026, 10, 18, 12, 38, 30))));
        Assert.Equal(
            "registry.corrupt-20260102-030405.json.gz",
            RegistryFile.QuarantineFileName(
                RegistryQuarantineReason.Corrupt,
                new DateTimeOffset(new DateTime(2026, 1, 2, 3, 4, 5))));
    }

    [Fact]
    public void RegistryBytesCountsUtf8BytesNotJsStringUnits()
    {
        Assert.Equal(4, RegistryFile.RegistryBytes("é")); // the JSON string quotes plus two bytes
        Assert.Equal(
            System.Text.Encoding.UTF8.GetByteCount("{\"title\":\"日本語\"}"),
            RegistryFile.RegistryBytes(new Dictionary<string, object?> { ["title"] = "日本語" }));
    }
}
