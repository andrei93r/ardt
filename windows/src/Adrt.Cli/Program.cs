using System.Globalization;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using Adrt.Core;

namespace Adrt.Cli;

/// <summary>
/// <c>adrt-cli</c>: the harness's view of the running app. One process, one
/// request, one JSON document on stdout; nothing is cached between calls.
/// </summary>
/// <remarks>
/// The client knows the trigger <em>names</em> only so it can list them and give
/// a good usage message. It never implements a trigger: the app's dispatch
/// delegate is the only policy, which keeps this surface aligned with the GNOME
/// suite's <c>gdbus call</c>.
/// </remarks>
internal static class Program
{
    private const int DefaultTimeoutMs = 10_000;
    private const int DefaultDumpLimit = 200;

    private static readonly JsonSerializerOptions OutputOptions = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        WriteIndented = false,
    };

    private static int Main(string[] args)
    {
        TrySetUtf8Output();

        try
        {
            return Run(args);
        }
        catch (IpcException error)
        {
            Console.Error.WriteLine($"adrt-cli: {error.Message}");
            return (int)error.ExitCode;
        }
        catch (OperationCanceledException)
        {
            Console.Error.WriteLine("adrt-cli: cancelled");
            return (int)CliExitCode.Timeout;
        }
        catch (ArgumentException error)
        {
            Console.Error.WriteLine($"adrt-cli: {error.Message}");
            return (int)CliExitCode.Usage;
        }
        catch (InvalidOperationException error)
        {
            Console.Error.WriteLine($"adrt-cli: {error.Message}");
            return (int)CliExitCode.Transport;
        }
        catch (PlatformNotSupportedException error)
        {
            Console.Error.WriteLine($"adrt-cli: {error.Message} (adrt-cli runs on Windows)");
            return (int)CliExitCode.Transport;
        }
    }

    private static int Run(string[] args)
    {
        if (!TryParseGlobals(args, out string? pipe, out int timeoutMs, out bool pretty, out List<string> rest))
        {
            return (int)CliExitCode.Usage;
        }

        if (rest.Count == 0)
        {
            PrintUsage(Console.Error);
            return (int)CliExitCode.Usage;
        }

        string command = rest[0];
        List<string> arguments = rest.GetRange(1, rest.Count - 1);

        switch (command)
        {
            case "help":
            case "--help":
            case "-h":
                PrintUsage(Console.Out);
                return (int)CliExitCode.Ok;

            case "list-triggers":
                if (arguments.Count != 0) return ExtraArguments(command);
                PrintTriggers();
                return (int)CliExitCode.Ok;

            case "ping":
                if (arguments.Count != 0) return ExtraArguments(command);
                return Send(IpcClient.PingTrigger, null, pipe, timeoutMs, pretty, unwrapJsonString: false);

            case "dump-state":
                if (arguments.Count != 0) return ExtraArguments(command);
                return Send("DumpState", null, pipe, timeoutMs, pretty, unwrapJsonString: true);

            case "dump-decisions":
                if (!TryLimit(command, arguments, out int decisionsLimit)) return (int)CliExitCode.Usage;
                return Send(
                    "DumpDecisions",
                    new JsonArray { decisionsLimit },
                    pipe,
                    timeoutMs,
                    pretty,
                    unwrapJsonString: true);

            case "dump-events":
                if (!TryEventsArguments(arguments, out JsonArray? eventArgs)) return (int)CliExitCode.Usage;
                return Send("DumpEvents", eventArgs, pipe, timeoutMs, pretty, unwrapJsonString: true);

            case "dump-trace":
                if (!TryLimit(command, arguments, out int traceLimit)) return (int)CliExitCode.Usage;
                return Send(
                    "DumpTrace",
                    new JsonArray { traceLimit },
                    pipe,
                    timeoutMs,
                    pretty,
                    unwrapJsonString: true);

            case "trigger":
                if (arguments.Count is 0 or > 2)
                {
                    Console.Error.WriteLine("adrt-cli: usage: adrt-cli trigger <name> [json|-]");
                    return (int)CliExitCode.Usage;
                }

                if (!TryParseArgs(arguments.Count == 2 ? arguments[1] : null, out JsonNode? triggerArgs))
                {
                    return (int)CliExitCode.Usage;
                }

                return Send(arguments[0], triggerArgs, pipe, timeoutMs, pretty, unwrapJsonString: false);

            default:
                Console.Error.WriteLine($"adrt-cli: unknown command '{command}'");
                PrintUsage(Console.Error);
                return (int)CliExitCode.Usage;
        }
    }

    private static int Send(
        string trigger,
        JsonNode? args,
        string? pipeOverride,
        int timeoutMs,
        bool pretty,
        bool unwrapJsonString)
    {
        string pipe = pipeOverride ?? IpcPipe.Current();
        JsonNode? result = IpcClient
            .CallAsync(pipe, trigger, args, timeoutMs, CancellationToken.None)
            .GetAwaiter()
            .GetResult();

        Console.Out.WriteLine(FormatResult(result, pretty, unwrapJsonString));
        return (int)CliExitCode.Ok;
    }

    /// <summary>
    /// Triggers declared with <c>out: ['s']</c> return a JSON document wrapped in
    /// a JSON string (the D-Bus wire type). The <c>dump-*</c> commands unwrap it so
    /// <c>jq</c> and PowerShell's <c>ConvertFrom-Json</c> see the document, while
    /// <c>trigger</c> keeps the exact wire result.
    /// </summary>
    private static string FormatResult(JsonNode? result, bool pretty, bool unwrapJsonString)
    {
        JsonSerializerOptions options = pretty
            ? new JsonSerializerOptions(OutputOptions) { WriteIndented = true }
            : OutputOptions;

        if (unwrapJsonString &&
            result is JsonValue value &&
            value.TryGetValue(out string? text) &&
            text.Length > 0)
        {
            try
            {
                JsonNode? inner = JsonNode.Parse(text);
                return inner is null ? "null" : inner.ToJsonString(options);
            }
            catch (JsonException)
            {
                // Not a JSON document; fall through and print the string as-is.
            }
        }

        return result is null ? "null" : result.ToJsonString(options);
    }

    private static bool TryParseGlobals(
        string[] args,
        out string? pipe,
        out int timeoutMs,
        out bool pretty,
        out List<string> rest)
    {
        pipe = null;
        pretty = false;
        timeoutMs = TimeoutFromEnvironment();
        rest = [];

        for (int index = 0; index < args.Length; index += 1)
        {
            string arg = args[index];
            if (arg == "--")
            {
                for (int tail = index + 1; tail < args.Length; tail += 1) rest.Add(args[tail]);
                return true;
            }

            if (arg is "--help" or "-h")
            {
                rest.Add("help");
                return true;
            }

            if (arg == "--pretty")
            {
                pretty = true;
                continue;
            }

            if (arg == "--pipe" || arg.StartsWith("--pipe=", StringComparison.Ordinal))
            {
                string value;
                if (arg == "--pipe")
                {
                    if (index + 1 >= args.Length)
                    {
                        Console.Error.WriteLine("adrt-cli: --pipe needs a name");
                        return false;
                    }

                    value = args[++index];
                }
                else
                {
                    value = arg["--pipe=".Length..];
                }

                if (string.IsNullOrWhiteSpace(value))
                {
                    Console.Error.WriteLine("adrt-cli: --pipe needs a name");
                    return false;
                }

                pipe = IpcPipe.Normalize(value);
                continue;
            }

            if (arg is "--timeout" or "--timeout-ms" || arg.StartsWith("--timeout=", StringComparison.Ordinal))
            {
                string value;
                if (arg.StartsWith("--timeout=", StringComparison.Ordinal))
                {
                    value = arg["--timeout=".Length..];
                }
                else if (index + 1 < args.Length)
                {
                    value = args[++index];
                }
                else
                {
                    Console.Error.WriteLine("adrt-cli: --timeout needs milliseconds");
                    return false;
                }

                if (!int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out timeoutMs) ||
                    timeoutMs <= 0)
                {
                    Console.Error.WriteLine($"adrt-cli: invalid timeout '{value}' (expected positive milliseconds)");
                    return false;
                }

                continue;
            }

            if (arg.StartsWith('-') && rest.Count == 0)
            {
                Console.Error.WriteLine($"adrt-cli: unknown option '{arg}'");
                return false;
            }

            rest.Add(arg);
        }

        return true;
    }

    private static int TimeoutFromEnvironment()
    {
        string? configured = Environment.GetEnvironmentVariable("ADRT_IPC_TIMEOUT_MS");
        if (string.IsNullOrWhiteSpace(configured)) return DefaultTimeoutMs;

        if (!int.TryParse(configured, NumberStyles.None, CultureInfo.InvariantCulture, out int timeout) ||
            timeout <= 0)
        {
            throw new ArgumentException(
                $"ADRT_IPC_TIMEOUT_MS must be positive milliseconds, not '{configured}'");
        }

        return timeout;
    }

    private static bool TryLimit(string command, List<string> arguments, out int limit)
    {
        limit = DefaultDumpLimit;
        if (arguments.Count == 0) return true;

        if (arguments.Count > 1)
        {
            Console.Error.WriteLine($"adrt-cli: usage: adrt-cli {command} [limit]");
            return false;
        }

        if (!int.TryParse(arguments[0], NumberStyles.None, CultureInfo.InvariantCulture, out limit) ||
            limit < 0)
        {
            Console.Error.WriteLine($"adrt-cli: invalid limit '{arguments[0]}'");
            return false;
        }

        return true;
    }

    private static bool TryEventsArguments(List<string> arguments, out JsonArray? args)
    {
        args = null;
        if (arguments.Count > 2)
        {
            Console.Error.WriteLine("adrt-cli: usage: adrt-cli dump-events [limit] [filter]");
            return false;
        }

        int limit = DefaultDumpLimit;
        string filter = string.Empty;
        if (arguments.Count >= 1)
        {
            if (!int.TryParse(arguments[0], NumberStyles.None, CultureInfo.InvariantCulture, out limit) ||
                limit < 0)
            {
                Console.Error.WriteLine($"adrt-cli: invalid limit '{arguments[0]}'");
                return false;
            }
        }

        if (arguments.Count == 2) filter = arguments[1];

        args = new JsonArray { limit, filter };
        return true;
    }

    private static bool TryParseArgs(string? json, out JsonNode? args)
    {
        args = null;
        if (json is null) return true;

        string text = json == "-" ? ReadStandardInput() : json;
        if (string.IsNullOrWhiteSpace(text)) return true;

        try
        {
            args = JsonNode.Parse(text);
            return true;
        }
        catch (JsonException error)
        {
            Console.Error.WriteLine($"adrt-cli: invalid JSON arguments: {error.Message}");
            return false;
        }
    }

    private static string ReadStandardInput()
    {
        using Stream stdin = Console.OpenStandardInput();
        using var reader = new StreamReader(stdin, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
        return reader.ReadToEnd();
    }

    private static int ExtraArguments(string command)
    {
        Console.Error.WriteLine($"adrt-cli: '{command}' takes no arguments");
        return (int)CliExitCode.Usage;
    }

    private static void PrintTriggers()
    {
        foreach (Trigger trigger in Triggers.All)
        {
            Console.Out.WriteLine(
                string.Create(
                    CultureInfo.InvariantCulture,
                    $"{trigger.Name}\t{trigger.Taxonomy}\tin=({string.Join(",", trigger.In)})\tout=({string.Join(",", trigger.Out)})"));
        }
    }

    private static void PrintUsage(TextWriter writer)
    {
        writer.WriteLine(
            """
            adrt-cli — drive a running Adrt app over its named pipe

            Usage:
              adrt-cli [options] <command> [arguments]

            Commands:
              trigger <name> [json|-]     send any trigger from Triggers.All; "-" reads stdin
              dump-state                  DumpState (unwrapped JSON)
              dump-decisions [limit]      DumpDecisions, default 200
              dump-events [limit] [filter]
                                          DumpEvents, default 200 / empty filter
              dump-trace [limit]          DumpTrace, default 200
              ping                        transport health check
              list-triggers               print the trigger table (no server needed)
              help                        this text

            Options:
              --pipe <name>               pipe name (default adrt-<sid>, or $ADRT_PIPE)
              --timeout <ms>              request timeout, default 10000
              --pretty                    indent JSON output

            Exit codes:
              0 success, 1 trigger error, 2 usage, 3 timeout, 4 connect/protocol error

            Examples:
              adrt-cli dump-state | jq .
              adrt-cli trigger TogglePause
              adrt-cli trigger MoveWindow '[1234,0,0,640,480]'
              echo '[1234,0,0,640,480]' | adrt-cli trigger MoveWindow -
            """);
    }

    private static void TrySetUtf8Output()
    {
        try
        {
            Console.OutputEncoding = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false);
        }
        catch (IOException)
        {
            // Redirected/limited consoles may refuse; the JSON is still valid UTF-16
            // in-process and gets encoded by the caller's redirection.
        }
    }
}
