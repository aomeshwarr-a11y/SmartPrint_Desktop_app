using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Moq.Protected;
using SmartPrinter.Agent.Cloud;
using SmartPrinter.Agent.Configuration;
using SmartPrinter.Agent.Security;
using Xunit;

namespace SmartPrinter.Agent.Tests;

public class DeviceAuthServiceTests
{
    private readonly SupabaseOptions _options = new()
    {
        Url = "https://test.supabase.co",
        AnonKey = "anon-key-12345"
    };

    private static (DeviceAuthService service, Mock<HttpMessageHandler> handlerMock, Mock<ICredentialProtector> protectorMock) CreateService(
        HttpResponseMessage responseMessage,
        DeviceCredential? initialCredential = null)
    {
        var handlerMock = new Mock<HttpMessageHandler>();
        handlerMock
            .Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .ReturnsAsync(responseMessage);

        var httpClient = new HttpClient(handlerMock.Object);
        var factoryMock = new Mock<IHttpClientFactory>();
        factoryMock.Setup(f => f.CreateClient(It.IsAny<string>())).Returns(httpClient);

        var protectorMock = new Mock<ICredentialProtector>();
        protectorMock.Setup(p => p.Protect(It.IsAny<string>())).Returns<string>(s => System.Text.Encoding.UTF8.GetBytes(s));
        protectorMock.Setup(p => p.Unprotect(It.IsAny<byte[]>())).Returns<byte[]>(b => System.Text.Encoding.UTF8.GetString(b));

        var tempDir = Path.Combine(Path.GetTempPath(), "sp-auth-test-" + Guid.NewGuid());
        Directory.CreateDirectory(tempDir);
        var store = new CredentialStore(protectorMock.Object, Options.Create(new AgentOptions { DataDirectory = tempDir }), NullLogger<CredentialStore>.Instance);

        if (initialCredential != null)
        {
            store.SaveAsync(initialCredential).GetAwaiter().GetResult();
        }

        var service = new DeviceAuthService(
            Options.Create(new SupabaseOptions { Url = "https://test.supabase.co", AnonKey = "anon-key-12345" }),
            store,
            factoryMock.Object,
            NullLogger<DeviceAuthService>.Instance);

        if (initialCredential != null)
        {
            service.LoadStoredCredentialAsync().GetAwaiter().GetResult();
        }

        return (service, handlerMock, protectorMock);
    }

    [Fact]
    public async Task RefreshAccessToken_SendsBearerAnonKeyInAuthorizationHeader()
    {
        var response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(JsonSerializer.Serialize(new { access_token = "jwt-token", expires_in = 900 }))
        };

        var (service, handlerMock, _) = CreateService(
            response,
            new DeviceCredential("dev-1", "shop-1", "secret-1", DateTime.UtcNow));

        HttpRequestMessage? capturedRequest = null;
        handlerMock
            .Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .Callback<HttpRequestMessage, CancellationToken>((req, _) => capturedRequest = req)
            .ReturnsAsync(response);

        var token = await service.RefreshAccessTokenAsync();

        Assert.Equal("jwt-token", token);
        Assert.NotNull(capturedRequest);
        Assert.Equal("Bearer", capturedRequest.Headers.Authorization?.Scheme);
        Assert.Equal("anon-key-12345", capturedRequest.Headers.Authorization?.Parameter);
        Assert.True(capturedRequest.Headers.Contains("apikey"));
    }

    [Fact]
    public async Task RefreshAccessToken_OnGatewayUnauthorizedError_DoesNotUnpairDevice()
    {
        // Kong gateway returns 401 with UNAUTHORIZED_NO_AUTH_HEADER when auth header is missing or malformed
        var response = new HttpResponseMessage(HttpStatusCode.Unauthorized)
        {
            Content = new StringContent("{\"code\":\"UNAUTHORIZED_NO_AUTH_HEADER\",\"message\":\"Missing authorization header\"}")
        };

        var (service, _, _) = CreateService(
            response,
            new DeviceCredential("dev-1", "shop-1", "secret-1", DateTime.UtcNow));

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => service.RefreshAccessTokenAsync());

        Assert.Contains("Failed to refresh device token", ex.Message);
        // The credential must NOT be deleted locally on a gateway error
        Assert.True(service.IsPaired);
    }

    [Fact]
    public async Task RefreshAccessToken_OnDefinitiveBackendRevocation_UnpairsDevice()
    {
        // Edge function returns 401 with "Invalid or revoked device credential."
        var response = new HttpResponseMessage(HttpStatusCode.Unauthorized)
        {
            Content = new StringContent("{\"error\":\"Invalid or revoked device credential.\"}")
        };

        var (service, _, _) = CreateService(
            response,
            new DeviceCredential("dev-1", "shop-1", "secret-1", DateTime.UtcNow));

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => service.RefreshAccessTokenAsync());

        Assert.Contains("Device credential revoked", ex.Message);
        // Device is now unpaired
        Assert.False(service.IsPaired);
    }

    [Fact]
    public async Task RefreshAccessToken_OnDeviceInactive_UnpairsDevice()
    {
        // Edge function returns 403 with "Device not found or not active."
        var response = new HttpResponseMessage(HttpStatusCode.Forbidden)
        {
            Content = new StringContent("{\"error\":\"Device not found or not active.\"}")
        };

        var (service, _, _) = CreateService(
            response,
            new DeviceCredential("dev-1", "shop-1", "secret-1", DateTime.UtcNow));

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => service.RefreshAccessTokenAsync());

        Assert.Contains("Device credential revoked", ex.Message);
        Assert.False(service.IsPaired);
    }
}
