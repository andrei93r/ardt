// The generated settings window: one row per SettingsDescriptor entry, grouped
// into categories, filtered by the search box, with per-row and global reset.
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using Adrt.Core;

namespace Adrt.Settings;

/// <summary>
/// The WPF preferences window. It is built from
/// <see cref="SettingsDescriptor.Settings"/> at construction time, so a key added
/// to the descriptor gets a row (and a typed editor) without touching this file.
/// </summary>
/// <remarks>
/// Every edit is written straight through <see cref="SettingsStore"/>; there is no
/// Apply button. The window is normally opened by
/// <see cref="SettingsWindowHost"/>, which gives WPF its own STA thread and keeps
/// the tray's message loop untouched.
/// </remarks>
public partial class SettingsWindow : Window
{
    private readonly SettingsStore _store;
    private readonly List<SettingRow> _rows = [];
    private readonly List<(GroupBox Box, List<SettingRow> Rows)> _groups = [];
    private readonly RulesPage _rules;
    private readonly AppsPage _apps;
    private bool _navigating;

    /// <summary>Create a window over the per-user store.</summary>
    public SettingsWindow()
        : this(new SettingsStore())
    {
    }

    /// <summary>Create a window over <paramref name="store"/>.</summary>
    public SettingsWindow(SettingsStore store)
    {
        ArgumentNullException.ThrowIfNull(store);
        _store = store;
        InitializeComponent();

        PathText.Text = store.FilePath;
        PathText.ToolTip = store.FilePath;

        _rules = new RulesPage(store, SetStatus);
        _apps = new AppsPage(store, SetStatus);
        RulesHost.Content = _rules;
        AppsHost.Content = _apps;
        Pages.SelectionChanged += OnPageChanged;

        BuildRows();

        IReadOnlyList<string> errors = store.LastErrors;
        if (errors.Count > 0)
        {
            SetStatus($"Using defaults for {errors.Count} invalid value(s): {errors[0]}", true);
        }
        else
        {
            SetStatus(
                store.Exists
                    ? $"Loaded {SettingsDescriptor.Settings.Count} settings."
                    : "No settings file yet; showing the defaults.",
                false);
        }

        PreviewKeyDown += OnPreviewKeyDown;

        // Keep every row in step when a page or an import writes through the
        // same store. A row's own edit is already reflected, so this is cheap.
        _store.Changed += OnStoreChanged;
    }

    /// <summary>The store this window edits.</summary>
    public SettingsStore Store => _store;

    /// <summary>The tab currently shown.</summary>
    public SettingsPage CurrentPage => (SettingsPage)Pages.SelectedIndex;

    /// <summary>
    /// Select a tab. <see cref="SettingsWindowHost.Show"/> uses this so the tray
    /// can open the window directly on Rules or Apps.
    /// </summary>
    public void ShowPage(SettingsPage page)
    {
        if (page is < SettingsPage.Settings or > SettingsPage.Apps) return;
        _navigating = true;
        try
        {
            Pages.SelectedIndex = (int)page;
            ReloadPage(page);
        }
        finally
        {
            _navigating = false;
        }
    }

