using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using OsAgent;
using OsAgent.Coleta;

// ponytail: domínio padrão do servidor; o MSI sobrescreve via --servidor (propriedade SERVIDOR_URL)
const string ServidorPadrao = "https://os.onedayinformatica.com.br";

if (args.Length > 0 && args[0] == "coletar")
{
    var inv = InventarioColeta.Coletar();
    var opt = new JsonSerializerOptions(JsonSerializerDefaults.Web) { WriteIndented = true, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };
    Console.WriteLine(JsonSerializer.Serialize(
        new { identificacao = Hardware.Identificar(AgentWorker.Versao), specs = inv.Specs, hash = inv.Hash, software = inv.Software }, opt));
    return 0;
}

if (args.Length > 0 && args[0] == "instalar")
{
    string? Arg(string nome) { var i = Array.IndexOf(args, nome); return i >= 0 && i + 1 < args.Length ? args[i + 1] : null; }
    var codigo = NomeArquivo.ExtrairCodigo(Arg("--msi"));
    if (codigo is null)
    {
        Console.Error.WriteLine("Este instalador não tem o código do cliente no nome do arquivo. " +
            "Baixe o instalador novamente pela aba Agente do cliente (o nome deve ser AgenteOS-<código>.msi) e não renomeie o arquivo.");
        return 1;
    }
    var servidor = Arg("--servidor");
    var store = new ConfigStore();
    try
    {
        if (!string.IsNullOrWhiteSpace(servidor)) ApiClient.ValidarUrl(servidor);
        var atual = store.Carregar();
        // reinstalar/atualizar com o mesmo código mantém o token (não duplica o PC)
        var token = atual?.Codigo == codigo ? atual.TokenProtegido : null;
        store.RestringirAcesso();
        store.Salvar(new AgentConfig(string.IsNullOrWhiteSpace(servidor) ? atual?.ServidorUrl ?? ServidorPadrao : servidor, codigo, token));
        Log.Info("Código de instalação gravado.");
        return 0;
    }
    catch (Exception e)
    {
        Console.Error.WriteLine("Não foi possível gravar a configuração do agente: " + e.Message);
        return 2;
    }
}

var host = Host.CreateDefaultBuilder(args)
    .UseWindowsService(o => o.ServiceName = "AgenteOS")
    .ConfigureServices(s => { s.AddSingleton(new ConfigStore()); s.AddHostedService<AgentWorker>(); })
    .Build();
await host.RunAsync();
return 0;
