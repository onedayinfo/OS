# Inventário automático de PCs — agente Windows, fila de cadastro e uptime

Data: 2026-11-08
Estado: proposto (aguardando revisão do usuário)
Base: `main` @ `f877f7b` (release 0.14.1)

## 1. Objetivo

Hoje os ativos (`Asset`) são cadastrados à mão. O objetivo é ter, para cada cliente
com contrato, **a lista real dos computadores**, atualizada pela própria máquina, para:

1. **Vincular chamados e OS ao equipamento certo** (o vínculo ativo↔chamado já existe).
2. **Sugerir melhorias/trocas** com base em dados reais (RAM, disco, Windows, idade).
3. Saber **quando cada PC esteve ligado** (uptime), em especial no home office, onde
   ninguém olha a máquina.

Um **agente Windows** instalado nos PCs envia a "foto" da máquina ao OS. PCs novos caem
numa **fila de cadastro**; só viram ativo depois que o técnico aprova e dá nome, local e
responsável. O instalador é entregue ao próprio cliente/funcionário (inclusive home
office).

## 2. Fora do escopo / anti-objetivos

- **Uso de aplicativos** (qual programa esteve em primeiro plano): adiado, o usuário
  ainda vai decidir. Nenhum título de janela, teclado ou tela é coletado em nenhuma fase.
- **Nenhum controle remoto e nenhum comando vindo do servidor**: o agente só *envia*
  dados. A única coisa que o servidor pode mandar é a nova versão do próprio agente
  (autoatualização verificada por hash).
- Só Windows 10/11. Sem Linux/macOS.
- Orçamento/cotação automático a partir das sugestões; alertas por e-mail/WhatsApp sobre
  PC offline (ideias futuras).
- Multi-tenant (o OS é single-tenant; ver outras specs).

Anti-objetivo: o agente não pode virar motivo de chamado. Se o instalador gerar alerta de
antivírus/SmartScreen ou travar o PC do funcionário, a fase falhou.

## 3. Modelo de dados (Prisma)

**`Asset` (campos novos, todos opcionais):**
- `description String?` — frase sobre a máquina (separada de `notes`, que é observação).
- `assignedTo String?` — responsável/usuário, texto livre ("Maria – financeiro").
- `specs Json?` — último inventário técnico copiado do dispositivo vinculado (ver §4).
- `lastSeenAt DateTime?` — último contato do agente.
- `label` (já existe) é o nome do PC dado pelo técnico; vem pré-preenchido com o
  hostname na aprovação.

**`AgentDevice`** (uma linha por máquina que já se apresentou; é a fila **e** o vínculo):
- `id`, `clientId`, `machineGuid` (`HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid`),
  identidade `@@unique([clientId, machineGuid, serialKey])`, onde `serialKey` é o serial
  normalizado ou `''` (vazio).
- `hostname`, `serialNumber?` (BIOS), `status` (`PENDING | LINKED | IGNORED`),
  `assetId? @unique`.
- `tokenHash` — credencial própria do dispositivo (§5), `agentVersion`, `lastSeenAt`,
  `firstSeenAt`.
- `specs Json` — hardware e SO do último inventário. `software Json` — lista
  `{name, version, publisher}`; `inventoryHash` para só regravar quando mudar.

**`DeviceUptimeEvent`**: `deviceId`, `type` (`BOOT | SHUTDOWN | SLEEP | RESUME | CRASH`),
`at`, `@@unique([deviceId, type, at])` (reenvio idempotente). Retenção 180 dias
(valor ajustável em Configurações).

**`Client`**: `agentEnrollCode String? @unique` (código de instalação do cliente,
32 caracteres hex (16 bytes aleatórios), regenerável).

Software como `Json` e não tabela é escolha simples: se surgir a necessidade de "quais
clientes têm o programa X", promove-se a tabela depois.

## 4. O que o agente coleta (somente leitura)

- **Identificação:** hostname, `MachineGuid`, serial da BIOS, fabricante, modelo, MAC e
  IP local (informativos; **o identificador é o `MachineGuid`+serial**, não o IP).
- **Capacidade:** CPU (nome/núcleos), RAM total, discos (tamanho, livre, SSD ou HDD,
  status SMART), SO (edição, build), data da BIOS.
- **Aptidão Windows 11:** TPM presente/versão, Secure Boot/UEFI, mais CPU e RAM.
- **Software instalado:** chaves `Uninstall` (HKLM 64/32 + usuários) e, se disponível, winget.
- **Uptime:** eventos de ligar/desligar/suspender/retomar/queda lidos do Event Log
  (Kernel-General 12/13, Kernel-Power 41, 6008, 1074, Power-Troubleshooter 1),
  enviados desde o último cursor, mais o heartbeat.

