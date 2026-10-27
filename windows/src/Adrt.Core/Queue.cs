// Port of src/core/queue.ts. Keep names and semantics 1:1 with the TypeScript.
namespace Adrt.Core;

/// <summary>The three priority lanes (§11).</summary>
public enum Lane
{
    /// <summary>1 — focus, border, marker: the cheapest, most visible.</summary>
    Feedback = 1,

    /// <summary>2 — route, plan, apply, workspace create/reap, view shift.</summary>
    Layout = 2,

    /// <summary>3 — reap, persist, work-area refresh, sweep.</summary>
    Maintenance = 3,
}

public sealed class QueuedEvent
{
    public required Lane Lane { get; init; }
    public required string Key { get; init; }
    public required string Kind { get; set; }
    public Dictionary<string, object?>? Data { get; set; }

    /// <summary>When it was enqueued, from the injected clock.</summary>
    public double At { get; set; }
}

/// <summary>
/// The one scheduling path (§11). Every signal handler pushes an event; a single
/// deferred drain runs the policy. Three lanes give a stable priority order:
///
///   1 feedback     focus, border, marker — the cheapest, most visible
///   2 layout       route, plan, apply, workspace create/reap, view shift
///   3 maintenance  reap, persist, work-area refresh, sweep
///
/// Pushing the same <b>key</b> before a drain coalesces: the latest payload wins and
/// the entry keeps its earliest position, so a burst of signals for one window
/// costs one pass. That is what makes a signal storm harmless.
///
/// The queue owns no timers: <c>Push</c> says whether the caller must arm the drain
/// (it was empty), and the drain empties the queue.
///
/// Data structure (§5.11): three fixed lanes, each an insertion-ordered map keyed
/// by the coalescing key, plus a key→lane index. This beats a heap at this scale:
/// a heap would lose the coalescing invariant (one entry per key, earliest
/// position, newest payload) and charges O(log n) per push for an ordering the
/// three lanes already give for free. Do not replace it with a heap.
/// </summary>
public sealed class EventQueue
{
    private static readonly Lane[] Lanes = [Lane.Feedback, Lane.Layout, Lane.Maintenance];

    // An insertion-ordered map over the three lane numbers: the lane number
    // indexes the map directly, and enumeration is insertion order like a JS Map.
    private readonly OrderedDictionary<Lane, OrderedDictionary<string, QueuedEvent>> _lanes = new()
    {
        [Lane.Feedback] = new OrderedDictionary<string, QueuedEvent>(StringComparer.Ordinal),
        [Lane.Layout] = new OrderedDictionary<string, QueuedEvent>(StringComparer.Ordinal),
        [Lane.Maintenance] = new OrderedDictionary<string, QueuedEvent>(StringComparer.Ordinal),
    };

    /// <summary>
    /// key → lane holding it, so <c>Has</c> is O(1) instead of scanning all three
    /// lanes. The same key may sit in two lanes at once (that is two events, not a
    /// coalesce); the index then keeps the last lane. It is removed only when every
    /// lane is emptied, which <c>Drain</c>/<c>Clear</c> always do together, so the
    /// index never outlives its entry.
    /// </summary>
    private readonly Dictionary<string, Lane> _laneOf = new(StringComparer.Ordinal);

    /// <summary>
    /// Reused by <c>Drain</c> so a pass allocates no array. Ownership contract: the
    /// returned list is valid until the next <c>Drain()</c> and must not be retained;
    /// the only caller (<c>session.runDrain</c>) iterates it synchronously and drops it.
    /// </summary>
    private readonly List<QueuedEvent> _drained = [];

    private readonly TimeProvider _time;
    private int _count;

    public EventQueue(TimeProvider? time = null)
    {
        _time = time ?? TimeProvider.System;
    }

    /// <summary>How many events are waiting.</summary>
    public int Pending => _count;

    /// <summary>Whether pushing this key/lane would arm the drain (the queue was empty).</summary>
    public bool Push(Lane lane, string key, string kind, Dictionary<string, object?>? data = null)
    {
        var wasEmpty = _count == 0;
        var laneMap = LaneMap(lane);
        if (laneMap is null) return wasEmpty;
        if (laneMap.TryGetValue(key, out var existing))
        {
            // Coalesced: keep its place in the lane, take the newest payload.
            existing.Kind = kind;
            existing.Data = data;
            existing.At = Now();
        }
        else
        {
            laneMap[key] = new QueuedEvent { Lane = lane, Key = key, Kind = kind, Data = data, At = Now() };
            _laneOf[key] = lane;
            _count += 1;
        }
        return wasEmpty;
    }

    /// <summary>O(1): the key→lane index decides presence.</summary>
    public bool Has(string key) => _laneOf.ContainsKey(key);

    public int Depth(Lane lane) => LaneMap(lane)?.Count ?? 0;

    /// <summary>The lowest-numbered non-empty lane: the one the drain should start with.</summary>
    public Lane? HighestLane()
    {
        foreach (var lane in Lanes)
        {
            if ((LaneMap(lane)?.Count ?? 0) > 0) return lane;
        }
        return null;
    }

    /// <summary>
    /// Take everything, in lane order and then in insertion order. The result is
    /// the queue's reused buffer: valid until the next <c>Drain()</c>.
    /// </summary>
    public IReadOnlyList<QueuedEvent> Drain()
    {
        var output = _drained;
        output.Clear();
        foreach (var lane in Lanes)
        {
            var laneMap = LaneMap(lane);
            if (laneMap is null) continue;
            foreach (var queuedEvent in laneMap.Values) output.Add(queuedEvent);
            laneMap.Clear();
        }
        _laneOf.Clear();
        _count = 0;
        return output;
    }

    public void Clear()
    {
        foreach (var lane in Lanes) LaneMap(lane)?.Clear();
        _laneOf.Clear();
        _count = 0;
    }

    /// <summary>
    /// The oldest (worst-case) age in a drained batch, for the perf counters. A
    /// batch coalesces one entry per key retaining its earliest position, so the
    /// oldest timestamp is the longest any event waited before this drain.
    /// </summary>
    public double DrainAge(double now, IReadOnlyList<QueuedEvent> drained)
    {
        var oldest = now;
        foreach (var queuedEvent in drained) oldest = Math.Min(oldest, queuedEvent.At);
        return Math.Max(0, now - oldest);
    }

    private double Now() => _time.GetUtcNow().ToUnixTimeMilliseconds();

    /// <summary>The lane's map, or null for a number outside <see cref="Lane"/> (defensive).</summary>
    private OrderedDictionary<string, QueuedEvent>? LaneMap(Lane lane) => lane switch
    {
        Lane.Feedback or Lane.Layout or Lane.Maintenance => _lanes[lane],
        _ => null,
    };
}
