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
/// </para>
/// <para>
/// The default table is also audited for internal duplicates before the OS is
/// asked. A duplicate would otherwise show up as
/// <c>ERROR_HOTKEY_ALREADY_REGISTERED</c> and look like an external conflict,
/// hiding the real bug (two rows wanting the same key).
/// </para>
/// </remarks>
internal static class HotkeyRegistrar
{
    /// <summary>Register every default binding on the calling thread.</summary>
    /// <param name="hotkeys">Manager owned by the thread that pumps <c>WM_HOTKEY</c>.</param>
    /// <param name="log">Receives one line per accepted or refused binding.</param>
    public static IReadOnlyList<HotkeyRegistrationResult> RegisterDefaults(
        HotkeyManager hotkeys,
        Action<string> log)
    {
        ArgumentNullException.ThrowIfNull(hotkeys);
        ArgumentNullException.ThrowIfNull(log);

        var results = new List<HotkeyRegistrationResult>(HotkeyTable.Default.Count);
        var byCombination = new Dictionary<(HotkeyModifiers, uint), HotkeyBinding>();

        foreach (HotkeyBinding binding in HotkeyTable.Default)
        {
            (HotkeyModifiers, uint) combination =
                (WithoutNoRepeat(binding.Modifiers), binding.VirtualKey);

            if (byCombination.TryGetValue(combination, out HotkeyBinding? first))
            {
                log(FormattableString.Invariant(
                    $"adrt: hotkey {Describe(binding)} ({binding.Label}) conflicts with {Describe(first)} ({first.Label}) in the default table; skipped."));
                results.Add(new HotkeyRegistrationResult(
                    binding,
                    new HotkeyRegistration(
                        binding.Id,
                        binding.Modifiers,
                        binding.VirtualKey,
                        false,
                        NativeMethods.ERROR_HOTKEY_ALREADY_REGISTERED,
                        "duplicate combination in the default table"),
                    first));
                continue;
            }

            HotkeyRegistration registration = hotkeys.Register(
                binding.Id,
                binding.Modifiers | HotkeyModifiers.NoRepeat,
                binding.VirtualKey);

            results.Add(new HotkeyRegistrationResult(binding, registration, null));
            if (registration.Registered)
            {
                byCombination.Add(combination, binding);
                log(FormattableString.Invariant(
                    $"adrt: {Describe(binding)} registered ({binding.Label}; {binding.Trigger})."));
            }
            else
            {
                log(FormattableString.Invariant(
                    $"adrt: {Describe(binding)} unavailable ({registration.Error}); continuing without {binding.Label}."));
            }
        }

        return results;
    }

    /// <summary>Render a binding exactly as the registrar logs it.</summary>
    public static string Describe(HotkeyBinding binding) =>
        HotkeyManager.Describe(WithoutNoRepeat(binding.Modifiers), binding.VirtualKey);

    private static HotkeyModifiers WithoutNoRepeat(HotkeyModifiers modifiers) =>
        modifiers & ~HotkeyModifiers.NoRepeat;
}
