using OsAgent;
using Xunit;

public class ServidorTests
{
    const string Cod = "0123456789abcdef0123456789abcdef";

    [Theory]
    [InlineData($"AgenteOS-{Cod}-os.cliente.com.br.msi", "os.cliente.com.br")]
    [InlineData($"C:\\x\\AgenteOS-{Cod}-OS.Cliente.com.br (1).msi", "os.cliente.com.br")]
    [InlineData($"AgenteOS-{Cod}-localhost.msi", "localhost")]
    [InlineData($"AgenteOS-{Cod}.msi", null)]
    [InlineData($"AgenteOS-{Cod} (1).msi", null)]
    [InlineData($"AgenteOS-{Cod}-semponto.msi", null)]
    [InlineData($"AgenteOS-{Cod}-os_x.com.br.msi", null)]
    [InlineData($"AgenteOS-{Cod}-os..com.msi", null)]
    [InlineData($"AgenteOS-{Cod}--os.com.msi", null)]
    public void Extrai_codigo_e_host(string caminho, string? host)
    {
        var (c, h) = NomeArquivo.Extrair(caminho);
        Assert.Equal(Cod, c);
        Assert.Equal(host, h);
    }

    [Theory]
    [InlineData("AgenteOS-0123456789abcdef0123456789abcde-os.com.br.msi")]
    [InlineData("outro.msi")]
    [InlineData(null)]
    public void Sem_codigo_nada(string? caminho) => Assert.Equal((null, null), NomeArquivo.Extrair(caminho));

    [Fact]
    public void Precedencia_explicito_host_salvo_padrao()
    {
        Assert.Equal("https://a.com", Instalacao.ResolverServidor("https://a.com", "b.com", "https://c.com", "https://d.com"));
        Assert.Equal("https://b.com", Instalacao.ResolverServidor("", "b.com", "https://c.com", "https://d.com"));
        Assert.Equal("https://c.com", Instalacao.ResolverServidor(" ", null, "https://c.com", "https://d.com"));
        Assert.Equal("https://d.com", Instalacao.ResolverServidor(null, null, null, "https://d.com"));
    }

    [Fact]
    public void Url_invalida_aborta()
    {
        Assert.Throws<ArgumentException>(() => Instalacao.ResolverServidor("http://a.com", null, null, "https://d.com"));
        Assert.Throws<ArgumentException>(() => Instalacao.ResolverServidor("lixo", null, null, "https://d.com"));
    }

    [Fact]
    public void Codigo_precedencia_explicito_arquivo_salvo()
    {
        const string A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", C2 = "cccccccccccccccccccccccccccccccc";
        Assert.Equal(A, Instalacao.ResolverCodigo(A, B, C2));
        Assert.Equal(B, Instalacao.ResolverCodigo("", B, C2));
        Assert.Equal(B, Instalacao.ResolverCodigo("   ", B, C2));
        Assert.Equal(C2, Instalacao.ResolverCodigo(null, null, C2));
        Assert.Null(Instalacao.ResolverCodigo(null, null, null));
    }

    [Fact]
    public void Codigo_explicito_normaliza_espacos_e_maiusculas()
    {
        Assert.Equal("0123456789abcdef0123456789abcdef", Instalacao.ResolverCodigo("  0123456789ABCDEF 0123456789abcdef\r\n", null, null));
    }

    [Theory]
    [InlineData("0123456789abcdef0123456789abcde")]
    [InlineData("0123456789abcdef0123456789abcdefa")]
    [InlineData("0123456789abcdef0123456789abcdeg")]
    public void Codigo_explicito_invalido_lanca(string v) =>
        Assert.Throws<ArgumentException>(() => Instalacao.ResolverCodigo(v, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", null));
}
