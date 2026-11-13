using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace OsAgent;

public class ApiClient
{
    static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    { DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };

    readonly HttpClient _http;
    readonly string? _codigo;
    readonly Func<string?> _token;

    public ApiClient(HttpClient http, string servidorUrl, string? codigo, Func<string?> token)
    {
        ValidarUrl(servidorUrl);
        _http = http;
        _http.BaseAddress = new Uri(servidorUrl.TrimEnd('/') + "/api/");
        _http.Timeout = TimeSpan.FromSeconds(30);
        _codigo = codigo;
        _token = token;
    }

    /// <summary>Somente HTTPS na saída; http só para localhost (testes).</summary>
    public static void ValidarUrl(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var u)) throw new ArgumentException($"URL do servidor inválida: {url}");
        if (u.Scheme == Uri.UriSchemeHttps) return;
        if (u.Scheme == Uri.UriSchemeHttp && (u.IsLoopback || u.Host == "localhost")) return;
        throw new ArgumentException("O servidor precisa usar HTTPS (http só é aceito para localhost).");
    }

    public async Task<string> EnrollAsync(Identificacao id, CancellationToken ct = default)
    {
        var body = new
        {
            code = _codigo, machineGuid = id.MachineGuid, hostname = id.Hostname, serialNumber = id.SerialNumber,
            manufacturer = id.Manufacturer, model = id.Model, ip = id.Ip, mac = id.Mac, agentVersion = id.AgentVersion,
        };
        using var r = await _http.PostAsJsonAsync("agent/enroll", body, Json, ct);
        Checar(r);
        var j = await r.Content.ReadFromJsonAsync<JsonElement>(Json, ct);
        return j.GetProperty("token").GetString() ?? throw new InvalidOperationException("Resposta sem token.");
    }

    public async Task<CheckinResposta> CheckinAsync(Identificacao id, Inventario? inv, CancellationToken ct = default)
    {
        var d = new Dictionary<string, object?>
        {
            ["hostname"] = id.Hostname, ["serialNumber"] = id.SerialNumber, ["manufacturer"] = id.Manufacturer,
            ["model"] = id.Model, ["ip"] = id.Ip, ["mac"] = id.Mac, ["agentVersion"] = id.AgentVersion,
        };
        foreach (var k in d.Where(kv => kv.Value is null).Select(kv => kv.Key).ToList()) d.Remove(k); // omitido, não null
        if (inv is not null) d["inventory"] = new { specs = inv.Specs, software = inv.Software };
        using var req = new HttpRequestMessage(HttpMethod.Post, "agent/checkin") { Content = JsonContent.Create(d, options: Json) };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _token() ?? "");
        using var r = await _http.SendAsync(req, ct);
        Checar(r);
        var j = await r.Content.ReadFromJsonAsync<JsonElement>(Json, ct);
        return new CheckinResposta(j.GetProperty("status").GetString() ?? "", j.GetProperty("wantInventory").GetBoolean());
    }

    static void Checar(HttpResponseMessage r)
    {
        if (r.StatusCode == HttpStatusCode.Unauthorized) throw new TokenInvalido();
        if (r.StatusCode == HttpStatusCode.Forbidden) throw new ClienteSemContrato();
        r.EnsureSuccessStatusCode();
    }
}
