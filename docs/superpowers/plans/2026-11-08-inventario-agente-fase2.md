# Agente Windows + MSI (fase 2a) — Plano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps usam checkbox.

**Goal:** um `AgenteOS-<codigo>.msi` que instala um serviço Windows que se apresenta (enroll) e envia heartbeat + inventário (checkin) à API da fase 1.

**Spec:** `docs/superpowers/specs/2026-11-08-inventario-agente-design.md` (§4, §5, §10). API já pronta em `backend/src/agent/` (DTOs: `dto/enroll.dto.ts`, `dto/checkin.dto.ts`).

## Decisões (substituem o §10 do spec onde divergem)

- **C# / .NET 10**, não Go: o usuário já tem o .NET e o fluxo WiX 5.0.2 funcionando no projeto vizinho `Z:\Projetos\NewGuard` (`guard/instalador/build-msi.ps1`, `NewGuard.wxs`, `dotnet-tools.json`). **Copiar o padrão de lá** (WiX como ferramenta local, `dotnet publish -r win-x64 --self-contained`, `ServiceInstall` LocalSystem, `util:ServiceConfig` restart 60 s, `MajorUpgrade`, UpgradeCode fixo).
- **Sem assinatura** (não há certificado): o `build-msi.ps1` deixa um parâmetro `-Certificado` opcional que roda `signtool`; sem ele, gera sem assinar.
- **Código do cliente no nome do arquivo** (`AgenteOS-<32hex>.msi`). Uma custom action EXE imediata roda `OsAgent.exe instalar --msi "[OriginalDatabase]"`, que extrai o código do nome com `AgenteOS-([0-9a-f]{32})` e grava em `C:\ProgramData\AgenteOS\config.json`. Sem código → a instalação falha com mensagem em português. (Se uma EXE imediata não enxergar os arquivos instalados, usar `Property` + ação diferida; o implementador valida numa instalação real e registra a decisão.)
- **Fora desta fase:** autoatualização/Ed25519, eventos de uptime (fase 3), aba Inventário e regras de melhoria, assinatura.
- URL do servidor: constante `ServidorUrl` lida de `config.json`, padrão vem de propriedade MSI `SERVIDOR_URL` (padrão `https://os.onedayinfo.com.br`, o implementador confere em `portainer-stack.env`/README qual é o domínio público).

## Global Constraints

- Agente **só envia**; nenhum comando do servidor; sem coleta de janelas/teclado/tela.
- Somente HTTPS na saída; token do dispositivo em `config.json` protegido por DPAPI (LocalMachine); pasta `ProgramData\AgenteOS` só SYSTEM/Administradores.
- Heartbeat 5 min; inventário completo no start, a cada 24 h e quando o hash mudar; backoff exponencial (máx 1 h) em erro de rede; 401 → reenroll com o código; 403 → quieto, tenta de novo em 1 h.
- Mensagens e logs em português; log em `ProgramData\AgenteOS\agente.log` com rotação simples.

## Review Focus

- Nome do arquivo renomeado pelo navegador (`AgenteOS-<cod> (1).msi`) ainda extrai o código.
- Serial placeholder ("To be filled by O.E.M.") é enviado como veio (o servidor normaliza); campos ausentes viram omitidos, não string vazia.
- Servidor fora do ar/contrato vencido (403) não faz o serviço travar nem inundar o log.
- Reinstalar/atualizar o MSI mantém token e não duplica o PC.
- Desinstalar remove o serviço mas não apaga o histórico do servidor.

---

### Task 1: Núcleo do agente (projeto, config, enroll/checkin, serviço)

**Files:** Create `agent/OsAgent/OsAgent.csproj` (net10.0, Worker + `Microsoft.Extensions.Hosting.WindowsServices`, projeto Windows), `agent/OsAgent/Program.cs`, `Config.cs`, `ApiClient.cs`, `AgentWorker.cs`, `NomeArquivo.cs`; `agent/OsAgent.Tests/` (xUnit); `agent/OsAgent.slnx`.

**Interfaces — Produces:**
- `static class NomeArquivo { static string? ExtrairCodigo(string caminho) }` — regex `AgenteOS-([0-9a-f]{32})` (case-insensitive, normaliza para minúsculas), aceita sufixo ` (1)`.
- `record AgentConfig(string ServidorUrl, string? Codigo, string? TokenProtegido)`; `ConfigStore.Carregar()/Salvar()`; token via `ProtectedData` (LocalMachine).
- `ApiClient.EnrollAsync(Identificacao) -> string token`, `ApiClient.CheckinAsync(Identificacao, Inventario?) -> CheckinResposta` (campo `wantInventory`, como a API da fase 1 devolve); JSON camelCase, corpo igual a `EnrollDto`/`CheckinDto`.
- `Identificacao(machineGuid, hostname, serialNumber?, manufacturer?, model?, ip?, mac?, agentVersion)`.
- Comandos de linha: sem argumentos = roda como serviço; `instalar --msi <caminho>` = grava código e sai (código ≠ 0 com mensagem se não achar); `coletar` = imprime o JSON do inventário no console (diagnóstico).

