// One typed row in the settings window. A row owns its editor and knows how to
// reload from, validate against and reset through the SettingsStore.
using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using Adrt.Core;

namespace Adrt.Settings;

/// <summary>A descriptor-driven row: title, key, editor and a per-row reset.</summary>
internal sealed class SettingRow
{
    private static readonly Brush SeparatorBrush = Frozen(Color.FromRgb(0xE2, 0xE2, 0xE2));

    private readonly SettingsStore _store;
    private readonly Action<string, bool> _report;
    private Action _reload = static () => { };
    private Button? _reset;
    private bool _syncing;

    public SettingRow(SettingDescriptor descriptor, SettingsStore store, Action<string, bool> report)
    {
        Descriptor = descriptor;
        _store = store;
        _report = report;
        Label = SettingLabels.For(descriptor.Key);
        Category = SettingsCategories.For(descriptor.Key);

        FrameworkElement editor = CreateEditor();
        Container = BuildContainer(editor);
        _reload();
    }

    public SettingDescriptor Descriptor { get; }

    public string Label { get; }

    public SettingCategory Category { get; }

    /// <summary>The row's visual, whose visibility the search filter toggles.</summary>
    public FrameworkElement Container { get; }

    /// <summary>True when <paramref name="query"/> matches the title, key or category.</summary>
    public bool Matches(string query) =>
        query.Length == 0 ||
        Label.Contains(query, StringComparison.OrdinalIgnoreCase) ||
        Descriptor.Key.Contains(query, StringComparison.OrdinalIgnoreCase) ||
        Category.Title.Contains(query, StringComparison.OrdinalIgnoreCase);

    /// <summary>Re-read the value from the store into the editor.</summary>
    public void Reload() => _reload();

    private FrameworkElement CreateEditor()
    {
        switch (Descriptor.Type)
        {
            case SettingType.Bool:
                return CreateCheckBox();
            case SettingType.Int:
            case SettingType.Uint:
                return CreateNumberBox();
            case SettingType.Strv:
                return CreateListBox();
            case SettingType.Enum:
            case SettingType.String:
            default:
                return CreateTextBox();
        }
    }

    private FrameworkElement CreateCheckBox()
    {
        var check = new CheckBox
        {
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Left,
            MinWidth = 24,
        };
        check.Checked += (_, _) =>
        {
            if (!_syncing) Commit(check.IsChecked == true);
        };
        check.Unchecked += (_, _) =>
        {
            if (!_syncing) Commit(check.IsChecked == true);
        };
        _reload = () =>
        {
            _syncing = true;
            check.IsChecked = _store.GetBool(Descriptor.Key);
            _syncing = false;
            UpdateResetState();
        };
        return check;
    }

    private FrameworkElement CreateNumberBox()
    {
        var box = new TextBox
        {
            Width = 120,
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalContentAlignment = VerticalAlignment.Center,
            Padding = new Thickness(4, 2, 4, 2),
            ToolTip = BoundsTooltip(),
        };
        box.LostFocus += (_, _) => CommitNumber(box);
        box.KeyDown += (_, args) =>
        {
            if (args.Key != Key.Enter) return;
            CommitNumber(box);
            args.Handled = true;
        };
        _reload = () =>
        {
            box.Text = FormatNumber(_store.GetNumber(Descriptor.Key));
            UpdateResetState();
        };
        return box;
    }

    private FrameworkElement CreateTextBox()
    {
        IReadOnlyList<string>? choices = SettingChoices.For(Descriptor);
        if (choices is not null)
        {
            var combo = new ComboBox
            {
                Width = 260,
                HorizontalAlignment = HorizontalAlignment.Left,
                VerticalContentAlignment = VerticalAlignment.Center,
                IsEditable = true,
                IsTextSearchEnabled = true,
                ItemsSource = choices,
                ToolTip = $"Known values: {string.Join(", ", choices)}",
            };
            combo.SelectionChanged += (_, _) =>
            {
                if (!_syncing) Commit(combo.Text);
            };
            combo.LostFocus += (_, _) =>
            {
                if (!_syncing) Commit(combo.Text);
            };
            _reload = () =>
            {
                _syncing = true;
                combo.Text = _store.GetString(Descriptor.Key);
                _syncing = false;
                UpdateResetState();
            };
            return combo;
        }

        var box = new TextBox
        {
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalContentAlignment = VerticalAlignment.Center,
            Padding = new Thickness(4, 2, 4, 2),
        };
        box.LostFocus += (_, _) => Commit(box.Text);
        box.KeyDown += (_, args) =>
        {
            if (args.Key != Key.Enter) return;
            Commit(box.Text);
            args.Handled = true;
        };
        _reload = () =>
        {
            box.Text = _store.GetString(Descriptor.Key);
            UpdateResetState();
        };
        return box;
    }

    private FrameworkElement CreateListBox()
    {
        var box = new TextBox
        {
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalContentAlignment = VerticalAlignment.Center,
            Padding = new Thickness(4, 2, 4, 2),
            ToolTip = "Comma-separated list; leave empty for none.",
        };
        box.LostFocus += (_, _) => CommitList(box);
        box.KeyDown += (_, args) =>
        {
            if (args.Key != Key.Enter) return;
            CommitList(box);
            args.Handled = true;
        };
        _reload = () =>
        {
            box.Text = string.Join(", ", _store.GetStrings(Descriptor.Key));
            UpdateResetState();
        };
        return box;
    }

