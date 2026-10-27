// Per-user settings store for the Windows port.
//
// The key names, types and defaults all come from Adrt.Core.SettingsDescriptor,
// which is generated from the GNOME schema. The file is the flat JSON object
// described by docs/WINDOWS_PORT.md §5.9:
//
//   %APPDATA%\Adrt\settings.json
//
// Load merges the file over the descriptor defaults (a missing key keeps its
// default, an unknown key is ignored for forward compatibility). Saves are
// atomic: write a sibling temp file, then replace the real one.
using System.Globalization;
using System.IO;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using Adrt.Core;

namespace Adrt.Settings;

/// <summary>One setting's old and new value, as carried by <see cref="SettingsStore.Changed"/>.</summary>
public sealed class SettingsChangedEventArgs(string key, object? oldValue, object? newValue) : EventArgs
{
    /// <summary>The descriptor key that changed.</summary>
    public string Key { get; } = key;

    /// <summary>The value before the change, in its typed form (bool/double/string/list).</summary>
    public object? OldValue { get; } = oldValue;

    /// <summary>The value after the change, in its typed form.</summary>
    public object? NewValue { get; } = newValue;
}

/// <summary>
/// Reads and writes <c>%APPDATA%\Adrt\settings.json</c> with the descriptor's
/// key names, defaults and value types.
/// </summary>
/// <remarks>
/// Values are stored in their natural C# form: <see cref="bool"/> for
/// <see cref="SettingType.Bool"/>, <see cref="double"/> for
/// <see cref="SettingType.Int"/>/<see cref="SettingType.Uint"/>,
/// <see cref="string"/> for <see cref="SettingType.String"/>/
/// <see cref="SettingType.Enum"/>, and a <see cref="string"/> list for
/// <see cref="SettingType.Strv"/>. The store is safe to call from one UI thread;
/// access to the table itself is locked so a tray callback cannot corrupt it.
/// </remarks>
public sealed class SettingsStore
{
    private const string StoreFileName = "settings.json";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    private static readonly IReadOnlyDictionary<string, SettingDescriptor> Descriptors =
        SettingsDescriptor.Settings.ToDictionary(setting => setting.Key, StringComparer.Ordinal);

    private readonly object _gate = new();
    private readonly Dictionary<string, object?> _values = new(StringComparer.Ordinal);

    /// <summary>Create a store at <paramref name="filePath"/>, or the per-user default.</summary>
    /// <param name="filePath">
    /// An explicit path (for tests or a portable install); null uses
    /// <see cref="DefaultPath"/>. Loading happens in the constructor.
    /// </param>
    public SettingsStore(string? filePath = null)
    {
        FilePath = string.IsNullOrWhiteSpace(filePath) ? DefaultPath : System.IO.Path.GetFullPath(filePath);
        ResetAllCore();
        Reload();
    }

    /// <summary>The standard per-user file: <c>%APPDATA%\Adrt\settings.json</c>.</summary>
    public static string DefaultPath
    {
        get
        {
            string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            if (string.IsNullOrEmpty(appData)) appData = AppContext.BaseDirectory;
            return System.IO.Path.Combine(appData, "Adrt", StoreFileName);
        }
    }

    /// <summary>The file this store reads and writes.</summary>
    public string FilePath { get; }

    /// <summary>True when <see cref="FilePath"/> existed at the last load/save.</summary>
    public bool Exists => File.Exists(FilePath);

    /// <summary>Problems from the last <see cref="Reload"/>; invalid values keep their default.</summary>
    public IReadOnlyList<string> LastErrors { get; private set; } = [];

    /// <summary>Raised after a value actually changes (a no-op set does not raise it).</summary>
    public event EventHandler<SettingsChangedEventArgs>? Changed;

    /// <summary>Raised after <see cref="Reload"/> or <see cref="ResetAll"/> replaces the table.</summary>
    public event EventHandler? Reloaded;

    /// <summary>Raised after a successful <see cref="TrySave"/>.</summary>
    public event EventHandler? Saved;

    /// <summary>Every descriptor key, in descriptor order.</summary>
    public static IReadOnlyList<SettingDescriptor> Settings => SettingsDescriptor.Settings;

