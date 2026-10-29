namespace Adrt.Settings;

/// <summary>The top-level pages of the settings window.</summary>
/// <remarks>
/// The numeric order is the tab order, so <see cref="SettingsWindowHost.Show"/>
/// and the tray can name a page without depending on the window's control tree.
/// </remarks>
public enum SettingsPage
{
    /// <summary>The descriptor-driven settings rows.</summary>
    Settings = 0,

    /// <summary>The placement-rules editor.</summary>
    Rules = 1,

    /// <summary>The app registry: never-tile, forget, clear, export and import.</summary>
    Apps = 2,
}
