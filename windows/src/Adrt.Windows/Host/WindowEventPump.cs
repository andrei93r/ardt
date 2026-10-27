using System.Collections.Concurrent;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace Adrt.Windows;

/// <summary>Raw window events delivered by the WinEvent hook. No interpretation happens in the hook.</summary>
public enum WindowEventKind
{
    /// <summary>A window object was created (<c>EVENT_OBJECT_CREATE</c>).</summary>
    Create,

    /// <summary>A window object was destroyed (<c>EVENT_OBJECT_DESTROY</c>).</summary>
    Destroy,

    /// <summary>A window became visible (<c>EVENT_OBJECT_SHOW</c>).</summary>
    Show,

    /// <summary>A window was hidden (<c>EVENT_OBJECT_HIDE</c>).</summary>
    Hide,

    /// <summary>A window moved or resized (<c>EVENT_OBJECT_LOCATIONCHANGE</c>).</summary>
    LocationChange,

    /// <summary>The foreground window changed (<c>EVENT_SYSTEM_FOREGROUND</c>).</summary>
    Foreground,

    /// <summary>A window started minimizing (<c>EVENT_SYSTEM_MINIMIZESTART</c>).</summary>
    MinimizeStart,

    /// <summary>A window finished minimizing/restoring (<c>EVENT_SYSTEM_MINIMIZEEND</c>).</summary>
    MinimizeEnd,

    /// <summary>A user move/resize drag started (<c>EVENT_SYSTEM_MOVESIZESTART</c>).</summary>
    MoveSizeStart,

    /// <summary>A user move/resize drag ended; read the final rectangle then (<c>EVENT_SYSTEM_MOVESIZEEND</c>).</summary>
    MoveSizeEnd,

    /// <summary>A window was cloaked, e.g. moved to another virtual desktop (<c>EVENT_OBJECT_CLOAKED</c>).</summary>
    Cloaked,

    /// <summary>A window was uncloaked (<c>EVENT_OBJECT_UNCLOAKED</c>).</summary>
    Uncloaked,
}

/// <summary>One raw Win32 event, exactly as delivered by the OS.</summary>
/// <param name="Kind">Event family.</param>
/// <param name="Window">HWND the event refers to (never zero).</param>
/// <param name="EventTimeMs">The <c>dwmsEventTime</c> supplied by Windows, in milliseconds.</param>
public readonly record struct WindowEvent(WindowEventKind Kind, nint Window, uint EventTimeMs);

/// <summary>
/// Out-of-context <c>SetWinEventHook</c> pump.
/// </summary>
/// <remarks>
/// <para>
/// The pump owns one STA thread with a message loop and installs the hook on
/// that thread, so callbacks are delivered there. Callbacks only enqueue raw
/// events — all policy belongs to the drain consumer, matching the GNOME
/// adapter's rule.
/// </para>
/// <para>
/// A 50 ms thread timer pokes <see cref="Signaled"/> so the host can run its
/// coalesced drain even when no window event arrives. Events are queued in a
/// bounded queue; when it fills, events are dropped and
/// <see cref="DroppedCount"/> is incremented (the safety sweep repairs state
/// later; a stalled process must not grow without limit).
/// </para>
/// </remarks>
[SupportedOSPlatform("windows")]
public sealed class WindowEventPump : IDisposable
{
    private const int MaxQueuedEvents = 8192;
    private const uint TimerIntervalMs = 50;
    private const int DefaultDrainLimit = 256;

    private static readonly nint TimerId = 1;

    private readonly ConcurrentQueue<WindowEvent> _queue = new();
    private readonly AutoResetEvent _signal = new(false);
    private readonly NativeMethods.WinEventProc _callback;
    private readonly bool _skipOwnProcess;
    private readonly object _gate = new();

    private nint _hook;
    private uint _threadId;
    private Thread? _thread;
    private Exception? _startupError;
    private int _dropped;
    private int _disposed;

    /// <summary>Create a pump. <paramref name="skipOwnProcess"/> filters this process's windows by default.</summary>
    public WindowEventPump(bool skipOwnProcess = true)
    {
        _skipOwnProcess = skipOwnProcess;
        _callback = OnWinEvent;
    }

    /// <summary>
    /// Auto-reset handle poked on every event and every 50 ms tick. Wait on it to
    /// drive the host drain; do not dispose it.
    /// </summary>
    public WaitHandle Signaled => _signal;

    /// <summary>Number of events currently waiting to be drained.</summary>
    public int PendingCount => _queue.Count;

    /// <summary>Number of events dropped because the queue was full.</summary>
    public int DroppedCount => Volatile.Read(ref _dropped);

    /// <summary>Start the STA pump thread and install the hook and drain timer.</summary>
    /// <exception cref="InvalidOperationException">The pump is already running, or the hook/timer could not be installed.</exception>
    /// <exception cref="ObjectDisposedException">The pump has been disposed.</exception>
    public void Start()
    {
        ObjectDisposedException.ThrowIf(IsDisposed, this);

        lock (_gate)
        {
            if (_thread is not null) throw new InvalidOperationException("The window event pump is already running.");

            _startupError = null;
            var ready = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var thread = new Thread(() => Run(ready))
            {
                IsBackground = true,
                Name = "adrt-win-event-pump",
            };
            thread.SetApartmentState(ApartmentState.STA);
            _thread = thread;
            thread.Start();
            ready.Task.GetAwaiter().GetResult();

            if (_startupError is { } error)
            {
                _thread = null;
                throw new InvalidOperationException("Could not start the WinEvent pump.", error);
            }
        }
    }