    /// <summary>True when <paramref name="key"/> is one of the descriptor's keys.</summary>
    public static bool IsKnown(string key) => Descriptors.ContainsKey(key);

    /// <summary>The descriptor for <paramref name="key"/>, or null when unknown.</summary>
    public static SettingDescriptor? Descriptor(string key) =>
        Descriptors.TryGetValue(key, out var descriptor) ? descriptor : null;

    /// <summary>The current value of <paramref name="key"/> in its typed form.</summary>
    /// <exception cref="KeyNotFoundException">The key is not in the descriptor.</exception>
    public object? Get(string key)
    {
        SettingDescriptor descriptor = Require(key);
        lock (_gate)
        {
            return CloneValue(_values[descriptor.Key]);
        }
    }

    /// <summary>The current boolean value of <paramref name="key"/>.</summary>
    public bool GetBool(string key) => GetTyped<bool>(key);

    /// <summary>The current numeric value of <paramref name="key"/>.</summary>
    public double GetNumber(string key) => GetTyped<double>(key);

    /// <summary>The current string value of <paramref name="key"/>.</summary>
    public string GetString(string key) => GetTyped<string>(key);

    /// <summary>A snapshot of the current string-list value of <paramref name="key"/>.</summary>
    public IReadOnlyList<string> GetStrings(string key) => GetTyped<string[]>(key);

    /// <summary>Read the current value, falling back when the stored value is not of that type.</summary>
    private T GetTyped<T>(string key)
    {
        lock (_gate)
        {
            _ = Require(key);
            if (_values[key] is T value) return value;
            throw new InvalidOperationException($"setting \"{key}\" is not stored as {typeof(T).Name}");
        }
    }

    /// <summary>Set one value, validating it against the descriptor.</summary>
    /// <returns>False when the value is invalid; <paramref name="error"/> then explains why.</returns>
    public bool TrySet(string key, object? value, out string error)
    {
        if (!Descriptors.TryGetValue(key, out var descriptor))
        {
            error = $"unknown setting \"{key}\"";
            return false;
        }
        if (!TryCoerce(descriptor, value, out var normalized, out error)) return false;

        object? oldValue;
        lock (_gate)
        {
            oldValue = _values[key];
            _values[key] = normalized;
        }
        if (!ValueEquals(oldValue, normalized))
        {
            Changed?.Invoke(this, new SettingsChangedEventArgs(key, CloneValue(oldValue), CloneValue(normalized)));
        }
        return true;
    }

    /// <summary>Set one value, throwing on invalid input (programming errors, not user input).</summary>
    /// <exception cref="ArgumentException">The value does not match the descriptor.</exception>
    public void Set(string key, object? value)
    {
        if (!TrySet(key, value, out var error)) throw new ArgumentException(error, nameof(value));
    }

    /// <summary>True when <paramref name="key"/> currently holds its schema default.</summary>
    public bool IsDefault(string key)
    {
        SettingDescriptor descriptor = Require(key);
        lock (_gate)
        {
            return ValueEquals(_values[key], descriptor.Default);
        }
    }

    /// <summary>Restore one key to its schema default.</summary>
    /// <returns>True when the value changed.</returns>
    public bool Reset(string key)
    {
        SettingDescriptor descriptor = Require(key);
        object? oldValue;
        object? newValue = CloneValue(descriptor.Default);
        lock (_gate)
        {
            oldValue = _values[key];
            _values[key] = newValue;
        }
        if (ValueEquals(oldValue, newValue)) return false;
        Changed?.Invoke(this, new SettingsChangedEventArgs(key, CloneValue(oldValue), CloneValue(newValue)));
        return true;
    }

