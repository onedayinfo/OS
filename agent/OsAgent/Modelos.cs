namespace OsAgent;

public record Identificacao(string MachineGuid, string Hostname, string? SerialNumber, string? Manufacturer,
    string? Model, string? Ip, string? Mac, string AgentVersion);

public record SoftwareItem(string Name, string? Version, string? Publisher);

public record Inventario(Dictionary<string, object> Specs, List<SoftwareItem> Software, string Hash);

public record CheckinResposta(string Status, bool WantInventory);

public class TokenInvalido : Exception { public TokenInvalido() : base("Token ou código recusado pelo servidor (401).") { } }
public class ClienteSemContrato : Exception { public ClienteSemContrato() : base("Servidor recusou o dispositivo (403: sem contrato ativo ou ignorado).") { } }
