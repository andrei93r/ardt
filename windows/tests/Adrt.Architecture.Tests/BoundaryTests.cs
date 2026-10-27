using System.Reflection;

namespace Adrt.Architecture.Tests;

/// <summary>
/// The dependency arrow is one-way: <c>Adrt.Windows</c> may use the public surface
/// of <c>Adrt.Core</c>, and nothing else. No friend assemblies, no reflection
/// poking at internals.
/// </summary>
public sealed class BoundaryTests
{
    [Fact]
    public void CoreDoesNotReferenceTheWindowsHost()
    {
        using var metadata = AssemblyMetadata.Read(ArchitecturePaths.CoreAssemblyPath);

        Assert.DoesNotContain("Adrt.Windows", metadata.ReferencedAssemblies);
        Assert.Empty(metadata.TypeReferences
            .Where(type => type.Namespace.Equals("Adrt.Windows", StringComparison.Ordinal) ||
                           type.Namespace.StartsWith("Adrt.Windows.", StringComparison.Ordinal))
            .Select(type => type.FullName));
    }

    [Fact]
    public void NoInternalsVisibleToIsDeclared()
    {
        // Production projects only: this test file naturally mentions the token.
        var sourceRoot = Path.Combine(ArchitecturePaths.WindowsRoot, "src");
        Assert.True(Directory.Exists(sourceRoot), $"missing source directory: {sourceRoot}");

        var projectFiles = Directory.EnumerateFiles(sourceRoot, "*", SearchOption.AllDirectories)
            .Where(path => path.EndsWith(".cs", StringComparison.Ordinal) ||
                           path.EndsWith(".csproj", StringComparison.Ordinal) ||
                           path.EndsWith(".props", StringComparison.Ordinal) ||
                           path.EndsWith(".targets", StringComparison.Ordinal))
            .Where(path => !path.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}", StringComparison.Ordinal) &&
                           !path.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}", StringComparison.Ordinal))
            .Append(Path.Combine(ArchitecturePaths.WindowsRoot, "Directory.Build.props"))
            .Where(File.Exists)
            .ToArray();
        Assert.NotEmpty(projectFiles);

        var declarations = projectFiles
            .Where(path => File.ReadAllText(path).Contains("InternalsVisibleTo", StringComparison.Ordinal))
            .Select(path => Path.GetRelativePath(ArchitecturePaths.WindowsRoot, path))
            .ToArray();
        Assert.Empty(declarations);

        using var core = AssemblyMetadata.Read(ArchitecturePaths.CoreAssemblyPath);
        using var host = AssemblyMetadata.Read(ArchitecturePaths.WindowsAssemblyPath);
        Assert.False(core.HasInternalsVisibleToAttribute(), "Adrt.Core must not grant friend access");
        Assert.False(host.HasInternalsVisibleToAttribute(), "Adrt.Windows must not grant friend access");
    }

    [Fact]
    public void WindowsHostUsesOnlyThePublicCoreSurface()
    {
        var core = typeof(Adrt.Core.JsonLines).Assembly;
        var publicTypes = core.GetExportedTypes();
        Assert.NotEmpty(publicTypes);

        var publicTypeNames = publicTypes
            .Select(type => type.FullName!)
            .ToHashSet(StringComparer.Ordinal);

        var internalTypes = core.GetTypes()
            .Where(type => !type.IsVisible)
            .Select(type => type.FullName ?? type.Name)
            .ToHashSet(StringComparer.Ordinal);
        Assert.NotEmpty(internalTypes); // the point of the gate: internals exist and stay private

        var internalMembers = publicTypes
            .SelectMany(type => type
                .GetMembers(BindingFlags.Public | BindingFlags.NonPublic |
                            BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly)
                .Where(member => member switch
                {
                    FieldInfo field => field.IsAssembly || field.IsFamilyOrAssembly,
                    MethodBase method => method.IsAssembly || method.IsFamilyOrAssembly,
                    PropertyInfo property =>
                        property.GetMethod is { IsAssembly: true } or { IsFamilyOrAssembly: true } ||
                        property.SetMethod is { IsAssembly: true } or { IsFamilyOrAssembly: true },
                    EventInfo @event =>
                        @event.AddMethod is { IsAssembly: true } or { IsFamilyOrAssembly: true } ||
                        @event.RemoveMethod is { IsAssembly: true } or { IsFamilyOrAssembly: true },
                    _ => false,
                })
                .Select(member => $"{type.FullName}::{member.Name}"))
            .ToHashSet(StringComparer.Ordinal);
        Assert.NotEmpty(internalMembers);

        using var host = AssemblyMetadata.Read(ArchitecturePaths.WindowsAssemblyPath);
        Assert.Contains("Adrt.Core", host.ReferencedAssemblies);

        var usedInternalTypes = host.TypeReferences
            .Where(type => internalTypes.Contains(type.FullName))
            .Select(type => type.FullName)
            .ToArray();

        var usedInternalMembers = host.MemberReferences
            .Where(member => publicTypeNames.Contains(member.ParentFullName) &&
                             internalMembers.Contains($"{member.ParentFullName}::{member.Name}"))
            .Select(member => $"{member.ParentFullName}::{member.Name}")
            .ToArray();

        Assert.Empty(usedInternalTypes);
        Assert.Empty(usedInternalMembers);
    }
}
