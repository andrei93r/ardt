using System.Collections.Concurrent;
using System.Globalization;
using System.IO.Pipes;
using System.Runtime.Versioning;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using Adrt.Core;

namespace Adrt.Windows;

/// <summary>
/// Newline-delimited JSON over <c>\\.\pipe\adrt-&lt;sid&gt;</c>: the Windows twin
/// of the GNOME D-Bus harness surface.
/// </summary>
/// <remarks>
/// <para>
/// Request: <c>{"id":any,"trigger":"Name","args":any?}</c><br/>
/// Response: <c>{"id":any,"ok":true,"result":any}</c> or
/// <c>{"id":any,"ok":false,"error":"…"}</c>.
/// </para>
/// <para>
/// One <c>id</c> per request; the response echoes it verbatim. Connections may
/// carry any number of requests, one per line. The transport owns framing,
/// validation and error envelopes only: every trigger is executed by the
/// delegate passed to <see cref="Start"/>, so no tiling policy lives here.
/// </para>
/// <para>
/// <c>ping</c> is a transport control request (it is not one of the 85 core
/// triggers) and answers with pid/pipe/trigger count/uptime. Every name in
/// <see cref="Triggers.All"/> is accepted; anything else is rejected before the
/// delegate is called.
/// </para>
/// </remarks>
[SupportedOSPlatform("windows")]
public sealed class IpcServer : IDisposable
{
    /// <summary>Transport health request; deliberately not in the trigger table.</summary>
    public const string PingTrigger = "ping";

    /// <summary>A request line longer than this is rejected instead of buffered.</summary>
    private const int MaxLineChars = 1024 * 1024;

    private static readonly HashSet<string> KnownTriggers =
        Triggers.All.Select(trigger => trigger.Name).ToHashSet(StringComparer.Ordinal);

    private static readonly JsonSerializerOptions WireOptions = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        WriteIndented = false,
    };

    private readonly object _gate = new();
    private readonly ConcurrentDictionary<NamedPipeServerStream, byte> _connections = new();
    private readonly string _pipeName;

    private CancellationTokenSource? _cancellation;
    private Task? _acceptLoop;
    private NamedPipeServerStream? _listener;
    private Func<string, JsonNode?, JsonNode?>? _dispatch;
    private long _startedAtMs;
    private bool _disposed;

    /// <summary>Server on the current user's pipe (<c>adrt-&lt;sid&gt;</c>).</summary>
    public IpcServer()
        : this(IpcPipeName.Current())
    {
    }

    /// <summary>Server on an explicit pipe name, for isolated harness runs.</summary>
    public IpcServer(string pipeName)
    {
        _pipeName = IpcPipeName.Normalize(pipeName);
    }

    /// <summary>The pipe name (the part after <c>\\.\pipe\</c>).</summary>
    public string PipeName => _pipeName;

    /// <summary>The full <c>\\.\pipe\…</c> path.</summary>
    public string PipePath => IpcPipeName.PathFor(_pipeName);

    /// <summary>True between a successful <see cref="Start"/> and <see cref="Stop"/>.</summary>
    public bool IsRunning
    {
        get
        {
            lock (_gate)
            {
                return _dispatch is not null;
            }
        }
    }

    /// <summary>
    /// Create the pipe and begin accepting connections. The delegate receives the
    /// trigger name and its JSON <c>args</c> (unmodified), and returns the JSON
    /// <c>result</c>; throw to produce an <c>ok:false</c> envelope.
    /// </summary>
    /// <returns>This server, so a host can write <c>using var ipc = new IpcServer().Start(…)</c>.</returns>
    /// <exception cref="InvalidOperationException">Already started, or disposed.</exception>
    public IpcServer Start(Func<string, JsonNode?, JsonNode?> dispatch)
    {
        ArgumentNullException.ThrowIfNull(dispatch);

        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (_dispatch is not null) throw new InvalidOperationException("IpcServer is already started");

            NamedPipeServerStream listener = CreateListener();

            _dispatch = dispatch;
            _cancellation = new CancellationTokenSource();
            _startedAtMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            _listener = listener;
            _acceptLoop = Task.Run(
                () => AcceptLoopAsync(listener, dispatch, _cancellation.Token),
                CancellationToken.None);
        }

        return this;
    }

    /// <summary>Stop accepting, drop live connections, and wait briefly for the loop.</summary>
    public void Stop()
    {
        CancellationTokenSource? cancellation;
        NamedPipeServerStream? listener;
        Task? loop;

        lock (_gate)
        {
            cancellation = _cancellation;
            listener = _listener;
            loop = _acceptLoop;
            _cancellation = null;
            _listener = null;
            _acceptLoop = null;
            _dispatch = null;
        }

        if (cancellation is null) return;

        cancellation.Cancel();
        listener?.Dispose();
        foreach (NamedPipeServerStream connection in _connections.Keys)
        {
            connection.Dispose();
        }

        try
        {
            loop?.Wait(TimeSpan.FromSeconds(2));
        }
        catch (AggregateException)
        {
            // The accept loop only exits on cancellation/disposal; nothing to do.
        }

        cancellation.Dispose();
    }

    /// <inheritdoc />
    public void Dispose()
    {
        lock (_gate)
        {
            _disposed = true;
        }

        Stop();
        GC.SuppressFinalize(this);
    }

    private static NamedPipeServerStream CreateListener(string pipeName) =>
        new(
            pipeName,
            PipeDirection.InOut,
            NamedPipeServerStream.MaxAllowedServerInstances,
            PipeTransmissionMode.Byte,
            PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);

    private NamedPipeServerStream CreateListener() => CreateListener(_pipeName);

    private async Task AcceptLoopAsync(
        NamedPipeServerStream initial,
        Func<string, JsonNode?, JsonNode?> dispatch,
        CancellationToken cancellationToken)
    {
        NamedPipeServerStream listener = initial;
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                try
                {
                    await listener.WaitForConnectionAsync(cancellationToken).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
                catch (ObjectDisposedException)
                {
                    break;
                }
                catch (IOException)
                {
                    break;
                }

                if (cancellationToken.IsCancellationRequested)
                {
                    listener.Dispose();
                    break;
                }

                NamedPipeServerStream connection = listener;
                _connections.TryAdd(connection, 0);
                _ = HandleConnectionAsync(connection, dispatch, cancellationToken);

                try
                {
                    listener = CreateListener();
                }
                catch (IOException)
                {
                    break;
                }
                catch (UnauthorizedAccessException)
                {
                    break;
                }

                lock (_gate)
                {
                    _listener = listener;
                }
            }
        }
