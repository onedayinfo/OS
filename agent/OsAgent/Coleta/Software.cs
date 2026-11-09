using Microsoft.Win32;

namespace OsAgent.Coleta;

public static class Software
{
    const string Uninstall = @"Software\Microsoft\Windows\CurrentVersion\Uninstall";

    public static List<SoftwareItem> Coletar()
    {
        var lista = new List<SoftwareItem>();

        void Varrer(RegistryHive hive, RegistryView view, string caminho)
        {
            try
            {
                using var b = RegistryKey.OpenBaseKey(hive, view);
                using var k = b.OpenSubKey(caminho);
                if (k is null) return;
                foreach (var nome in k.GetSubKeyNames())
                {
                    try
                    {
                        using var s = k.OpenSubKey(nome);
                        if (s is null) continue;
                        if (Convert.ToInt32(s.GetValue("SystemComponent") ?? 0) == 1) continue;
                        lista.Add(new SoftwareItem(s.GetValue("DisplayName") as string ?? "",
                            s.GetValue("DisplayVersion")?.ToString(), s.GetValue("Publisher") as string));
                    }
                    catch { /* entrada ilegível: ignora */ }
                }
            }
            catch { /* chave inacessível: ignora */ }
        }

        Varrer(RegistryHive.LocalMachine, RegistryView.Registry64, Uninstall);
        Varrer(RegistryHive.LocalMachine, RegistryView.Registry32, Uninstall);
        try
        {
            using var u = RegistryKey.OpenBaseKey(RegistryHive.Users, RegistryView.Registry64);
            foreach (var sid in u.GetSubKeyNames().Where(n => !n.EndsWith("_Classes", StringComparison.OrdinalIgnoreCase)))
                Varrer(RegistryHive.Users, RegistryView.Registry64, sid + "\\" + Uninstall);
        }
        catch { }
        return Normalizar(lista);
    }

    /// <summary>Descarta sem nome, trunca campos, remove duplicatas exatas e limita a 3000.</summary>
    public static List<SoftwareItem> Normalizar(IEnumerable<SoftwareItem> itens)
    {
        static string? T(string? s, int max) { s = s?.Trim(); return string.IsNullOrEmpty(s) ? null : s.Length > max ? s[..max] : s; }
        return itens
            .Select(i => new SoftwareItem(T(i.Name, 255) ?? "", T(i.Version, 128), T(i.Publisher, 255)))
            .Where(i => i.Name.Length > 0)
            .Distinct()
            .OrderBy(i => i.Name, StringComparer.OrdinalIgnoreCase).ThenBy(i => i.Version, StringComparer.Ordinal)
            .Take(3000)
            .ToList();
    }
}
