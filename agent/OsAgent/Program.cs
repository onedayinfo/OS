using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using OsAgent;
using OsAgent.Coleta;

// último fallback do servidor (ver Instalacao.ResolverServidor)
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
    var (codigo, hostArquivo) = NomeArquivo.Extrair(Arg("--msi"));
    if (codigo is null)
    {
        Console.Error.WriteLine("Este instalador não tem o código do cliente no nome do arquivo. " +
            "Baixe o instalador novamente pela aba Agente do cliente (o nome deve ser AgenteOS-<código>.msi) e não renomeie o arquivo.");
        return 1;
    }
    var store = new ConfigStore();
    try
    {
        var atual = store.Carregar();
        var url = Instalacao.ResolverServidor(Arg("--servidor"), hostArquivo, atual?.ServidorUrl, ServidorPadrao);
        // reinstalar/atualizar com o mesmo código mantém o token (não duplica o PC)
        var token = atual?.Codigo == codigo ? atual.TokenProtegido : null;
        store.RestringirAcesso();
        store.Salvar(new AgentConfig(url, codigo, token));
        Log.Info($"Código de instalação gravado. Servidor: {url}");
        return 0;
    }
    catch (ArgumentException e)
    {
        Console.Error.WriteLine("Endereço do servidor inválido: " + e.Message);
        return 3;
    }
    catch (Exception e)
    {
        Console.Error.WriteLine("Não foi possível gravar a configuração do agente: " + e.Message);
        return 2;
    }
}

if (args.Length > 0 && args[0] == "servidor")
{
    if (args.Length < 2) { Console.Error.WriteLine("Uso: OsAgent.exe servidor https://os.cliente.com.br"); return 1; }
    try
    {
        ApiClient.ValidarUrl(args[1]);
        var store = new ConfigStore();
        var atual = store.Carregar();
        if (atual is null) { Console.Error.WriteLine("O agente ainda não foi instalado (sem config.json)."); return 1; }
        store.Salvar(atual with { ServidorUrl = args[1].TrimEnd('/') });
        Console.WriteLine($"Servidor alterado para {args[1].TrimEnd('/')}. Reinicie o serviço: net stop AgenteOS && net start AgenteOS");
        return 0;
    }
    catch (ArgumentException e) { Console.Error.WriteLine("Endereço do servidor inválido: " + e.Message); return 3; }
    catch (UnauthorizedAccessException) { Console.Error.WriteLine("Sem permissão para gravar a configuração. Execute como administrador."); return 2; }
}

if (args.Length > 0 && args[0] == "status")
{
    var c = new ConfigStore().Carregar();
    if (c is null) { Console.WriteLine("Agente não configurado (sem config.json, ou sem permissão para ler: execute como administrador)."); return 1; }
    Console.WriteLine($"Servidor: {c.ServidorUrl}");
    Console.WriteLine($"Código de instalação: {(string.IsNullOrEmpty(c.Codigo) ? "não" : "sim")}");
    Console.WriteLine($"Token (dispositivo apresentado): {(string.IsNullOrEmpty(c.TokenProtegido) ? "não" : "sim")}");
    Console.WriteLine($"Último contato com o servidor: {(c.UltimoContato is { } u ? u.ToLocalTime().ToString("dd/MM/yyyy HH:mm:ss") : "desconhecido")}");
    return 0;
}

var host = Host.CreateDefaultBuilder(args)
    .UseWindowsService(o => o.ServiceName = "AgenteOS")
    .ConfigureServices(s => { s.AddSingleton(new ConfigStore()); s.AddHostedService<AgentWorker>(); })
    .Build();
await host.RunAsync();
return 0;
