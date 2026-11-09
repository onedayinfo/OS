using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace OsAgent;

public record AgentConfig(string ServidorUrl, string? Codigo, string? TokenProtegido, DateTime? UltimoContato = null);

public class ConfigStore
{
    // AGENTEOS_DADOS só existe para testes/diagnóstico; em produção vale C:\ProgramData\AgenteOS
    public static readonly string PastaPadrao = Environment.GetEnvironmentVariable("AGENTEOS_DADOS")
        ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "AgenteOS");
    static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    readonly string _pasta;
    public ConfigStore(string? pasta = null) => _pasta = pasta ?? PastaPadrao;
    public string Pasta => _pasta;
    string Arquivo => Path.Combine(_pasta, "config.json");

    public AgentConfig? Carregar()
    {
        try { return File.Exists(Arquivo) ? JsonSerializer.Deserialize<AgentConfig>(File.ReadAllText(Arquivo), Json) : null; }
        catch (JsonException) { return null; }
    }

    public void Salvar(AgentConfig cfg)
    {
        Directory.CreateDirectory(_pasta);
        File.WriteAllText(Arquivo, JsonSerializer.Serialize(cfg, Json));
    }

    public static string Proteger(string token) =>
        Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(token), null, DataProtectionScope.LocalMachine));

    public static string? Desproteger(string? protegido)
    {
        if (string.IsNullOrEmpty(protegido)) return null;
        try { return Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(protegido), null, DataProtectionScope.LocalMachine)); }
        catch (Exception e) when (e is CryptographicException or FormatException) { return null; }
    }

    /// <summary>Restringe a pasta a SYSTEM e Administradores (remove a herança de ProgramData, que dá leitura a Usuários).</summary>
    public void RestringirAcesso()
    {
        Directory.CreateDirectory(_pasta);
        if (Environment.GetEnvironmentVariable("AGENTEOS_DADOS") is not null) return; // modo teste: não tranca a pasta
        var di = new DirectoryInfo(_pasta);
        var sec = new System.Security.AccessControl.DirectorySecurity();
        sec.SetAccessRuleProtection(true, false);
        foreach (var sid in new[] { System.Security.Principal.WellKnownSidType.LocalSystemSid, System.Security.Principal.WellKnownSidType.BuiltinAdministratorsSid })
            sec.AddAccessRule(new System.Security.AccessControl.FileSystemAccessRule(
                new System.Security.Principal.SecurityIdentifier(sid, null),
                System.Security.AccessControl.FileSystemRights.FullControl,
                System.Security.AccessControl.InheritanceFlags.ContainerInherit | System.Security.AccessControl.InheritanceFlags.ObjectInherit,
                System.Security.AccessControl.PropagationFlags.None,
                System.Security.AccessControl.AccessControlType.Allow));
        di.SetAccessControl(sec);
    }
}
