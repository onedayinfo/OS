# Ativos + Locais (Fase 0.3.0)

Data: 2026-09-09
Estado: proposto (aguardando revisão do usuário)
Base: `main` @ `ee58a4d` (release 0.2.0)
Roadmap: `docs/roadmap.md` — vertical TI + segurança eletrônica

## 1. Objetivo

Transformar o campo de texto livre `Ticket.equipment` num cadastro real de
**parque instalado**: cada cliente tem **Locais**, cada Local tem **Ativos**
(câmera, DVR, switch, no-break, controladora de acesso, central de alarme…),
e cada Chamado passa a apontar para um Local e um ou mais Ativos.

Entregas:

1. **Locais/Sites** por cliente — endereço, contato no local, observações de
   acesso.
2. **Tipos de ativo** — tabela configurável pelo ADMIN, molde de Categorias.
3. **Ativos** — ficha por equipamento com dados de rede, credenciais de acesso
   criptografadas, fotos, garantia e status.
4. **Vínculo Chamado ↔ Local + Ativos (N:N)** e aposentadoria do campo
   `equipment`.
5. **Histórico de intervenções por ativo** — derivado dos chamados vinculados.
6. **Importação CSV** de ativos.

Fora de escopo (adiado para 0.4.0): ativos/locais no **portal do cliente**
(só leitura; cliente escolhe local/ativo ao abrir chamado). Nota manual de
intervenção no ativo. Auditoria de quem revelou credencial. Upsert / importação
de locais por CSV.

## 2. Decisões travadas (do brainstorm)

- Chamado ↔ Ativo é **N:N**. `Ticket.equipment` **para de ser escrito**: sai
  dos DTOs e formulários; a coluna fica e é exibida só-leitura em chamados
  antigos que já tenham valor ("Equipamento (legado): …").
- **Local** pertence a um cliente; campos: `name`, `address?`, `contactName?`,
  `contactPhone?`, `accessNotes?`, `active`. `@@unique([clientId, name])`.
- **Ativo precisa ter Local** (FK obrigatória). O Local precisa ser do mesmo
  cliente do ativo.
- **Chamado tem `locationId?`**. Quando preenchido, o Local é do cliente do
  chamado, e todo ativo vinculado ao chamado pertence a esse Local. Fluxo na
  triagem: cliente → local → ativos.
- **Tipo de ativo** = tabela `AssetType` configurável (ADMIN), molde de
  `Category`, com seed inicial.
- **Ativo** só tem `status` (`ACTIVE | MAINTENANCE | INACTIVE`); não há `active`
  separado. `INACTIVE` some dos seletores mas mantém histórico. `Location` e
  `AssetType` mantêm o `active` das Categorias.
- **Credenciais de acesso** do equipamento (usuário/senha) criptografadas no
  banco com o util AES-256-GCM existente (`APP_ENCRYPTION_KEY`). Nunca saem em
  listagem/ficha — só `hasCredentials: boolean`. Decifra só num endpoint
  dedicado, `ADMIN`+`AGENT`. Sem auditoria nesta fase.
- **Foto do ativo** = `Attachment` ganha `assetId?`, mesmo padrão de
  `ticketId?`/`commentId?`.
- **Histórico** = só derivado dos chamados; sem entrada manual.
- **CSV**: só ativos; cliente/local/tipo têm que já existir (erro por linha);
  só inserir; síncrono.
- Sem migração de dados. Ativos começam vazios.

## 3. Arquitetura

### 3.1 Backend — módulos novos

Todos no padrão `clients`/`categories`, ESM, `@Roles('ADMIN','AGENT')` salvo
onde indicado.

```
backend/src/
  asset-types/
    asset-types.module.ts
    asset-types.service.ts       # CRUD + seed idempotente no onModuleInit
    asset-types.controller.ts    # GET (ADMIN,AGENT); POST/PATCH (ADMIN)
    dto/{create,update}-asset-type.dto.ts
  locations/
    locations.module.ts
    locations.service.ts
    locations.controller.ts      # GET/POST/PATCH  (ADMIN,AGENT)
    dto/{create,update}-location.dto.ts
    locations.service.spec.ts
  assets/
    assets.module.ts
    assets.service.ts
    assets.controller.ts
    assets-import.service.ts     # parser + resolução + relatório
    dto/{create,update}-asset.dto.ts
    dto/import-result.dto.ts
    assets.service.spec.ts
    assets-import.service.spec.ts
```

`credentials` (cifra/decifra) reutiliza
`import { encrypt, decrypt } from '../settings/crypto.util.js'`.

Upload de foto reutiliza `StorageService` e o `FileInterceptor`
(`@nestjs/platform-express`) já usados em `attachments`.

### 3.2 Rotas

**asset-types**
- `GET /asset-types?q=&page=&pageSize=` — `ADMIN`,`AGENT`
- `POST /asset-types` · `PATCH /asset-types/:id` — `ADMIN`
- Seed idempotente: câmera, DVR/NVR, switch, roteador, no-break, servidor,
  desktop, central de alarme, controladora de acesso, cerca elétrica, catraca,
  fechadura eletrônica.

