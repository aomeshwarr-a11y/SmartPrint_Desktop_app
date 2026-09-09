namespace SmartPrinter.Agent.Configuration;

/// <summary>
/// Supabase project connection details. NEVER put a service_role key here - the agent
/// must only ever hold the anon key plus a narrowly-scoped, revocable device credential
/// obtained through the pairing flow (see DeviceAuthService). RLS policies (see
/// supabase/migrations) are what actually restrict a device to its own shop's rows.
/// </summary>
public sealed class SupabaseOptions
{
    public string Url { get; set; } = string.Empty;

    public string AnonKey { get; set; } = string.Empty;

    public string PrintJobsTable { get; set; } = "print_jobs";

    public string PrintJobEventsTable { get; set; } = "print_job_events";

    public string PrintersTable { get; set; } = "printers";

    public string DevicesTable { get; set; } = "devices";

    public string StorageBucket { get; set; } = "print-uploads";
}
