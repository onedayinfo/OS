# Agente OS (Windows)

Serviço `AgenteOS` que envia inventário e sinal de funcionamento ao sistema de OS. Gerar o instalador: `pwsh agent/instalador/build-msi.ps1 [-Version 0.1.0]` (saída em `agent/instalador/saida/AgenteOS.msi`).

O instalador deve ter o nome `AgenteOS-<código de 32 caracteres>.msi` (não renomeie; o sufixo ` (1)` do navegador é aceito).

## Servidor de cada cliente (domínio próprio)

Ordem de precedência na instalação:

1. **`SERVIDOR_URL` na linha de comando** (vence tudo):
   `msiexec /i AgenteOS-<código>.msi /qn SERVIDOR_URL=https://os.cliente.com.br`
2. **Host no nome do arquivo**: `AgenteOS-<código>-os.cliente.com.br.msi` usa `https://os.cliente.com.br` (minúsculas, dígitos, hífen e ponto; sem porta).
3. **Valor já salvo** no `config.json` (reinstalação/atualização mantém o servidor).
4. **Padrão do agente**: `https://os.onedayinformatica.com.br`.

Só HTTPS é aceito (exceto `localhost`). Endereço inválido aborta a instalação com mensagem em português.

## Ajuste e diagnóstico (PowerShell/Prompt como administrador)

- `OsAgent.exe servidor https://os.cliente.com.br` grava o servidor no `config.json`; depois `net stop AgenteOS && net start AgenteOS`.
- `OsAgent.exe status` mostra servidor, se há código e token, e o último contato conhecido.
- `OsAgent.exe coletar` imprime o inventário em JSON (diagnóstico).

Arquivos do agente: `C:\ProgramData\AgenteOS\` (`config.json`, `agente.log`), acessível só a SYSTEM e Administradores.