**locations**
- `GET /locations?clientId=&q=&page=&pageSize=`
- `GET /locations/:id`
- `POST /locations` · `PATCH /locations/:id`
- valida cliente existente e ativo; colisão de `@@unique(clientId,name)` →
  `409 ConflictException` com mensagem amigável.

**assets**
- `GET /assets?clientId=&locationId=&typeId=&status=&q=&page=&pageSize=`
  — cada item traz `hasCredentials: boolean`; **nunca** `credentialsEnc` nem o
  conteúdo decifrado.
- `GET /assets/:id` — inclui `client`, `location`, `type` e `recentTickets`
  (derivado: `number`, `title`, `status`, `assignee.name`, `createdAt` — até 20,
  ordem desc).
- `POST /assets` — body na §3.3; se `credentials` presente, cifra e grava.
- `PATCH /assets/:id` — campos parciais; `credentials: {username,password}`
  regrava, `credentials: null` limpa, ausência mantém.
- `GET /assets/:id/credentials` — `{ username, password }` decifrado;
  `ADMIN`,`AGENT`. Se `credentialsEnc` nulo → `{ username: null, password: null }`.
- `POST /assets/:id/attachments` (multipart `file`) · `GET /assets/:id/attachments`
  — grava/lê via `StorageService`; `Attachment.assetId` preenchido.
- `POST /assets/import` (multipart `file`) — §3.4.

**tickets** (módulo existente, alterado)
- `CreateTicketDto` / `UpdateTicketDto`: **remove** `equipment`; **adiciona**
  `locationId?: string` e `assetIds?: string[]`.
- `TicketsService.create/update`: valida
  - `locationId` pertence a `ticket.clientId` (erro se cliente ausente);
  - cada `assetId` existe e tem `locationId === ticket.locationId`;
  - grava eventos `LOCATION_CHANGED` / `ASSETS_CHANGED` na timeline quando muda.
- Serialização do ticket passa a incluir `location` e `assets` (id, label,
  type.name); `equipment` só aparece no detalhe quando não-vazio.

### 3.3 `Asset` — DTO de entrada

```ts
CreateAssetDto {
  clientId: string           // obrigatório
  locationId: string         // obrigatório, precisa ser do clientId
  typeId: string             // obrigatório
  label: string              // obrigatório, ex "CAM-01 Portaria"
  brand?: string
  model?: string
  serialNumber?: string      // único por cliente quando preenchido
  ip?: string                // valida formato IPv4/IPv6
  mac?: string               // valida formato MAC
  credentials?: { username: string; password: string } | null
  installedAt?: string       // ISO date
  warrantyEndsAt?: string    // ISO date
  status?: 'ACTIVE' | 'MAINTENANCE' | 'INACTIVE'   // default ACTIVE
  notes?: string
}
```

`describe`/serializer de saída troca `credentialsEnc` por
`hasCredentials: boolean`.

### 3.4 Importação CSV

- `assets-import.service.ts`, chamado por `POST /assets/import`. Síncrono.
- Dep nova: **`csv-parse`** (`csv-parse/sync`).
- Cabeçalho obrigatório, ordem livre. Colunas:
  `cliente, local, tipo, identificacao, marca, modelo, numero_serie, ip, mac, instalado_em, garantia_ate, observacoes`.
  Sem coluna de credenciais.
- Por linha:
  1. resolve `cliente` por `name` exato e `active: true`;
  2. resolve `local` por `(clientId, name)`;
  3. resolve `tipo` por `AssetType.name` e `active: true`;
  4. `numero_serie` não-vazio já existente para o cliente → erro;
  5. datas em `YYYY-MM-DD`; formato inválido → erro;
  6. sucesso → cria o `Asset` (`status` default `ACTIVE`).
- Cada linha numa transação isolada — linha ruim não afeta as boas.
- Resposta `ImportResultDto`: `{ created: number, errors: { line: number; message: string }[] }`.
- Modelo `.csv` estático servido em `frontend/public/modelo-ativos.csv`.

### 3.5 Frontend (`/app`, equipe)

**Navegação**: novo item **Ativos** (`/app/app/ativos`).

**`/app/app/ativos` (lista)**
- Colunas: identificação · tipo · cliente · local · status (badge) ·
  nº série · garantia (marca vencida como o SLA).
- Filtros: cliente → local (dependente) → tipo → status → busca (`q`).
- Ações: **Novo ativo** · **Importar CSV** (modal: upload + link do modelo →
  exibe `N criados` + tabela de erros por linha).

**`/app/app/ativos/[id]` (ficha)**
- Cabeçalho: `label` + badge de status + links cliente/local.
- **Dados**: brand, model, serial, ip, mac, instalação, garantia, notes —
  botão Editar abre form em painel (molde `ClientForm`).
- **Credenciais**: "cadastradas / não cadastradas"; botão **Revelar** →
  `GET /assets/:id/credentials`, exibe temporariamente; edição no mesmo form.
- **Fotos**: grid de miniaturas + upload (reaproveita componente de anexo dos
  chamados).
- **Histórico**: `TicketTable` com `recentTickets`, só leitura.