    /// <summary>Restore every key to its schema default.</summary>
    public void ResetAll()
    {
        lock (_gate)
        {
            ResetAllCore();
        }
        Reloaded?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>
    /// Re-read <see cref="FilePath"/> over the defaults. A missing file is normal
    /// (first run); a corrupt or partially invalid file keeps the valid values
    /// and reports the rest in <see cref="LastErrors"/>.
    /// </summary>
    /// <returns>The list of problems, empty when the file was wholly valid.</returns>
    public IReadOnlyList<string> Reload()
    {
        var errors = new List<string>();
        lock (_gate)
        {
            ResetAllCore();
            if (File.Exists(FilePath))
            {
                try
                {
                    string text = File.ReadAllText(FilePath);
                    using JsonDocument document = JsonDocument.Parse(text, new JsonDocumentOptions
                    {
                        AllowTrailingCommas = true,
                        CommentHandling = JsonCommentHandling.Skip,
                    });

                    if (document.RootElement.ValueKind != JsonValueKind.Object)
                    {
                        errors.Add("the file must contain a JSON object");
                    }
                    else
                    {
                        foreach (JsonProperty property in document.RootElement.EnumerateObject())
                        {
                            // Unknown keys (a newer version) are ignored, not deleted:
                            // the next save simply omits them, as this build cannot edit them.
                            if (!Descriptors.TryGetValue(property.Name, out var descriptor)) continue;
                            if (TryFromJson(descriptor, property.Value, out var value, out string error))
                            {
                                _values[descriptor.Key] = value;
                            }
                            else
                            {
                                errors.Add($"{descriptor.Key}: {error}");
                            }
                        }
                    }
                }
                catch (JsonException error)
                {
                    errors.Add($"the file is not valid JSON: {error.Message}");
                }
                catch (IOException error)
                {
                    errors.Add($"the file could not be read: {error.Message}");
                }
                catch (UnauthorizedAccessException error)
                {
                    errors.Add($"the file could not be read: {error.Message}");
                }
            }
        }

        LastErrors = errors;
        Reloaded?.Invoke(this, EventArgs.Empty);
        return errors;
    }

    /// <summary>Write the current table to <see cref="FilePath"/>, atomically.</summary>
    /// <returns>False on an IO/access failure; <paramref name="error"/> then explains why.</returns>
    public bool TrySave(out string error)
    {
        try
        {
            JsonObject root = new();
            lock (_gate)
            {
                foreach (SettingDescriptor descriptor in SettingsDescriptor.Settings)
                {
                    root[descriptor.Key] = ToNode(_values[descriptor.Key]);
                }
            }

            string directory = System.IO.Path.GetDirectoryName(FilePath) ?? string.Empty;
            if (directory.Length > 0) Directory.CreateDirectory(directory);

            string temp = FilePath + ".tmp";
            File.WriteAllText(temp, root.ToJsonString(JsonOptions));
            File.Move(temp, FilePath, overwrite: true);
            error = string.Empty;
            Saved?.Invoke(this, EventArgs.Empty);
            return true;
        }
        catch (Exception failure) when (failure is IOException or UnauthorizedAccessException or NotSupportedException)
        {
            error = failure.Message;
            return false;
        }
    }

    private void ResetAllCore()
    {
        _values.Clear();
        foreach (SettingDescriptor descriptor in SettingsDescriptor.Settings)
        {
            _values[descriptor.Key] = CloneValue(descriptor.Default);
        }
    }

    private static SettingDescriptor Require(string key) =>
        Descriptors.TryGetValue(key, out var descriptor)
            ? descriptor
            : throw new KeyNotFoundException($"unknown setting \"{key}\"");

    private static bool TryCoerce(
        SettingDescriptor descriptor,
        object? value,
        out object? normalized,
        out string error)
    {
        normalized = null;
        error = string.Empty;

        switch (descriptor.Type)
        {
            case SettingType.Bool:
                if (value is not bool flag)
                {
                    error = "expected true or false";
                    return false;
                }
                normalized = flag;
                return true;

            case SettingType.Int:
            case SettingType.Uint:
                if (!TryNumber(value, out double number))
                {
                    error = "expected a number";
                    return false;
                }
                if (!double.IsFinite(number))
                {
                    error = "expected a finite number";
                    return false;
                }
                if (Math.Truncate(number) != number)
                {
                    error = "expected a whole number";
                    return false;
                }
                if (descriptor.Type == SettingType.Uint && number < 0)
                {
                    error = "expected zero or more";
                    return false;
                }
                if (descriptor.Min is double min && number < min)
                {
                    error = FormattableString.Invariant($"expected at least {min:0.###}");
                    return false;
                }
                if (descriptor.Max is double max && number > max)
                {
                    error = FormattableString.Invariant($"expected at most {max:0.###}");
                    return false;
                }
                normalized = number;
                return true;

            case SettingType.Enum:
                if (value is not string choice)
                {
                    error = "expected text";
                    return false;
                }
                if (descriptor.Choices is { Count: > 0 } choices &&
                    !choices.Contains(choice, StringComparer.Ordinal))
                {
                    error = $"expected one of: {string.Join(", ", choices)}";
                    return false;
                }
                normalized = choice;
                return true;

            case SettingType.String:
                if (value is not string text)
                {
                    error = "expected text";
                    return false;
                }
                normalized = text;
                return true;

            case SettingType.Strv:
                if (value is string || value is not IEnumerable<string> items)
                {
                    error = "expected a list of strings";
                    return false;
                }
                normalized = items.ToArray();
                return true;

            default:
                error = FormattableString.Invariant($"unsupported setting type {descriptor.Type}");
                return false;
        }
    }

    private static bool TryFromJson(
        SettingDescriptor descriptor,
        JsonElement value,
        out object? result,
        out string error)
    {
        result = null;
        error = string.Empty;

        switch (descriptor.Type)
        {
            case SettingType.Bool:
                if (value.ValueKind is JsonValueKind.True or JsonValueKind.False)
                {
                    result = value.GetBoolean();
                    return true;
                }
                error = "expected true or false";
                return false;

            case SettingType.Int:
            case SettingType.Uint:
                if (value.ValueKind != JsonValueKind.Number || !value.TryGetDouble(out double number))
                {
                    error = "expected a number";
                    return false;
                }
                return TryCoerce(descriptor, number, out result, out error);

            case SettingType.Enum:
                if (value.ValueKind != JsonValueKind.String)
                {
                    error = "expected text";
                    return false;
                }
                return TryCoerce(descriptor, value.GetString(), out result, out error);

            case SettingType.String:
                if (value.ValueKind != JsonValueKind.String)
                {
                    error = "expected text";
                    return false;
                }
                result = value.GetString() ?? string.Empty;
                return true;

            case SettingType.Strv:
                if (value.ValueKind != JsonValueKind.Array)
                {
                    error = "expected an array of strings";
                    return false;
                }
                var items = new List<string>();
                foreach (JsonElement item in value.EnumerateArray())
                {
                    if (item.ValueKind != JsonValueKind.String)
                    {
                        error = "expected an array of strings";
                        return false;
                    }
                    items.Add(item.GetString() ?? string.Empty);
                }
                result = items.ToArray();
                return true;

            default:
                error = FormattableString.Invariant($"unsupported setting type {descriptor.Type}");
                return false;
        }
    }

    private static bool TryNumber(object? value, out double number)
    {
        switch (value)
        {
            case double doubleValue:
                number = doubleValue;
                return true;
            case float floatValue:
                number = floatValue;
                return true;
            case int intValue:
                number = intValue;
                return true;
            case long longValue:
                number = longValue;
                return true;
            case decimal decimalValue:
                number = (double)decimalValue;
                return true;
            case string text when double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out double parsed):
                number = parsed;
                return true;
            default:
                number = 0;
                return false;
        }
    }

    private static JsonNode? ToNode(object? value) => value switch
    {
        null => null,
        bool flag => JsonValue.Create(flag),
        double number => JsonValue.Create(number),
        string text => JsonValue.Create(text),
        IEnumerable<string> items => new JsonArray(items.Select(item => JsonValue.Create(item)).ToArray()),
        _ => JsonValue.Create(Convert.ToString(value, CultureInfo.InvariantCulture)),
    };

    private static object? CloneValue(object? value) => value switch
    {
        string[] items => items.ToArray(),
        IEnumerable<string> items => items.ToArray(),
        _ => value,
    };

    private static bool ValueEquals(object? left, object? right) => (left, right) switch
    {
        (null, null) => true,
        (IEnumerable<string> first, IEnumerable<string> second) => first.SequenceEqual(second, StringComparer.Ordinal),
        (string first, string second) => string.Equals(first, second, StringComparison.Ordinal),
        (bool first, bool second) => first == second,
        (double first, double second) => first.Equals(second),
        _ => Equals(left, right),
    };
}
