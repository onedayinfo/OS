using OsAgent;
using OsAgent.Coleta;
using Xunit;

public class InventarioTests
{
    [Fact]
    public void Hash_estavel_independente_da_ordem_e_do_livreGb()
    {
        var a = new Dictionary<string, object> { ["ramGb"] = 8, ["discos"] = new List<Dictionary<string, object>> { new() { ["nome"] = "A", ["livreGb"] = 10.5 }, new() { ["nome"] = "B" } } };
        var b = new Dictionary<string, object> { ["discos"] = new List<Dictionary<string, object>> { new() { ["nome"] = "B" }, new() { ["livreGb"] = 99.0, ["nome"] = "A" } }, ["ramGb"] = 8 };
        var s1 = new List<SoftwareItem> { new("X", "1", null), new("Y", "2", "P") };
        var s2 = new List<SoftwareItem> { new("Y", "2", "P"), new("X", "1", null) };
        Assert.Equal(InventarioColeta.CalcularHash(a, s1), InventarioColeta.CalcularHash(b, s2));
        Assert.NotEqual(InventarioColeta.CalcularHash(a, s1), InventarioColeta.CalcularHash(a, [new("X", "1", null)]));
    }

    [Fact]
    public void Software_sem_duplicatas_sem_nome_e_truncado()
    {
        var r = Software.Normalizar([new("A", "1", null), new("A", "1", null), new("", "1", null), new(new string('n', 300), null, null)]);
        Assert.Equal(2, r.Count);
        Assert.All(r, i => Assert.True(i.Name.Length <= 255));
    }

    [Fact]
    public void Coletar_nesta_maquina_devolve_algo_plausivel()
    {
        var inv = InventarioColeta.Coletar();
        Assert.True(inv.Specs.ContainsKey("ramGb"));
        Assert.NotEmpty(inv.Software);
        Assert.Equal(64, inv.Hash.Length);
    }
}