**`/app/app/clientes/[id]`** — duas abas novas nas `Tabs` existentes:
- **Locais**: lista + form inline (name, address, contactName, contactPhone,
  accessNotes), ativar/desativar.
- **Ativos**: tabela dos ativos do cliente, link pra ficha, botão "Novo ativo"
  com cliente pré-selecionado.

**`/app/app/config`** — nova aba **Tipos de ativo**: lista + adicionar +
renomear + ativar/desativar (molde das abas atuais).

**Chamado (`/app/app/chamados/novo` e `/[id]`)**
- Remove o campo **Equipamento**.
- Adiciona **Local** (select filtrado pelo cliente) e **Ativos** (multiselect
  filtrado pelo local; desabilitado enquanto não houver local).
- Detalhe: mostra Local + chips dos Ativos (link pra ficha). `equipment`
  legado, se houver, numa linha discreta.

**Portal**: inalterado nesta fase.

### 3.6 Schema / migração

Prisma migrate: novas tabelas `locations`, `asset_types`, `assets`, join
implícito `_TicketAssets`; `AssetStatus` enum; `tickets.locationId` (nullable,
índice); `attachments.assetId` (nullable, índice); dois valores novos em
`TicketEventType`. Sem backfill.

## 4. Fluxos

### 4.1 Cadastro manual
ADMIN cria Local na aba do cliente → cria Ativo (cliente+local+tipo+label,
opcional credenciais/rede) → some na lista de Ativos.

### 4.2 Importação CSV
ADMIN baixa o modelo, preenche, sobe em Ativos ▸ Importar → recebe
`N criados` + erros por linha (cliente/local/tipo inexistente, série duplicada,
data inválida).

### 4.3 Chamado com ativo
Na abertura/triagem: escolhe cliente → Local (do cliente) → Ativos (do Local).
Timeline registra `LOCATION_CHANGED`/`ASSETS_CHANGED`. Ficha de cada ativo
passa a listar esse chamado no Histórico.

### 4.4 Revelar credencial
AGENT abre a ficha → **Revelar** → back decifra e devolve `{username,password}`
→ UI mostra por alguns segundos. Sem registro de auditoria.

## 5. Erros e bordas

- Local com nome repetido no mesmo cliente → 409.
- Ativo com `locationId` de outro cliente → 400.
- Vincular ao chamado um ativo de outro Local → 400.
- `GET /assets/:id/credentials` sem credenciais → `{username:null,password:null}`,
  200.
- CSV sem cabeçalho ou coluna obrigatória ausente → 400 (arquivo todo).
- CSV com linha inválida → 200 com a linha em `errors`, demais criadas.
- `APP_ENCRYPTION_KEY` ausente ao gravar credenciais → erro claro
  (`EncryptionKeyMissingError`, já existente), 400.
- Tornar `AssetType`/Local `inactive` não apaga ativos existentes; some só dos
  seletores de criação.

## 6. Testes

Unit (Vitest):
- `locations.service` — unique por cliente, valida cliente, filtro `clientId`.
- `asset-types.service` — seed idempotente, CRUD, papel na escrita.
- `assets.service` — local⊂cliente, unicidade de série (nulos não colidem),
  cifra/decifra de credenciais, `hasCredentials` nunca vaza segredo,
  `recentTickets` derivado.
- `assets-import.service` — cabeçalho ausente, linha boa, cliente/local/tipo
  inexistente, série duplicada, data inválida, relatório agregado.
- `tickets.service` — `locationId`⊂cliente, `assetId`⊂local, eventos de
  timeline, `equipment` fora do DTO.

Integração (exige Postgres):
- CRUD de ativo ponta a ponta.
- `POST /assets/import` com CSV misto (boas + ruins).
- `GET /assets/:id/credentials` respeitando papel (`CONTACT`/`MANAGER` → 403).
- upload + download de foto de ativo.

E2E Playwright (fumaça): criar Local no cliente → criar Ativo → abrir chamado
vinculando Local + Ativo.

## 7. Sequência de implementação (rascunho pro plano)

1. Schema Prisma + migração + `AssetStatus`, campos em `Ticket`/`Attachment`,
   enum de eventos.
2. `asset-types` (módulo + seed + testes).
3. `locations` (módulo + testes).
4. `assets` service/controller (CRUD, credenciais, `recentTickets`) + testes.
5. Foto de ativo (rotas de anexo reaproveitando `StorageService`).
6. `assets-import` (`csv-parse`, resolução, relatório) + testes + modelo `.csv`.
7. `tickets`: DTOs, validação, eventos, serialização; remover `equipment` da UI.
8. Frontend: lista + ficha de ativo, modal de import.
9. Frontend: abas Locais e Ativos no cliente; aba Tipos de ativo em Config.
10. Frontend: form de chamado (Local + Ativos), detalhe do chamado.
11. Integração + E2E; CHANGELOG; release 0.3.0.

## 8. Versão

MINOR → **0.3.0** (funcionalidade nova, retrocompatível; `equipment` legado
preservado). `CHANGELOG.md` em "Não lançado" durante o desenvolvimento.
