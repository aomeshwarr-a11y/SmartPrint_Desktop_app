using SmartPrinter.Agent.Data.Models;
using Xunit;

namespace SmartPrinter.Agent.Tests;

public class JobStateMachineTests
{
    [Theory]
    [InlineData(LocalJobStatus.Completed)]
    [InlineData(LocalJobStatus.Failed)]
    [InlineData(LocalJobStatus.Cancelled)]
    public void TerminalStates_AreRecognized(string status)
    {
        Assert.Contains(status, LocalJobStatus.Terminal);
    }

    [Theory]
    [InlineData(LocalJobStatus.Queued)]
    [InlineData(LocalJobStatus.Printing)]
    public void NonTerminalStates_AreNotInTerminalSet(string status)
    {
        Assert.DoesNotContain(status, LocalJobStatus.Terminal);
    }

    [Theory]
    [InlineData(LocalJobStatus.Claimed)]
    [InlineData(LocalJobStatus.Downloading)]
    [InlineData(LocalJobStatus.Downloaded)]
    [InlineData(LocalJobStatus.Printing)]
    public void InFlightStates_RequireRecoveryCheckOnRestart(string status)
    {
        Assert.Contains(status, LocalJobStatus.RequiresRecoveryCheck);
    }

    [Fact]
    public void QueuedAndTerminalStates_DoNotRequireRecoveryCheck()
    {
        Assert.DoesNotContain(LocalJobStatus.Queued, LocalJobStatus.RequiresRecoveryCheck);
        Assert.DoesNotContain(LocalJobStatus.Completed, LocalJobStatus.RequiresRecoveryCheck);
    }

    [Fact]
    public void TerminalAndRecoveryCheckSets_AreDisjoint()
    {
        // A status must never require both "assume terminal" and "re-verify on restart"
        // handling at once - this would be a contradiction in JobProcessor.RecoverAsync.
        Assert.Empty(LocalJobStatus.Terminal.Intersect(LocalJobStatus.RequiresRecoveryCheck, StringComparer.OrdinalIgnoreCase));
    }
}
