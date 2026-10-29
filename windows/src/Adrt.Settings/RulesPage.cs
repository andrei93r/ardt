// The placement-rules page: one card per rule with app/title globs, an action,
// an enable switch and up/down/remove buttons. Rules live in the `rules-json`
// setting; every edit validates through Rules.ValidateRule before it is saved.
using System.Globalization;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using Adrt.Core;
using TileMode = Adrt.Core.TileMode;

namespace Adrt.Settings;

/// <summary>
/// The Rules tab. It edits the raw <c>rules-json</c> array through
/// <see cref="SettingsStore"/> and preserves fields it does not understand
/// (for example a hand-written <c>kind</c> matcher) across edits.
/// </summary>
internal sealed class RulesPage : UserControl
{
    private static readonly JsonSerializerOptions WriteOptions = new()
    {
        WriteIndented = true,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    private static readonly (TileMode Mode, string Label)[] Actions =
    [
        (TileMode.Full, "Tile full"),
        (TileMode.LeftHalf, "Tile left half"),
        (TileMode.RightHalf, "Tile right half"),
        (TileMode.Float, "Float"),
    ];

    private static readonly Brush CardBrush = Frozen(Color.FromRgb(0xFA, 0xFA, 0xFA));
    private static readonly Brush CardBorderBrush = Frozen(Color.FromRgb(0xD8, 0xD8, 0xD8));

    private readonly SettingsStore _store;
    private readonly Action<string, bool> _report;
    private readonly StackPanel _list = new();
    private JsonArray _entries = [];
    private string _parseError = string.Empty;

    /// <summary>Create the page over <paramref name="store"/>.</summary>
    public RulesPage(SettingsStore store, Action<string, bool> report)
    {
        ArgumentNullException.ThrowIfNull(store);
        ArgumentNullException.ThrowIfNull(report);
        _store = store;
        _report = report;
        Content = BuildLayout();
        Reload();
    }

    /// <summary>Re-read <c>rules-json</c> from the store and rebuild the list.</summary>
    public void Reload()
    {
        _parseError = string.Empty;
        _entries = [];

        string stored;
        try
        {
            stored = _store.GetString("rules-json");
        }
        catch (InvalidOperationException error)
        {
            _parseError = error.Message;
            Rebuild();
            return;
        }

        try
        {
            JsonNode? parsed = JsonNode.Parse(stored);
            if (parsed is JsonArray array) _entries = array;
            else if (parsed is not null) _parseError = "rules-json must be a JSON array.";
        }
        catch (JsonException error)
        {
            _parseError = error.Message;
        }

        Rebuild();
    }

    private FrameworkElement BuildLayout()
    {
        var root = new DockPanel { Margin = new Thickness(16, 12, 16, 12) };

        var header = new StackPanel { Margin = new Thickness(0, 0, 0, 10) };
        header.Children.Add(new TextBlock
        {
            Text = "Placement rules",
            FontSize = 16,
            FontWeight = FontWeights.SemiBold,
        });
        header.Children.Add(new TextBlock
        {
            Text = "Force a placement when a window matches, or leave it floating. "
                 + "The first enabled rule wins. Rules are matched against the app id and "
                 + "the window title with case-insensitive globs (* any run, ? one character).",
            Foreground = SystemColors.GrayTextBrush,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 2, 0, 0),
        });
        DockPanel.SetDock(header, Dock.Top);
        root.Children.Add(header);

        var actions = new StackPanel
        {
            Orientation = System.Windows.Controls.Orientation.Horizontal,
            Margin = new Thickness(0, 10, 0, 0),
        };
        var add = new Button
        {
            Content = "Add rule",
            Padding = new Thickness(14, 4, 14, 4),
        };
        add.Click += (_, _) => AddRule();
        actions.Children.Add(add);
        DockPanel.SetDock(actions, Dock.Bottom);
        root.Children.Add(actions);

        root.Children.Add(new ScrollViewer
        {
            Content = _list,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        });

        return root;
    }

    private void Rebuild()
    {
        _list.Children.Clear();

        if (_parseError.Length > 0)
        {
            _list.Children.Add(BuildParseError());
            return;
        }

        if (_entries.Count == 0)
        {
            _list.Children.Add(new TextBlock
            {
                Text = "No rules yet. Add a rule to force a window placement.",
                Foreground = SystemColors.GrayTextBrush,
                Margin = new Thickness(2, 4, 2, 12),
            });
        }

        for (int index = 0; index < _entries.Count; index++)
        {
            _list.Children.Add(BuildRuleCard(index));
        }
    }

