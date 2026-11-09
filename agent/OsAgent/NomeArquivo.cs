using System.Text.RegularExpressions;

namespace OsAgent;

public static class NomeArquivo
{
    static readonly Regex Re = new(@"AgenteOS-([0-9a-f]{32})(?![0-9a-f])", RegexOptions.IgnoreCase);

    /// <summary>Extrai o código de instalação do nome do arquivo (aceita " (1)" e maiúsculas).</summary>
    public static string? ExtrairCodigo(string? caminho)
    {
        if (string.IsNullOrEmpty(caminho)) return null;
        var m = Re.Match(Path.GetFileName(caminho));
        return m.Success ? m.Groups[1].Value.ToLowerInvariant() : null;
    }
}

public static class Backoff
{
    /// <summary>5 min, dobrando a cada falha seguida, máximo 1 h.</summary>
    public static TimeSpan Atraso(int falhas)
    {
        var min = 5.0 * Math.Pow(2, Math.Min(Math.Max(falhas, 0), 10));
        return TimeSpan.FromMinutes(Math.Min(min, 60));
    }
}