#pragma warning disable CA1031 // A failed accept loop must not take the app down; Stop() observes it.
        catch (Exception)
#pragma warning restore CA1031
        {
            // Stop()/Dispose() already treats a dead loop as stopped.
        }
        finally
        {
            listener.Dispose();
            lock (_gate)
            {
                if (ReferenceEquals(_listener, listener)) _listener = null;
            }
        }
    }

    private async Task HandleConnectionAsync(
        NamedPipeServerStream connection,
        Func<string, JsonNode?, JsonNode?> dispatch,
        CancellationToken cancellationToken)
    {
        try
        {
            var encoding = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false);
            using var reader = new StreamReader(
                connection,
                encoding,
                detectEncodingFromByteOrderMarks: false,
                bufferSize: 4096,
                leaveOpen: true);
            using var writer = new StreamWriter(connection, encoding, bufferSize: 4096, leaveOpen: true)
            {
                AutoFlush = true,
                NewLine = "\n",
            };

            while (!cancellationToken.IsCancellationRequested)
            {
                string? line = await reader.ReadLineAsync(cancellationToken).ConfigureAwait(false);
                if (line is null) break;
                if (line.Length == 0) continue;

                string response = line.Length > MaxLineChars
                    ? Failure(null, string.Create(
                        CultureInfo.InvariantCulture,
                        $"request line exceeds {MaxLineChars} characters"))
                    : Process(line, dispatch);

                await writer.WriteLineAsync(response.AsMemory(), cancellationToken).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException)
        {
            // Stop() or client disconnect while blocked on a read.
        }
        catch (ObjectDisposedException)
        {
            // Stop() closed the connection.
        }
        catch (IOException)
        {
            // Client vanished mid-request; the next client gets a fresh instance.
        }
        finally
        {
            _connections.TryRemove(connection, out _);
            connection.Dispose();
        }
    }

#pragma warning disable CA1031 // Malformed input and throwing handlers must produce an error envelope, not a dead pipe.
    private string Process(string line, Func<string, JsonNode?, JsonNode?> dispatch)
    {
        JsonNode? id = null;
        try
        {
            JsonNode? root;
            try
            {
                root = JsonNode.Parse(line);
            }
            catch (JsonException error)
            {
                return Failure(null, $"invalid JSON: {error.Message}");
            }

            if (root is not JsonObject request)
            {
                return Failure(null, "request must be a JSON object");
            }

            id = request["id"]?.DeepClone();

            if (request["trigger"] is not JsonValue triggerValue ||
                !triggerValue.TryGetValue(out string? trigger) ||
                string.IsNullOrWhiteSpace(trigger))
            {
                return Failure(id, "missing trigger");
            }

            JsonNode? args = request["args"]?.DeepClone();

            if (string.Equals(trigger, PingTrigger, StringComparison.Ordinal))
            {
                return Success(id, Ping());
            }

            if (!KnownTriggers.Contains(trigger))
            {
                return Failure(id, $"unknown trigger: {trigger}");
            }

            JsonNode? result = dispatch(trigger, args);
            return Success(id, result);
        }
        catch (Exception error) when (!IsFatal(error))
        {
            return Failure(id, error.Message);
        }
    }
#pragma warning restore CA1031

    private JsonObject Ping() => new()
    {
        ["pong"] = true,
        ["pid"] = Environment.ProcessId,
        ["pipe"] = PipePath,
        ["triggers"] = KnownTriggers.Count,
        ["startedAtMs"] = Volatile.Read(ref _startedAtMs),
        ["nowMs"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
    };

    private static string Success(JsonNode? id, JsonNode? result)
    {
        var response = new JsonObject
        {
            ["id"] = id?.DeepClone(),
            ["ok"] = true,
            ["result"] = result?.DeepClone(),
        };
        return response.ToJsonString(WireOptions);
    }

    private static string Failure(JsonNode? id, string? message)
    {
        var response = new JsonObject
        {
            ["id"] = id?.DeepClone(),
            ["ok"] = false,
            ["error"] = string.IsNullOrWhiteSpace(message) ? "trigger failed" : message,
        };
        return response.ToJsonString(WireOptions);
    }

    private static bool IsFatal(Exception error) =>
        error is OutOfMemoryException or StackOverflowException or AccessViolationException;
}