    private FrameworkElement BuildParseError()
    {
        var panel = new StackPanel();
        panel.Children.Add(new TextBlock
        {
            Text = "The stored rules are not valid JSON.",
            FontWeight = FontWeights.SemiBold,
            Foreground = Brushes.Firebrick,
        });
        panel.Children.Add(new TextBlock
        {
            Text = _parseError,
            Foreground = SystemColors.GrayTextBrush,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 2, 0, 8),
        });
        var startOver = new Button
        {
            Content = "Start over",
            Padding = new Thickness(14, 4, 14, 4),
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        startOver.Click += (_, _) =>
        {
            _entries = [];
            _parseError = string.Empty;
            Save();
            Rebuild();
        };
        panel.Children.Add(startOver);

        return new Border
        {
            BorderBrush = Brushes.Firebrick,
            BorderThickness = new Thickness(1),
            Padding = new Thickness(10),
            Child = panel,
        };
    }

    private FrameworkElement BuildRuleCard(int index)
    {
        JsonObject? raw = _entries[index] as JsonObject;
        var summary = new TextBlock
        {
            FontWeight = FontWeights.SemiBold,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };
        var errors = new TextBlock
        {
            Foreground = Brushes.Firebrick,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 6, 0, 0),
            Visibility = Visibility.Collapsed,
        };

        void Refresh()
        {
            List<string> problems = Validate(raw, index);
            summary.Text = Summary(raw) + (problems.Count > 0 ? "  (invalid)" : string.Empty);
            errors.Text = string.Join("; ", problems);
            errors.Visibility = problems.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
        }

        var head = new Grid();
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        Grid.SetColumn(summary, 0);
        head.Children.Add(summary);

        var enabled = new CheckBox
        {
            Content = "Enabled",
            IsChecked = raw?["enabled"] is not JsonValue value ||
                        value.GetValueKind() != JsonValueKind.False,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(8, 0, 0, 0),
        };
        enabled.Checked += (_, _) => SetEnabled(raw, true);
        enabled.Unchecked += (_, _) => SetEnabled(raw, false);
        Grid.SetColumn(enabled, 1);
        head.Children.Add(enabled);

        Button up = SmallButton("Up", "Move this rule up (earlier rules win)");
        up.IsEnabled = index > 0;
        up.Click += (_, _) => Move(index, index - 1);
        Grid.SetColumn(up, 2);
        head.Children.Add(up);

        Button down = SmallButton("Down", "Move this rule down");
        down.IsEnabled = index < _entries.Count - 1;
        down.Click += (_, _) => Move(index, index + 1);
        Grid.SetColumn(down, 3);
        head.Children.Add(down);

        Button remove = SmallButton("Remove", "Remove this rule");
        remove.Click += (_, _) => Remove(index);
        Grid.SetColumn(remove, 4);
        head.Children.Add(remove);

        var body = new StackPanel { Margin = new Thickness(0, 8, 0, 0) };
        body.Children.Add(GlobRow(
            "Application glob",
            "Matched against the app id. Leave empty to match any application.",
            MatchString(raw, "appId"),
            text => SetMatchString(raw, "appId", text)));

        body.Children.Add(GlobRow(
            "Title glob",
            "Matched against the window title. Every filled field must match (AND).",
            MatchString(raw, "title"),
            text => SetMatchString(raw, "title", text)));

        var actionPanel = new StackPanel
        {
            Orientation = System.Windows.Controls.Orientation.Horizontal,
            Margin = new Thickness(0, 4, 0, 0),
        };
        actionPanel.Children.Add(new TextBlock
        {
            Text = "Action",
            Width = 130,
            VerticalAlignment = VerticalAlignment.Center,
            FontWeight = FontWeights.SemiBold,
        });
        var action = new ComboBox
        {
            Width = 180,
            ItemsSource = Actions.Select(entry => entry.Label).ToList(),
            SelectedIndex = Math.Max(0, Array.FindIndex(Actions, entry => entry.Mode == RuleTile(raw))),
            VerticalContentAlignment = VerticalAlignment.Center,
        };
        action.SelectionChanged += (_, _) =>
        {
            if (action.SelectedIndex < 0 || action.SelectedIndex >= Actions.Length || raw is null) return;
            raw["tile"] = TileWire(Actions[action.SelectedIndex].Mode);
            Save();
            Refresh();
        };
        actionPanel.Children.Add(action);
        body.Children.Add(actionPanel);
        body.Children.Add(errors);

        var stack = new StackPanel();
        stack.Children.Add(head);
        stack.Children.Add(body);

