using System.Management;
using System.Net.NetworkInformation;
using Microsoft.Win32;

namespace OsAgent.Coleta;

public static class Hardware
{
    // Cada coletor é isolado: falha vira ausência, nunca derruba o inventário.
    static T? Seguro<T>(Func<T?> f) { try { return f(); } catch { return default; } }

    static List<ManagementObject> Todos(string ns, string query)
    {
        using var s = new ManagementObjectSearcher(ns, query);
        return s.Get().Cast<ManagementObject>().ToList();
    }

    static ManagementObject? Primeiro(string ns, string query) => Todos(ns, query).FirstOrDefault();

    static string? Str(ManagementBaseObject? o, string prop) =>
        o?[prop]?.ToString()?.Trim() is { Length: > 0 } v ? v : null;

    static int Gb(object bytes) => (int)Math.Round(Convert.ToUInt64(bytes) / 1073741824.0);

    public static Identificacao Identificar(string versao)
    {
        var bios = Seguro(() => Primeiro("root\\cimv2", "SELECT SerialNumber FROM Win32_BIOS"));
        var cs = Seguro(() => Primeiro("root\\cimv2", "SELECT Manufacturer, Model FROM Win32_ComputerSystem"));
        var (ip, mac) = Seguro(RedePrincipal);
        var guid = Seguro(() =>
        {
            using var b = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64);
            using var k = b.OpenSubKey(@"SOFTWARE\Microsoft\Cryptography");
            return k?.GetValue("MachineGuid") as string;
        }) ?? Environment.MachineName;
        // serial placeholder ("To be filled by O.E.M.") segue como veio: o servidor normaliza
        return new Identificacao(guid, Environment.MachineName, Str(bios, "SerialNumber"), Str(cs, "Manufacturer"),
            Str(cs, "Model"), ip, mac, versao);
    }

    static (string?, string?) RedePrincipal()
    {
        foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (nic.OperationalStatus != OperationalStatus.Up ||
                nic.NetworkInterfaceType is NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel) continue;
            var p = nic.GetIPProperties();
            if (p.GatewayAddresses.Count == 0) continue;
            var ip = p.UnicastAddresses.FirstOrDefault(a => a.Address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)?.Address.ToString();
            var mac = string.Join(":", nic.GetPhysicalAddress().GetAddressBytes().Select(b => b.ToString("X2")));
            return (ip, mac.Length > 0 ? mac : null);
        }
        return (null, null);
    }

    public static Dictionary<string, object> ColetarSpecs()
    {
        var d = new Dictionary<string, object>();
        void Add(string k, object? v) { if (v is not null) d[k] = v; }

        Add("cpu", Seguro<object>(() =>
        {
            var cpus = Todos("root\\cimv2", "SELECT Name, NumberOfCores FROM Win32_Processor");
            if (cpus.Count == 0) return null;
            var o = new Dictionary<string, object>();
            if (Str(cpus[0], "Name") is { } n) o["nome"] = n;
            o["nucleos"] = cpus.Sum(c => Convert.ToInt32(c["NumberOfCores"]));
            return o;
        }));
        Add("ramGb", Seguro<object>(() =>
        {
            var cs = Primeiro("root\\cimv2", "SELECT TotalPhysicalMemory FROM Win32_ComputerSystem");
            return cs is null ? null : Gb(cs["TotalPhysicalMemory"]);
        }));
        Add("discos", Seguro(ColetarDiscos));
        Add("so", Seguro<object>(() =>
        {
            var os = Primeiro("root\\cimv2", "SELECT Caption, BuildNumber, Version FROM Win32_OperatingSystem");
            if (os is null) return null;
            var o = new Dictionary<string, object>();
            if (Str(os, "Caption") is { } c) o["edicao"] = c;
            if (Str(os, "BuildNumber") is { } b) o["build"] = b;
            if (Str(os, "Version") is { } v) o["versao"] = v;
            return o;
        }));
        Add("bios", Seguro<object>(() =>
        {
            var b = Primeiro("root\\cimv2", "SELECT ReleaseDate, SMBIOSBIOSVersion FROM Win32_BIOS");
            if (b is null) return null;
            var o = new Dictionary<string, object>();
            if (Str(b, "ReleaseDate") is { Length: >= 8 } r) o["data"] = $"{r[..4]}-{r[4..6]}-{r[6..8]}";
            if (Str(b, "SMBIOSBIOSVersion") is { } v) o["versao"] = v;
            return o;
        }));
        Add("tpm", Seguro<object>(() =>
        {
            var t = Primeiro("root\\CIMV2\\Security\\MicrosoftTpm", "SELECT SpecVersion FROM Win32_Tpm");
            if (t is null) return new Dictionary<string, object> { ["presente"] = false };
            var o = new Dictionary<string, object> { ["presente"] = true };
            if (Str(t, "SpecVersion")?.Split(',')[0].Trim() is { Length: > 0 } v) o["versao"] = v;
            return o;
        }));
        Add("uefi", Seguro<object>(() =>
        {
            using var k = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Control");
            return k?.GetValue("PEFirmwareType") is { } fw ? Convert.ToInt32(fw) == 2 : null;
        }));
        Add("secureBoot", Seguro<object>(() =>
        {
            using var k = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Control\SecureBoot\State");
            return k?.GetValue("UEFISecureBootEnabled") is { } v ? Convert.ToInt32(v) == 1 : null;
        }));
        return d;
    }

    static object? ColetarDiscos()
    {
        var sistema = (Environment.GetEnvironmentVariable("SystemDrive") ?? "C:").TrimEnd('\\');
        var fisicos = new List<(string nome, string tipo, string? smart)>();
        try
        {
            foreach (var p in Todos("root\\Microsoft\\Windows\\Storage", "SELECT FriendlyName, MediaType, HealthStatus FROM MSFT_PhysicalDisk"))
            {
                var tipo = Convert.ToInt32(p["MediaType"]) switch { 3 => "HDD", 4 => "SSD", _ => "" };
                var smart = Convert.ToInt32(p["HealthStatus"]) switch { 0 => "OK", 1 => "Atenção", 2 => "Falha", _ => null };
                fisicos.Add((Str(p, "FriendlyName") ?? "", tipo, smart));
            }
        }
        catch { /* sem tipo/SMART */ }

        var lista = new List<Dictionary<string, object>>();
        foreach (var disk in Todos("root\\cimv2", "SELECT DeviceID, Model, Size FROM Win32_DiskDrive"))
        {
            var nome = Str(disk, "Model") ?? "Disco";
            var o = new Dictionary<string, object> { ["nome"] = nome };
            if (disk["Size"] is not null) o["tamanhoGb"] = Gb(disk["Size"]);
            var f = fisicos.FirstOrDefault(x => x.nome.Length > 0 && nome.Contains(x.nome, StringComparison.OrdinalIgnoreCase));
            if (f.nome is not null)
            {
                if (f.tipo.Length > 0) o["tipo"] = f.tipo;
                if (f.smart is not null) o["smart"] = f.smart;
            }
            try
            {
                double livre = 0; bool temSistema = false, achou = false;
                var id = disk["DeviceID"]!.ToString()!.Replace("\\", "\\\\");
                foreach (var part in Todos("root\\cimv2", $"ASSOCIATORS OF {{Win32_DiskDrive.DeviceID='{id}'}} WHERE AssocClass=Win32_DiskDriveToDiskPartition"))
                    foreach (var ld in Todos("root\\cimv2", $"ASSOCIATORS OF {{Win32_DiskPartition.DeviceID='{part["DeviceID"]}'}} WHERE AssocClass=Win32_LogicalDiskToPartition"))
                    {
                        achou = true;
                        if (ld["FreeSpace"] is not null) livre += Convert.ToUInt64(ld["FreeSpace"]);
                        if (string.Equals(Str(ld, "DeviceID"), sistema, StringComparison.OrdinalIgnoreCase)) temSistema = true;
                    }
                if (achou) { o["livreGb"] = Math.Round(livre / 1073741824.0, 1); o["sistema"] = temSistema; }
            }
            catch { /* sem espaço livre */ }
            lista.Add(o);
        }
        return lista.Count == 0 ? null : lista;
    }
}
