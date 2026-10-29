// The Apps page: the per-user app registry (%APPDATA%\Adrt\registry.json).
// It lists every app, exposes the durable never-tile switch, forgets entries,
// clears the whole registry behind a confirmation, and exports/imports the
// versioned config bundle through the core Config merge/replace policy.
using System.Globalization;
using System.IO;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using Adrt.Core;
using Microsoft.Win32;

namespace Adrt.Settings;

/// <summary>
/// The Apps tab. The registry is loaded from disk into a core
/// <see cref="AppRegistry"/>; every mutation writes the bounded
/// <see cref="AppRegistry.ToJSON"/> form back atomically and bumps
/// <c>registry-revision</c> so a running host reloads it.
/// </summary>
internal sealed class AppsPage : UserControl
{
    private static readonly JsonSerializerOptions RegistryJson = new()
    {
        WriteIndented = true,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    private static readonly Brush CardBrush = Frozen(Color.FromRgb(0xFA, 0xFA, 0xFA));
    private static readonly Brush CardBorderBrush = Frozen(Color.FromRgb(0xD8, 0xD8, 0xD8));

    private readonly SettingsStore _settings;
    private readonly Action<string, bool> _report;
    private readonly StackPanel _list = new();
    private readonly TextBlock _emptyText = new();
    private readonly string _path;
    private AppRegistry _registry = new();

    /// <summary>Create the page and load the registry from disk.</summary>
    public AppsPage(SettingsStore settings, Action<string, bool> report)
    {
        ArgumentNullException.ThrowIfNull(settings);
        ArgumentNullException.ThrowIfNull(report);
        _settings = settings;
        _report = report;
        _path = DefaultPath;
        Content = BuildLayout();
        Reload();
    }

    /// <summary>The standard per-user registry file: <c>%APPDATA%\Adrt\registry.json</c>.</summary>
    public static string DefaultPath
    {
        get
        {
            string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            if (string.IsNullOrEmpty(appData)) appData = AppContext.BaseDirectory;
            return Path.Combine(appData, "Adrt", "registry.json");
        }
    }

    /// <summary>Re-read the registry file and rebuild the list.</summary>
    public void Reload()
    {
        _registry = new AppRegistry();
        string problem = string.Empty;

        if (File.Exists(_path))
        {
            try
            {
                string text = File.ReadAllText(_path);
                RegistryDto? data = JsonSerializer.Deserialize<RegistryDto>(text);
                if (data is not null)
                {
                    if (data.Version > AppRegistry.RegistryVersion)
                    {
                        problem = FormattableString.Invariant(
                            $"registry.json is version {data.Version}; this build understands {AppRegistry.RegistryVersion}.");
                    }
                    else
                    {
                        _registry = AppRegistry.FromJSON(new AppRegistryData
                        {
                            Version = data.Version,
                            Entries = data.Entries,
                        });
                    }
                }
            }
            catch (JsonException error)
            {
                problem = $"registry.json is not valid JSON: {error.Message}";
            }
            catch (IOException error)
            {
                problem = $"registry.json could not be read: {error.Message}";
            }
            catch (UnauthorizedAccessException error)
            {
                problem = $"registry.json could not be read: {error.Message}";
            }
        }

        Rebuild();

        if (problem.Length > 0)
        {
            _report($"Apps: {problem}", true);
        }
        else
        {
            _report(
                FormattableString.Invariant($"Apps: {_registry.Size} app(s) in the registry."),
                false);
        }
    }

    private FrameworkElement BuildLayout()
    {
        var root = new DockPanel { Margin = new Thickness(16, 12, 16, 12) };

        var header = new StackPanel { Margin = new Thickness(0, 0, 0, 10) };
        header.Children.Add(new TextBlock
        {
            Text = "App registry",
            FontSize = 16,
            FontWeight = FontWeights.SemiBold,
        });
        header.Children.Add(new TextBlock
        {
            Text = "Every app adrt has seen. “Never tile” keeps an app floating; "
                 + "Forget drops the entry, including its durable choice and learned placements.",
            Foreground = SystemColors.GrayTextBrush,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 2, 0, 0),
        });
        header.Children.Add(new TextBlock
        {
            Text = _path,
            FontSize = 11,
            FontFamily = new FontFamily("Consolas"),
            Foreground = SystemColors.GrayTextBrush,
            TextTrimming = TextTrimming.CharacterEllipsis,
            ToolTip = _path,
            Margin = new Thickness(0, 4, 0, 0),
        });
        DockPanel.SetDock(header, Dock.Top);
        root.Children.Add(header);

        var actions = new WrapPanel { Margin = new Thickness(0, 10, 0, 0) };
        Button refresh = ActionButton("Refresh", "Reload the registry file");
        refresh.Click += (_, _) => Reload();
        actions.Children.Add(refresh);

        Button clear = ActionButton("Forget all…", "Forget every app after a confirmation");
        clear.Click += (_, _) => ClearAll();
        actions.Children.Add(clear);

        Button export = ActionButton("Export JSON…", "Save settings and the app registry to a config bundle");
        export.Click += (_, _) => Export();
        actions.Children.Add(export);

        Button import = ActionButton("Import JSON…", "Load a config bundle and merge or replace it");
        import.Click += (_, _) => Import();
        actions.Children.Add(import);
        DockPanel.SetDock(actions, Dock.Bottom);
        root.Children.Add(actions);

        _emptyText.Text = "No apps recorded yet. Apps appear here as they are opened.";
        _emptyText.Foreground = SystemColors.GrayTextBrush;
        _emptyText.Margin = new Thickness(2, 4, 2, 12);

        root.Children.Add(new ScrollViewer
        {
            Content = _list,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        });

        return root;
    }