    private FrameworkElement BuildContainer(FrameworkElement editor)
    {
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(300) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var labels = new StackPanel
        {
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(0, 0, 12, 0),
        };
        labels.Children.Add(new TextBlock
        {
            Text = Label,
            FontWeight = FontWeights.SemiBold,
            TextWrapping = TextWrapping.Wrap,
        });
        labels.Children.Add(new TextBlock
        {
            Text = Descriptor.Key,
            FontSize = 11,
            Foreground = SystemColors.GrayTextBrush,
            FontFamily = new FontFamily("Consolas"),
        });
        Grid.SetColumn(labels, 0);
        grid.Children.Add(labels);

        editor.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(editor, 1);
        grid.Children.Add(editor);

        var reset = new Button
        {
            Content = "Reset",
            Padding = new Thickness(8, 2, 8, 2),
            Margin = new Thickness(8, 0, 0, 0),
            VerticalAlignment = VerticalAlignment.Center,
            ToolTip = $"Reset “{Label}” to its default",
        };
        reset.Click += (_, _) => ResetToDefault();
        Grid.SetColumn(reset, 2);
        grid.Children.Add(reset);
        _reset = reset;

        return new Border
        {
            BorderBrush = SeparatorBrush,
            BorderThickness = new Thickness(0, 0, 0, 1),
            Padding = new Thickness(0, 6, 0, 6),
            Child = grid,
            ToolTip = $"{Descriptor.Type} · default {FormatDefault()}",
        };
    }

    private void CommitNumber(TextBox box)
    {
        if (!TryParseNumber(box.Text, out double value, out string error))
        {
            _report($"{Label}: {error}", true);
            return;
        }
        box.Text = FormatNumber(value);
        Commit(value);
    }

    private void CommitList(TextBox box)
    {
        string[] items = box.Text.Split(
            ',',
            StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        box.Text = string.Join(", ", items);
        Commit(items);
    }

    private void Commit(object? value)
    {
        if (!_store.TrySet(Descriptor.Key, value, out string error))
        {
            _report($"{Label}: {error}", true);
            UpdateResetState();
            return;
        }

        UpdateResetState();
        _report(
            _store.TrySave(out error)
                ? $"{Label}: saved."
                : $"{Label}: changed in memory, but the file was not written — {error}",
            error.Length > 0);
    }

    private void ResetToDefault()
    {
        bool changed = _store.Reset(Descriptor.Key);
        _reload();
        if (!changed)
        {
            _report($"{Label}: already at its default.", false);
            return;
        }

        _report(
            _store.TrySave(out string error)
                ? $"{Label}: reset to default."
                : $"{Label}: reset in memory, but the file was not written — {error}",
            error.Length > 0);
    }

    private void UpdateResetState()
    {
        if (_reset is not null) _reset.IsEnabled = !_store.IsDefault(Descriptor.Key);
    }

    private string FormatDefault()
    {
        object? value = Descriptor.Default;
        return value switch
        {
            bool flag => flag ? "true" : "false",
            double number => FormatNumber(number),
            string text => text.Length == 0 ? "(empty)" : text,
            IEnumerable<string> items => FormatList(items),
            _ => Convert.ToString(value, CultureInfo.InvariantCulture) ?? "(none)",
        };
    }

    private static string FormatList(IEnumerable<string> items)
    {
        string text = string.Join(", ", items);
        return text.Length == 0 ? "(empty)" : text;
    }

    private string BoundsTooltip()
    {
        if (Descriptor.Min is double min && Descriptor.Max is double max)
        {
            return FormattableString.Invariant($"Between {min:0.###} and {max:0.###}.");
        }
        if (Descriptor.Min is double lower) return FormattableString.Invariant($"At least {lower:0.###}.");
        if (Descriptor.Max is double upper) return FormattableString.Invariant($"At most {upper:0.###}.");
        return Descriptor.Type == SettingType.Uint ? "Zero or more." : "A whole number.";
    }

    private bool TryParseNumber(string text, out double value, out string error)
    {
        error = string.Empty;
        if (!double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out value) &&
            !double.TryParse(text, NumberStyles.Float, CultureInfo.CurrentCulture, out value))
        {
            error = $"“{text}” is not a number.";
            return false;
        }

        if (!double.IsFinite(value))
        {
            error = "The value must be finite.";
            return false;
        }

        if ((Descriptor.Type is SettingType.Int or SettingType.Uint) && Math.Truncate(value) != value)
        {
            error = "The value must be a whole number.";
            return false;
        }

        if (Descriptor.Type == SettingType.Uint && value < 0)
        {
            error = "The value must be zero or more.";
            return false;
        }

        if (Descriptor.Min is double min && value < min)
        {
            error = FormattableString.Invariant($"The value must be at least {min:0.###}.");
            return false;
        }

        if (Descriptor.Max is double max && value > max)
        {
            error = FormattableString.Invariant($"The value must be at most {max:0.###}.");
            return false;
        }

        return true;
    }

    private static string FormatNumber(double value)
    {
        if (Math.Truncate(value) == value && Math.Abs(value) < 1e15)
        {
            return value.ToString("0", CultureInfo.InvariantCulture);
        }
        return value.ToString("0.############", CultureInfo.InvariantCulture);
    }

    private static Brush Frozen(Color color)
    {
        var brush = new SolidColorBrush(color);
        brush.Freeze();
        return brush;
    }
}
