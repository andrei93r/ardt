namespace Adrt.Windows.Input;

/// <summary>What happened to one binding during registration.</summary>
/// <param name="Binding">The table entry.</param>
/// <param name="Registration">The OS outcome (<c>Registered=false</c> on conflict).</param>
/// <param name="Conflict">Set when the table itself contains the same combination.</param>
internal readonly record struct HotkeyRegistrationResult(
    HotkeyBinding Binding,
    HotkeyRegistration Registration,
    HotkeyBinding? Conflict);

/// <summary>
/// Registers <see cref="HotkeyTable.Default"/> and reports every outcome.
/// </summary>
/// <remarks>
/// <para>
/// A refused combination is normal on Windows: the shell, an IME, a vendor
/// utility or another tiling app may own it. The host keeps running with the
/// keys it did get, which is why this returns results instead of throwing.
/// When a row has <see cref="HotkeyBinding.Fallbacks"/>, the registrar tries
/// them in order after a refusal, so the action stays reachable.
/// </para>
/// <para>
/// The default table is also audited for internal duplicates before the OS is
/// asked. A duplicate would otherwise show up as
/// <c>ERROR_HOTKEY_ALREADY_REGISTERED</c> and look like an external conflict,
/// hiding the real bug (two rows wanting the same key). Fallbacks participate
/// in the audit: the table must not declare the same combination twice, even
/// when one of the two is only a fallback.
/// </para>
/// </remarks>
internal static class HotkeyRegistrar
{
    /// <summary><c>ERROR_HOTKEY_ALREADY_REGISTERED</c>; kept local so the input lane does not depend on host internals.</summary>
    private const int HotkeyAlreadyRegistered = 1409;

    /// <summary>Register every default binding on the calling thread.</summary>
    /// <param name="hotkeys">Manager owned by the thread that pumps <c>WM_HOTKEY</c>.</param>
    /// <param name="log">Receives one line per accepted or refused binding.</param>
    public static IReadOnlyList<HotkeyRegistrationResult> RegisterDefaults(
        HotkeyManager hotkeys,
        Action<string> log)
    {
        ArgumentNullException.ThrowIfNull(hotkeys);
        ArgumentNullException.ThrowIfNull(log);

        Dictionary<int, HotkeyBinding> duplicates = FindDuplicates(log);
        var results = new List<HotkeyRegistrationResult>(HotkeyTable.Default.Count);

        foreach (HotkeyBinding binding in HotkeyTable.Default)
        {
            if (duplicates.TryGetValue(binding.Id, out HotkeyBinding? first))
            {
                results.Add(new HotkeyRegistrationResult(
                    binding,
                    new HotkeyRegistration(
                        binding.Id,
                        binding.Modifiers,
                        binding.VirtualKey,
                        false,
                        HotkeyAlreadyRegistered,
                        "duplicate combination in the default table"),
                    first));
                continue;
            }

            List<(HotkeyModifiers Modifiers, uint VirtualKey)> combinations = Combinations(binding);
            HotkeyRegistration? accepted = null;
            HotkeyRegistration primaryFailure = default;
            var refused = new List<string>(combinations.Count);

            foreach ((HotkeyModifiers modifiers, uint virtualKey) in combinations)
            {
                HotkeyRegistration registration = hotkeys.Register(
                    binding.Id,
                    modifiers | HotkeyModifiers.NoRepeat,
                    virtualKey);

                if (registration.Registered)
                {
                    accepted = registration;
                    break;
                }

                if (refused.Count == 0) primaryFailure = registration;
                refused.Add(FormattableString.Invariant(
                    $"{Describe(modifiers, virtualKey)} unavailable ({registration.Error})"));
            }

            if (accepted is { } active)
            {
                results.Add(new HotkeyRegistrationResult(binding, active, null));

                if (refused.Count == 0)
                {
                    log(FormattableString.Invariant(
                        $"adrt: {Describe(binding)} registered ({binding.Label}; {binding.Trigger})."));
                }
                else
                {
                    // Both attempts in one line: what was refused, what replaced it.
                    log(FormattableString.Invariant(
                        $"adrt: {string.Join("; ", refused)}; using {Describe(active.Modifiers, active.VirtualKey)} ({binding.Label})."));
                }
            }
            else
            {
                results.Add(new HotkeyRegistrationResult(binding, primaryFailure, null));
                log(FormattableString.Invariant(
                    $"adrt: {string.Join("; ", refused)}; continuing without {binding.Label}."));
            }
        }

        return results;
    }

    /// <summary>Render a binding exactly as the registrar logs it.</summary>
    public static string Describe(HotkeyBinding binding) =>
        Describe(binding.Modifiers, binding.VirtualKey);

    private static string Describe(HotkeyModifiers modifiers, uint virtualKey) =>
        HotkeyManager.Describe(WithoutNoRepeat(modifiers), virtualKey);

    /// <summary>
    /// Check every declared combination (primary and fallback) for duplicates
    /// before the OS is contacted. Returns the first conflicting row per
    /// binding id; such rows are not registered at all.
    /// </summary>
    private static Dictionary<int, HotkeyBinding> FindDuplicates(Action<string> log)
    {
        var seen = new Dictionary<(HotkeyModifiers Modifiers, uint VirtualKey), HotkeyBinding>();
        var duplicates = new Dictionary<int, HotkeyBinding>();

        foreach (HotkeyBinding binding in HotkeyTable.Default)
        {
            List<(HotkeyModifiers Modifiers, uint VirtualKey)> combinations = Combinations(binding);
            HotkeyBinding? conflict = null;

            foreach ((HotkeyModifiers modifiers, uint virtualKey) in combinations)
            {
                if (!seen.TryGetValue((modifiers, virtualKey), out HotkeyBinding? first)) continue;

                conflict = first;
                string combination = Describe(modifiers, virtualKey);
                log(FormattableString.Invariant(
                    $"adrt: hotkey {combination} ({binding.Label}) conflicts with {combination} ({first.Label}) in the default table; skipped."));
                break;
            }

            if (conflict is not null)
            {
                duplicates[binding.Id] = conflict;
                continue;
            }

            foreach ((HotkeyModifiers modifiers, uint virtualKey) in combinations)
            {
                seen[(modifiers, virtualKey)] = binding;
            }
        }

        return duplicates;
    }

    /// <summary>The primary combination followed by any fallbacks, in try order.</summary>
    private static List<(HotkeyModifiers Modifiers, uint VirtualKey)> Combinations(HotkeyBinding binding)
    {
        var combinations = new List<(HotkeyModifiers Modifiers, uint VirtualKey)>(
            1 + (binding.Fallbacks?.Count ?? 0))
        {
            (WithoutNoRepeat(binding.Modifiers), binding.VirtualKey),
        };

        if (binding.Fallbacks is null) return combinations;

        foreach (HotkeyFallback fallback in binding.Fallbacks)
        {
            combinations.Add((WithoutNoRepeat(fallback.Modifiers), fallback.VirtualKey));
        }

        return combinations;
    }

    private static HotkeyModifiers WithoutNoRepeat(HotkeyModifiers modifiers) =>
        modifiers & ~HotkeyModifiers.NoRepeat;
}
