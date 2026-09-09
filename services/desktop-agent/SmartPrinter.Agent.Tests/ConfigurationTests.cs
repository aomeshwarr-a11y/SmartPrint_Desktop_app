using SmartPrinter.Agent.Configuration;
using Xunit;

namespace SmartPrinter.Agent.Tests;

public class ConfigurationTests
{
    [Fact]
    public void AgentOptions_ExpandedDataDirectory_ExpandsEnvironmentVariables()
    {
        Environment.SetEnvironmentVariable("SMARTPRINTER_TEST_VAR", @"C:\CustomPath");
        var options = new AgentOptions { DataDirectory = "%SMARTPRINTER_TEST_VAR%\\Agent" };

        Assert.Equal(@"C:\CustomPath\Agent", options.ExpandedDataDirectory);
    }

    [Fact]
    public void AgentOptions_DefaultAllowedFileExtensions_OnlyContainsPdf()
    {
        var options = new AgentOptions();
        Assert.Single(options.AllowedFileExtensions);
        Assert.Equal(".pdf", options.AllowedFileExtensions[0]);
    }

    [Fact]
    public void AgentOptions_DefaultMockCloudMode_IsFalse()
    {
        var options = new AgentOptions();
        Assert.False(options.MockCloudMode, "Production default must be real cloud mode, not mock.");
    }

    [Fact]
    public void AgentOptions_MaxDownloadFileSizeBytes_HasASaneDefaultCap()
    {
        var options = new AgentOptions();
        Assert.True(options.MaxDownloadFileSizeBytes > 0);
        Assert.True(options.MaxDownloadFileSizeBytes <= 200 * 1024 * 1024, "Default cap should be conservative to resist resource-exhaustion uploads.");
    }
}
