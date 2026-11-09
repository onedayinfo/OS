using System.Net;
using System.Text;
using OsAgent;
using Xunit;

public class ApiClientTests
{
    class Falso(HttpStatusCode status, string corpo = "{}") : HttpMessageHandler
    {
        public string? UltimoCorpo, UltimaAuth, UltimaRota;
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage r, CancellationToken ct)
        {
            UltimaRota = r.RequestUri!.AbsolutePath;
            UltimoCorpo = r.Content is null ? null : await r.Content.ReadAsStringAsync(ct);
            UltimaAuth = r.Headers.Authorization?.ToString();
            return new HttpResponseMessage(status) { Content = new StringContent(corpo, Encoding.UTF8, "application/json") };
        }
    }

    static readonly Identificacao Id = new("guid-1", "PC01", null, "Dell", null, "10.0.0.5", null, "0.1.0");
    static ApiClient Novo(Falso h) => new(new HttpClient(h), "https://os.exemplo.com", "abc", () => "tok");

    [Fact]
    public async Task Enroll_devolve_token_e_omite_campos_nulos()
    {
        var h = new Falso(HttpStatusCode.OK, "{\"token\":\"T123\",\"status\":\"PENDING\"}");
        Assert.Equal("T123", await Novo(h).EnrollAsync(Id));
        Assert.Equal("/agent/enroll", h.UltimaRota);
        Assert.Contains("\"machineGuid\":\"guid-1\"", h.UltimoCorpo);
        Assert.DoesNotContain("serialNumber", h.UltimoCorpo);
    }

    [Fact]
    public async Task Checkin_envia_bearer_e_le_wantInventory()
    {
        var h = new Falso(HttpStatusCode.OK, "{\"status\":\"APPROVED\",\"wantInventory\":true}");
        var r = await Novo(h).CheckinAsync(Id, null);
        Assert.True(r.WantInventory);
        Assert.Equal("Bearer tok", h.UltimaAuth);
        Assert.DoesNotContain("inventory", h.UltimoCorpo);
    }

    [Fact]
    public async Task Checkin_com_inventario_inclui_specs_e_software()
    {
        var h = new Falso(HttpStatusCode.OK, "{\"status\":\"APPROVED\",\"wantInventory\":false}");
        await Novo(h).CheckinAsync(Id, new Inventario(new() { ["ramGb"] = 8 }, [new("App", "1", null)], "h"));
        Assert.Contains("\"inventory\":{\"specs\":{\"ramGb\":8},\"software\":[{\"name\":\"App\",\"version\":\"1\"}]}", h.UltimoCorpo);
    }

    [Fact] public async Task Checkin_401_vira_TokenInvalido() =>
        await Assert.ThrowsAsync<TokenInvalido>(() => Novo(new Falso(HttpStatusCode.Unauthorized)).CheckinAsync(Id, null));

    [Fact] public async Task Checkin_403_vira_ClienteSemContrato() =>
        await Assert.ThrowsAsync<ClienteSemContrato>(() => Novo(new Falso(HttpStatusCode.Forbidden)).CheckinAsync(Id, null));

    [Fact]
    public void So_https_ou_localhost()
    {
        Assert.Throws<ArgumentException>(() => ApiClient.ValidarUrl("http://os.exemplo.com"));
        ApiClient.ValidarUrl("http://localhost:3000");
        ApiClient.ValidarUrl("https://os.exemplo.com");
    }
}