    private static Button ActionButton(string text, string tooltip) => new()
    {
        Content = text,
        Padding = new Thickness(14, 4, 14, 4),
        Margin = new Thickness(0, 0, 8, 0),
        ToolTip = tooltip,
    };

    private void Rebuild()
    {
        _list.Children.Clear();
        if (_registry.Size == 0)
        {
            _list.Children.Add(_emptyText);
            return;
        }

        foreach (AppEntry entry in _registry.Entries().OrderByDescending(entry => entry.LastSeen))
        {
            _list.Children.Add(BuildAppCard(entry));
        }
    }

    private FrameworkElement BuildAppCard(AppEntry entry)
    {
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var labels = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        labels.Children.Add(new TextBlock
        {
            Text = entry.AppId,
            FontWeight = FontWeights.SemiBold,
            TextTrimming = TextTrimming.CharacterEllipsis,
        });
        labels.Children.Add(new TextBlock
        {
            Text = Details(entry),
            FontSize = 11,
            Foreground = SystemColors.GrayTextBrush,
            TextTrimming = TextTrimming.CharacterEllipsis,
        });
        Grid.SetColumn(labels, 0);
        grid.Children.Add(labels);

        var toggle = new CheckBox
        {
            Content = "Never tile",
            IsChecked = entry.NeverTile,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(8, 0, 0, 0),
            ToolTip = "Keep this app out of the tiling",
        };
        toggle.Checked += (_, _) => SetNeverTile(entry.AppId, true);
        toggle.Unchecked += (_, _) => SetNeverTile(entry.AppId, false);
        Grid.SetColumn(toggle, 1);
        grid.Children.Add(toggle);

        var forget = new Button
        {
            Content = "Forget",
            Padding = new Thickness(8, 2, 8, 2),
            Margin = new Thickness(8, 0, 0, 0),
            VerticalAlignment = VerticalAlignment.Center,
            ToolTip = "Drop this entry from the registry",
        };
        forget.Click += (_, _) => Forget(entry.AppId);
        Grid.SetColumn(forget, 2);
        grid.Children.Add(forget);

        return new Border
        {
            Background = CardBrush,
            BorderBrush = CardBorderBrush,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(4),
            Padding = new Thickness(10, 8, 10, 8),
            Margin = new Thickness(0, 0, 0, 6),
            Child = grid,
        };
    }

    private static string Details(AppEntry entry)
    {
        string seen = entry.WindowsSeen.ToString("0", CultureInfo.InvariantCulture);
        string last;
        if (entry.LastSeen <= 0)
        {
            last = "never";
        }
        else if (entry.LastSeen <= DateTimeOffset.MaxValue.ToUnixTimeMilliseconds())
        {
            last = DateTimeOffset.FromUnixTimeMilliseconds((long)entry.LastSeen)
                .ToLocalTime()
                .ToString("g", CultureInfo.CurrentCulture);
        }
        else
        {
            last = "unknown";
        }
        string title = entry.LastTitle.Length > 0 ? $" · “{entry.LastTitle}”" : string.Empty;
        return FormattableString.Invariant($"{seen} window(s) seen · last {last}") + title;
    }

