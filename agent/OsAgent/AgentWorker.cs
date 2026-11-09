using System.Reflection;
using Microsoft.Extensions.Hosting;
using OsAgent.Coleta;

namespace OsAgent;

public class AgentWorker(ConfigStore store) : BackgroundService
{
    public static string Versao => Assembly.GetExecutingAssembly().GetName().Version is { } v ? $"{v.Major}.{v.Minor}.{v.Build}" : "0.0.0";
    static readonly TimeSpan Heartbeat = TimeSpan.FromMinutes(5), UmaHora = TimeSpan.FromHours(1), UmDia = TimeSpan.FromHours(24);

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        Log.Info($"Agente OS {Versao} iniciado.");
        int falhas = 0;
        string? ultimoErro = null;
        Inventario? inv = null; string? hashEnviado = null;
        DateTime coletadoEm = DateTime.MinValue, enviadoEm = DateTime.MinValue;

        while (!ct.IsCancellationRequested)
        {
            TimeSpan espera;
            var emEnroll = false;
            try
            {
                var cfg = store.Carregar();
                if (cfg is null || string.IsNullOrEmpty(cfg.Codigo))
                {
                    Aviso(ref ultimoErro, "Sem código de instalação em config.json; reinstale o agente a partir do instalador do cliente.");
                    await Task.Delay(UmaHora, ct); continue;
                }
                var token = ConfigStore.Desproteger(cfg.TokenProtegido);
                var api = new ApiClient(new HttpClient(), cfg.ServidorUrl, cfg.Codigo, () => token);
                var id = await Task.Run(() => Hardware.Identificar(Versao), ct);

                if (token is null)
                {
                    emEnroll = true;
                    token = await api.EnrollAsync(id, ct);
                    emEnroll = false;
                    store.Salvar(cfg with { TokenProtegido = ConfigStore.Proteger(token) });
                    Log.Info("Dispositivo apresentado ao servidor.");
                }

                if (inv is null || DateTime.UtcNow - coletadoEm > UmaHora)
                {
                    inv = await Task.Run(InventarioColeta.Coletar, ct);
                    coletadoEm = DateTime.UtcNow;
                }
                // inventário no start, a cada 24 h, quando o hash muda ou quando o servidor pede
                var enviar = inv.Hash != hashEnviado || DateTime.UtcNow - enviadoEm > UmDia;
                var r = await api.CheckinAsync(id, enviar ? inv : null, ct);
                if (!enviar && r.WantInventory) { await api.CheckinAsync(id, inv, ct); enviar = true; }
                if (enviar) { hashEnviado = inv.Hash; enviadoEm = DateTime.UtcNow; Log.Info("Inventário enviado."); }
                falhas = 0; ultimoErro = null;
                try { store.Salvar((store.Carregar() ?? cfg) with { UltimoContato = DateTime.UtcNow }); } catch { /* só informativo */ }
                espera = Heartbeat;
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { break; }
            catch (TokenInvalido)
            {
                if (emEnroll) { Aviso(ref ultimoErro, "O servidor recusou o código de instalação. Verifique o instalador."); espera = UmaHora; }
                else
                {
                    Log.Info("Token recusado (401); apresentando o dispositivo novamente.");
                    var c = store.Carregar();
                    if (c is not null) store.Salvar(c with { TokenProtegido = null });
                    espera = TimeSpan.FromSeconds(5);
                }
            }
            catch (ClienteSemContrato)
            {
                Aviso(ref ultimoErro, "O servidor não aceita este dispositivo (sem contrato ativo ou ignorado). Nova tentativa em 1 hora.");
                espera = UmaHora;
            }
            catch (Exception e)
            {
                espera = Backoff.Atraso(falhas++);
                Aviso(ref ultimoErro, $"Falha de comunicação: {e.Message}. Nova tentativa em {espera.TotalMinutes:0} min.");
            }
            try { await Task.Delay(espera, ct); } catch (OperationCanceledException) { break; }
        }
        Log.Info("Agente OS encerrado.");
    }

    // não repete a mesma mensagem a cada tentativa (evita inundar o log)
    static void Aviso(ref string? ultimo, string msg)
    {
        if (msg != ultimo) Log.Erro(msg);
        ultimo = msg;
    }
}
