using System.IO;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using Adrt.Core;

namespace Adrt.Windows;

/// <summary>One persisted float: the surface id plus enough identity to remap it after a restart.</summary>
/// <remarks>
/// Surface ids are session-scoped (the tracker starts at 1 each run), so the id
/// alone cannot survive a restart. The app id and title are written beside it and
/// used only to re-bind a saved float to the matching live window; at runtime the
/// set is still keyed by surface id.
/// </remarks>
internal sealed record PersistedFloat
{
    [JsonPropertyName("surfaceId")] public required int SurfaceId { get; init; }
    [JsonPropertyName("appId")] public string AppId { get; init; } = "";
    [JsonPropertyName("title")] public string Title { get; init; } = "";
}

/// <summary>
/// The host's real float state (§6): a per-window set keyed by surface id,
/// excluded from every plan, persisted to <c>%APPDATA%\Adrt\floats.json</c>.
/// </summary>
/// <remarks>
/// All members run on the host thread. A failed read/write is logged once and
/// otherwise ignored: a corrupt state file must never stop tiling.
/// </remarks>
internal sealed class FloatState
{
    private const string FileName = "floats.json";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    private readonly Action<string> _log;
    private readonly HashSet<int> _floating = [];
    private readonly Dictionary<int, PersistedFloat> _records = [];
    private bool _failureLogged;

    public FloatState(Action<string> log, string? filePath = null)
    {
        ArgumentNullException.ThrowIfNull(log);
        _log = log;
        FilePath = string.IsNullOrWhiteSpace(filePath) ? DefaultPath : Path.GetFullPath(filePath);
    }

    /// <summary>The standard per-user file: <c>%APPDATA%\Adrt\floats.json</c>.</summary>
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

    /// <summary>True when the window is a float.</summary>
    public bool IsFloating(int surfaceId) => _floating.Contains(surfaceId);

    /// <summary>A snapshot of the floating surface ids.</summary>
    public IReadOnlyCollection<int> Ids => _floating;

    /// <summary>Load the saved records. Call once from <see cref="TilingHost.Start"/>.</summary>
    public void Load()
    {
        _floating.Clear();
        _records.Clear();

        if (!File.Exists(FilePath)) return;

        try
        {
            string text = File.ReadAllText(FilePath);
            PersistedFloat[]? records = JsonSerializer.Deserialize<PersistedFloat[]>(text, JsonOptions);
            if (records is null) return;

            foreach (PersistedFloat record in records)
            {
                if (record.SurfaceId <= 0) continue;
                _records[record.SurfaceId] = record;
                _floating.Add(record.SurfaceId);
            }
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException)
        {
            Fail("load", error);
        }
    }

    /// <summary>
    /// Re-bind saved floats to the live surfaces after a restart. A record keeps
    /// its stored id when that id names a window with the same app; otherwise the
    /// first live window with the same app id and title is used. Records that no
    /// longer match anything are dropped.
    /// </summary>
    public void Restore(IReadOnlyList<Surface> surfaces)
    {
        ArgumentNullException.ThrowIfNull(surfaces);

        var byId = new Dictionary<int, Surface>(surfaces.Count);
        foreach (Surface surface in surfaces) byId[surface.Id] = surface;

        var restored = new Dictionary<int, PersistedFloat>();
        var taken = new HashSet<int>();

        foreach (PersistedFloat record in _records.Values)
        {
            if (byId.TryGetValue(record.SurfaceId, out Surface? direct) && direct is not null &&
                string.Equals(direct.AppId, record.AppId, StringComparison.Ordinal))
            {
                restored[direct.Id] = record with { SurfaceId = direct.Id, Title = direct.Title };
                taken.Add(direct.Id);
            }
        }

        foreach (PersistedFloat record in _records.Values)
        {
            if (restored.ContainsKey(record.SurfaceId)) continue;
            if (record.AppId.Length == 0) continue;

            Surface? match = null;
            foreach (Surface surface in surfaces)
            {
                if (taken.Contains(surface.Id)) continue;
                if (!string.Equals(surface.AppId, record.AppId, StringComparison.Ordinal)) continue;
                if (record.Title.Length > 0 && !string.Equals(surface.Title, record.Title, StringComparison.Ordinal)) continue;
                match = surface;
                break;
            }

            if (match is null) continue;
            restored[match.Id] = record with { SurfaceId = match.Id, Title = match.Title };
            taken.Add(match.Id);
        }

        _floating.Clear();
        _records.Clear();
        foreach (var (id, record) in restored)
        {
            _floating.Add(id);
            _records[id] = record;
        }

        if (restored.Count > 0) Save();
    }

    /// <summary>Toggle one window's float state and persist the new value.</summary>
    /// <returns>The new floating state.</returns>
    public bool Toggle(int surfaceId, string appId, string title)
    {
        bool floating;
        if (_floating.Remove(surfaceId))
        {
            _records.Remove(surfaceId);
            floating = false;
        }
        else
        {
            _floating.Add(surfaceId);
            _records[surfaceId] = new PersistedFloat
            {
                SurfaceId = surfaceId,
                AppId = appId,
                Title = title,
            };
            floating = true;
        }

        Save();
        return floating;
    }

    /// <summary>Forget a destroyed window. Returns true when it was floating.</summary>
    public bool Forget(int surfaceId)
    {
        bool removed = _floating.Remove(surfaceId);
        removed |= _records.Remove(surfaceId);
        if (removed) Save();
        return removed;
    }

    /// <summary>Forget floats whose window no longer exists. Returns how many were dropped.</summary>
    public int ForgetNotIn(IReadOnlySet<int> live)
    {
        ArgumentNullException.ThrowIfNull(live);

        int forgotten = 0;
        foreach (int id in _floating.ToArray())
        {
            if (live.Contains(id)) continue;
            _floating.Remove(id);
            _records.Remove(id);
            forgotten++;
        }

        if (forgotten > 0) Save();
        return forgotten;
    }

    private void Save()
    {
        try
        {
            string? directory = Path.GetDirectoryName(FilePath);
            if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);

            Array records = _records.Values.OrderBy(record => record.SurfaceId).ToArray();
            string text = JsonSerializer.Serialize(records, JsonOptions);
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
        _log(FormattableString.Invariant($"[float] could not {action} {FilePath}: {error.Message}"));
    }
}
