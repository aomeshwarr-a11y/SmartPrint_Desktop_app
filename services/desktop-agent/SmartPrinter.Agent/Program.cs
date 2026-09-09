using System;
using System.IO;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Serilog;
using SmartPrinter.Agent.Cloud;
using SmartPrinter.Agent.Configuration;
using SmartPrinter.Agent.Data;
using SmartPrinter.Agent.HealthCheck;
using SmartPrinter.Agent.Ipc;
using SmartPrinter.Agent.Printing;
using SmartPrinter.Agent.Security;
using SmartPrinter.Agent.Logging;
using Microsoft.Extensions.Hosting.WindowsServices;

namespace SmartPrinter.Agent;

/// <summary>
/// Entry point for the SmartPrinter Desktop Agent.
///
/// This process can run in two modes:
///   1. Windows Service mode (production) - installed via sc.exe / installer, runs headless
///      under the LocalSystem or a dedicated service account, survives logoff/reboot.
///   2. Console mode (development) - run directly with `dotnet run`, useful for debugging
///      without installing a service. Triggered automatically when not launched by the
///      Service Control Manager, or explicitly with `--console`.
///
/// In both modes the exact same <see cref="Worker"/> background service runs; only the
/// hosting shell differs. This guarantees dev and prod behave identically.
/// </summary>
public static class Program
{
    public static async Task<int> Main(string[] args)
    {
        var isWindowsService = WindowsServiceHelpers.IsWindowsService() && !args.Contains("--console");
        var contentRoot = AppContext.BaseDirectory;

        var configuration = new ConfigurationBuilder()
            .SetBasePath(contentRoot)
            .AddJsonFile("appsettings.json", optional: false, reloadOnChange: true)
            .AddJsonFile($"appsettings.{Environment.GetEnvironmentVariable("SMARTPRINTER_ENVIRONMENT") ?? "Development"}.json",
                optional: true, reloadOnChange: true)
            .AddEnvironmentVariables(prefix: "SMARTPRINTER_")
            .AddCommandLine(args)
            .Build();

        Log.Logger = SerilogConfig.Build(configuration, contentRoot);

        try
        {
            Log.Information("SmartPrinter Agent starting. Mode={Mode} Version={Version}",
                isWindowsService ? "WindowsService" : "Console",
                typeof(Program).Assembly.GetName().Version);

            var builder = Host.CreateApplicationBuilder(args);
            builder.Configuration.Sources.Clear();
            builder.Configuration.AddConfiguration(configuration);
            builder.Services.AddSerilog();

            if (isWindowsService)
            {
                builder.Services.AddWindowsService(o => o.ServiceName = "SmartPrinterAgent");
            }

            ConfigureServices(builder.Services, configuration);

            var host = builder.Build();

            // Ensure the local SQLite schema exists before anything else touches it.
            using (var scope = host.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<SqliteQueueRepository>();
                await db.InitializeAsync();
            }

            await host.RunAsync();
            return 0;
        }
        catch (Exception ex)
        {
            Log.Fatal(ex, "SmartPrinter Agent terminated unexpectedly");
            return 1;
        }
        finally
        {
            Log.CloseAndFlush();
        }
    }

    private static void ConfigureServices(IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<AgentOptions>(configuration.GetSection("Agent"));
        services.Configure<SupabaseOptions>(configuration.GetSection("Supabase"));

        services.AddSingleton<Cloud.AgentRuntimeState>();
        services.AddSingleton<SqliteQueueRepository>();
        services.AddSingleton<IPrinterService, WindowsPrinterService>();
        services.AddSingleton<IPdfPrintEngine, PdfiumPrintEngine>();
        services.AddSingleton<ICredentialProtector, DpapiCredentialProtector>();
        services.AddSingleton<CredentialStore>();
        services.AddSingleton<SupabaseGateway>();
        services.AddSingleton<DeviceAuthService>();
        services.AddSingleton<RealtimeJobListener>();
        services.AddSingleton<JobProcessor>();
        services.AddSingleton<LastSeenUpdater>();
        services.AddSingleton<NamedPipeServer>();
        services.AddSingleton<IpcRouter>();

        services.AddHttpClient();

        services.AddHostedService<Worker>();
    }
}
