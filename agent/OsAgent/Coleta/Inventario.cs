using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace OsAgent.Coleta;

public static class InventarioColeta
{
    public static Inventario Coletar()
    {
        var specs = Hardware.ColetarSpecs();
        var sw = Software.Coletar();
        return new Inventario(specs, sw, CalcularHash(specs, sw));
    }

    /// <summary>SHA-256 estável: chaves e listas ordenadas, sem livreGb (muda a todo momento).</summary>
    public static string CalcularHash(Dictionary<string, object> specs, IEnumerable<SoftwareItem> software)
    {
        var texto = Canonico(JsonSerializer.SerializeToNode(specs)) + "|" + string.Join("\n", software
            .OrderBy(s => s.Name, StringComparer.Ordinal).ThenBy(s => s.Version, StringComparer.Ordinal).ThenBy(s => s.Publisher, StringComparer.Ordinal)
            .Select(s => $"{s.Name}\t{s.Version}\t{s.Publisher}"));
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(texto))).ToLowerInvariant();
    }

    static string Canonico(JsonNode? n) => n switch
    {
        JsonObject o => "{" + string.Join(",", o.Where(kv => kv.Key != "livreGb").OrderBy(kv => kv.Key, StringComparer.Ordinal)
            .Select(kv => $"\"{kv.Key}\":{Canonico(kv.Value)}")) + "}",
        JsonArray a => "[" + string.Join(",", a.Select(Canonico).OrderBy(x => x, StringComparer.Ordinal)) + "]",
        null => "null",
        _ => n.ToJsonString(),
    };
}