    private void SetNeverTile(string appId, bool value)
    {
        _registry.SetNeverTile(appId, value);
        if (!SaveRegistry(out string error))
        {
            _report($"Apps: changed in memory, but the file was not written — {error}", true);
            return;
        }

        BumpRegistryRevision();
        _report(
            FormattableString.Invariant($"Apps: {appId} is now {(value ? "never tiled" : "tiled again")}."),
            false);
    }

    private void Forget(string appId)
    {
        if (!_registry.Remove(appId)) return;
        if (!SaveRegistry(out string error))
        {
            Rebuild();
            _report($"Apps: changed in memory, but the file was not written — {error}", true);
            return;
        }

        BumpRegistryRevision();
        Rebuild();
        _report($"Apps: forgot {appId}.", false);
    }

    private void ClearAll()
    {
        if (_registry.Size == 0)
        {
            _report("Apps: the registry is already empty.", false);
            return;
        }

        const string question =
            "Forget every app?\n\n"
            + "This clears each app's Never-tile choice, learned placements and timing adaptation.";
        Window? owner = Window.GetWindow(this);
        MessageBoxResult answer = owner is null
            ? MessageBox.Show(question, "Adrt apps", MessageBoxButton.YesNo, MessageBoxImage.Warning, MessageBoxResult.No)
            : MessageBox.Show(owner, question, "Adrt apps", MessageBoxButton.YesNo, MessageBoxImage.Warning, MessageBoxResult.No);
        if (answer != MessageBoxResult.Yes) return;

        foreach (AppEntry entry in _registry.Entries()) _registry.Remove(entry.AppId);
        if (!SaveRegistry(out string error))
        {
            Rebuild();
            _report($"Apps: cleared in memory, but the file was not written — {error}", true);
            return;
        }

        BumpRegistryRevision();
        Rebuild();
        _report("Apps: cleared the registry.", false);
    }

    private void Export()
    {
        var dialog = new SaveFileDialog
        {
            Title = "Export Adrt settings and app registry",
            FileName = "adrt-config.json",
            DefaultExt = "json",
            Filter = "JSON files (*.json)|*.json|All files (*.*)|*.*",
            AddExtension = true,
            OverwritePrompt = true,
        };
        Window? owner = Window.GetWindow(this);
        bool? chosen = owner is null ? dialog.ShowDialog() : dialog.ShowDialog(owner);
        if (chosen != true) return;

        try
        {
            File.WriteAllText(dialog.FileName, Config.SerializeBundle(BuildBundle()));
            _report($"Apps: exported to {dialog.FileName}.", false);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or NotSupportedException)
        {
            _report($"Apps: could not write {dialog.FileName} — {error.Message}", true);
        }
    }

