// Port of src/core/scheduler.ts. Keep names and semantics 1:1 with the TypeScript.
using System.Globalization;

namespace Adrt.Core;

/// <summary>
/// Signature-based skip (§6, §24 item 4). Pure data structures; the adapter
/// owns the timer that drains the queue (<c>core/queue.ts</c>).
/// </summary>
public sealed class SignatureCache
{
    private readonly Dictionary<string, string> _signatures = new(StringComparer.Ordinal);

    /// <summary>True when the signature differs from the cached one (and updates it).</summary>
    public bool Changed(string key, string signature)
    {
        if (_signatures.TryGetValue(key, out var previous) && previous == signature) return false;
        _signatures[key] = signature;
        return true;
    }

    public string? Peek(string key) => _signatures.GetValueOrDefault(key);

    public void Clear(string key) => _signatures.Remove(key);

    public void ClearAll() => _signatures.Clear();

    public int Size => _signatures.Count;
}

/// <summary>Stable signature for a computed plan, used by the signature cache.</summary>
public static class Scheduler
{
    public static string PlanSignature(IReadOnlyList<Placement> placements) =>
        string.Join(';', placements.Select(placement =>
            $"{placement.SurfaceId.ToString(CultureInfo.InvariantCulture)}:" +
            $"{Number(placement.Rect.X)},{Number(placement.Rect.Y)}," +
            $"{Number(placement.Rect.Width)},{Number(placement.Rect.Height)}"));

    /// <summary>
    /// Whether a computed plan should be applied, from its pure inputs.
    ///
    /// <paramref name="changed"/> is true when the plan differs from the last one
    /// applied for its workspace — but the per-workspace cache can also be cleared
    /// by an unrelated signal (a title or frame change), which makes
    /// <paramref name="changed"/> true for a plan that is byte-identical to the one
    /// already applied. When the windows already aim at exactly this plan
    /// (<paramref name="alreadyTargeted"/>) and none has genuinely drifted
    /// (<paramref name="mismatch"/>), re-applying it would restart the frame
    /// animation from a mid-transition rect — the "overshoot then corrects". So an
    /// unchanged, already-targeted plan is adopted without re-applying; a real
    /// drift (<paramref name="mismatch"/>) still applies.
    /// </summary>
    public static bool ShouldApplyPlan(bool mismatch, bool changed, bool alreadyTargeted)
    {
        if (!mismatch && !changed) return false;
        if (!mismatch && alreadyTargeted) return false;
        return true;
    }

    /// <summary>JS <c>Number#toString</c> for the values a plan can hold (integral doubles stay bare).</summary>
    private static string Number(double value) =>
        value == 0 ? "0" : value.ToString("R", CultureInfo.InvariantCulture);
}
