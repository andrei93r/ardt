using System.Security.Principal;

namespace Adrt.Cli;

/// <summary>
/// The named-pipe address shared by the app and <c>adrt-cli</c>:
/// <c>\\.\pipe\adrt-&lt;sid&gt;</c>.
/// </summary>
/// <remarks>
/// The SID suffix scopes the pipe to one logged-on user, so a second user on the
/// same machine cannot address (or squat) another user's app. The server
/// additionally asks the OS for <c>PipeOptions.CurrentUserOnly</c>; this class
/// only computes the name, which is what the client needs.
///
/// <c>ADRT_PIPE</c> overrides the name (without the <c>\\.\pipe\</c> prefix). It
/// exists for parallel/one-off harness runs, not for normal use.
/// </remarks>
internal static class IpcPipe
{
    public const string EnvironmentVariable = "ADRT_PIPE";
    public const string DefaultPrefix = "adrt";
    public const string PathPrefix = @"\\.\pipe\";

    /// <summary>The pipe name for the current user, or <c>ADRT_PIPE</c> when set.</summary>
    public static string Current()
    {
        string? configured = Environment.GetEnvironmentVariable(EnvironmentVariable);
        if (!string.IsNullOrWhiteSpace(configured)) return Normalize(configured);

        string sid = CurrentSid();
        return $"{DefaultPrefix}-{sid}";
    }

    /// <summary>Strip a full <c>\\.\pipe\</c> path down to the pipe name.</summary>
    public static string Normalize(string name)
    {
        string trimmed = name.Trim();
        if (trimmed.StartsWith(PathPrefix, StringComparison.OrdinalIgnoreCase))
        {
            trimmed = trimmed[PathPrefix.Length..];
        }

        if (trimmed.Length == 0)
        {
            throw new ArgumentException("the pipe name is empty", nameof(name));
        }

        if (trimmed.Contains('\\') || trimmed.Contains('/'))
        {
            throw new ArgumentException(
                $"'{name}' is not a pipe name (expected the part after {PathPrefix})",
                nameof(name));
        }

        return trimmed;
    }

    /// <summary>The current user's SID, e.g. <c>S-1-5-21-…</c>.</summary>
    public static string CurrentSid()
    {
        using WindowsIdentity identity = WindowsIdentity.GetCurrent();
        string? sid = identity.User?.Value;
        if (string.IsNullOrEmpty(sid))
        {
            throw new InvalidOperationException("cannot resolve the current user SID for the Adrt pipe");
        }

        return sid;
    }

    /// <summary>The full Win32 path for diagnostics and help text.</summary>
    public static string PathFor(string name) => PathPrefix + Normalize(name);
}