- [ ] Testes xUnit para `NomeArquivo.ExtrairCodigo` (nome normal, com ` (1)`, maiúsculas, sem código → null, 31 hex → null) e para o backoff; ver falhar; implementar; ver passar.
- [ ] `ApiClient` com `HttpClient` (timeout 30 s), testado contra `HttpMessageHandler` falso: enroll 201 devolve token; checkin 401 → exceção `TokenInvalido`; 403 → `ClienteSemContrato`.
- [ ] `AgentWorker`: loop descrito nas Global Constraints; commit.

### Task 2: Coleta de hardware/software

**Files:** Create `agent/OsAgent/Coleta/*.cs` (`Hardware.cs`, `Software.cs`, `Inventario.cs`).

**Produces:** `Inventario.Coletar() -> (Dictionary<string,object> specs, List<SoftwareItem> software, string hash)`. `specs` com as chaves: `cpu{nome,nucleos}`, `ramGb`, `discos[{nome,tamanhoGb,livreGb,tipo(SSD|HDD),smart,sistema}]`, `so{edicao,build,versao}`, `bios{data,versao}`, `tpm{presente,versao}`, `secureBoot`, `uefi`. Software: chaves `Uninstall` HKLM 64/32 + HKU carregados; ignora entradas sem `DisplayName` e `SystemComponent=1`; máx. 3000, nomes ≤255.

- [ ] Usar WMI (`System.Management`) — Win32_Processor, ComputerSystem, BIOS, DiskDrive/`MSFT_PhysicalDisk` (tipo SSD/HDD), `Win32_Tpm`, `Confirm-SecureBootUEFI` equivalente por registro. Cada coletor em `try/catch`: falha de um item vira ausência, nunca derruba o inventário.
- [ ] Teste: `hash` estável para o mesmo inventário (ordena listas); software sem duplicatas exatas; commit. Rodar `OsAgent.exe coletar` nesta máquina e conferir que o JSON é plausível.

### Task 3: MSI

**Files:** Create `agent/instalador/AgenteOS.wxs`, `agent/instalador/build-msi.ps1`, `agent/instalador/dotnet-tools.json` (WiX 5.0.2), `agent/.gitignore` (obj, bin, saida, obj-publish).

- [ ] `AgenteOS.wxs` (WiX 5, pt-BR, perMachine, UpgradeCode novo fixo): instala em `ProgramFiles64Folder\AgenteOS`, serviço `AgenteOS` LocalSystem auto com restart, ação EXE `instalar --msi "[OriginalDatabase]"` antes de iniciar o serviço (falha aborta a instalação), UI mínima com a tela de aviso do que é coletado (informativa), propriedade `SERVIDOR_URL`. Desinstalar não apaga `ProgramData\AgenteOS` do servidor (nada a fazer) e remove o serviço.
- [ ] `build-msi.ps1 [-Version 0.1.0] [-Certificado <pfx>]` copiando a estrutura de `NewGuard/guard/instalador/build-msi.ps1`; grava `agent/instalador/saida/AgenteOS.msi` e mostra tamanho/SHA-256.
- [ ] **Verificação real:** gerar o MSI; copiar para `AgenteOS-<código de teste>.msi`; instalar com `msiexec /i ... /qn` no Windows desta máquina contra um servidor de teste local (backend de dev em `http://localhost` precisa de HTTPS: permitir `http://localhost` apenas em build Debug ou via `SERVIDOR_URL` explícito em `http://localhost` — o implementador adiciona a exceção só para localhost); confirmar serviço rodando, PC em `PENDING` na fila, depois checkin; desinstalar e confirmar remoção. Registrar o que não pôde ser testado.

### Task 4: Entrega do instalador pelo servidor

**Files:** Modify `backend/src/agent/client-agent.controller.ts` (+ spec), `backend/Dockerfile`, `.dockerignore`/`.gitignore` conforme necessário, `frontend/src/components/client-agent-tab.tsx`, `deploy/README.md`, `CHANGELOG.md`.

- [ ] `GET /clients/:id/agent/installer` (ADMIN/AGENT, mesmos guards da rota do código): se o cliente não tem `agentEnrollCode` → 409; se `AGENT_MSI_PATH` (padrão `/app/agent-dist/AgenteOS.msi`) não existe → 404 "instalador ainda não publicado"; senão stream com `Content-Disposition: attachment; filename="AgenteOS-<codigo>.msi"`. Teste de integração/unit com arquivo temporário (os três casos).
- [ ] Dockerfile: `COPY` opcional de `agent-dist/` (a pasta fica fora do git, com `.gitkeep`); o script de deploy documenta: gerar o MSI, copiar para `backend/agent-dist/AgenteOS.msi`, depois `build-and-push.sh`.
- [ ] Botão "Baixar instalador" na aba Agente (usa o download autenticado já usado em outros anexos do front; se não houver padrão, `fetch` com blob). Checagem manual no navegador.
- [ ] CHANGELOG `## [0.16.0]` (agente + instalador); bump de versão fica para o deploy.
