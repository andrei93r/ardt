using System.Runtime.Versioning;
using System.Security.Principal;

namespace Adrt.Windows;

/// <summary>
/// The named-pipe address for the app: <c>\\.\pipe\adrt-&lt;sid&gt;</c>.
/// </summary>
/// <remarks>
/// The SID suffix prevents two logged-on users from addressing each other's
/// app. <see cref="IpcServer"/> additionally creates the pipe with
/// <c>PipeOptions.CurrentUserOnly</c>, so the kernel ACL is the same scope.
///
/// <c>ADRT_PIPE</c> overrides the name (the part after <c>\\.\pipe\</c>). The
/// harness uses that for isolated/parallel runs; normal installs leave it unset.
/// </remarks>
[SupportedOSPlatform("windows")]
public static class IpcPipeName
{
    public const string EnvironmentVariable = "ADRT_PIPE";
    public const string DefaultPrefix = "adrt";
    public const string PathPrefix = @"\\.\pipe\";

    /// <summary>Longest name Windows accepts after the <c>\\.\pipe\</c> prefix.</summary>
    private const int MaxNameLength = 200;

    /// <summary>The current user's pipe name, or <c>ADRT_PIPE</c> when set.</summary>
    public static string Current()
    {
        string? configured = Environment.GetEnvironmentVariable(EnvironmentVariable);
        if (!string.IsNullOrWhiteSpace(configured)) return Normalize(configured);

        return $"{DefaultPrefix}-{CurrentSid()}";
    }

    /// <summary>Strip a full <c>\\.\pipe\</c> path down to the pipe name.</summary>
    public static string Normalize(string name)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);

        string trimmed = name.Trim();
        if (trimmed.StartsWith(PathPrefix, StringComparison.OrdinalIgnoreCase))
        {
            trimmed = trimmed[PathPrefix.Length..];
        }

        if (trimmed.Length == 0 || trimmed.Length > MaxNameLength)
        {
            throw new ArgumentException(
                $"the pipe name must be 1..{MaxNameLength} characters",
                nameof(name));
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

    /// <summary>The full Win32 path for diagnostics and ping output.</summary>
    public static string PathFor(string name) => PathPrefix + Normalize(name);
}