    private void Import()
    {
        var dialog = new OpenFileDialog
        {
            Title = "Import an Adrt config bundle",
            Filter = "JSON files (*.json)|*.json|All files (*.*)|*.*",
            CheckFileExists = true,
            Multiselect = false,
        };
        Window? owner = Window.GetWindow(this);
        bool? chosen = owner is null ? dialog.ShowDialog() : dialog.ShowDialog(owner);
        if (chosen != true) return;

        string text;
        try
        {
            text = File.ReadAllText(dialog.FileName);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or NotSupportedException)
        {
            _report($"Apps: could not read {dialog.FileName} — {error.Message}", true);
            return;
        }

        (Bundle? incoming, IReadOnlyList<string> parseErrors) = Config.ParseBundle(text);
        if (incoming is null)
        {
            string reason = parseErrors.Count > 0 ? parseErrors[0] : "not an Adrt config bundle.";
            _report($"Apps: {dialog.FileName} was not imported — {reason}", true);
            return;
        }

        if (incoming.Tracked.Registry is { } bundled &&
            bundled.Version > AppRegistry.RegistryVersion)
        {
            _report(
                FormattableString.Invariant(
                    $"Apps: {dialog.FileName} was written by a newer adrt (registry version {bundled.Version})."),
                true);
            return;
        }

        ImportMode? mode = ChooseImportMode(parseErrors);
        if (mode is null) return;

        string stamp = DateTimeOffset.UtcNow.ToString("o", CultureInfo.InvariantCulture);
        BundleMergeResult merged = Config.MergeBundles(BuildBundle(), incoming, mode.Value, stamp);

        var problems = new List<string>(parseErrors);
        AppRegistry? imported = incoming.Tracked.Registry is null
            ? null
            : FromBundleRegistry(incoming.Tracked.Registry);
        if (incoming.Tracked.Registry is not null && imported is null) return;

        int settingsApplied = ApplySettings(merged.Bundle.Settings, problems);
        if (imported is not null)
        {
            _registry = mode == ImportMode.Replace ? imported : MergeRegistries(_registry, imported);
        }
        ApplyAdaptations(merged.Bundle.Tracked.Adaptations);

        if (!SaveRegistry(out string registryError))
        {
            _report($"Apps: imported in memory, but the registry was not written — {registryError}", true);
            return;
        }

        BumpRegistryRevision();
        Rebuild();

        string summary = $"Apps: imported {settingsApplied} setting(s)";
        if (imported is not null) summary += FormattableString.Invariant($", {imported.Size} app(s)");
        summary += mode == ImportMode.Replace ? " (replace)." : " (merge).";
        if (problems.Count > 0) summary += $" {problems.Count} problem(s) — {problems[0]}";
        _report(summary, problems.Count > 0);
    }

    private ImportMode? ChooseImportMode(IReadOnlyList<string> parseErrors)
    {
        const string question =
            "Import this config bundle?\n\n"
            + "Yes merges: kept apps stay, Never-tile is kept if either side has it, "
            + "and new apps are added.\n"
            + "No replaces the current apps and imported settings.\n"
            + "Cancel does nothing.";
        string title = parseErrors.Count > 0 ? "Adrt import (with warnings)" : "Adrt import";
        Window? owner = Window.GetWindow(this);
        MessageBoxResult answer = owner is null
            ? MessageBox.Show(question, title, MessageBoxButton.YesNoCancel, MessageBoxImage.Question, MessageBoxResult.Yes)
            : MessageBox.Show(owner, question, title, MessageBoxButton.YesNoCancel, MessageBoxImage.Question, MessageBoxResult.Yes);
        return answer switch
        {
            MessageBoxResult.Yes => ImportMode.Merge,
            MessageBoxResult.No => ImportMode.Replace,
            _ => null,
        };
    }

    private int ApplySettings(IReadOnlyDictionary<string, object?> values, List<string> problems)
    {
        int applied = 0;
        foreach ((string key, object? value) in values)
        {
            if (!SettingsStore.IsKnown(key))
            {
                problems.Add(FormattableString.Invariant($"{key}: unknown setting"));
                continue;
            }
            if (_settings.TrySet(key, value, out string error)) applied++;
            else problems.Add($"{key}: {error}");
        }

        if (!_settings.TrySave(out string saveError))
        {
            problems.Add($"settings file: {saveError}");
        }
        return applied;
    }

    private void ApplyAdaptations(IReadOnlyDictionary<string, AdaptationRecord> adaptations)
    {
        foreach ((string appId, AdaptationRecord record) in adaptations)
        {
            var patch = new Dictionary<string, object?>(StringComparer.Ordinal);
            if (record.UnmaximizeDelayEma is double delay) patch["unmaximizeDelayMs"] = delay;
            if (record.SettleTimeEma is double settle) patch["settleMs"] = settle;
            if (record.SkipAnimation is bool skip) patch["skipAnimation"] = skip;
            if (patch.Count > 0) _registry.SetAdapt(appId, patch);
        }
    }