Cadência: **heartbeat a cada 5 min**; inventário completo na instalação, a cada 24 h e
no boot; eventos de uptime junto do heartbeat seguinte.

## 5. API do agente e autenticação

Endpoints públicos (`@Public`, fora do JWT de usuário), com rate limit:

- `POST /agent/enroll` — envia o `agentEnrollCode` + identificação. O servidor valida o
  código (§6), cria o `AgentDevice` em `PENDING` (ou reencontra pelo `machineGuid`) e
  devolve um **token do dispositivo**. O código do cliente não é mais usado depois disso.
- `POST /agent/checkin` — Bearer do token do dispositivo: heartbeat, inventário (se
  mudou) e eventos de uptime. Atualiza `lastSeenAt`; se `LINKED`, copia
  hardware/rede para o `Asset` (§7).
- `GET /agent/update` — versão atual e URL+hash do novo binário.

Rotas de gestão (JWT, `ADMIN`/`AGENT`): listar fila, aprovar (criando ativo), vincular a
ativo existente, ignorar, listar eventos de uptime do ativo, gerar/regenerar código e
baixar o instalador do cliente.

## 6. Quando um cliente "vale" (contrato)

O enroll e o checkin só são aceitos enquanto o cliente tiver **ao menos um contrato
`ACTIVE` com `endDate >= hoje`**. Contrato vencido ou cancelado → o agente recebe 403 e
fica quieto (dados antigos permanecem no histórico). Regenerar o código do cliente
invalida instalações **novas** com o código antigo, sem derrubar as já enroladas.

## 7. Fila de cadastro e vínculo

- PC novo entra em `PENDING` com tudo que o agente já enviou; continua enviando dados
  na fila.
- Aprovar = escolher **local** (obrigatório, já é regra do `Asset`), nome (`label`, vem do
  hostname), responsável, descrição, observação e tipo (padrão "Computador"). Cria o
  `Asset` e liga o `AgentDevice` (`LINKED`).
- **Sugestão de vínculo:** se o serial (ou `machineGuid`) bater com um `Asset` já
  cadastrado do mesmo cliente, a tela oferece "vincular a este" em vez de criar novo.
- `IGNORED` = máquina que não deve virar ativo (PC pessoal); reversível.
- **O agente nunca sobrescreve campos humanos:** `label`, `description`, `assignedTo`,
  `notes`, `locationId`, `status`. Atualiza `specs`, `lastSeenAt`, `ip`, `mac`, e
  `brand`/`model`/`serialNumber` **somente se estiverem vazios** no ativo.
- Reinstalação do Windows muda o `MachineGuid` mas mantém o serial → cai na fila de novo
  com sugestão de vínculo ao ativo existente.

## 8. Sugestões de melhoria (automáticas)

Regras avaliadas sobre `specs` de ativos vinculados, com limiares editáveis em
Configurações (valores iniciais = proposta minha, ajustáveis):

| Sugestão | Regra inicial |
|---|---|
| Upgrade de RAM | RAM < 8 GB |
| Trocar HD por SSD | disco do sistema é HDD |
| Disco cheio | livre < 15% no disco do sistema |
| Disco com falha | SMART reportando falha (urgente) |
| Windows sem suporte | Windows 10 (suporte encerrou em out/2025) |
| Sem suporte ao Windows 11 | TPM 2.0/UEFI/CPU/RAM não atendem |
| Equipamento antigo | BIOS com mais de 5 anos |

Saída: selo nos ativos e uma tela "Melhorias sugeridas" agrupada por cliente (contagem
e lista por regra). Só leitura; não gera orçamento. Uma máquina sem contato há mais de
30 dias não é avaliada (dado velho).

## 9. Telas

- **Ficha do cliente → aba "Agente":** baixar instalador, regenerar código, quantos PCs
  conectados / na fila / sem contato.
- **Fila de cadastro** (`/app/ativos/fila`): pendentes por cliente, aprovar/vincular/ignorar.
- **Ficha do ativo → aba "Inventário":** specs, software (busca), último contato e
  linha do tempo de uptime por dia (ligado/suspenso/desligado/queda).
- **Lista de ativos:** coluna "último contato" e selo de melhorias.
- **Melhorias sugeridas**, e limiares em Configurações.

## 10. Agente e instalador (decisões minhas, a validar)

- **Go**, executável único, roda como **serviço Windows** (SYSTEM), sem runtime extra.
- Instalador **assinado digitalmente** (Authenticode). Sem assinatura o SmartScreen e
  antivírus alertam o funcionário. O certificado de assinatura é custo do usuário.
- Instalação **silenciosa**, pede administrador uma vez (UAC). Tela curta de aviso na
  instalação dizendo o que é coletado (LGPD); sem ícone na bandeja. Sem permissão de
  administrador não instala (limitação aceita, home office precisará de apoio).
