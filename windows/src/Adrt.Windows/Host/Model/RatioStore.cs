using System.IO;
using System.Text.Encodings.Web;
using System.Text.Json;
using Adrt.Core;

namespace Adrt.Windows;

/// <summary>
/// The host's split-ratio state: <c>connector:workspace:axis</c> → fraction of
/// the split owned by the sorted-first app, clamped to 0.05-0.95 and persisted
/// to <c>%APPDATA%\Adrt\ratios.json</c>.
/// </summary>
/// <remarks>
/// The key and wire format are the core's (<see cref="Tiler.RatioKey"/>), so a
/// file written by the GNOME host or an older Windows build can be sanitised and
/// migrated. A failed read/write is logged once and otherwise ignored. All
/// members run on the host thread.
/// </remarks>
internal sealed class RatioStore
{
    private const string FileName = "ratios.json";
    private const double MinRatio = 0.05;
    private const double MaxRatio = 0.95;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    private readonly Action<string> _log;
    private Dictionary<string, double> _ratios = new(StringComparer.Ordinal);
    private bool _failureLogged;

    public RatioStore(Action<string> log, string? filePath = null)
    {
        ArgumentNullException.ThrowIfNull(log);
        _log = log;
        FilePath = string.IsNullOrWhiteSpace(filePath) ? DefaultPath : Path.GetFullPath(filePath);
    }

    /// <summary>The standard per-user file: <c>%APPDATA%\Adrt\ratios.json</c>.</summary>
    public static string DefaultPath
    {
        get
        {
            string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            if (string.IsNullOrEmpty(appData)) appData = AppContext.BaseDirectory;
            return Path.Combine(appData, "Adrt", FileName);
        }
    }

    /// <summary>The file this state reads and writes.</summary>
    public string FilePath { get; }

    /// <summary>A copy of the stored ratios, suitable for <see cref="TilerConfig.Ratios"/>.</summary>
    public IReadOnlyDictionary<string, double> Snapshot() =>
        new Dictionary<string, double>(_ratios, StringComparer.Ordinal);

    /// <summary>Read the file, sanitise old keys and migrate index-keyed ratios.</summary>
    public void Load(IReadOnlyDictionary<int, string>? connectorByIndex = null)
    {
        if (!File.Exists(FilePath))
        {
            _ratios = new Dictionary<string, double>(StringComparer.Ordinal);
            return;
        }

        try
        {
            string text = File.ReadAllText(FilePath);
            Dictionary<string, double>? raw = JsonSerializer.Deserialize<Dictionary<string, double>>(text, JsonOptions);
            if (raw is null)
            {
                _ratios = new Dictionary<string, double>(StringComparer.Ordinal);
                return;
            }

            if (connectorByIndex is not null)
            {
                raw = Tiler.MigrateLegacyRatioKeys(raw, connectorByIndex);
            }

            _ratios = Tiler.SanitizeRatios(raw);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException)
        {
            Fail("load", error);
            _ratios = new Dictionary<string, double>(StringComparer.Ordinal);
        }
    }

    /// <summary>The stored ratio for a key, or 0.5 when it has none.</summary>
    public double Get(string connector, int workspaceId, SplitAxis axis)
    {
        ArgumentException.ThrowIfNullOrEmpty(connector);
        string key = Tiler.RatioKey(connector, workspaceId, axis);
        return _ratios.TryGetValue(key, out double ratio) ? ratio : 0.5;
    }

    /// <summary>Store a clamped ratio and persist. Returns true when the value changed.</summary>
    public bool Set(string connector, int workspaceId, SplitAxis axis, double ratio)
    {
        ArgumentException.ThrowIfNullOrEmpty(connector);
        if (!double.IsFinite(ratio)) return false;

        double clamped = Types.Clamp(ratio, MinRatio, MaxRatio);
        string key = Tiler.RatioKey(connector, workspaceId, axis);
        if (_ratios.TryGetValue(key, out double current) && current == clamped) return false;

        _ratios[key] = clamped;
        Save();
        return true;
    }

    /// <summary>
    /// §10/§5: drop a reaped workspace's keys and shift the workspaces to its
    /// right down one. Delegates the mapping to the core so the shift matches the
    /// model exactly. Returns true when the table changed.
    /// </summary>
    public bool RemapAfterReap(IReadOnlyList<int> reaped)
    {
        ArgumentNullException.ThrowIfNull(reaped);
        if (reaped.Count == 0) return false;

        Dictionary<string, double> next = Tiler.RemapRatiosAfterReap(_ratios, reaped);
        if (Same(next, _ratios)) return false;

        _ratios = next;
        Save();
        return true;
    }

    private static bool Same(
        IReadOnlyDictionary<string, double> left,
        IReadOnlyDictionary<string, double> right)
    {
        if (left.Count != right.Count) return false;
        foreach (var (key, value) in left)
        {
            if (!right.TryGetValue(key, out double other) || other != value) return false;
        }

        return true;
    }

    private void Save()
    {
        try
        {
            string? directory = Path.GetDirectoryName(FilePath);
            if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);

            string text = JsonSerializer.Serialize(_ratios, JsonOptions);
            string temporary = FilePath + ".tmp";
            File.WriteAllText(temporary, text);
            File.Move(temporary, FilePath, overwrite: true);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            Fail("save", error);
        }
    }

    private void Fail(string action, Exception error)
    {
        if (_failureLogged) return;
        _failureLogged = true;
        _log(FormattableString.Invariant($"[ratio] could not {action} {FilePath}: {error.Message}"));
    }
}
