using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace Adrt.Windows.Overlay;

/// <summary>Registers the window classes the chrome lane owns, once per process.</summary>
/// <remarks>
/// The <c>WNDPROC</c> pointer must stay alive for the life of the class; callers
/// hold their delegate in a static field and pass
/// <c>Marshal.GetFunctionPointerForDelegate</c>. The class name is the identity,
/// so calling this twice is a no-op rather than a silent second registration.
/// </remarks>
[SupportedOSPlatform("windows")]
internal static class WindowClassRegistration
{
    private static readonly object Gate = new();
    private static readonly HashSet<string> Registered = new(StringComparer.Ordinal);

    /// <summary>The module handle used for window creation.</summary>
    public static nint ModuleHandle => OverlayNativeMethods.GetModuleHandle(null);

    /// <summary>Register <paramref name="className"/> if it is not registered yet.</summary>
    /// <exception cref="Win32Exception">Registration failed for a reason other than "already exists".</exception>
    public static void Ensure(string className, nint windowProcedure)
    {
        ArgumentException.ThrowIfNullOrEmpty(className);

        lock (Gate)
        {
            if (Registered.Contains(className)) return;

            var windowClass = new OverlayNativeMethods.WNDCLASSEX
            {
                cbSize = (uint)Marshal.SizeOf<OverlayNativeMethods.WNDCLASSEX>(),
                lpfnWndProc = windowProcedure,
                hInstance = ModuleHandle,
                lpszClassName = className,
            };

            if (OverlayNativeMethods.RegisterClassEx(ref windowClass) == 0)
            {
                int error = Marshal.GetLastWin32Error();
                if (error != OverlayNativeMethods.ERROR_CLASS_ALREADY_EXISTS)
                {
                    throw new Win32Exception(error, $"RegisterClassEx failed for {className}");
                }
            }

            Registered.Add(className);
        }
    }
}
