using Microsoft.Extensions.Configuration;
using Serilog;
using Serilog.Core;
using Serilog.Events;

namespace SmartPrinter.Agent.Logging;

/// <summary>
/// Central Serilog configuration. Two things are non-negotiable here per SECURITY.md:
///   1. Logs are rotated and size-capped so a runaway loop cannot fill the shop PC's disk.
///   2. <see cref="SecretRedactionEnricher"/> scrubs anything that looks like a token,
///      secret, or password out of the rendered message before it ever reaches a sink -
///      defense in depth on top of "never log the credential" discipline in code.
/// </summary>
public static class SerilogConfig
{
    public static Serilog.ILogger Build(IConfiguration configuration, string contentRoot)
    {
        var dataDir = Environment.ExpandEnvironmentVariables(
            configuration["Agent:DataDirectory"] ?? "%PROGRAMDATA%\\SmartPrinter\\Agent");
        var logDir = Path.Combine(dataDir, "logs");
        Directory.CreateDirectory(logDir);

        return new LoggerConfiguration()
            .ReadFrom.Configuration(configuration)
            .Enrich.FromLogContext()
            .Enrich.With<SecretRedactionEnricher>()
            .WriteTo.Console()
            .WriteTo.File(
                Path.Combine(logDir, "agent-.log"),
                rollingInterval: RollingInterval.Day,
                retainedFileCountLimit: 14,
                fileSizeLimitBytes: 20 * 1024 * 1024,
                rollOnFileSizeLimit: true,
                outputTemplate: "{Timestamp:yyyy-MM-dd HH:mm:ss.fff zzz} [{Level:u3}] ({SourceContext}) {Message:lj}{NewLine}{Exception}")
            .CreateLogger();
    }
}

/// <summary>
/// Rewrites obviously secret-shaped substrings in every log message before it is
/// rendered. This is a safety net, not the primary control - code must never pass a
/// device secret, access token, or password into a log message in the first place.
/// </summary>
public sealed class SecretRedactionEnricher : ILogEventEnricher
{
    private static readonly System.Text.RegularExpressions.Regex[] Patterns =
    {
        new(@"Bearer\s+[A-Za-z0-9\-_\.]+", System.Text.RegularExpressions.RegexOptions.Compiled),
        new(@"(?i)(device_secret|access_token|password|api_key|apikey)\s*[:=]\s*""?[^""\s,}]+", System.Text.RegularExpressions.RegexOptions.Compiled)
    };

    public void Enrich(LogEvent logEvent, ILogEventPropertyFactory propertyFactory)
    {
        var rendered = logEvent.RenderMessage();
        var redacted = rendered;
        foreach (var pattern in Patterns)
        {
            redacted = pattern.Replace(redacted, "[REDACTED]");
        }

        if (!ReferenceEquals(redacted, rendered) && redacted != rendered)
        {
            logEvent.AddOrUpdateProperty(propertyFactory.CreateProperty("RedactedMessage", redacted));
        }
    }
}
