using System.Globalization;

namespace Adrt.Windows.Input;

/// <summary>
/// Input + chrome switches resolved from the command line and the environment.
/// </summary>
/// <remarks>
/// <para>
/// The border is on by default: the W5 chrome is part of the product surface and
/// a silent opt-in would leave it undiscovered. <c>--no-border</c> (or
/// <c>ADRT_BORDER=0</c>) turns it off for the session; the
/// <c>Ctrl+Alt+B</c> hotkey can still bring it back at runtime.
/// </para>
/// <para>
/// No settings file exists yet (W6), so the command line is the config switch
/// this stage can honour. Unknown arguments are ignored, as they were before
/// W5, so the existing invocations keep working.
/// </para>
/// </remarks>
internal sealed record InputOptions
{
    /// <summary>The <c>nudge-step</c> default from the settings descriptor (10%).</summary>
    public const double DefaultNudgeStep = 0.10;

    /// <summary>Lowest and highest share the keyboard nudge allows (the core's 5-95% rule).</summary>
    private const double MinNudgeStep = 0.01;
    private const double MaxNudgeStep = 0.50;

    /// <summary>Whether the focus border overlay is enabled at startup.</summary>
    public required bool BorderEnabled { get; init; }

    /// <summary>Share of the work area a single nudge moves the shared edge, 0.01-0.50.</summary>
    public required double NudgeStep { get; init; }

    /// <summary>Parse the switches this stage understands; never throws on unknown input.</summary>
    public static InputOptions Parse(IReadOnlyList<string> args)
    {
        ArgumentNullException.ThrowIfNull(args);

        bool border = ReadBorderEnvironment() ?? true;
        double nudge = DefaultNudgeStep;

        foreach (string argument in args)
        {
            if (argument.Equals("--no-border", StringComparison.OrdinalIgnoreCase))
            {
                border = false;
            }
            else if (argument.Equals("--border", StringComparison.OrdinalIgnoreCase))
            {
                border = true;
            }
            else if (TryReadValue(argument, "--border=", out string borderValue))
            {
                if (TryParseBool(borderValue) is { } parsed) border = parsed;
            }
            else if (TryReadValue(argument, "--nudge-step=", out string stepValue))
            {
                if (double.TryParse(
                        stepValue,
                        NumberStyles.Float,
                        CultureInfo.InvariantCulture,
                        out double parsed) &&
                    double.IsFinite(parsed))
                {
                    nudge = Math.Clamp(parsed, MinNudgeStep, MaxNudgeStep);
                }
            }
        }

        return new InputOptions { BorderEnabled = border, NudgeStep = nudge };
    }

    /// <summary>One-line description for the startup log.</summary>
    public string Describe() => FormattableString.Invariant(
        $"border {(BorderEnabled ? "on" : "off")} (Ctrl+Alt+B toggles), nudge step {NudgeStep:P0}");

    private static bool? ReadBorderEnvironment() =>
        TryParseBool(Environment.GetEnvironmentVariable("ADRT_BORDER"));

    private static bool TryReadValue(string argument, string prefix, out string value)
    {
        if (argument.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
        {
            value = argument[prefix.Length..].Trim();
            return true;
        }

        value = string.Empty;
        return false;
    }

    private static bool? TryParseBool(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        return text.Trim().ToLowerInvariant() switch
        {
            "1" or "true" or "on" or "yes" => true,
            "0" or "false" or "off" or "no" => false,
            _ => null,
        };
    }
}