    /// <summary>Take up to <paramref name="maxEvents"/> events off the queue, oldest first.</summary>
    public IReadOnlyList<WindowEvent> Drain(int maxEvents = DefaultDrainLimit)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(maxEvents);

        var drained = new List<WindowEvent>(Math.Min(maxEvents, DefaultDrainLimit));
        while (drained.Count < maxEvents && _queue.TryDequeue(out WindowEvent rawEvent))
        {
            drained.Add(rawEvent);
        }

        return drained;
    }

    /// <summary>Post <c>WM_QUIT</c> to the pump thread and wait for it to unhook and exit.</summary>
    public void Stop() => Shutdown();

    /// <summary>Stop the pump, unhook and release the wake-up handle.</summary>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
        if (Shutdown())
        {
            _signal.Dispose();
        }
    }

    private bool IsDisposed => Volatile.Read(ref _disposed) != 0;

    private void Run(TaskCompletionSource ready)
    {
        _threadId = NativeMethods.GetCurrentThreadId();
        try
        {
            uint flags = NativeMethods.WINEVENT_OUTOFCONTEXT;
            if (_skipOwnProcess) flags |= NativeMethods.WINEVENT_SKIPOWNPROCESS;

            _hook = NativeMethods.SetWinEventHook(
                NativeMethods.EVENT_MIN,
                NativeMethods.EVENT_MAX,
                0,
                Marshal.GetFunctionPointerForDelegate(_callback),
                0,
                0,
                flags);

            if (_hook == 0)
            {
                _startupError = new Win32Exception(Marshal.GetLastWin32Error(), "SetWinEventHook failed");
                return;
            }

            if (NativeMethods.SetTimer(0, TimerId, TimerIntervalMs, 0) == 0)
            {
                _startupError = new Win32Exception(Marshal.GetLastWin32Error(), "SetTimer failed");
                return;
            }

            ready.TrySetResult();
            PumpMessages();
        }
#pragma warning disable CA1031 // A fault on the pump thread must be reported to Start, never rethrown into the native message loop.
        catch (Exception error) when (error is not OutOfMemoryException)
#pragma warning restore CA1031
        {
            _startupError ??= error;
        }
        finally
        {
            if (_hook != 0)
            {
                NativeMethods.UnhookWinEvent(_hook);
                _hook = 0;
            }

            NativeMethods.KillTimer(0, TimerId);
            _threadId = 0;
            ready.TrySetResult();
        }
    }

    private void PumpMessages()
    {
        while (true)
        {
            int result = NativeMethods.GetMessage(out NativeMethods.MSG message, 0, 0, 0);
            if (result <= 0) return; // 0 = WM_QUIT, -1 = error.

            if (message.message == NativeMethods.WM_TIMER &&
                message.hwnd == 0 &&
                message.wParam == TimerId)
            {
                if (!IsDisposed) _signal.Set();
                continue;
            }

            NativeMethods.TranslateMessage(ref message);
            NativeMethods.DispatchMessage(ref message);
        }
    }

    private void OnWinEvent(
        nint hook,
        uint eventCode,
        nint hwnd,
        int idObject,
        int idChild,
        uint eventThreadId,
        uint eventTimeMs)
    {
        // Hooks run on the pump thread: enqueue and return. Never touch state.
        if (hwnd == 0 || idObject != NativeMethods.OBJID_WINDOW || idChild != 0) return;

        WindowEventKind? kind = Map(eventCode);
        if (kind is null) return;

        if (_queue.Count >= MaxQueuedEvents)
        {
            Interlocked.Increment(ref _dropped);
        }
        else
        {
            _queue.Enqueue(new WindowEvent(kind.Value, hwnd, eventTimeMs));
        }

        if (!IsDisposed) _signal.Set();
    }

    private static WindowEventKind? Map(uint eventCode) => eventCode switch
    {
        NativeMethods.EVENT_OBJECT_CREATE => WindowEventKind.Create,
        NativeMethods.EVENT_OBJECT_DESTROY => WindowEventKind.Destroy,
        NativeMethods.EVENT_OBJECT_SHOW => WindowEventKind.Show,
        NativeMethods.EVENT_OBJECT_HIDE => WindowEventKind.Hide,
        NativeMethods.EVENT_OBJECT_LOCATIONCHANGE => WindowEventKind.LocationChange,
        NativeMethods.EVENT_SYSTEM_FOREGROUND => WindowEventKind.Foreground,
        NativeMethods.EVENT_SYSTEM_MINIMIZESTART => WindowEventKind.MinimizeStart,
        NativeMethods.EVENT_SYSTEM_MINIMIZEEND => WindowEventKind.MinimizeEnd,
        NativeMethods.EVENT_SYSTEM_MOVESIZESTART => WindowEventKind.MoveSizeStart,
        NativeMethods.EVENT_SYSTEM_MOVESIZEEND => WindowEventKind.MoveSizeEnd,
        NativeMethods.EVENT_OBJECT_CLOAKED => WindowEventKind.Cloaked,
        NativeMethods.EVENT_OBJECT_UNCLOAKED => WindowEventKind.Uncloaked,
        _ => null,
    };

    private bool Shutdown()
    {
        Thread? thread;
        lock (_gate)
        {
            thread = _thread;
            _thread = null;
        }

        if (thread is null) return true;

        uint threadId = Volatile.Read(ref _threadId);
        if (threadId != 0)
        {
            NativeMethods.PostThreadMessage(threadId, NativeMethods.WM_QUIT, 0, 0);
        }

        return thread.Join(TimeSpan.FromSeconds(5));
    }
}