    private void OnPageChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_navigating || e.Source != Pages) return;
        ReloadPage(CurrentPage);
    }

    private void ReloadPage(SettingsPage page)
    {
        // Re-read the page's source so a window that stayed open in the
        // background reflects edits made by another process.
        switch (page)
        {
            case SettingsPage.Rules:
                _rules.Reload();
                break;
            case SettingsPage.Apps:
                _apps.Reload();
                break;
            default:
                break;
        }
    }

    private void OnStoreChanged(object? sender, SettingsChangedEventArgs e)
    {
        foreach (SettingRow row in _rows) row.Reload();
    }

    private void BuildRows()
    {
        RowsPanel.Children.Clear();
        _rows.Clear();
        _groups.Clear();

        var byCategory = new Dictionary<SettingCategory, List<SettingRow>>();
        foreach (SettingDescriptor descriptor in SettingsDescriptor.Settings)
        {
            var row = new SettingRow(descriptor, _store, SetStatus);
            _rows.Add(row);
            if (!byCategory.TryGetValue(row.Category, out var rows))
            {
                rows = [];
                byCategory[row.Category] = rows;
            }
            rows.Add(row);
        }

        RowsPanel.Children.Add(new TextBlock
        {
            Text = "Changes save automatically. Rows come from the shared settings descriptor, "
                 + "so the key names and defaults match the model.",
            Foreground = SystemColors.GrayTextBrush,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 0, 0, 12),
        });

        foreach (SettingCategory category in SettingsCategories.All)
        {
            if (!byCategory.TryGetValue(category, out var rows)) continue;

            var panel = new StackPanel { Margin = new Thickness(2, 0, 2, 2) };
            foreach (SettingRow row in rows) panel.Children.Add(row.Container);

            var box = new GroupBox
            {
                Header = BuildHeader(category),
                Content = panel,
                Margin = new Thickness(0, 0, 0, 12),
                Padding = new Thickness(8, 4, 8, 4),
            };
            RowsPanel.Children.Add(box);
            _groups.Add((box, rows));
        }
    }

    private static FrameworkElement BuildHeader(SettingCategory category)
    {
        var panel = new StackPanel { Margin = new Thickness(0, 2, 0, 4) };
        panel.Children.Add(new TextBlock
        {
            Text = category.Title,
            FontSize = 14,
            FontWeight = FontWeights.SemiBold,
        });
        panel.Children.Add(new TextBlock
        {
            Text = category.Description,
            FontSize = 11,
            Foreground = SystemColors.GrayTextBrush,
            TextWrapping = TextWrapping.Wrap,
        });
        return panel;
    }

    private void SetStatus(string message, bool error)
    {
        StatusText.Text = message;
        StatusText.Foreground = error ? Brushes.Firebrick : SystemColors.ControlTextBrush;
    }

    private void OnSearchTextChanged(object sender, TextChangedEventArgs e)
    {
        SearchHint.Visibility = SearchBox.Text.Length == 0 ? Visibility.Visible : Visibility.Collapsed;

        string query = SearchBox.Text.Trim();
        int matches = 0;
        foreach ((GroupBox box, List<SettingRow> rows) in _groups)
        {
            int visible = 0;
            foreach (SettingRow row in rows)
            {
                bool match = row.Matches(query);
                row.Container.Visibility = match ? Visibility.Visible : Visibility.Collapsed;
                if (match) visible++;
            }
            box.Visibility = visible == 0 ? Visibility.Collapsed : Visibility.Visible;
            matches += visible;
        }

        if (query.Length == 0)
        {
            SetStatus($"Showing all {SettingsDescriptor.Settings.Count} settings.", false);
        }
        else
        {
            SetStatus($"{matches} setting(s) match “{query}”.", false);
        }
    }

    private void OnReloadClicked(object sender, RoutedEventArgs e)
    {
        IReadOnlyList<string> errors = _store.Reload();
        foreach (SettingRow row in _rows) row.Reload();
        _rules.Reload();

        SetStatus(
            errors.Count == 0
                ? "Reloaded from disk."
                : $"Reloaded with {errors.Count} problem(s): {errors[0]}",
            errors.Count > 0);
    }

    private void OnResetAllClicked(object sender, RoutedEventArgs e)
    {
        MessageBoxResult answer = MessageBox.Show(
            this,
            $"Reset all {SettingsDescriptor.Settings.Count} settings to their defaults?",
            "Adrt settings",
            MessageBoxButton.YesNo,
            MessageBoxImage.Warning,
            MessageBoxResult.No);
        if (answer != MessageBoxResult.Yes) return;

        _store.ResetAll();
        foreach (SettingRow row in _rows) row.Reload();
        _rules.Reload();

        bool saved = _store.TrySave(out string error);
        SetStatus(
            saved
                ? "All settings reset to their defaults."
                : $"Reset in memory, but the file was not written — {error}",
            !saved);
    }

    private void OnPreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.F && Keyboard.Modifiers.HasFlag(ModifierKeys.Control))
        {
            Pages.SelectedIndex = (int)SettingsPage.Settings;
            SearchBox.Focus();
            SearchBox.SelectAll();
            e.Handled = true;
        }
        else if (e.Key == Key.Escape && SearchBox.IsKeyboardFocusWithin)
        {
            SearchBox.Text = string.Empty;
        }
    }
}
