using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using Adrt.Core;

namespace Adrt.Windows.Overlay;

/// <summary>
/// The focus border: one layered, click-through, topmost window per monitor,
/// painted with GDI (no WPF, no Direct2D).
/// </summary>
/// <remarks>
/// <para>
/// Each monitor gets its own overlay when a border is first drawn there, sized
/// to the monitor's full bounds. Only the overlay under the focused window is
/// visible, so a mixed-DPI desktop never stretches one surface across two
/// coordinate systems. The window carries
/// <c>WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW</c>
/// and answers <c>HTTRANSPARENT</c>, so it can never take focus or a click.
/// </para>
/// <para>
/// Drawing is a 32-bit top-down DIB: transparent everywhere except a
/// <see cref="Thickness"/>-pixel accent band just inside the frame. The band is
/// drawn inside the window's visible frame so it never covers a neighbouring
/// tile (the W3 layout has zero gaps). The DIB is cached and only repainted and
/// handed to <c>UpdateLayeredWindow</c> when the frame actually changes.
/// </para>
/// </remarks>
[SupportedOSPlatform("windows")]
internal sealed class BorderWindow : IDisposable
{
    /// <summary>Accent blue as premultiplied BGRA: #3B82F6, opaque.</summary>
    private const int Accent = unchecked((int)0xFF3B82F6);

    /// <summary>Border thickness in physical pixels (the product spec's 2px).</summary>
    private const int Thickness = 2;

    private const string ClassName = "Adrt.FocusBorder";

    private static readonly OverlayNativeMethods.WndProcDelegate WindowProcedure = OnMessage;
    private static readonly nint WindowProcedurePointer =
        Marshal.GetFunctionPointerForDelegate(WindowProcedure);

    private readonly Dictionary<nint, MonitorSurface> _surfaces = [];
    private readonly Action<string>? _log;
    private bool _visible;
    private int _disposed;

    public BorderWindow(Action<string>? log = null)
    {
        _log = log;
    }

    /// <summary>True when at least one overlay window is shown.</summary>
    public bool IsVisible => _visible;

    /// <summary>True when <paramref name="handle"/> is one of the overlay windows.</summary>
    public bool IsOwnWindow(nint handle)
    {
        if (handle == 0) return false;
        foreach (MonitorSurface surface in _surfaces.Values)
        {
            if (surface.Handle == handle) return true;
        }

        return false;
    }

    /// <summary>Draw the border around <paramref name="frame"/> on the monitor it occupies.</summary>
    public void Show(IReadOnlyList<MonitorInfo> monitors, Rect frame)
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
        ArgumentNullException.ThrowIfNull(monitors);

        MonitorInfo? target = FindMonitor(monitors, frame);
        if (target is null)
        {
            Hide();
            return;
        }

        foreach ((nint handle, MonitorSurface surface) in _surfaces)
        {
            if (handle != target.Handle) surface.Hide();
        }

        if (!_surfaces.TryGetValue(target.Handle, out MonitorSurface? drawing))
        {
            drawing = new MonitorSurface(_log);
            _surfaces.Add(target.Handle, drawing);
        }

