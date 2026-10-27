// Cases from tests/core that are genuinely platform-specific and have no
// Adrt.Core target. Each one is kept as a skipped fact so the gap is visible
// rather than silently dropped.

using Xunit;

namespace Adrt.Core.Tests;

public class PlatformSpecificTests
{
    private const string PurityReason =
        "The TS case exercises scripts/check-core-purity.sh against a temporary src/core tree. " +
        "The Windows equivalent is windows/tests/Adrt.Architecture.Tests/CorePurityTests.cs.";

    private const string ShellDriftReason =
        "The TS case scans the GNOME/GJS adapter sources in src/adapters/gnome; Adrt.Core has no such adapter.";

    private const string TrackedWindowReason =
        "The TS case tests src/adapters/gnome/tracked-window.ts; no Adrt.Core type corresponds to it.";

    [Fact(Skip = PurityReason)]
    public void PurityGatePassesACoreThatReadsNothingFromTheOutsideWorld()
    {
    }

    [Fact(Skip = PurityReason)]
    public void PurityGateAcceptsTheClockInjectionSeam()
    {
    }

    [Fact(Skip = PurityReason)]
    public void PurityGateAcceptsASeamThatContinuesASignatureOnTheNextLine()
    {
    }

    [Fact(Skip = PurityReason)]
    public void PurityGateAcceptsADateBuiltFromExplicitComponents()
    {
    }

    [Fact(Skip = PurityReason)]
    public void PurityGateAcceptsACommentThatMerelyNamesTheApi()
    {
    }

    [Fact(Skip = PurityReason)]
    public void PurityGateStillRejectsAWallClockReadOutsideASeam()
    {
    }

    [Fact(Skip = PurityReason)]
    public void PurityGateStillRejectsDateNowMathRandomAndIoOutsideASeam()
    {
    }

    [Fact(Skip = ShellDriftReason)]
    public void ShellAdapterSourcesArePresent()
    {
    }

    [Fact(Skip = ShellDriftReason)]
    public void ShellAdapterNeverBuildsAnStBoxLayoutWithTheRemovedVerticalProperty()
    {
    }

    [Fact(Skip = ShellDriftReason)]
    public void ShellAdapterBuildsAVerticalBoxWithTheOrientationTheShellUnderstands()
    {
    }

    [Fact(Skip = ShellDriftReason)]
    public void ShellAdapterKeepsTheGrabHandleThatPushModalReturns()
    {
    }

    [Fact(Skip = ShellDriftReason)]
    public void ShellAdapterPassesAnActionModeToEveryPushModalCall()
    {
    }

    [Fact(Skip = TrackedWindowReason)]
    public void TrackedWindowStartsOnTheDefaultProfileBeforeTheAppClassIsKnown()
    {
    }

    [Fact(Skip = TrackedWindowReason)]
    public void TrackedWindowReDerivesTheFamilyProfileOnceTheIdentityIsResolved()
    {
    }

    [Fact(Skip = TrackedWindowReason)]
    public void TrackedWindowPrefersTheResolvedIdentityKeyOverTheRawAppId()
    {
    }
}
