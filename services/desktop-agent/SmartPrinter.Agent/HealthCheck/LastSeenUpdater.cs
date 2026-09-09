using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using SmartPrinter.Agent.Configuration;
using SmartPrinter.Agent.Cloud;

namespace SmartPrinter.Agent.HealthCheck;

/// <summary>
/// Updates devices.last_seen_at on a coarse interval (minutes, not seconds) ONLY - this
/// is deliberately not a heartbeat loop. Real activity (job status updates, Realtime
/// events) already implies liveness; this timer exists solely to cover the case where
/// the device has been completely idle (no jobs) for a long stretch, so the dashboard
/// can still distinguish "quietly online" from "actually offline".
/// </summary>
public sealed class LastSeenUpdater
{
    private readonly SupabaseGateway _gateway;
    private readonly AgentOptions _options;
    private readonly ILogger<LastSeenUpdater> _logger;

    public LastSeenUpdater(SupabaseGateway gateway, IOptions<AgentOptions> options, ILogger<LastSeenUpdater> logger)
    {
        _gateway = gateway;
        _options = options.Value;
        _logger = logger;
    }

    public async Task RunAsync(Guid deviceId, CancellationToken cancellationToken)
    {
        var interval = TimeSpan.FromSeconds(Math.Max(60, _options.LastSeenIntervalSeconds));

        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                await _gateway.UpdateDeviceLastSeenAsync(deviceId, cancellationToken);
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Last-seen ping failed (non-fatal, will retry next interval)");
            }

            try
            {
                await Task.Delay(interval, cancellationToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }
}
