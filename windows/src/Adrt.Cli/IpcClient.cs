using System.Globalization;
using System.IO.Pipes;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Adrt.Cli;

/// <summary>Process exit codes, also used to classify IPC failures.</summary>
internal enum CliExitCode
{
    Ok = 0,

    /// <summary>The server answered, but with <c>ok:false</c>.</summary>
    RemoteError = 1,

    /// <summary>Bad command line; no request was sent.</summary>
    Usage = 2,

    /// <summary>The request or the connection timed out.</summary>
    Timeout = 3,

    /// <summary>Could not connect, or the response was not the protocol's shape.</summary>
    Transport = 4,
}

/// <summary>One structured failure from the pipe, carrying the exit code to use.</summary>
#pragma warning disable CA1032 // internal-only; the standard exception constructors add no value.
internal sealed class IpcException : Exception
{
    public IpcException(string message, CliExitCode exitCode)
        : base(message)
    {
        ExitCode = exitCode;
    }

    public IpcException(string message, CliExitCode exitCode, Exception inner)
        : base(message, inner)
    {
        ExitCode = exitCode;
    }

    public CliExitCode ExitCode { get; }
}
#pragma warning restore CA1032

/// <summary>
/// One request/response round trip over the newline-delimited JSON pipe. The
/// client is deliberately dumb: it frames a request and unwraps the envelope;
/// all trigger behaviour lives in the app.
/// </summary>
internal static class IpcClient
{
    /// <summary>Transport-level health request; not one of the core triggers.</summary>
    public const string PingTrigger = "ping";

    private static readonly JsonSerializerOptions WireOptions = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        WriteIndented = false,
    };

    /// <summary>
    /// Send one request and return its <c>result</c>. Throws <see cref="IpcException"/>
    /// for timeouts, transport/protocol errors and remote <c>ok:false</c> answers.
    /// </summary>
    public static async Task<JsonNode?> CallAsync(
        string pipeName,
        string trigger,
        JsonNode? args,
        int timeoutMs,
        CancellationToken cancellationToken)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(timeoutMs);

        string id = $"cli-{Guid.NewGuid():N}";
        var request = new JsonObject
        {
            ["id"] = id,
            ["trigger"] = trigger,
            ["args"] = args?.DeepClone(),
        };
        byte[] payload = Encoding.UTF8.GetBytes(request.ToJsonString(WireOptions) + "\n");

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(timeoutMs);

        try
        {
            using var pipe = new NamedPipeClientStream(
                ".",
                pipeName,
                PipeDirection.InOut,
                PipeOptions.Asynchronous);

            await pipe.ConnectAsync(timeoutMs, timeout.Token).ConfigureAwait(false);
            await pipe.WriteAsync(payload, timeout.Token).ConfigureAwait(false);
            await pipe.FlushAsync(timeout.Token).ConfigureAwait(false);

            using var reader = new StreamReader(
                pipe,
                new UTF8Encoding(encoderShouldEmitUTF8Identifier: false),
                detectEncodingFromByteOrderMarks: false,
                bufferSize: 4096,
                leaveOpen: true);

            string? line = await reader.ReadLineAsync(timeout.Token).ConfigureAwait(false);
            if (line is null)
            {
                throw new IpcException(
                    "the server closed the pipe without a response",
                    CliExitCode.Transport);
            }

            return ParseResponse(id, line);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (OperationCanceledException error)
        {
            throw new IpcException(
                string.Create(CultureInfo.InvariantCulture, $"request timed out after {timeoutMs} ms"),
                CliExitCode.Timeout,
                error);
        }
        catch (TimeoutException error)
        {
            throw new IpcException(
                string.Create(CultureInfo.InvariantCulture, $"connect timed out after {timeoutMs} ms"),
                CliExitCode.Timeout,
                error);
        }
        catch (IOException error)
        {
            throw new IpcException(
                $"cannot talk to {IpcPipe.PathFor(pipeName)}: {error.Message} (is adrt running?)",
                CliExitCode.Transport,
                error);
        }
        catch (UnauthorizedAccessException error)
        {
            throw new IpcException(
                $"access to {IpcPipe.PathFor(pipeName)} was denied: {error.Message}",
                CliExitCode.Transport,
                error);
        }
    }

    private static JsonNode? ParseResponse(string sentId, string line)
    {
        JsonNode? root;
        try
        {
            root = JsonNode.Parse(line);
        }
        catch (JsonException error)
        {
            throw new IpcException(
                $"the server sent invalid JSON: {error.Message}",
                CliExitCode.Transport,
                error);
        }

        if (root is not JsonObject response)
        {
            throw new IpcException("the server response is not a JSON object", CliExitCode.Transport);
        }

        string? responseId = response["id"]?.ToJsonString(WireOptions);
        string? expectedId = JsonValue.Create(sentId)?.ToJsonString(WireOptions);
        if (!string.Equals(responseId, expectedId, StringComparison.Ordinal))
        {
            throw new IpcException(
                $"the server answered request {responseId ?? "<null>"}, expected {sentId}",
                CliExitCode.Transport);
        }

        if (response["ok"] is not JsonValue okValue || !okValue.TryGetValue(out bool ok))
        {
            throw new IpcException("the server response has no boolean 'ok' field", CliExitCode.Transport);
        }

        if (!ok)
        {
            string message = response["error"] is JsonValue errorValue &&
                             errorValue.TryGetValue(out string? error) &&
                             !string.IsNullOrWhiteSpace(error)
                ? error
                : "the trigger failed without an error message";
            throw new IpcException(message, CliExitCode.RemoteError);
        }

        return response["result"]?.DeepClone();
    }
}
