namespace OsAgent;

/// <summary>Log em arquivo, em português, com rotação simples (1 MB, guarda agente.log.1).</summary>
public static class Log
{
    static readonly object Trava = new();
    public static string Pasta = ConfigStore.PastaPadrao;

    public static void Info(string msg) => Escrever("INFO", msg);
    public static void Erro(string msg) => Escrever("ERRO", msg);

    static void Escrever(string nivel, string msg)
    {
        var linha = $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} [{nivel}] {msg}";
        Console.WriteLine(linha);
        try
        {
            lock (Trava)
            {
                Directory.CreateDirectory(Pasta);
                var f = Path.Combine(Pasta, "agente.log");
                if (File.Exists(f) && new FileInfo(f).Length > 1_000_000) File.Move(f, f + ".1", true);
                File.AppendAllText(f, linha + Environment.NewLine);
            }
        }
        catch { /* log nunca derruba o agente */ }
    }
}
