// Port of src/core/drag.ts. Keep names and semantics 1:1 with the TypeScript.
using System.Text.Json.Serialization;

namespace Adrt.Core;

[JsonPolymorphic(TypeDiscriminatorPropertyName = "kind")]
[JsonDerivedType(typeof(SlotDragOutcome), "slot")]
[JsonDerivedType(typeof(MaximizeDragOutcome), "maximize")]
[JsonDerivedType(typeof(SwapDragOutcome), "swap")]
[JsonDerivedType(typeof(FloatDragOutcome), "float")]
[JsonDerivedType(typeof(NoneDragOutcome), "none")]
public abstract record DragOutcome
{
    [JsonPropertyName("workspace")] public required int Workspace { get; init; }
    [JsonPropertyName("rect")] public required Rect Rect { get; init; }
}

public sealed record SlotDragOutcome : DragOutcome
{
    [JsonPropertyName("slot")] public required int Slot { get; init; }
}

public sealed record MaximizeDragOutcome : DragOutcome;

public sealed record SwapDragOutcome : DragOutcome
{
    [JsonPropertyName("with")] public required int With { get; init; }
}

public sealed record FloatDragOutcome : DragOutcome;

public sealed record NoneDragOutcome : DragOutcome;

public sealed record DragInput
{
    [JsonPropertyName("state")] public required State State { get; init; }
    [JsonPropertyName("env")] public required Env Env { get; init; }
    [JsonPropertyName("id")] public required int Id { get; init; }
    [JsonPropertyName("workspace")] public required int Workspace { get; init; }
    [JsonPropertyName("from")] public Direction? From { get; init; }
    [JsonPropertyName("crossed")] public int? Crossed { get; init; }

    /// <summary>
    /// §6: whether the dragged window is a *managed* window — one that can occupy
    /// a tile. A drag of a window that cannot (a dialog, a popup, a skip-taskbar
    /// utility, an always-on-top widget, a fixed-size client, an exception app, or
    /// a window the user floated) has no landing decision at all.
    /// </summary>
    [JsonPropertyName("managed")] public required bool Managed { get; init; }

    /// <summary>The drag has stayed on its own workspace and screen (§6).</summary>
    [JsonPropertyName("samePlane")] public required bool SamePlane { get; init; }

    /// <summary>The screen receiving the drop.</summary>
    [JsonPropertyName("screen")] public required Screen Screen { get; init; }

    [JsonPropertyName("config")] public required TilerConfig Config { get; init; }

    /// <summary>The dragged window's own description, including its current side.</summary>
    [JsonPropertyName("dragged")] public required TilerWindow Dragged { get; init; }

    /// <summary>The other tileable windows on that screen, keyed by workspace.</summary>
    [JsonPropertyName("othersByWorkspace")]
    public required IReadOnlyDictionary<int, IReadOnlyList<TilerWindow>> OthersByWorkspace { get; init; }

    /// <summary>The dragged window's rect as dropped.</summary>
    [JsonPropertyName("dropped")] public required Rect Dropped { get; init; }
}

/// <summary>
/// §6/§11: the one drag decision, pure. Given the drag state and the live
/// geometry it returns where the dragged window will land — the same result the
/// drop applies, so the drop-assist preview can never disagree with the drop.
///
/// A same-plane move that crosses a sibling swaps; one that crosses nothing
/// returns to its own tile. A cross-plane drop follows `dropPlacement`. The target
/// rect is the tiler's own layout for the hypothetical post-drop workspace, so
/// the outline is exactly the rect the window lands in.
/// </summary>
public static class Drag
{
    /// <summary>
    /// The rect the dragged window takes after `decision` is applied, or `null` when
    /// the drag has no landing decision at all (§6).
    /// </summary>
    public static DragOutcome? DragOutcome(DragInput input)
    {
        // §6: only a *managed* window crosses and swaps. A window that cannot occupy
        // a tile has no landing: no drop-assist highlight (the overlay hides on a
        // `null` target) and no swap/slot/maximize on the drop. Dragging it is a
        // plain move. A free slot or a crossing must never be offered for it.
        if (!input.Managed) return null;

        Rect Result(IReadOnlyList<TilerWindow> windows)
        {
            var plan = Tiler.ComputePlans(windows, input.Screen, input.Config);
            return plan.Placements.FirstOrDefault(placement => placement.SurfaceId == input.Id)?.Rect ?? input.Dropped;
        }

        IReadOnlyList<TilerWindow> Others(int workspace) =>
            input.OthersByWorkspace.TryGetValue(workspace, out var list) ? list : Array.Empty<TilerWindow>();

        TilerWindow Dragged(int? slot = null) =>
            slot is null ? input.Dragged : input.Dragged with { Slot = slot };

        Rect Swap(int workspace, int withId)
        {
            var partner = Others(workspace).FirstOrDefault(w => w.Id == withId);
            var (draggedSlot, partnerSlot) = PlacementPolicy.SwappedSides(input.Id, input.Dragged.Slot, withId, partner?.Slot);
            var list = Others(workspace).Select(w => w.Id == withId ? w with { Slot = partnerSlot } : w);
            return Result(list.Append(Dragged(draggedSlot)).ToList());
        }

        if (input.SamePlane)
        {
            if (input.Crossed is not null)
            {
                var crossed = input.Crossed.Value;
                return new SwapDragOutcome
                {
                    Workspace = input.Workspace,
                    With = crossed,
                    Rect = Swap(input.Workspace, crossed),
                };
            }
            return new NoneDragOutcome
            {
                Workspace = input.Workspace,
                Rect = Result(Others(input.Workspace).Append(Dragged()).ToList()),
            };
        }

        var decision = PlacementPolicy.DropPlacement(input.State, input.Env, input.Id, input.Workspace, input.From, input.Crossed);
        switch (decision)
        {
            case SlotDropResult slot:
            {
                // The free slot wins: the resident takes the other side of the pair.
                var partnerSlot = slot.Slot == 0 ? 1 : 0;
                var list = Others(slot.Workspace)
                    .Select((w, index) => index == 0 ? w with { Slot = partnerSlot } : w);
                return new SlotDragOutcome
                {
                    Workspace = slot.Workspace,
                    Slot = slot.Slot,
                    Rect = Result(list.Append(Dragged(slot.Slot)).ToList()),
                };
            }
            case MaximizeDropResult maximize:
                return new MaximizeDragOutcome
                {
                    Workspace = maximize.Workspace,
                    Rect = Result(new[] { Dragged() }),
                };
            case SwapDropResult swap:
                return new SwapDragOutcome
                {
                    Workspace = swap.Workspace,
                    With = swap.With,
                    Rect = Swap(swap.Workspace, swap.With),
                };
            case FloatDropResult floatResult:
                return new FloatDragOutcome
                {
                    Workspace = floatResult.Workspace,
                    Rect = input.Dropped,
                };
        }
        return null;
    }
}