        Refresh();
        return new Border
        {
            Background = CardBrush,
            BorderBrush = CardBorderBrush,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(4),
            Padding = new Thickness(10, 8, 10, 8),
            Margin = new Thickness(0, 0, 0, 8),
            Child = stack,
        };
    }

    private static Button SmallButton(string text, string tooltip) => new()
    {
        Content = text,
        Padding = new Thickness(8, 2, 8, 2),
        Margin = new Thickness(6, 0, 0, 0),
        VerticalAlignment = VerticalAlignment.Center,
        ToolTip = tooltip,
    };

    /// <summary>
    /// A labelled glob box. Edits commit on Enter and on focus loss; the summary
    /// and error line are refreshed by the caller's commit/refresh closure.
    /// </summary>
    private static FrameworkElement GlobRow(
        string label,
        string tooltip,
        string text,
        Action<string> commit)
    {
        var panel = new Grid { Margin = new Thickness(0, 0, 0, 4) };
        panel.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(130) });
        panel.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var caption = new TextBlock
        {
            Text = label,
            VerticalAlignment = VerticalAlignment.Center,
            FontWeight = FontWeights.SemiBold,
        };
        Grid.SetColumn(caption, 0);
        panel.Children.Add(caption);

        var box = new TextBox
        {
            Text = text,
            ToolTip = tooltip,
            VerticalContentAlignment = VerticalAlignment.Center,
            Padding = new Thickness(4, 2, 4, 2),
        };
        box.LostFocus += (_, _) =>
        {
            box.Text = box.Text.Trim();
            commit(box.Text);
        };
        box.KeyDown += (_, args) =>
        {
            if (args.Key != Key.Enter) return;
            box.Text = box.Text.Trim();
            commit(box.Text);
            args.Handled = true;
        };
        Grid.SetColumn(box, 1);
        panel.Children.Add(box);

        return panel;
    }

    private void AddRule()
    {
        // A new row starts disabled: one click must not install a catch-all
        // `full` rule that silently turns every pair into a stacked window.
        _entries.Add(new JsonObject
        {
            ["match"] = new JsonObject { ["appId"] = "*" },
            ["tile"] = TileWire(TileMode.Full),
            ["enabled"] = false,
        });
        Save();
        Rebuild();
    }

    private void Move(int from, int to)
    {
        if (to < 0 || to >= _entries.Count || from == to) return;
        JsonNode? moved = _entries[from];
        _entries.RemoveAt(from);
        _entries.Insert(to, moved);
        Save();
        Rebuild();
    }

    private void Remove(int index)
    {
        _entries.RemoveAt(index);
        Save();
        Rebuild();
    }

    private void SetEnabled(JsonObject? raw, bool enabled)
    {
        if (raw is null) return;
        if (enabled) raw.Remove("enabled");
        else raw["enabled"] = false;
        Save();
    }

    private void SetMatchString(JsonObject? raw, string field, string value)
    {
        if (raw is null || field.Length == 0) return;
        JsonObject match = raw["match"] as JsonObject ?? new JsonObject();
        if (value.Length > 0) match[field] = value;
        else match.Remove(field);
        raw["match"] = match;
        Save();
    }

    private void Save()
    {
        string json = _entries.ToJsonString(WriteOptions);
        if (!_store.TrySet("rules-json", json, out string error))
        {
            _report($"Rules: {error}", true);
            return;
        }
        _report(
            _store.TrySave(out error)
                ? "Rules: saved."
                : $"Rules: changed in memory, but the file was not written — {error}",
            error.Length > 0);
    }

    private static List<string> Validate(JsonObject? raw, int index)
    {
        var errors = new List<string>();
        _ = Rules.ValidateRule(raw, FormattableString.Invariant($"rule[{index}]"), errors);
        return errors;
    }

    private static string MatchString(JsonObject? raw, string field)
    {
        if (raw?["match"] is not JsonObject match) return string.Empty;
        return match[field] is JsonValue value && value.GetValueKind() == JsonValueKind.String
            ? value.GetValue<string>()
            : string.Empty;
    }

    private static TileMode RuleTile(JsonObject? raw)
    {
        if (raw?["tile"] is not JsonValue value || value.GetValueKind() != JsonValueKind.String) return TileMode.Full;
        return value.GetValue<string>() switch
        {
            "left-half" => TileMode.LeftHalf,
            "right-half" => TileMode.RightHalf,
            "float" => TileMode.Float,
            _ => TileMode.Full,
        };
    }

    private static string Summary(JsonObject? raw)
    {
        if (raw is null) return "Not a rule object";
        string action = RuleTile(raw) switch
        {
            TileMode.LeftHalf => "Left half",
            TileMode.RightHalf => "Right half",
            TileMode.Float => "Float",
            _ => "Full",
        };
        string app = MatchString(raw, "appId");
        string title = MatchString(raw, "title");
        string target = app.Length > 0 ? app : "Any application";
        if (title.Length > 0) target += $", title “{title}”";
        bool enabled = raw["enabled"] is not JsonValue value || value.GetValueKind() != JsonValueKind.False;
        return string.Create(
            CultureInfo.InvariantCulture,
            $"{target} → {action}{(enabled ? string.Empty : " · disabled")}");
    }

    private static string TileWire(TileMode mode) => mode switch
    {
        TileMode.LeftHalf => "left-half",
        TileMode.RightHalf => "right-half",
        TileMode.Float => "float",
        _ => "full",
    };

    private static Brush Frozen(Color color)
    {
        var brush = new SolidColorBrush(color);
        brush.Freeze();
        return brush;
    }
}