    private Bundle BuildBundle()
    {
        AppRegistryData data = _registry.ToJSON();
        var adaptations = new Dictionary<string, AdaptationRecord>(StringComparer.Ordinal);
        foreach (AppEntry entry in _registry.Entries())
        {
            AdaptRecord adapt = entry.Adapt;
            if (adapt.UnmaximizeDelayMs is null && adapt.SettleMs is null && adapt.SkipAnimation is null) continue;
            adaptations[entry.AppId] = new AdaptationRecord
            {
                AppId = entry.AppId,
                FirstSeen = entry.FirstSeen,
                LastSeen = entry.LastSeen,
                Observations = entry.WindowsSeen,
                UnmaximizeDelayEma = adapt.UnmaximizeDelayMs,
                SettleTimeEma = adapt.SettleMs,
                SkipAnimation = adapt.SkipAnimation,
            };
        }

        var settings = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (SettingDescriptor descriptor in SettingsStore.Settings)
        {
            settings[descriptor.Key] = _settings.Get(descriptor.Key);
        }

        return new Bundle
        {
            Format = Config.BundleFormat,
            Version = Config.BundleVersion,
            ExportedAt = DateTimeOffset.UtcNow.ToString("o", CultureInfo.InvariantCulture),
            Settings = settings,
            Tracked = new BundleTracked
            {
                Adaptations = adaptations,
                Behavior = new Dictionary<string, object?>(StringComparer.Ordinal),
                Registry = new BundleRegistry
                {
                    Version = data.Version,
                    Entries = data.Entries.Cast<object?>().ToList(),
                },
            },
        };
    }

    /// <summary>
    /// Union by app id, the §12 merge rule: a local entry keeps its data and only
    /// its Never-tile decision is ORed with the imported one; new apps are added.
    /// </summary>
    private static AppRegistry MergeRegistries(AppRegistry current, AppRegistry imported)
    {
        var importedById = new Dictionary<string, AppEntry>(StringComparer.Ordinal);
        foreach (AppEntry entry in imported.Entries()) importedById[entry.AppId] = entry;

        var localIds = new HashSet<string>(StringComparer.Ordinal);
        var entries = new List<AppEntry>();
        foreach (AppEntry entry in current.Entries())
        {
            localIds.Add(entry.AppId);
            if (importedById.TryGetValue(entry.AppId, out AppEntry? source)) entry.NeverTile |= source.NeverTile;
            entries.Add(entry);
        }
        foreach (AppEntry entry in imported.Entries())
        {
            if (!localIds.Contains(entry.AppId)) entries.Add(entry);
        }

        return AppRegistry.FromJSON(new AppRegistryData
        {
            Version = AppRegistry.RegistryVersion,
            Entries = entries,
        });
    }

    private AppRegistry? FromBundleRegistry(BundleRegistry registry)
    {
        // Bundle entries are opaque object graphs (Config normalizes them from
        // JSON); round-trip through the registry's own shape so AppRegistry owns
        // the entry semantics and bounds.
        try
        {
            string json = JsonSerializer.Serialize(registry);
            RegistryDto? data = JsonSerializer.Deserialize<RegistryDto>(json);
            return AppRegistry.FromJSON(data is null
                ? null
                : new AppRegistryData { Version = data.Version, Entries = data.Entries });
        }
        catch (JsonException error)
        {
            _report($"Apps: the bundle's app registry is not valid — {error.Message}", true);
            return null;
        }
    }

    private void BumpRegistryRevision()
    {
        double current = _settings.GetNumber("registry-revision");
        long next = (long)Math.Truncate(current) + 1;
        if (!_settings.TrySet("registry-revision", next, out _)) return;
        _settings.TrySave(out _);
    }

    private bool SaveRegistry(out string error)
    {
        try
        {
            string directory = Path.GetDirectoryName(_path) ?? string.Empty;
            if (directory.Length > 0) Directory.CreateDirectory(directory);

            string temp = _path + ".tmp";
            File.WriteAllText(temp, JsonSerializer.Serialize(_registry.ToJSON(), RegistryJson));
            File.Move(temp, _path, overwrite: true);
            error = string.Empty;
            return true;
        }
        catch (Exception failure) when (failure is IOException or UnauthorizedAccessException or NotSupportedException)
        {
            error = failure.Message;
            return false;
        }
    }

    private static Brush Frozen(Color color)
    {
        var brush = new SolidColorBrush(color);
        brush.Freeze();
        return brush;
    }

    /// <summary>The registry file's own shape, used to read and to adopt a bundle.</summary>
    private sealed class RegistryDto
    {
        [JsonPropertyName("version")] public double Version { get; init; }

        [JsonPropertyName("entries")] public List<AppEntry> Entries { get; init; } = [];
    }
}
