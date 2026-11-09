using OsAgent;
using Xunit;

public class NomeArquivoTests
{
    const string Cod = "0123456789abcdef0123456789abcdef";

    [Theory]
    [InlineData(@"C:\Downloads\AgenteOS-0123456789abcdef0123456789abcdef.msi")]
    [InlineData(@"C:\Downloads\AgenteOS-0123456789abcdef0123456789abcdef (1).msi")]
    [InlineData(@"agenteos-0123456789ABCDEF0123456789ABCDEF.msi")]
    public void Extrai_codigo(string caminho) => Assert.Equal(Cod, NomeArquivo.ExtrairCodigo(caminho));

    [Theory]
    [InlineData(@"C:\x\AgenteOS.msi")]
    [InlineData(@"C:\x\AgenteOS-0123456789abcdef0123456789abcde.msi")]
    [InlineData(null)]
    public void Sem_codigo_devolve_null(string? caminho) => Assert.Null(NomeArquivo.ExtrairCodigo(caminho));

    [Fact]
    public void Backoff_dobra_e_limita_em_1h()
    {
        Assert.Equal(TimeSpan.FromMinutes(5), Backoff.Atraso(0));
        Assert.Equal(TimeSpan.FromMinutes(10), Backoff.Atraso(1));
        Assert.Equal(TimeSpan.FromMinutes(20), Backoff.Atraso(2));
        Assert.Equal(TimeSpan.FromHours(1), Backoff.Atraso(10));
        Assert.Equal(TimeSpan.FromHours(1), Backoff.Atraso(1000));
    }
}