        drawing.Ensure(target);
        drawing.Draw(frame);
        _visible = true;
    }

    /// <summary>Hide every overlay but keep the windows (and their DIBs) alive.</summary>
    public void Hide()
    {
        foreach (MonitorSurface surface in _surfaces.Values) surface.Hide();
        _visible = false;
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0) return;

        foreach (MonitorSurface surface in _surfaces.Values) surface.Dispose();
        _surfaces.Clear();
        _visible = false;
        GC.SuppressFinalize(this);
    }

    private static MonitorInfo? FindMonitor(IReadOnlyList<MonitorInfo> monitors, Rect frame)
    {
        MonitorInfo? best = null;
        double bestArea = 0;
        foreach (MonitorInfo monitor in monitors)
        {
            Rect bounds = monitor.Bounds;
            double width = Math.Min(frame.Right, bounds.Right) - Math.Max(frame.X, bounds.X);
            double height = Math.Min(frame.Bottom, bounds.Bottom) - Math.Max(frame.Y, bounds.Y);
            if (width <= 0 || height <= 0) continue;

            double area = width * height;
            if (area <= bestArea) continue;
            bestArea = area;
            best = monitor;
        }

        if (best is not null) return best;

        // A frame fully off-screen (mid-animation, a stale rect) still belongs to
        // the nearest monitor, not to no monitor at all.
        double centreX = frame.X + frame.Width / 2;
        double centreY = frame.Y + frame.Height / 2;
        return monitors
            .OrderBy(monitor =>
            {
                double dx = centreX - (monitor.Bounds.X + monitor.Bounds.Width / 2);
                double dy = centreY - (monitor.Bounds.Y + monitor.Bounds.Height / 2);
                return dx * dx + dy * dy;
            })
            .FirstOrDefault();
    }

    private static nint OnMessage(nint hWnd, uint msg, nint wParam, nint lParam)
    {
        // Input plumbing only: the overlay must never intercept a click or an
        // activation. No tiling policy runs in a window procedure.
        switch (msg)
        {
            case OverlayNativeMethods.WM_NCHITTEST:
                return OverlayNativeMethods.HTTRANSPARENT;
            case OverlayNativeMethods.WM_MOUSEACTIVATE:
                return OverlayNativeMethods.MA_NOACTIVATE;
            case OverlayNativeMethods.WM_ERASEBKGND:
                return 1;
            default:
                return OverlayNativeMethods.DefWindowProc(hWnd, msg, wParam, lParam);
        }
    }

    /// <summary>One monitor-sized layered window with its cached DIB.</summary>
    private sealed class MonitorSurface : IDisposable
    {
        private readonly Action<string>? _log;
        private nint _handle;
        private nint _memoryDc;
        private nint _bitmap;
        private nint _previousBitmap;
        private nint _bits;
        private int[] _pixels = [];
        private int _x;
        private int _y;
        private int _width;
        private int _height;
        private Rect _lastFrame;
        private bool _hasFrame;
        private bool _updateFailureLogged;

        public MonitorSurface(Action<string>? log)
        {
            _log = log;
        }

        public nint Handle => _handle;

        /// <summary>Create or re-create the surface when its monitor bounds changed.</summary>
        public void Ensure(MonitorInfo monitor)
        {
            int x = Round(monitor.Bounds.X);
            int y = Round(monitor.Bounds.Y);
            int width = Math.Max(1, Round(monitor.Bounds.Width));
            int height = Math.Max(1, Round(monitor.Bounds.Height));

            if (_handle != 0 && x == _x && y == _y && width == _width && height == _height) return;

            Release();
            Create(x, y, width, height);
        }

        /// <summary>Paint the 2px band for <paramref name="frame"/> and publish it.</summary>
        public void Draw(Rect frame)
        {
            if (_handle == 0) return;
            if (_hasFrame && frame == _lastFrame)
            {
                // Still ensure the window is mapped: Hide() may have run since.
                OverlayNativeMethods.ShowWindow(_handle, OverlayNativeMethods.SW_SHOWNOACTIVATE);
                return;
            }

            Array.Clear(_pixels);
            int left = Math.Clamp(Round(frame.X) - _x, 0, _width);
            int right = Math.Clamp(Round(frame.X) + Round(frame.Width) - _x, 0, _width);
            int top = Math.Clamp(Round(frame.Y) - _y, 0, _height);
            int bottom = Math.Clamp(Round(frame.Y) + Round(frame.Height) - _y, 0, _height);

            if (right - left >= Thickness * 2 && bottom - top >= Thickness * 2)
            {
                PaintBorder(left, top, right, bottom);
            }

            Marshal.Copy(_pixels, 0, _bits, _pixels.Length);
            Publish();
            _lastFrame = frame;
            _hasFrame = true;
            OverlayNativeMethods.ShowWindow(_handle, OverlayNativeMethods.SW_SHOWNOACTIVATE);
        }

        public void Hide()
        {
            if (_handle != 0) OverlayNativeMethods.ShowWindow(_handle, OverlayNativeMethods.SW_HIDE);
        }

        public void Dispose()
        {
            Release();
            GC.SuppressFinalize(this);
        }

        private void Create(int x, int y, int width, int height)
        {
            WindowClassRegistration.Ensure(ClassName, WindowProcedurePointer);

            const int extendedStyle =
                OverlayNativeMethods.WS_EX_LAYERED |
                OverlayNativeMethods.WS_EX_TRANSPARENT |
                OverlayNativeMethods.WS_EX_TOOLWINDOW |
                OverlayNativeMethods.WS_EX_NOACTIVATE;

            _handle = OverlayNativeMethods.CreateWindowEx(
                extendedStyle,
                ClassName,
                "adrt focus border",
                OverlayNativeMethods.WS_POPUP,
                x,
                y,
                width,
                height,
                0,
                0,
                WindowClassRegistration.ModuleHandle,
                0);

            if (_handle == 0)
            {
                int error = Marshal.GetLastWin32Error();
                throw new Win32Exception(error, "could not create the border overlay window");
            }

            _x = x;
            _y = y;
            _width = width;
            _height = height;

            _memoryDc = OverlayNativeMethods.CreateCompatibleDC(0);
            if (_memoryDc == 0)
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "could not create the border overlay DC");
            }

            var bitmapInfo = new OverlayNativeMethods.BITMAPINFO
            {
                bmiHeader = new OverlayNativeMethods.BITMAPINFOHEADER
                {
                    biSize = (uint)Marshal.SizeOf<OverlayNativeMethods.BITMAPINFOHEADER>(),
                    biWidth = width,
                    // Negative height: a top-down DIB, row 0 at the top.
                    biHeight = -height,
                    biPlanes = 1,
                    biBitCount = 32,
                    biCompression = OverlayNativeMethods.BI_RGB,
                },
            };

            _bitmap = OverlayNativeMethods.CreateDIBSection(
                _memoryDc,
                ref bitmapInfo,
                OverlayNativeMethods.DIB_RGB_COLORS,
                out _bits,
                0,
                0);

            if (_bitmap == 0 || _bits == 0)
            {
                throw new Win32Exception(
                    Marshal.GetLastWin32Error(),
                    "could not create the border overlay DIB");
            }

            _previousBitmap = OverlayNativeMethods.SelectObject(_memoryDc, _bitmap);
            _pixels = new int[width * height];
            _hasFrame = false;

            OverlayNativeMethods.SetWindowPos(
                _handle,
                OverlayNativeMethods.HwndTopMost,
                x,
                y,
                width,
                height,
                OverlayNativeMethods.SWP_NOACTIVATE | OverlayNativeMethods.SWP_SHOWWINDOW);
        }

        private void PaintBorder(int left, int top, int right, int bottom)
        {
            for (int y = top; y < top + Thickness; y++) FillRow(y, left, right);
            for (int y = bottom - Thickness; y < bottom; y++) FillRow(y, left, right);
            for (int y = top + Thickness; y < bottom - Thickness; y++)
            {
                FillRow(y, left, left + Thickness);
                FillRow(y, right - Thickness, right);
            }
        }

        private void FillRow(int y, int from, int to)
        {
            int offset = y * _width;
            for (int x = from; x < to; x++) _pixels[offset + x] = Accent;
        }

        private void Publish()
        {
            nint screenDc = OverlayNativeMethods.GetDC(0);
            try
            {
                var destination = new OverlayNativeMethods.POINT(_x, _y);
                var size = new OverlayNativeMethods.SIZE(_width, _height);
                var source = new OverlayNativeMethods.POINT(0, 0);
                var blend = new OverlayNativeMethods.BLENDFUNCTION
                {
                    BlendOp = OverlayNativeMethods.AC_SRC_OVER,
                    BlendFlags = 0,
                    SourceConstantAlpha = 255,
                    AlphaFormat = OverlayNativeMethods.AC_SRC_ALPHA,
                };

                if (!OverlayNativeMethods.UpdateLayeredWindow(
                        _handle,
                        screenDc,
                        ref destination,
                        ref size,
                        _memoryDc,
                        ref source,
                        0,
                        ref blend,
                        OverlayNativeMethods.ULW_ALPHA) &&
                    !_updateFailureLogged)
                {
                    _updateFailureLogged = true;
                    _log?.Invoke(FormattableString.Invariant(
                        $"adrt: border UpdateLayeredWindow failed ({Marshal.GetLastWin32Error()}); the focus border will not draw"));
                }
            }
            finally
            {
                if (screenDc != 0) _ = OverlayNativeMethods.ReleaseDC(0, screenDc);
            }
        }

        private void Release()
        {
            if (_previousBitmap != 0 && _memoryDc != 0)
            {
                _ = OverlayNativeMethods.SelectObject(_memoryDc, _previousBitmap);
                _previousBitmap = 0;
            }

            if (_bitmap != 0)
            {
                _ = OverlayNativeMethods.DeleteObject(_bitmap);
                _bitmap = 0;
            }

            if (_memoryDc != 0)
            {
                _ = OverlayNativeMethods.DeleteDC(_memoryDc);
                _memoryDc = 0;
            }

            if (_handle != 0)
            {
                _ = OverlayNativeMethods.DestroyWindow(_handle);
                _handle = 0;
            }

            _bits = 0;
            _pixels = [];
            _width = 0;
            _height = 0;
            _hasFrame = false;
        }

        private static int Round(double value) => (int)Math.Round(value, MidpointRounding.AwayFromZero);
    }
}
