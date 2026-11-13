# Agente OS (Windows)

Serviço `AgenteOS` que envia inventário e sinal de funcionamento ao sistema de OS. Gerar o instalador: `pwsh agent/instalador/build-msi.ps1 [-Version 0.1.0]` (saída em `agent/instalador/saida/AgenteOS.msi`).

O instalador normalmente tem o nome `AgenteOS-<código de 32 caracteres>.msi` (o sufixo ` (1)` do navegador é aceito); se o nome perder o código, veja abaixo.

## Código de instalação

Ordem de precedência:

1. **`CODIGO` na linha de comando** (vence tudo): `msiexec /i AgenteOS.msi /qn CODIGO=<32 caracteres>`. Espaços ao redor são removidos e maiúsculas viram minúsculas; fora de 32 caracteres hexadecimais a instalação é abortada.
2. **Código no nome do arquivo** (`AgenteOS-<código>.msi`).
3. **Código já salvo** no `config.json` (reinstalação/atualização).
4. Sem nenhum dos três, a instalação falha com mensagem em português.

Na instalação com tela, se o nome do arquivo não parecer trazer o código (por exemplo, renomeado pelo WhatsApp), o instalador mostra a tela **Código de instalação**: digite ou cole o código (ficha do cliente, aba Agente, no OS). Limites: o MSI não tem expressão regular, então a tela só aparece quando o caminho do `.msi` não contém `AgenteOS-` e `CODIGO` não foi informado; um nome como `AgenteOS-abc.msi` não mostra a tela e a instalação é desfeita pela validação do agente. O botão Avançar não faz nada com o campo vazio, e a conferência dos 32 caracteres hexadecimais é feita pelo agente ao gravar (não pela tela). Em `OsAgent.exe instalar` o mesmo valor vai em `--codigo`.

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