- **Formato: um único `.msi`** (decisão do usuário: "melhor se fosse um instalador"; ele
  já gera MSI com sucesso em outro projeto). O MSI é **genérico e assinado uma vez**.
  **Código do cliente no nome do arquivo** (`AgenteOS-<codigo>.msi`, baixado pela ficha do
  cliente): o MSI lê o próprio nome na instalação (custom action sobre `OriginalDatabase`)
  e passa o código ao serviço. O nome não faz parte da assinatura, então ela não quebra.
  Cuidado: navegador pode renomear duplicatas ("(1)"), por isso o código tem formato fixo
  e é extraído por regex; se não achar, a instalação falha com mensagem clara em vez de
  instalar sem cliente. (Escolha minha; o plano da fase 2 pode trocar por transform MST se
  achar melhor, mantendo "um arquivo, dois cliques".)
- **Certificado:** o usuário não sabe se existe. A fase 2 começa verificando isso; sem
  certificado, entrega-se sem assinatura (alerta do SmartScreen) e a assinatura entra
  quando o certificado existir, sem mudar o resto.
- Saída só por **HTTPS** para a URL pública do OS. Autoatualização com checagem de hash.
- Desinstalação normal pelo "Aplicativos e recursos".

## 11. Fases (um plano por fase)

1. **Servidor (implementada na 0.15.0, branch `feat/inventario-agente`):** campos novos no `Asset`, `AgentDevice`, enroll/checkin, código por
   cliente + regra de contrato, fila e vínculo, telas de fila e aba do cliente. Testável
   com `curl`, sem agente.
2. **Agente + instalador:** coleta de hardware/software, serviço, assinatura, geração
   do instalador por cliente, autoatualização. Aba "Inventário" e regras de melhoria.
3. **Uptime:** eventos do Event Log e heartbeat, linha do tempo na tela do ativo.
4. *(adiada)* uso de aplicativos.

## 12. Riscos

- **Assinatura e antivírus** são o maior risco prático de adoção.
- **Home office sem administrador** não instala.
- **Serial ruim** ("To be filled by O.E.M.", repetido em clones): por isso a chave é
  `MachineGuid`; PCs clonados de uma imagem compartilham `MachineGuid`, tratar como
  conflito na fila.
- **Event Log com retenção curta** limita o histórico retroativo de uptime; o histórico
  confiável começa na instalação.
- Aviso de privacidade ao funcionário e cláusula no contrato com o cliente.

## 13. Decisões da revisão (calls minhas, a conferir)

- **Contrato:** `Contract.endDate` é obrigatório e os status são `ACTIVE | EXPIRED |
  CANCELLED`; vale só `ACTIVE` com `endDate >= hoje` do mesmo cliente do dispositivo.
  Ativos já `LINKED` de cliente sem contrato válido ficam visíveis, com selo
  **"contrato inativo"** e fora dos contadores de "sem contato" e das sugestões de melhoria.
- **Código vazado/spam:** teto de **50 dispositivos `PENDING` por cliente**; acima disso o
  enroll recusa até alguém aprovar/ignorar. `IGNORED` e a exclusão do dispositivo
  **revogam o token** (checkin responde 403, o agente para de enviar). O token não
  expira por tempo.
- **Identidade/clone:** chave é `(clientId, machineGuid)`. Se um checkin chegar com
  `machineGuid` já conhecido mas serial válido **diferente** do gravado, o servidor não
  sobrescreve: cria outro `AgentDevice` `PENDING` marcado "possível clone". Serial inválido
  ("To be filled by O.E.M.", vazio, repetitivo) é tratado como ausente.
- **Atualização do agente:** o binário é verificado por **assinatura Ed25519 com chave
  pública embutida no agente** (o hash sozinho não protege de servidor comprometido). O
  binário fica num volume do backend; o código do agente mora em `agent/` no monorepo.
- **Papéis e Configurações:** `ADMIN`/`AGENT` já existem (`Roles`). Limiares de melhoria
  usam a tabela `Setting` (chave/valor) existente, novas chaves em `settings.keys.ts`.
- **LGPD:** a tela de aviso do instalador é **informativa, não bloqueia**; o
  consentimento/base legal fica no contrato com o cliente.

### Decisões da implementação (fase 1)

- **Reenroll** troca o token do dispositivo e mantém o status (caso de reinstalação do agente).
- **Sem rate limit no checkin**: já exige token e o corpo é limitado a 2 MB.
- PC com código **revogado/regenerado** continua fazendo checkin; só novos enrolls são bloqueados.
- **IGNORED/restaurar:** ignorar revoga o token (checkin 403); restaurar volta o dispositivo
  para `PENDING`.
- `link` e `approve` retornam o **ativo serializado**.
