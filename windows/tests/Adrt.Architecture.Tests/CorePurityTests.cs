namespace Adrt.Architecture.Tests;

/// <summary>
/// <c>Adrt.Core</c> is the pure model: no P/Invoke, no UI toolkit, no registry and
/// no file system. The platform host owns every one of those. These tests make
/// the rule executable instead of a comment in the csproj.
/// </summary>
public sealed class CorePurityTests
{
    private static readonly (string Token, string Why)[] BannedSourceTokens =
    [
        ("DllImport", "P/Invoke belongs in Adrt.Windows"),
        ("LibraryImport", "P/Invoke belongs in Adrt.Windows"),
        ("System.Windows", "the core must not reference a Windows UI toolkit"),
        ("System.Windows.Forms", "the core must not reference WinForms"),
        ("Microsoft.Win32", "registry/Windows-only APIs belong in Adrt.Windows"),
        ("System.IO", "file and stream IO belongs in Adrt.Windows"),
        ("Adrt.Windows", "the dependency arrow points Windows -> Core, never back"),
    ];

    [Fact]
    public void CoreSourcesAreFreeOfPlatformApis()
    {
        var sources = ArchitecturePaths.EnumerateSources(ArchitecturePaths.CoreSource).ToArray();
        Assert.NotEmpty(sources);

        var violations = new List<string>();
        foreach (var path in sources)
        {
            var relative = Path.GetRelativePath(ArchitecturePaths.WindowsRoot, path);
            var lines = File.ReadAllLines(path);
            for (var index = 0; index < lines.Length; index++)
            {
                foreach (var (token, why) in BannedSourceTokens)
                {
                    if (lines[index].Contains(token, StringComparison.Ordinal))
                    {
                        violations.Add($"{relative}:{index + 1}: '{token}' ({why})");
                    }
                }
            }
        }

        Assert.Empty(violations);
    }

    [Fact]
    public void CoreAssemblyReferencesNoPlatformAssemblies()
    {
        using var metadata = AssemblyMetadata.Read(ArchitecturePaths.CoreAssemblyPath);

        // Sanity: the reader found the real assembly rather than an empty file.
        Assert.Contains("System.Runtime", metadata.ReferencedAssemblies);

        var forbidden = metadata.ReferencedAssemblies
            .Where(IsForbiddenAssembly)
            .ToArray();

        Assert.Empty(forbidden);
    }

    [Fact]
    public void CoreAssemblyHasNoPlatformTypeReferences()
    {
        using var metadata = AssemblyMetadata.Read(ArchitecturePaths.CoreAssemblyPath);

        Assert.NotEmpty(metadata.TypeReferences);

        var forbidden = metadata.TypeReferences
            .Where(type => IsForbiddenNamespace(type.Namespace))
            .Select(type => type.FullName)
            .ToArray();

        Assert.Empty(forbidden);
    }

    private static bool IsForbiddenAssembly(string name) =>
        name.Equals("Adrt.Windows", StringComparison.Ordinal) ||
        name.Equals("System.Windows", StringComparison.Ordinal) ||
        name.Equals("System.Windows.Forms", StringComparison.Ordinal) ||
        name.Equals("WindowsBase", StringComparison.Ordinal) ||
        name.Equals("PresentationCore", StringComparison.Ordinal) ||
        name.Equals("PresentationFramework", StringComparison.Ordinal) ||
        name.StartsWith("Microsoft.Win32", StringComparison.Ordinal) ||
        name.Equals("System.IO", StringComparison.Ordinal) ||
        name.StartsWith("System.IO.", StringComparison.Ordinal);

    private static bool IsForbiddenNamespace(string ns) =>
        ns.StartsWith("System.Windows", StringComparison.Ordinal) ||
        ns.Equals("Microsoft.Win32", StringComparison.Ordinal) ||
        ns.StartsWith("Microsoft.Win32.", StringComparison.Ordinal) ||
        ns.Equals("System.IO", StringComparison.Ordinal) ||
        ns.StartsWith("System.IO.", StringComparison.Ordinal) ||
        ns.Equals("Adrt.Windows", StringComparison.Ordinal) ||
        ns.StartsWith("Adrt.Windows.", StringComparison.Ordinal);
}
