// Two tests/core/types.test.ts cases assert JavaScript object identity: the
// returned rect must be a *fresh object* and mutating it must not touch the
// input. In C# `Rect` is a readonly record struct with value semantics, so
// neither aliasing nor mutation is representable. The value assertions from
// both cases are covered by TypesTests.

using Xunit;

namespace Adrt.Core.Tests;

public class ImmutableValueTests
{
    private const string Reason =
        "Rect is a readonly record struct (value semantics): a fresh reference copy and input aliasing do not exist.";

    [Fact(Skip = Reason)]
    public void ClampRectToAreaReturnsAFreshCopyWithUnchangedCoordinatesWhenAlreadyInside()
    {
    }

    [Fact(Skip = Reason)]
    public void ClampRectToAreaDoesNotAliasTheInputSoMutatingTheResultLeavesTheInputIntact()
    {
    }
}
