using System.Collections.Immutable;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Runtime.CompilerServices;

namespace Adrt.Architecture.Tests;

/// <summary>
/// Locates the checkout at runtime from the compiled source path. Keeping the
/// tests independent of the build output layout means they work both with the
/// default <c>bin/obj</c> layout and with <c>--artifacts-path</c>.
/// </summary>
internal static class ArchitecturePaths
{
    /// <summary><c>windows/tests/Adrt.Architecture.Tests</c>.</summary>
    internal static string TestDirectory([CallerFilePath] string sourceFile = "") =>
        Path.GetDirectoryName(sourceFile)!;

    /// <summary><c>windows/</c>.</summary>
    internal static string WindowsRoot =>
        Path.GetFullPath(Path.Combine(TestDirectory(), "..", ".."));

    internal static string CoreSource => Path.Combine(WindowsRoot, "src", "Adrt.Core");

    internal static string WindowsSource => Path.Combine(WindowsRoot, "src", "Adrt.Windows");

    internal static string SnapshotPath => Path.Combine(TestDirectory(), "api-surface.txt");

    internal static string CoreAssemblyPath => typeof(Adrt.Core.JsonLines).Assembly.Location;

    /// <summary>
    /// The host is copied next to the test output by the project reference in the
    /// csproj. It is inspected as metadata; nothing from it is executed.
    /// </summary>
    internal static string WindowsAssemblyPath => Path.Combine(AppContext.BaseDirectory, "Adrt.Windows.dll");

    /// <summary>All C# sources under <paramref name="root"/>, ignoring build output.</summary>
    internal static IEnumerable<string> EnumerateSources(string root) =>
        Directory.EnumerateFiles(root, "*.cs", SearchOption.AllDirectories)
            .Where(path => !HasBuildOutputSegment(path))
            .OrderBy(path => path, StringComparer.Ordinal);

    private static bool HasBuildOutputSegment(string path)
    {
        var parts = path.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        return parts.Any(part => part.Equals("bin", StringComparison.OrdinalIgnoreCase) ||
                                 part.Equals("obj", StringComparison.OrdinalIgnoreCase));
    }
}

/// <summary>Minimal metadata reader over an assembly, without loading it.</summary>
internal sealed class AssemblyMetadata : IDisposable
{
    private readonly PEReader _pe;
    private readonly MetadataReader _reader;

    private AssemblyMetadata(PEReader pe)
    {
        _pe = pe;
        _reader = pe.GetMetadataReader();
        ReferencedAssemblies = _reader.AssemblyReferences
            .Select(handle => _reader.GetString(_reader.GetAssemblyReference(handle).Name))
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToArray();
        TypeReferences = _reader.TypeReferences
            .Select(Describe)
            .OrderBy(type => type.FullName, StringComparer.Ordinal)
            .ToArray();
        MemberReferences = _reader.MemberReferences
            .Select(Describe)
            .Where(member => member is not null)
            .Select(member => member!.Value)
            .OrderBy(member => member.ParentFullName, StringComparer.Ordinal)
            .ThenBy(member => member.Name, StringComparer.Ordinal)
            .ToArray();
    }

    public IReadOnlyList<string> ReferencedAssemblies { get; }

    public IReadOnlyList<TypeReferenceInfo> TypeReferences { get; }

    public IReadOnlyList<MemberReferenceInfo> MemberReferences { get; }

    public static AssemblyMetadata Read(string path)
    {
        using var stream = File.OpenRead(path);
        // Copy into memory so the PEReader does not outlive the file handle.
        var bytes = new byte[stream.Length];
        stream.ReadExactly(bytes);
        return new AssemblyMetadata(new PEReader(ImmutableArray.Create(bytes)));
    }

    public bool HasInternalsVisibleToAttribute()
    {
        foreach (var handle in _reader.CustomAttributes)
        {
            var attribute = _reader.GetCustomAttribute(handle);
            var name = AttributeTypeFullName(attribute);
            if (name == "System.Runtime.CompilerServices.InternalsVisibleToAttribute")
            {
                return true;
            }
        }

        return false;
    }

    public void Dispose() => _pe.Dispose();

    private TypeReferenceInfo Describe(TypeReferenceHandle handle)
    {
        var type = _reader.GetTypeReference(handle);
        return new TypeReferenceInfo(FullName(handle), _reader.GetString(type.Namespace), _reader.GetString(type.Name));
    }

    private MemberReferenceInfo? Describe(MemberReferenceHandle handle)
    {
        var member = _reader.GetMemberReference(handle);
        var parent = member.Parent;
        if (parent.Kind != HandleKind.TypeReference)
        {
            // Generic instantiations (TypeSpecification) and ModuleReferences are
            // not interesting for the internal-surface check.
            return null;
        }

        var parentHandle = (TypeReferenceHandle)parent;
        return new MemberReferenceInfo(_reader.GetString(member.Name), FullName(parentHandle));
    }

    private string FullName(TypeReferenceHandle handle)
    {
        var type = _reader.GetTypeReference(handle);
        var name = _reader.GetString(type.Name);
        if (type.ResolutionScope.Kind == HandleKind.TypeReference)
        {
            return FullName((TypeReferenceHandle)type.ResolutionScope) + "+" + name;
        }

        var ns = _reader.GetString(type.Namespace);
        return ns.Length == 0 ? name : ns + "." + name;
    }

    private string AttributeTypeFullName(CustomAttribute attribute)
    {
        if (attribute.Constructor.Kind != HandleKind.MemberReference)
        {
            return string.Empty;
        }

        var constructor = _reader.GetMemberReference((MemberReferenceHandle)attribute.Constructor);
        if (constructor.Parent.Kind != HandleKind.TypeReference)
        {
            return string.Empty;
        }

        return FullName((TypeReferenceHandle)constructor.Parent);
    }
}

internal readonly record struct TypeReferenceInfo(string FullName, string Namespace, string Name);

internal readonly record struct MemberReferenceInfo(string Name, string ParentFullName);
