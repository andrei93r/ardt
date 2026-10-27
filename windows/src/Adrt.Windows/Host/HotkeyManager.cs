using System.ComponentModel;
using System.Runtime.Versioning;

namespace Adrt.Windows;

/// <summary>Modifier flags accepted by <c>RegisterHotKey</c>.</summary>
[Flags]
public enum HotkeyModifiers : uint
{
    /// <summary>No modifier (allowed, but rarely useful).</summary>
    None = 0,

    /// <summary>Alt.</summary>
    Alt = NativeMethods.MOD_ALT,

    /// <summary>Ctrl.</summary>
    Control = NativeMethods.MOD_CONTROL,

    /// <summary>Shift.</summary>
    Shift = NativeMethods.MOD_SHIFT,

    /// <summary>Windows key.</summary>
    Win = NativeMethods.MOD_WIN,

    /// <summary>Suppress auto-repeat while the key is held (<c>MOD_NOREPEAT</c>).</summary>
    NoRepeat = NativeMethods.MOD_NOREPEAT,
}

/// <summary>Outcome of one <see cref="HotkeyManager.Register"/> call.</summary>
/// <param name="Id">Caller-supplied registration id.</param>
/// <param name="Modifiers">Requested modifiers.</param>
/// <param name="VirtualKey">Requested virtual-key code.</param>
/// <param name="Registered">True when the OS accepted the binding.</param>
/// <param name="ErrorCode">Win32 error code (0 on success).</param>
/// <param name="Error">Human-readable reason, empty on success.</param>
public readonly record struct HotkeyRegistration(
    int Id,
    HotkeyModifiers Modifiers,
    uint VirtualKey,
    bool Registered,
    int ErrorCode,
    string Error);

/// <summary>
/// Owns a <c>RegisterHotKey</c> registration table and reports conflicts.
/// </summary>
/// <remarks>
/// Registrations are owned by the calling thread and <c>WM_HOTKEY</c> is posted
/// to that thread's queue, so register from the thread that runs the UI message
/// loop (pass its window handle when there is one). A refused binding is
/// returned as a failed <see cref="HotkeyRegistration"/> rather than thrown:
/// the Windows default table must be auditable, and a reserved system combo is
/// a normal outcome, not a crash.
/// </remarks>
[SupportedOSPlatform("windows")]
public sealed class HotkeyManager : IDisposable
{
    private readonly Dictionary<int, HotkeyRegistration> _registrations = [];
    private readonly object _gate = new();
    private readonly nint _targetWindow;
    private int _disposed;

    /// <summary>Create a manager that posts <c>WM_HOTKEY</c> to the calling thread (no window).</summary>
    public HotkeyManager()
        : this(0)
    {
    }

    /// <summary>Create a manager that posts <c>WM_HOTKEY</c> to <paramref name="targetWindow"/>.</summary>
    public HotkeyManager(nint targetWindow)
    {
        _targetWindow = targetWindow;
    }

    /// <summary>Snapshot of the bindings currently accepted by the OS, ordered by id.</summary>
    public IReadOnlyList<HotkeyRegistration> Registrations
    {
        get
        {
            lock (_gate)
            {
                return _registrations.Values.OrderBy(registration => registration.Id).ToArray();
            }
        }
    }

    /// <summary>Register a hotkey. Returns the outcome; conflicts are reported, not thrown.</summary>
    /// <param name="id">Unique positive id for this binding.</param>
    /// <param name="modifiers">Modifiers to hold.</param>
    /// <param name="virtualKey">Virtual-key code (e.g. <c>0x48</c> for H).</param>
    public HotkeyRegistration Register(int id, HotkeyModifiers modifiers, uint virtualKey)
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(id);
        ArgumentOutOfRangeException.ThrowIfZero(virtualKey);
        ArgumentOutOfRangeException.ThrowIfGreaterThan(virtualKey, 0xFFu);

        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);

            if (_registrations.ContainsKey(id))
            {
                return new HotkeyRegistration(
                    id,
                    modifiers,
                    virtualKey,
                    false,
                    NativeMethods.ERROR_HOTKEY_ALREADY_REGISTERED,
                    "id is already registered by this process");
            }

            if (NativeMethods.RegisterHotKey(_targetWindow, id, (uint)modifiers, virtualKey))
            {
                var registration = new HotkeyRegistration(id, modifiers, virtualKey, true, 0, "");
                _registrations.Add(id, registration);
                return registration;
            }

            int errorCode = (int)NativeMethods.GetLastError();
            return new HotkeyRegistration(
                id,
                modifiers,
                virtualKey,
                false,
                errorCode,
                DescribeError(errorCode));
        }
    }

    /// <summary>Unregister one binding. Returns true when it was registered and the OS released it.</summary>
    public bool Unregister(int id)
    {
        lock (_gate)
        {
            if (!_registrations.Remove(id)) return false;
            return NativeMethods.UnregisterHotKey(_targetWindow, id);
        }
    }

    /// <summary>Unregister every binding and return how many were released.</summary>
    public int UnregisterAll()
    {
        lock (_gate)
        {
            int released = 0;
            foreach (int id in _registrations.Keys)
            {
                if (NativeMethods.UnregisterHotKey(_targetWindow, id)) released++;
            }

            _registrations.Clear();
            return released;
        }
    }

    /// <summary>Release all registrations.</summary>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
        UnregisterAll();
    }

    /// <summary>Render a binding for logs and conflict messages (e.g. <c>Ctrl+Win+H</c>).</summary>
    public static string Describe(HotkeyModifiers modifiers, uint virtualKey)
    {
        var parts = new List<string>(5);
        if (modifiers.HasFlag(HotkeyModifiers.Win)) parts.Add("Win");
        if (modifiers.HasFlag(HotkeyModifiers.Control)) parts.Add("Ctrl");
        if (modifiers.HasFlag(HotkeyModifiers.Alt)) parts.Add("Alt");
        if (modifiers.HasFlag(HotkeyModifiers.Shift)) parts.Add("Shift");
        parts.Add(KeyName(virtualKey));
        return string.Join('+', parts);
    }

    private static string KeyName(uint virtualKey) => virtualKey switch
    {
        >= 'A' and <= 'Z' => ((char)virtualKey).ToString(),
        >= '0' and <= '9' => ((char)virtualKey).ToString(),
        >= 0x70 and <= 0x87 => FormattableString.Invariant($"F{virtualKey - 0x6F}"),
        _ => FormattableString.Invariant($"0x{virtualKey:X2}"),
    };

    private static string DescribeError(int errorCode) => errorCode switch
    {
        NativeMethods.ERROR_HOTKEY_ALREADY_REGISTERED => "already registered by another application",
        NativeMethods.ERROR_ACCESS_DENIED => "access denied",
        NativeMethods.ERROR_INVALID_PARAMETER => "invalid modifier or virtual-key",
        _ => new Win32Exception(errorCode).Message,
    };
}
