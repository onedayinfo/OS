using System.Text.RegularExpressions;

namespace OsAgent;

public static class NomeArquivo
{
    static readonly Regex Re = new(@"AgenteOS-([0-9a-f]{32})(?![0-9a-f])", RegexOptions.IgnoreCase);

    static readonly Regex Host = new(@"^(localhost|[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+)$");
    static readonly Regex Sufixo = new(@"(\s*\(\d+\))?\.msi$", RegexOptions.IgnoreCase);

    public static string? ExtrairCodigo(string? caminho) => Extrair(caminho).codigo;

    /// <summary>Código (32 hex) e, se válido, o host do servidor: AgenteOS-&lt;cod&gt;[-&lt;host&gt;][ (1)].msi. Host inválido é ignorado.</summary>
    public static (string? codigo, string? host) Extrair(string? caminho)
    {
        if (string.IsNullOrEmpty(caminho)) return (null, null);
        var nome = Path.GetFileName(caminho);
        var m = Re.Match(nome);
        if (!m.Success) return (null, null);
        var resto = Sufixo.Replace(nome[(m.Index + m.Length)..], "").ToLowerInvariant();
        var host = resto.StartsWith('-') && Host.IsMatch(resto[1..]) ? resto[1..] : null;
        return (m.Groups[1].Value.ToLowerInvariant(), host);
    }
}

public static class Instalacao
{
    /// <summary>Precedência: CODIGO explícito &gt; código do nome do arquivo &gt; já salvo. Null = nenhum. Explícito inválido lança ArgumentException.</summary>
    public static string? ResolverCodigo(string? explicito, string? doArquivo, string? salvo)
    {
        if (!string.IsNullOrWhiteSpace(explicito))
        {
            var c = string.Concat(explicito.Where(ch => !char.IsWhiteSpace(ch))).ToLowerInvariant();
            if (!System.Text.RegularExpressions.Regex.IsMatch(c, "^[0-9a-f]{32}$"))
                throw new ArgumentException("O código de instalação deve ter 32 caracteres (números de 0 a 9 e letras de a a f).");
            return c;
        }
        return doArquivo ?? (string.IsNullOrWhiteSpace(salvo) ? null : salvo);
    }

    /// <summary>Precedência: SERVIDOR_URL explícito &gt; host do nome do arquivo &gt; já salvo &gt; padrão. Vazio não vale. URL inválida lança ArgumentException.</summary>
    public static string ResolverServidor(string? explicito, string? hostDoArquivo, string? salvo, string padrao)
    {
        string? url = null;
        if (!string.IsNullOrWhiteSpace(explicito)) url = explicito.Trim();
        else if (!string.IsNullOrEmpty(hostDoArquivo)) url = "https://" + hostDoArquivo;
        else if (!string.IsNullOrWhiteSpace(salvo)) url = salvo;
        url ??= padrao;
        ApiClient.ValidarUrl(url);
        return url.TrimEnd('/');
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
