# WhatsApp como canal (fase 1: escuta, gatilhos e triagem por IA) — Plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: usar superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano task a task. Os passos usam checkbox (`- [ ]`) para acompanhamento.

**Goal:** O OS escuta os grupos de WhatsApp dos clientes (via Evolution API, somente leitura), cria chamados por frases de gatilho cadastradas por cliente e sugere chamados por IA (Claude Haiku 5.5) numa fila de triagem.

**Architecture:** Um módulo novo `backend/src/whatsapp/`. A Evolution chama um webhook público protegido por segredo; o backend grava a mensagem (idempotente), identifica o cliente pelo **ID do grupo cadastrado** e o contato pelo telefone; frase de gatilho cria chamado direto (sem IA), o resto fica `PENDING` e um cron de ~5 min classifica em lote com o Haiku e gera `TicketSuggestion` para o técnico aceitar/descartar. Frontend: aba "WhatsApp" na ficha do cliente, aba "WhatsApp" em Configurações e página `/app/triagem`.

**Tech Stack:** NestJS 12 (ESM, imports com `.js`), Prisma 6 + Postgres, `@nestjs/schedule` (já instalado), vitest, Next.js 14 + React Query + Tailwind, Playwright. Deps novas: `@anthropic-ai/sdk` e `zod` (exigido pelo helper `zodOutputFormat`). Infra nova: Evolution API + Redis + Postgres próprio da Evolution na stack.

**Spec:** `docs/superpowers/specs/2026-10-11-whatsapp-canal-design.md`

## Global Constraints

- **Nada é enviado ao WhatsApp** nesta fase (somente leitura). Nenhum código de envio.
- Modelo da IA: `claude-haiku-5-5` (string exata, sem sufixo de data). Chamada com `output_config: { effort: 'low', format: zodOutputFormat(...) }`; **sem** `tool_choice` forçado, sem `thinking: disabled`, sem `temperature`/`top_p`/`top_k`. Testes **nunca** chamam a API real.
- Gatilho = mensagem **começa com** a frase (sem acento, sem diferença de maiúscula, fronteira de palavra); a frase mais longa vence; o resto do texto vira descrição.
- Dedup: mesmo grupo + mesma frase com chamado ainda aberto (status fora de `RESOLVED|CLOSED|CANCELLED`) → a mensagem entra como evento no chamado existente, sem abrir outro.
- Cliente é definido pelo **JID do grupo cadastrado** (`...@g.us`, validado, único no sistema); o telefone do remetente só identifica o contato (`User.phone`). Grupo não cadastrado ou inativo → descartado sem gravar. `fromMe` → ignorado.
- Retenção das mensagens: 90 dias (`whatsapp.retentionDays`, configurável). Job da IA a cada ~5 minutos. Teto diário de tokens configurável (`ai.dailyTokenLimit`); ao estourar, o job pausa até o dia seguinte.
- Origem do chamado: `TicketOrigin.WHATSAPP`; chamado por gatilho sem contato identificado sai com `requesterId = null` e a descrição diz "remetente não identificado".
- Textos de UI e mensagens de erro em português do Brasil. Comentários de código em português, no estilo do repo (`// ponytail:` para simplificações conscientes).
- Segredos (`whatsapp.webhookSecret`, `whatsapp.evolution.apiKey`, `ai.anthropicApiKey`) ficam criptografados via `SettingsService` (`SECRET_KEYS`) e nunca voltam crus na API.
- Rotas novas: `@Roles('ADMIN', 'AGENT')`, exceto o webhook (`@Public()` + segredo) e `GET /whatsapp/qr` (`@Roles('ADMIN')`).
- Commits em Conventional Commits, em português, terminando com a linha `Co-Authored-By` exigida pelo ambiente. Trabalhar em `C:/Users/renan/os-exec` direto na `main`; nos checkpoints marcados: `git push origin main` e depois `cd /z/Projetos/OS && git pull --ff-only`. Sempre prefixar chamadas Bash de git/npm com `cd /c/Users/renan/os-exec/...` (o cwd da sessão volta para `Z:\Projetos\OS`).
- Pré-requisito de ambiente: Postgres local no ar (`cd /c/Users/renan/os-exec && docker compose up -d postgres`). Se o Docker estiver instável, parar e avisar o usuário.

## Review Focus

Entradas que o spec implica mas nenhuma task exercitaria sozinha (cada uma tem teste na task indicada):

1. Remetente sem telefone resolvível (JID `@lid`) → mensagem gravada, `senderPhone = ''`, contato não identificado, gatilho ainda funciona (Tasks 4 e 7).
2. Telefone do contato com/sem o 9º dígito de celular → deve casar com o JID (Tasks 2 e 7).
3. Evolution reenviando o mesmo evento → não duplica mensagem nem chamado (Tasks 7 e 13).
4. Frase "sem conexão" vs. texto "sem conexaoXYZ" ou "o sem conexão…" → só casa no início e em fronteira de palavra (Task 3).
5. IA devolvendo índices fora do intervalo, urgência/sentimento fora da faixa ou resposta recusada/inválida → valores clampados, índices descartados, mensagens seguem `PENDING` com contagem de tentativas e viram `FAILED` após 3 (Tasks 10 e 11).

---

## Mapa de arquivos

**Backend (criar)** — `backend/src/whatsapp/`:
- `db-errors.ts` — `isUniqueViolation(e)`.
- `text.util.ts` — `normalizeText`, `matchStart`, `isTrivial`.
- `evolution-payload.ts` — `parseEvolutionMessage` (payload da Evolution → `ParsedWhatsappMessage`).
- `whatsapp-groups.service.ts` / `.controller.ts` / `dto/group.dto.ts`.
- `trigger-phrases.service.ts` / `.controller.ts` / `dto/phrase.dto.ts`.
- `whatsapp.service.ts` — `ingest()` (gravar, identificar, gatilho, dedup).
- `whatsapp-webhook.controller.ts` — `POST /whatsapp/webhook`.
- `evolution-status.service.ts` + `whatsapp-status.controller.ts` — estado da conexão, QR, uso da IA.
- `ai-usage.service.ts` — tokens por dia e teto.
- `ai-classifier.service.ts` — chamada ao Haiku (schema zod, prompt, sanitização).
- `triage.service.ts` — job de classificação em lote.
- `whatsapp.cron.ts` — crons (triagem, status, retenção).
- `suggestions.service.ts` / `.controller.ts` / `dto/suggestion.dto.ts`.
- `whatsapp-messages.controller.ts` — mensagens de um chamado.
- `whatsapp.module.ts`.
- `backend/src/common/phone.util.ts` — `normalizePhone`, `phoneFromJid`, `phoneKey`.
- Specs `*.spec.ts` ao lado de cada arquivo; `whatsapp.integration.spec.ts`.

**Backend (modificar):** `prisma/schema.prisma`, `src/settings/settings.keys.ts`, `src/app.module.ts`, `src/users/{users.service.ts,user-view.ts,dto/create-contact.dto.ts,dto/update-user.dto.ts}`, `package.json`.

**Frontend (criar):** `src/lib/whatsapp.ts`, `src/components/trigger-phrases-panel.tsx`, `src/components/whatsapp-client-tab.tsx`, `src/components/ticket-whatsapp-messages.tsx`, `src/app/app/config/tabs/whatsapp-tab.tsx`, `src/app/app/triagem/page.tsx`, `e2e/whatsapp-triagem.spec.ts`.

**Frontend (modificar):** `src/lib/tickets.ts`, `src/components/ticket-timeline.tsx`, `src/components/contact-form.tsx`, `src/components/nav.tsx`, `src/app/app/clientes/[id]/page.tsx`, `src/app/app/config/page.tsx`, `src/app/app/chamados/[id]/page.tsx`, `e2e/seed-e2e.ts`.

**Infra/docs (modificar):** `portainer-stack.yml`, `portainer-stack.env`, `deploy/stack.env.example`, `docker-compose.yml`, `deploy/README.md`, `CHANGELOG.md`, `docs/superpowers/specs/2026-10-11-whatsapp-canal-design.md`.

---

### Task 1: Schema, migração e chaves de configuração

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Modify: `backend/src/settings/settings.keys.ts`
- Create: `backend/src/settings/settings.keys.spec.ts`
- Modify: `docs/superpowers/specs/2026-10-11-whatsapp-canal-design.md` (refinamento do modelo)

**Interfaces:**
- Produces (Prisma): `WhatsappGroup`, `WhatsappMessage`, `TriggerPhrase`, `TicketSuggestion`, `AiUsage`; enums `WhatsappMessageType`, `WhatsappAiStatus`, `SuggestionStatus`; `TicketOrigin.WHATSAPP`; `TicketEventType.WHATSAPP_IN`; `User.phone`.
- Produces (settings): chaves `whatsapp.webhookSecret`, `whatsapp.evolution.url`, `whatsapp.evolution.apiKey`, `whatsapp.evolution.instance`, `whatsapp.retentionDays`, `ai.anthropicApiKey`, `ai.dailyTokenLimit`.

- [ ] **Step 1: Escrever o teste das chaves**

`backend/src/settings/settings.keys.spec.ts`:

```ts
import { SECRET_KEYS, SETTING_KEYS } from './settings.keys.js';

describe('chaves do WhatsApp/IA', () => {
  it('registra todas as chaves novas', () => {
    for (const k of [
      'whatsapp.webhookSecret',
      'whatsapp.evolution.url',
      'whatsapp.evolution.apiKey',
      'whatsapp.evolution.instance',
      'whatsapp.retentionDays',
      'ai.anthropicApiKey',
      'ai.dailyTokenLimit',
    ]) {
      expect(SETTING_KEYS).toContain(k);
    }
  });

  it('marca como segredo o que não pode voltar cru', () => {
    for (const k of ['whatsapp.webhookSecret', 'whatsapp.evolution.apiKey', 'ai.anthropicApiKey']) {
      expect(SECRET_KEYS.has(k)).toBe(true);
    }
    expect(SECRET_KEYS.has('whatsapp.evolution.url')).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /c/Users/renan/os-exec/backend && npx vitest run src/settings/settings.keys.spec.ts`
Expected: FAIL (chaves ausentes).

- [ ] **Step 3: Implementar as chaves**

Em `settings.keys.ts`, acrescentar ao array `SETTING_KEYS` (antes de `] as const`):

```ts
  'whatsapp.webhookSecret',
  'whatsapp.evolution.url',
  'whatsapp.evolution.apiKey',
  'whatsapp.evolution.instance',
  'whatsapp.retentionDays',
  'ai.anthropicApiKey',
  'ai.dailyTokenLimit',
```

e ao `SECRET_KEYS`:

```ts
  'whatsapp.webhookSecret',
  'whatsapp.evolution.apiKey',
  'ai.anthropicApiKey',
```

- [ ] **Step 4: Editar o schema Prisma**

Em `schema.prisma`:

1. Enum `TicketOrigin`: acrescentar `WHATSAPP` depois de `QUOTE`.
2. Enum `TicketEventType`: acrescentar `WHATSAPP_IN` depois de `VISIT_CANCELLED`.
3. No `model User`, antes de `active`: `phone String?`; e na lista de relações: `whatsappMessages WhatsappMessage[]`.
4. No `model Client`, nas relações: `whatsappGroups WhatsappGroup[]`, `triggerPhrases TriggerPhrase[]`, `ticketSuggestions TicketSuggestion[]`.
5. No `model Category`, nas relações: `triggerPhrases TriggerPhrase[]`.
6. No `model Ticket`, nas relações: `whatsappMessages WhatsappMessage[]` e `whatsappSuggestions TicketSuggestion[]`.
7. Ao final do arquivo, acrescentar:

```prisma
enum WhatsappMessageType {
  TEXT
  AUDIO
  IMAGE
  OTHER
}

enum WhatsappAiStatus {
  PENDING
  ANALYZED
  SKIPPED
  FAILED
}

enum SuggestionStatus {
  OPEN
  ACCEPTED
  DISCARDED
}

model WhatsappGroup {
  id         String   @id @default(cuid())
  externalId String   @unique
  name       String?
  clientId   String
  active     Boolean  @default(true)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  client      Client             @relation(fields: [clientId], references: [id])
  messages    WhatsappMessage[]
  suggestions TicketSuggestion[]

  @@index([clientId])
  @@map("whatsapp_groups")
}

model WhatsappMessage {
  id              String              @id @default(cuid())
  externalId      String              @unique
  groupId         String
  senderPhone     String              @default("")
  senderName      String?
  senderUserId    String?
  type            WhatsappMessageType
  body            String?
  sentAt          DateTime
  aiStatus        WhatsappAiStatus    @default(PENDING)
  aiAttempts      Int                 @default(0)
  aiResult        Json?
  sentiment       Float?
  ticketId        String?
  triggerPhraseId String?
  createdAt       DateTime            @default(now())

  group      WhatsappGroup @relation(fields: [groupId], references: [id], onDelete: Cascade)
  senderUser User?         @relation(fields: [senderUserId], references: [id], onDelete: SetNull)
  ticket     Ticket?       @relation(fields: [ticketId], references: [id], onDelete: SetNull)

  @@index([groupId, sentAt])
  @@index([aiStatus])
  @@index([ticketId])
  @@map("whatsapp_messages")
}

model TriggerPhrase {
  id         String         @id @default(cuid())
  clientId   String?
  phrase     String
  phraseNorm String
  categoryId String?
  priority   TicketPriority @default(MEDIUM)
  title      String?
  active     Boolean        @default(true)
  createdAt  DateTime       @default(now())
  updatedAt  DateTime       @updatedAt

  client   Client?   @relation(fields: [clientId], references: [id], onDelete: Cascade)
  category Category? @relation(fields: [categoryId], references: [id], onDelete: SetNull)

  // ponytail: NULL não conflita em índice único no Postgres, então a unicidade das
  // frases GLOBAIS (clientId nulo) é checada no TriggerPhrasesService.
  @@unique([clientId, phraseNorm])
  @@map("trigger_phrases")
}

model TicketSuggestion {
  id          String           @id @default(cuid())
  groupId     String
  clientId    String
  messageIds  String[]
  excerpt     String
  urgency     Int
  sentiment   Float?
  summary     String
  status      SuggestionStatus @default(OPEN)
  ticketId    String?
  decidedById String?
  decidedAt   DateTime?
  createdAt   DateTime         @default(now())

  group  WhatsappGroup @relation(fields: [groupId], references: [id], onDelete: Cascade)
  client Client        @relation(fields: [clientId], references: [id])
  ticket Ticket?       @relation(fields: [ticketId], references: [id], onDelete: SetNull)

  @@index([status, createdAt])
  @@map("ticket_suggestions")
}

model AiUsage {
  day          String @id // YYYY-MM-DD no fuso America/Sao_Paulo
  inputTokens  Int    @default(0)
  outputTokens Int    @default(0)
  calls        Int    @default(0)

  @@map("ai_usage")
}
```

- [ ] **Step 5: Gerar a migração e o client**

Run: `cd /c/Users/renan/os-exec/backend && npx prisma migrate dev --name add_whatsapp && npx prisma generate`
Expected: migração `..._add_whatsapp` criada e aplicada. **Se o Prisma acusar drift ou pedir reset do banco: parar e perguntar ao usuário** (não aceitar `reset`).

- [ ] **Step 6: Rodar os testes e o build**

Run: `cd /c/Users/renan/os-exec/backend && npx vitest run src/settings && npm run build`
Expected: PASS e build limpo.

- [ ] **Step 7: Refinar o spec**

Em `docs/superpowers/specs/2026-10-11-whatsapp-canal-design.md`, §3, acrescentar ao fim da lista de modelos: "`WhatsappMessage` ganha `aiAttempts Int` (tentativas da IA; vira `FAILED` após 3) e `triggerPhraseId?` (para a deduplicação); `AiUsage(day, inputTokens, outputTokens, calls)` guarda o consumo diário para o teto de gasto."

- [ ] **Step 8: Commit**

```bash
cd /c/Users/renan/os-exec && git add backend/prisma backend/src/settings docs/superpowers/specs/2026-10-11-whatsapp-canal-design.md
git commit -m "feat(whatsapp): schema, migração e chaves de configuração"
```

---

### Task 2: Utilitário de telefone e telefone do contato

**Files:**
- Create: `backend/src/common/phone.util.ts`, `backend/src/common/phone.util.spec.ts`
- Create: `backend/src/users/users-phone.spec.ts`
- Modify: `backend/src/users/dto/create-contact.dto.ts`, `backend/src/users/dto/update-user.dto.ts`, `backend/src/users/users.service.ts`, `backend/src/users/user-view.ts`

**Interfaces:**
- Produces: `normalizePhone(raw): string | null`, `phoneFromJid(jid): string | null`, `phoneKey(phone): string | null` (8 últimos dígitos).
- Produces: `User.phone` gravado normalizado (só dígitos) em `createContact` e `update`; `publicUser` devolve `phone`.

- [ ] **Step 1: Escrever os testes do util**

`backend/src/common/phone.util.spec.ts`:

```ts
import { normalizePhone, phoneFromJid, phoneKey } from './phone.util.js';

describe('phone.util', () => {
  it('normalizePhone: só dígitos; curto/vazio vira null', () => {
    expect(normalizePhone('+55 (19) 99999-1234')).toBe('5519999991234');
    expect(normalizePhone('123')).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });

  it('phoneFromJid: usuário, com sufixo de dispositivo e LID', () => {
    expect(phoneFromJid('5519999991234@s.whatsapp.net')).toBe('5519999991234');
    expect(phoneFromJid('5519999991234:12@s.whatsapp.net')).toBe('5519999991234');
    expect(phoneFromJid('99887766554433@lid')).toBeNull();
    expect(phoneFromJid(null)).toBeNull();
  });

  it('phoneKey: com e sem o 9º dígito geram a mesma chave; números distintos não', () => {
    expect(phoneKey('5519999991234')).toBe(phoneKey('551999991234'));
    expect(phoneKey('5519988887777')).not.toBe(phoneKey('5519999991234'));
    expect(phoneKey('abc')).toBeNull();
  });
});
```

`backend/src/users/users-phone.spec.ts`:

```ts
import { UsersService } from './users.service.js';

function makeService() {
  const prisma = {
    user: {
      create: vi.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'u1', active: false, lastLoginAt: null, createdAt: new Date(), updatedAt: new Date(), ...data }),
      ),
      findUnique: vi.fn().mockResolvedValue({ id: 'u1' }),
      update: vi.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'u1', name: 'A', email: 'a@x.com', type: 'CLIENT', role: 'CONTACT', clientId: 'c1', active: true, phone: null, lastLoginAt: null, createdAt: new Date(), updatedAt: new Date(), ...data }),
      ),
    },
  };
  const mail = { sendInvite: vi.fn().mockResolvedValue(undefined) };
  return { service: new UsersService(prisma as any, mail as any), prisma };
}

describe('telefone do contato', () => {
  it('createContact grava o telefone normalizado e o devolve', async () => {
    const { service, prisma } = makeService();
    const r = await service.createContact('c1', { name: 'N', email: 'n@x.com', role: 'CONTACT', phone: '+55 (19) 99999-1234' } as any);
    expect(prisma.user.create.mock.calls[0][0].data.phone).toBe('5519999991234');
    expect(r.phone).toBe('5519999991234');
  });

  it('update: string vazia limpa o telefone; ausente não mexe', async () => {
    const { service, prisma } = makeService();
    await service.update('u1', { phone: '' } as any);
    expect(prisma.user.update.mock.calls[0][0].data).toEqual({ phone: null });
    await service.update('u1', { name: 'B' } as any);
    expect(prisma.user.update.mock.calls[1][0].data).toEqual({ name: 'B' });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /c/Users/renan/os-exec/backend && npx vitest run src/common/phone.util.spec.ts src/users/users-phone.spec.ts`
Expected: FAIL (módulo e campos ausentes).

- [ ] **Step 3: Implementar o util**

`backend/src/common/phone.util.ts`:

```ts
/** Só dígitos. Menos de 8 dígitos não é telefone → null. */
export function normalizePhone(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  return digits.length >= 8 ? digits : null;
}

/** "5519999991234@s.whatsapp.net" (com ou sem ":dispositivo") → "5519999991234". LID não carrega telefone → null. */
export function phoneFromJid(jid: string | null | undefined): string | null {
  if (!jid || jid.endsWith('@lid')) return null;
  return normalizePhone(jid.split('@')[0]?.split(':')[0]);
}

/**
 * Chave de comparação: os 8 últimos dígitos. Cobre o 9º dígito de celular (JIDs de
 * contas antigas vêm sem ele) sem confundir contatos do mesmo cliente.
 */
export function phoneKey(phone: string | null | undefined): string | null {
  const p = normalizePhone(phone);
  return p ? p.slice(-8) : null;
}
```

- [ ] **Step 4: Ligar ao cadastro de contatos**

`dto/create-contact.dto.ts`: trocar o import por `import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';` e acrescentar à classe:

```ts
  @IsOptional()
  @IsString()
  phone?: string;
```

`dto/update-user.dto.ts`: acrescentar à classe (o import já tem `IsOptional`, `IsString`):

```ts
  @IsOptional()
  @IsString()
  phone?: string;
```

`users.service.ts`: adicionar `import { normalizePhone } from '../common/phone.util.js';`; em `createContact`, dentro de `data: {...}` acrescentar `phone: normalizePhone(dto.phone),`; em `update`, trocar o tipo de `data` e acrescentar o campo:

```ts
    const data: { name?: string; active?: boolean; phone?: string | null } = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.phone !== undefined) data.phone = normalizePhone(dto.phone);
```

`user-view.ts`: em `publicUser`, acrescentar `phone: u.phone,` depois de `clientId`.

- [ ] **Step 5: Rodar e ver passar**

Run: `cd /c/Users/renan/os-exec/backend && npx vitest run src/common src/users && npm run build`
Expected: PASS (incluindo os specs antigos de users) e build limpo.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/renan/os-exec && git add backend/src/common backend/src/users
git commit -m "feat(whatsapp): telefone no contato do cliente e util de telefone"
```

---

### Task 3: Utilitários de texto (frase de gatilho e mensagens triviais)

**Files:**
- Create: `backend/src/whatsapp/text.util.ts`, `backend/src/whatsapp/text.util.spec.ts`

**Interfaces:**
- Produces: `normalizeText(s: string): string`; `matchStart(body: string, phraseNorm: string): { rest: string } | null`; `isTrivial(body: string): boolean`.

- [ ] **Step 1: Escrever os testes**

```ts
import { isTrivial, matchStart, normalizeText } from './text.util.js';

describe('normalizeText', () => {
  it('minúscula, sem acento, espaços colapsados', () => {
    expect(normalizeText('  Sem   Conexão ')).toBe('sem conexao');
  });
});

describe('matchStart', () => {
  it('casa sem acento/caixa e devolve o resto com a pontuação inicial removida', () => {
    expect(matchStart('SEM CONEXÃO - escritório, 3 PCs sem rede', 'sem conexao')).toEqual({
      rest: 'escritório, 3 PCs sem rede',
    });
  });
  it('mensagem só com a frase → resto vazio', () => {
    expect(matchStart('Sistema caiu!', 'sistema caiu')).toEqual({ rest: '' });
  });
  it('espaços extras dentro da frase', () => {
    expect(matchStart('sem   conexão agora', 'sem conexao')).toEqual({ rest: 'agora' });
  });
  it('não casa no meio da mensagem', () => {
    expect(matchStart('o sistema caiu ontem', 'sistema caiu')).toBeNull();
  });
  it('exige fronteira de palavra', () => {
    expect(matchStart('sem conexaoXYZ', 'sem conexao')).toBeNull();
  });
  it('frase vazia nunca casa', () => {
    expect(matchStart('qualquer coisa', '')).toBeNull();
  });
});

describe('isTrivial', () => {
  it.each(['ok', 'Ok!!', '👍', 'bom dia', 'Obrigado', 'kkkk', '  '])('"%s" é trivial', (t) => {
    expect(isTrivial(t)).toBe(true);
  });
  it.each(['caiu', 'sistema caiu', 'a internet está lenta'])('"%s" não é trivial', (t) => {
    expect(isTrivial(t)).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /c/Users/renan/os-exec/backend && npx vitest run src/whatsapp/text.util.spec.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar**

`backend/src/whatsapp/text.util.ts`:

```ts
/** Minúscula, sem acento, espaços colapsados — base da comparação de frases. */
export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A mensagem COMEÇA com a frase (`phraseNorm` já normalizada), em fronteira de palavra?
 * Devolve o resto do texto ORIGINAL (sem a pontuação que sobra depois da frase) ou null.
 */
export function matchStart(body: string, phraseNorm: string): { rest: string } | null {
  if (!phraseNorm) return null;
  const norm = normalizeText(body);
  if (!norm.startsWith(phraseNorm)) return null;
  const next = norm.charAt(phraseNorm.length);
  if (next !== '' && /[\p{L}\p{N}]/u.test(next)) return null;

  // ponytail: acha o prefixo do texto original que normaliza para a frase por tentativa
  // (textos de WhatsApp são curtos); evita mapear índices entre texto original e normalizado.
  let i = 0;
  while (i <= body.length && normalizeText(body.slice(0, i)) !== phraseNorm) i++;
  const rest = i > body.length ? '' : body.slice(i).replace(/^[\s\-–—:,.;!?]+/, '').trim();
  return { rest };
}

const TRIVIAL = new Set([
  'ok', 'okay', 'blz', 'beleza', 'certo', 'combinado', 'valeu', 'vlw', 'obrigado', 'obrigada',
  'obg', 'bom dia', 'boa tarde', 'boa noite', 'sim', 'nao', 'kkk', 'kkkk', 'tmj', 'show', 'top',
]);

/** Mensagens que não valem uma chamada de IA: emoji/pontuação, agradecimento, saudação, menos de 4 letras. */
export function isTrivial(body: string): boolean {
  const n = normalizeText(body)
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return n.length < 4 || TRIVIAL.has(n);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd /c/Users/renan/os-exec/backend && npx vitest run src/whatsapp/text.util.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/renan/os-exec && git add backend/src/whatsapp
git commit -m "feat(whatsapp): utilitários de texto para frases de gatilho e mensagens triviais"
```

---

### Task 4: Parser do payload da Evolution

**Files:**
- Create: `backend/src/whatsapp/evolution-payload.ts`, `backend/src/whatsapp/evolution-payload.spec.ts`

**Interfaces:**
- Consumes: `phoneFromJid` (Task 2).
- Produces:
  ```ts
  export type WhatsappMessageKind = 'TEXT' | 'AUDIO' | 'IMAGE' | 'OTHER';
  export interface ParsedWhatsappMessage {
    externalId: string;   // `${groupJid}:${key.id}`
    groupJid: string;
    senderPhone: string;  // '' quando não há telefone resolvível (ex.: LID)
    senderName: string | null;
    type: WhatsappMessageKind;
    body: string | null;
    sentAt: Date;
  }
  export function parseEvolutionMessage(payload: unknown): ParsedWhatsappMessage | null;
  ```

> **Atenção (formato não verificado em instância real):** a documentação pública da Evolution não confirma o campo do remetente em mensagens de grupo (`key.participant`, `participantPn`/`senderPn` em contas com LID). O parser aceita todos; a Task 20 captura um payload real e ajusta o fixture se divergir.

- [ ] **Step 1: Escrever os testes**

```ts
import { parseEvolutionMessage } from './evolution-payload.js';

const base = (over: Record<string, any> = {}, key: Record<string, any> = {}) => ({
  event: 'messages.upsert',
  instance: 'os',
  data: {
    key: { remoteJid: '120363000000000001@g.us', fromMe: false, id: 'ABC123', participant: '5519999991234@s.whatsapp.net', ...key },
    pushName: 'Fulano',
    message: { conversation: 'Sistema caiu - 3 PCs' },
    messageType: 'conversation',
    messageTimestamp: 1760000000,
    ...over,
  },
});

describe('parseEvolutionMessage', () => {
  it('mensagem de texto em grupo', () => {
    const m = parseEvolutionMessage(base())!;
    expect(m).toMatchObject({
      externalId: '120363000000000001@g.us:ABC123',
      groupJid: '120363000000000001@g.us',
      senderPhone: '5519999991234',
      senderName: 'Fulano',
      type: 'TEXT',
      body: 'Sistema caiu - 3 PCs',
    });
    expect(m.sentAt.getTime()).toBe(1760000000 * 1000);
  });

  it('aceita o nome do evento em MAIÚSCULAS com underline', () => {
    expect(parseEvolutionMessage({ ...base(), event: 'MESSAGES_UPSERT' })).not.toBeNull();
  });

  it('extendedTextMessage e data como array', () => {
    const p = base({ message: { extendedTextMessage: { text: 'Sem conexão' } } });
    const m = parseEvolutionMessage({ ...p, data: [p.data] })!;
    expect(m.body).toBe('Sem conexão');
    expect(m.type).toBe('TEXT');
  });

  it('ignora: outro evento, conversa individual, fromMe, sem id', () => {
    expect(parseEvolutionMessage({ ...base(), event: 'connection.update' })).toBeNull();
    expect(parseEvolutionMessage(base({}, { remoteJid: '5519999991234@s.whatsapp.net' }))).toBeNull();
    expect(parseEvolutionMessage(base({}, { fromMe: true }))).toBeNull();
    expect(parseEvolutionMessage(base({}, { id: undefined }))).toBeNull();
    expect(parseEvolutionMessage(null)).toBeNull();
    expect(parseEvolutionMessage('x')).toBeNull();
  });

  it('áudio e imagem viram tipo próprio; legenda da imagem vira body', () => {
    expect(parseEvolutionMessage(base({ message: { audioMessage: { seconds: 3 } } }))!).toMatchObject({ type: 'AUDIO', body: null });
    expect(parseEvolutionMessage(base({ message: { imageMessage: { caption: 'olha isso' } } }))!).toMatchObject({ type: 'IMAGE', body: 'olha isso' });
    expect(parseEvolutionMessage(base({ message: { stickerMessage: {} } }))!).toMatchObject({ type: 'OTHER', body: null });
  });

  it('remetente LID sem telefone: grava a mensagem com senderPhone vazio', () => {
    const m = parseEvolutionMessage(base({}, { participant: '99887766554433@lid' }))!;
    expect(m.senderPhone).toBe('');
  });

  it('LID com participantPn: usa o telefone real', () => {
    const m = parseEvolutionMessage(base({}, { participant: '99887766554433@lid', participantPn: '5519999991234@s.whatsapp.net' }))!;
    expect(m.senderPhone).toBe('5519999991234');
  });

  it('timestamp em objeto {low} e timestamp ausente', () => {
    expect(parseEvolutionMessage(base({ messageTimestamp: { low: 1760000001, high: 0 } }))!.sentAt.getTime()).toBe(1760000001 * 1000);
    expect(parseEvolutionMessage(base({ messageTimestamp: undefined }))!.sentAt).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /c/Users/renan/os-exec/backend && npx vitest run src/whatsapp/evolution-payload.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`backend/src/whatsapp/evolution-payload.ts`:

```ts
import { phoneFromJid } from '../common/phone.util.js';

export type WhatsappMessageKind = 'TEXT' | 'AUDIO' | 'IMAGE' | 'OTHER';

export interface ParsedWhatsappMessage {
  externalId: string;
  groupJid: string;
  /** '' quando o remetente não tem telefone resolvível (ex.: LID). */
  senderPhone: string;
  senderName: string | null;
  type: WhatsappMessageKind;
  body: string | null;
  sentAt: Date;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Obj = Record<string, any>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null;

/**
 * Converte o webhook `messages.upsert` da Evolution em uma mensagem de GRUPO nossa.
 * Devolve null para tudo que não nos interessa (outro evento, conversa individual,
 * mensagem enviada pelo próprio celular, payload sem id).
 */
export function parseEvolutionMessage(payload: unknown): ParsedWhatsappMessage | null {
  if (!isObj(payload)) return null;
  const event = String(payload.event ?? '').toLowerCase().replace(/_/g, '.');
  if (event !== 'messages.upsert') return null;

  const d: unknown = Array.isArray(payload.data) ? payload.data[0] : payload.data;
  if (!isObj(d) || !isObj(d.key)) return null;
  const key = d.key;

  const groupJid = typeof key.remoteJid === 'string' ? key.remoteJid : '';
  if (!groupJid.endsWith('@g.us') || key.fromMe === true) return null;
  if (typeof key.id !== 'string' || !key.id) return null;

  const m: Obj = isObj(d.message) ? d.message : {};
  const text: unknown =
    m.conversation ?? m.extendedTextMessage?.text ?? m.imageMessage?.caption ?? m.videoMessage?.caption ?? null;
  const body = typeof text === 'string' && text.trim() ? text : null;
  const type: WhatsappMessageKind = m.audioMessage ? 'AUDIO' : m.imageMessage ? 'IMAGE' : body ? 'TEXT' : 'OTHER';

  // Contas com LID: o telefone real, quando existe, vem em participantPn/senderPn.
  const senderJid = key.participantPn ?? key.senderPn ?? key.participant ?? d.participant;
  const ts = Number(isObj(d.messageTimestamp) ? d.messageTimestamp.low : d.messageTimestamp);

  return {
    externalId: `${groupJid}:${key.id}`,
    groupJid,
    senderPhone: phoneFromJid(typeof senderJid === 'string' ? senderJid : null) ?? '',
    senderName: typeof d.pushName === 'string' && d.pushName ? d.pushName : null,
    type,
    body,
    sentAt: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : new Date(),
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd /c/Users/renan/os-exec/backend && npx vitest run src/whatsapp/evolution-payload.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/renan/os-exec && git add backend/src/whatsapp
git commit -m "feat(whatsapp): parser do webhook messages.upsert da Evolution"
```

---

### Task 5: Grupos do cliente (cadastro por ID)

**Files:**
- Create: `backend/src/whatsapp/db-errors.ts`
- Create: `backend/src/whatsapp/dto/group.dto.ts`
- Create: `backend/src/whatsapp/whatsapp-groups.service.ts`, `backend/src/whatsapp/whatsapp-groups.service.spec.ts`
- Create: `backend/src/whatsapp/whatsapp-groups.controller.ts`

**Interfaces:**
- Produces: `isUniqueViolation(e: unknown): boolean`.
- Produces: `WhatsappGroupsService` com `list(clientId)`, `create(dto: CreateGroupDto)`, `update(id, dto: UpdateGroupDto)`, `remove(id)`.
- Produces: rotas `GET /whatsapp/groups?clientId=`, `POST /whatsapp/groups`, `PATCH /whatsapp/groups/:id`, `DELETE /whatsapp/groups/:id`.

- [ ] **Step 1: Escrever os testes**

`whatsapp-groups.service.spec.ts`:

```ts
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { WhatsappGroupsService } from './whatsapp-groups.service.js';

function make(over: Record<string, any> = {}) {
  const prisma = {
    client: { findUnique: vi.fn().mockResolvedValue({ id: 'c1' }) },
    whatsappGroup: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'g1', active: true, ...data })),
      update: vi.fn(),
      delete: vi.fn(),
      ...over,
    },
  };
  return { service: new WhatsappGroupsService(prisma as any), prisma };
}

describe('WhatsappGroupsService', () => {
  it('cria com ID válido e apelido aparado', async () => {
    const { service, prisma } = make();
    await service.create({ clientId: 'c1', externalId: ' 120363000000000001@g.us ', name: '  Suporte  ' });
    expect(prisma.whatsappGroup.create.mock.calls[0][0].data).toEqual({
      externalId: '120363000000000001@g.us',
      name: 'Suporte',
      clientId: 'c1',
    });
  });

  it('aceita o formato antigo de ID com hífen', async () => {
    const { service } = make();
    await expect(service.create({ clientId: 'c1', externalId: '5511999990000-1630000000@g.us' })).resolves.toBeDefined();
  });

  it.each(['abc', '5519999991234@s.whatsapp.net', '@g.us', ''])('rejeita ID inválido "%s"', async (externalId) => {
    const { service } = make();
    await expect(service.create({ clientId: 'c1', externalId })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cliente inexistente → 404', async () => {
    const { service, prisma } = make();
    prisma.client.findUnique.mockResolvedValue(null);
    await expect(service.create({ clientId: 'x', externalId: '1203630@g.us' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('ID já usado por outro cliente → 409 citando o cliente', async () => {
    const { service, prisma } = make({
      create: vi.fn().mockRejectedValue({ code: 'P2002' }),
      findUnique: vi.fn().mockResolvedValue({ client: { name: 'Acme' } }),
    });
    await expect(service.create({ clientId: 'c1', externalId: '1203630@g.us' })).rejects.toThrow(/Acme/);
    await expect(service.create({ clientId: 'c1', externalId: '1203630@g.us' })).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.whatsappGroup.findUnique).toHaveBeenCalled();
  });

  it('update atualiza só os campos enviados; remove apaga', async () => {
    const { service, prisma } = make();
    await service.update('g1', { active: false });
    expect(prisma.whatsappGroup.update).toHaveBeenCalledWith({ where: { id: 'g1' }, data: { active: false } });
    await service.remove('g1');
    expect(prisma.whatsappGroup.delete).toHaveBeenCalledWith({ where: { id: 'g1' } });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /c/Users/renan/os-exec/backend && npx vitest run src/whatsapp/whatsapp-groups.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`db-errors.ts`:

```ts
/** Violação de unicidade do Prisma (P2002). */
export function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === 'P2002';
}
```

`dto/group.dto.ts`:

```ts
import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateGroupDto {
  @IsString()
  @MinLength(1)
  clientId!: string;

  @IsString()
  externalId!: string;

  @IsOptional()
  @IsString()
  name?: string;
}

export class UpdateGroupDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
```

`whatsapp-groups.service.ts`:

```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { isUniqueViolation } from './db-errors.js';
import type { CreateGroupDto, UpdateGroupDto } from './dto/group.dto.js';

// "120363...@g.us" ou o formato antigo "5511999990000-1630000000@g.us"
const GROUP_JID = /^\d+(-\d+)?@g\.us$/;

@Injectable()
export class WhatsappGroupsService {
  constructor(private readonly prisma: PrismaService) {}

  list(clientId: string) {
    return this.prisma.whatsappGroup.findMany({ where: { clientId }, orderBy: { createdAt: 'asc' } });
  }

  async create(dto: CreateGroupDto) {
    const externalId = dto.externalId.trim();
    if (!GROUP_JID.test(externalId)) {
      throw new BadRequestException('ID inválido: use o formato 120363000000000001@g.us (copie da Evolution).');
    }
    const client = await this.prisma.client.findUnique({ where: { id: dto.clientId } });
    if (!client) throw new NotFoundException('Cliente não encontrado.');
    try {
      return await this.prisma.whatsappGroup.create({
        data: { externalId, name: dto.name?.trim() || null, clientId: dto.clientId },
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        const other = await this.prisma.whatsappGroup.findUnique({
          where: { externalId },
          include: { client: { select: { name: true } } },
        });
        throw new ConflictException(`Este grupo já está cadastrado no cliente "${other?.client.name ?? 'outro'}".`);
      }
      throw e;
    }
  }

  update(id: string, dto: UpdateGroupDto) {
    const data: { name?: string | null; active?: boolean } = {};
    if (dto.name !== undefined) data.name = dto.name.trim() || null;
    if (dto.active !== undefined) data.active = dto.active;
    return this.prisma.whatsappGroup.update({ where: { id }, data });
  }

  /** Apaga o grupo e, em cascata, as mensagens gravadas dele (a UI avisa). */
  remove(id: string) {
    return this.prisma.whatsappGroup.delete({ where: { id } });
  }
}
```

`whatsapp-groups.controller.ts`:

```ts
import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../common/roles.decorator.js';
import { WhatsappGroupsService } from './whatsapp-groups.service.js';
import { CreateGroupDto, UpdateGroupDto } from './dto/group.dto.js';

@Controller('whatsapp/groups')
@Roles('ADMIN', 'AGENT')
export class WhatsappGroupsController {
  constructor(private readonly groups: WhatsappGroupsService) {}

  @Get()
  list(@Query('clientId') clientId?: string) {
    if (!clientId) throw new BadRequestException('clientId é obrigatório.');
    return this.groups.list(clientId);
  }

  @Post()
  create(@Body() dto: CreateGroupDto) {
    return this.groups.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateGroupDto) {
    return this.groups.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.groups.remove(id);
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd /c/Users/renan/os-exec/backend && npx vitest run src/whatsapp/whatsapp-groups.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/renan/os-exec && git add backend/src/whatsapp
git commit -m "feat(whatsapp): cadastro de grupos do cliente pelo ID do grupo"
```

---

### Task 6: Frases de gatilho (CRUD e padrão global)

**Files:**
- Create: `backend/src/whatsapp/dto/phrase.dto.ts`
- Create: `backend/src/whatsapp/trigger-phrases.service.ts`, `backend/src/whatsapp/trigger-phrases.service.spec.ts`
- Create: `backend/src/whatsapp/trigger-phrases.controller.ts`

**Interfaces:**
- Consumes: `normalizeText` (Task 3), `isUniqueViolation` (Task 5).
- Produces: `TriggerPhrasesService` com `list(clientId: string | null)`, `create(dto)`, `update(id, dto)`, `remove(id)`, `applyDefaults(clientId): Promise<{ created: number }>`.
- Produces: rotas `GET /whatsapp/phrases?clientId=` (sem `clientId` = padrão global), `POST`, `PATCH :id`, `DELETE :id`, `POST /whatsapp/phrases/apply-defaults` (`{ clientId }`).

- [ ] **Step 1: Escrever os testes**

```ts
import { BadRequestException } from '@nestjs/common';
import { TriggerPhrasesService } from './trigger-phrases.service.js';

function make(over: Record<string, any> = {}) {
  const prisma = {
    category: { findUnique: vi.fn().mockResolvedValue({ id: 'cat1' }) },
    triggerPhrase: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue({ id: 'p1', clientId: 'c1', phraseNorm: 'x' }),
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'p1', ...data })),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'p1', ...data })),
      delete: vi.fn(),
      ...over,
    },
  };
  return { service: new TriggerPhrasesService(prisma as any), prisma };
}

describe('TriggerPhrasesService', () => {
  it('create normaliza a frase e aplica prioridade padrão', async () => {
    const { service, prisma } = make();
    await service.create({ clientId: 'c1', phrase: ' Sem Conexão ', priority: 'HIGH', title: 'Sem internet' });
    expect(prisma.triggerPhrase.create.mock.calls[0][0].data).toMatchObject({
      clientId: 'c1', phrase: 'Sem Conexão', phraseNorm: 'sem conexao', priority: 'HIGH', title: 'Sem internet',
    });
  });

  it('frase duplicada no mesmo escopo (inclusive global) → 400', async () => {
    const { service } = make({ findFirst: vi.fn().mockResolvedValue({ id: 'outra' }) });
    await expect(service.create({ phrase: 'Sistema caiu' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('categoria inexistente → 400', async () => {
    const { service, prisma } = make();
    prisma.category.findUnique.mockResolvedValue(null);
    await expect(service.create({ phrase: 'x1', categoryId: 'nao' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('frase vazia depois de normalizar → 400', async () => {
    const { service } = make();
    await expect(service.create({ phrase: '   ' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('list(null) lista o padrão global', async () => {
    const { service, prisma } = make();
    await service.list(null);
    expect(prisma.triggerPhrase.findMany.mock.calls[0][0].where).toEqual({ clientId: null });
  });

  it('applyDefaults copia só as que o cliente ainda não tem', async () => {
    const globals = [
      { phrase: 'Sistema caiu', phraseNorm: 'sistema caiu', categoryId: 'cat1', priority: 'URGENT', title: null },
      { phrase: 'Sem conexão', phraseNorm: 'sem conexao', categoryId: null, priority: 'HIGH', title: 'Sem internet' },
    ];
    const findMany = vi.fn()
      .mockResolvedValueOnce(globals) // padrão global
      .mockResolvedValueOnce([{ phraseNorm: 'sem conexao' }]); // já no cliente
    const { service, prisma } = make({ findMany, createMany: vi.fn().mockResolvedValue({ count: 1 }) });
    const r = await service.applyDefaults('c1');
    expect(r).toEqual({ created: 1 });
    expect(prisma.triggerPhrase.createMany.mock.calls[0][0].data).toEqual([
      { clientId: 'c1', phrase: 'Sistema caiu', phraseNorm: 'sistema caiu', categoryId: 'cat1', priority: 'URGENT', title: null },
    ]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /c/Users/renan/os-exec/backend && npx vitest run src/whatsapp/trigger-phrases.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`dto/phrase.dto.ts`:

```ts
import { IsBoolean, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import type { TicketPriority } from '@prisma/client';

export class CreatePhraseDto {
  /** Ausente = frase do padrão global. */
  @IsOptional()
  @IsString()
  clientId?: string;

  @IsString()
  @MinLength(1)
  phrase!: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
  priority?: TicketPriority;

  @IsOptional()
  @IsString()
  title?: string;
}

export class UpdatePhraseDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  phrase?: string;

  @IsOptional()
  @IsString()
  categoryId?: string | null;

  @IsOptional()
  @IsIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
  priority?: TicketPriority;

  @IsOptional()
  @IsString()
  title?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ApplyDefaultsDto {
  @IsString()
  @MinLength(1)
  clientId!: string;
}
```

`trigger-phrases.service.ts`:

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { normalizeText } from './text.util.js';
import type { CreatePhraseDto, UpdatePhraseDto } from './dto/phrase.dto.js';

@Injectable()
export class TriggerPhrasesService {
  constructor(private readonly prisma: PrismaService) {}

  /** `null` = padrão global. */
  list(clientId: string | null) {
    return this.prisma.triggerPhrase.findMany({ where: { clientId }, orderBy: { phraseNorm: 'asc' } });
  }

  private async assertCategory(categoryId: string | null | undefined) {
    if (!categoryId) return;
    const c = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!c) throw new BadRequestException('Categoria não encontrada.');
  }

  /** O índice único não protege o escopo global (NULL ≠ NULL no Postgres): checa aqui. */
  private async assertUnique(clientId: string | null, phraseNorm: string, exceptId?: string) {
    const dup = await this.prisma.triggerPhrase.findFirst({
      where: { clientId, phraseNorm, ...(exceptId ? { id: { not: exceptId } } : {}) },
    });
    if (dup) throw new BadRequestException('Já existe uma frase igual neste escopo.');
  }

  async create(dto: CreatePhraseDto) {
    const phrase = dto.phrase.trim();
    const phraseNorm = normalizeText(phrase);
    if (!phraseNorm) throw new BadRequestException('Informe a frase.');
    const clientId = dto.clientId ?? null;
    await this.assertCategory(dto.categoryId);
    await this.assertUnique(clientId, phraseNorm);
    return this.prisma.triggerPhrase.create({
      data: {
        clientId,
        phrase,
        phraseNorm,
        categoryId: dto.categoryId ?? null,
        priority: dto.priority ?? 'MEDIUM',
        title: dto.title?.trim() || null,
      },
    });
  }

  async update(id: string, dto: UpdatePhraseDto) {
    const found = await this.prisma.triggerPhrase.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Frase não encontrada.');
    const data: Record<string, unknown> = {};
    if (dto.phrase !== undefined) {
      const phrase = dto.phrase.trim();
      const phraseNorm = normalizeText(phrase);
      if (!phraseNorm) throw new BadRequestException('Informe a frase.');
      await this.assertUnique(found.clientId, phraseNorm, id);
      data.phrase = phrase;
      data.phraseNorm = phraseNorm;
    }
    if (dto.categoryId !== undefined) {
      await this.assertCategory(dto.categoryId);
      data.categoryId = dto.categoryId || null;
    }
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.title !== undefined) data.title = dto.title?.trim() || null;
    if (dto.active !== undefined) data.active = dto.active;
    return this.prisma.triggerPhrase.update({ where: { id }, data });
  }

  remove(id: string) {
    return this.prisma.triggerPhrase.delete({ where: { id } });
  }

  /** Copia o padrão global (só as ativas) para o cliente, pulando as que ele já tem. */
  async applyDefaults(clientId: string): Promise<{ created: number }> {
    const globals = await this.prisma.triggerPhrase.findMany({ where: { clientId: null, active: true } });
    const mine = await this.prisma.triggerPhrase.findMany({ where: { clientId }, select: { phraseNorm: true } });
    const have = new Set(mine.map((p) => p.phraseNorm));
    const data = globals
      .filter((g) => !have.has(g.phraseNorm))
      .map((g) => ({
        clientId,
        phrase: g.phrase,
        phraseNorm: g.phraseNorm,
        categoryId: g.categoryId,
        priority: g.priority,
        title: g.title,
      }));
    if (!data.length) return { created: 0 };
    const r = await this.prisma.triggerPhrase.createMany({ data, skipDuplicates: true });
    return { created: r.count };
  }
}
```

`trigger-phrases.controller.ts`:

```ts
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../common/roles.decorator.js';
import { TriggerPhrasesService } from './trigger-phrases.service.js';
import { ApplyDefaultsDto, CreatePhraseDto, UpdatePhraseDto } from './dto/phrase.dto.js';

@Controller('whatsapp/phrases')
@Roles('ADMIN', 'AGENT')
export class TriggerPhrasesController {
  constructor(private readonly phrases: TriggerPhrasesService) {}

  @Get()
  list(@Query('clientId') clientId?: string) {
    return this.phrases.list(clientId || null);
  }

  @Post()
  create(@Body() dto: CreatePhraseDto) {
    return this.phrases.create(dto);
  }

  @Post('apply-defaults')
  applyDefaults(@Body() dto: ApplyDefaultsDto) {
    return this.phrases.applyDefaults(dto.clientId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePhraseDto) {
    return this.phrases.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.phrases.remove(id);
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd /c/Users/renan/os-exec/backend && npx vitest run src/whatsapp/trigger-phrases.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/renan/os-exec && git add backend/src/whatsapp
git commit -m "feat(whatsapp): frases de gatilho por cliente e padrão global"
```

---

### Task 7: Ingestão da mensagem (gravar, identificar, gatilho, deduplicação)

**Files:**
- Create: `backend/src/whatsapp/whatsapp.service.ts`, `backend/src/whatsapp/whatsapp.service.spec.ts`

**Interfaces:**
- Consumes: `ParsedWhatsappMessage` (Task 4), `matchStart` (Task 3), `phoneKey` (Task 2), `isUniqueViolation` (Task 5), `TicketsService.create` e `TicketEventsService.record` (existentes).
- Produces: `WhatsappService.ingest(m: ParsedWhatsappMessage): Promise<{ stored: boolean; ticketId: string | null }>`.

- [ ] **Step 1: Escrever os testes**

```ts
import { WhatsappService } from './whatsapp.service.js';
import type { ParsedWhatsappMessage } from './evolution-payload.js';

const msg = (over: Partial<ParsedWhatsappMessage> = {}): ParsedWhatsappMessage => ({
  externalId: 'g@g.us:M1',
  groupJid: 'g@g.us',
  senderPhone: '5519999991234',
  senderName: 'Fulano',
  type: 'TEXT',
  body: 'Sem conexão - escritório',
  sentAt: new Date('2026-10-11T12:00:00Z'),
  ...over,
});

const group = { id: 'g1', externalId: 'g@g.us', name: 'Suporte Acme', clientId: 'c1', active: true };
const phrases = [
  { id: 'p1', phrase: 'Sem conexão', phraseNorm: 'sem conexao', title: 'Sem internet', categoryId: 'cat1', priority: 'HIGH' },
  { id: 'p2', phrase: 'Sem conexão total', phraseNorm: 'sem conexao total', title: null, categoryId: null, priority: 'URGENT' },
];

function make(over: { group?: any; phrases?: any[]; contacts?: any[]; open?: any; createError?: any } = {}) {
  const prisma = {
    whatsappGroup: { findUnique: vi.fn().mockResolvedValue('group' in over ? over.group : group) },
    user: { findMany: vi.fn().mockResolvedValue(over.contacts ?? []) },
    triggerPhrase: { findMany: vi.fn().mockResolvedValue(over.phrases ?? phrases) },
    whatsappMessage: {
      create: over.createError
        ? vi.fn().mockRejectedValue(over.createError)
        : vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'm1', ...data })),
      findFirst: vi.fn().mockResolvedValue(over.open ?? null),
      findUnique: vi.fn().mockResolvedValue({ ticketId: 't9' }),
      update: vi.fn().mockResolvedValue({}),
    },
  };
  const tickets = { create: vi.fn().mockResolvedValue({ id: 't1', number: '2026-0001' }) };
  const events = { record: vi.fn().mockResolvedValue({}) };
  return { service: new WhatsappService(prisma as any, tickets as any, events as any), prisma, tickets, events };
}

describe('WhatsappService.ingest', () => {
  it('grupo desconhecido ou inativo → descarta sem gravar', async () => {
    for (const g of [null, { ...group, active: false }]) {
      const { service, prisma, tickets } = make({ group: g });
      expect(await service.ingest(msg())).toEqual({ stored: false, ticketId: null });
      expect(prisma.whatsappMessage.create).not.toHaveBeenCalled();
      expect(tickets.create).not.toHaveBeenCalled();
    }
  });

  it('sem gatilho → grava PENDING, sem chamado', async () => {
    const { service, prisma, tickets } = make();
    const r = await service.ingest(msg({ body: 'a internet está lenta hoje' }));
    expect(r).toEqual({ stored: true, ticketId: null });
    expect(prisma.whatsappMessage.create.mock.calls[0][0].data).toMatchObject({ groupId: 'g1', aiStatus: 'PENDING' });
    expect(tickets.create).not.toHaveBeenCalled();
  });

  it('gatilho cria chamado com os dados da frase e marca a mensagem', async () => {
    const { service, prisma, tickets } = make();
    const r = await service.ingest(msg());
    expect(r).toEqual({ stored: true, ticketId: 't1' });
    const input = tickets.create.mock.calls[0][0];
    expect(input).toMatchObject({
      origin: 'WHATSAPP', clientId: 'c1', requesterId: null,
      title: 'Sem internet', categoryId: 'cat1', priority: 'HIGH',
    });
    expect(input.description).toContain('escritório');
    expect(input.description).toContain('Suporte Acme');
    expect(input.description).toContain('remetente não identificado');
    expect(prisma.whatsappMessage.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { ticketId: 't1', triggerPhraseId: 'p1', aiStatus: 'SKIPPED' },
    });
  });

  it('a frase mais longa vence', async () => {
    const { service, tickets } = make();
    await service.ingest(msg({ body: 'Sem conexão total no prédio' }));
    expect(tickets.create.mock.calls[0][0]).toMatchObject({ priority: 'URGENT', title: 'Sem conexão total' });
  });

  it('contato identificado pelo telefone (com/sem 9º dígito) vira solicitante', async () => {
    const { service, tickets } = make({ contacts: [{ id: 'u7', phone: '551999991234' }] });
    await service.ingest(msg({ senderPhone: '5519999991234' }));
    const input = tickets.create.mock.calls[0][0];
    expect(input.requesterId).toBe('u7');
    expect(input.description).not.toContain('não identificado');
  });

  it('remetente sem telefone (LID) ainda cria o chamado, não identificado', async () => {
    const { service, tickets } = make();
    await service.ingest(msg({ senderPhone: '' }));
    expect(tickets.create.mock.calls[0][0].requesterId).toBeNull();
  });

  it('mesma frase no mesmo grupo com chamado aberto → evento no chamado, sem novo', async () => {
    const { service, tickets, events, prisma } = make({ open: { ticketId: 't5' } });
    const r = await service.ingest(msg());
    expect(r).toEqual({ stored: true, ticketId: 't5' });
    expect(tickets.create).not.toHaveBeenCalled();
    expect(events.record).toHaveBeenCalledWith(
      expect.anything(), 't5', 'WHATSAPP_IN',
      expect.objectContaining({ text: 'Sem conexão - escritório', sender: 'Fulano' }),
    );
    expect(prisma.whatsappMessage.update.mock.calls[0][0].data).toMatchObject({ ticketId: 't5', triggerPhraseId: 'p1' });
    // a busca de "aberto" exclui chamados encerrados
    expect(prisma.whatsappMessage.findFirst.mock.calls[0][0].where.ticket).toEqual({
      status: { notIn: ['RESOLVED', 'CLOSED', 'CANCELLED'] },
    });
  });

  it('reentrega do mesmo evento (P2002) → não duplica nada', async () => {
    const { service, tickets } = make({ createError: { code: 'P2002' } });
    expect(await service.ingest(msg())).toEqual({ stored: false, ticketId: 't9' });
    expect(tickets.create).not.toHaveBeenCalled();
  });

  it('áudio/imagem são gravados como SKIPPED e não disparam gatilho', async () => {
    const { service, prisma, tickets } = make();
    await service.ingest(msg({ type: 'AUDIO', body: null }));
    expect(prisma.whatsappMessage.create.mock.calls[0][0].data.aiStatus).toBe('SKIPPED');
    await service.ingest(msg({ type: 'IMAGE', body: 'Sem conexão' }));
    expect(tickets.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /c/Users/renan/os-exec/backend && npx vitest run src/whatsapp/whatsapp.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`whatsapp.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import type { TriggerPhrase, WhatsappGroup } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TicketsService } from '../tickets/tickets.service.js';
import { TicketEventsService } from '../tickets/ticket-events.service.js';
import { phoneKey } from '../common/phone.util.js';
import { isUniqueViolation } from './db-errors.js';
import { matchStart } from './text.util.js';
import type { ParsedWhatsappMessage } from './evolution-payload.js';

const TERMINAL = ['RESOLVED', 'CLOSED', 'CANCELLED'] as const;

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: TicketsService,
    private readonly events: TicketEventsService,
  ) {}

  /**
   * Caminho de uma mensagem de grupo (spec §4). O cliente vem do grupo CADASTRADO; o
   * telefone só identifica o contato. Idempotente por `externalId`.
   */
  async ingest(m: ParsedWhatsappMessage): Promise<{ stored: boolean; ticketId: string | null }> {
    const group = await this.prisma.whatsappGroup.findUnique({ where: { externalId: m.groupJid } });
    if (!group || !group.active) return { stored: false, ticketId: null };

    const senderUserId = await this.findSender(group.clientId, m.senderPhone);
    const textual = m.type === 'TEXT' && !!m.body;

    let row;
    try {
      row = await this.prisma.whatsappMessage.create({
        data: {
          externalId: m.externalId,
          groupId: group.id,
          senderPhone: m.senderPhone,
          senderName: m.senderName,
          senderUserId,
          type: m.type,
          body: m.body,
          sentAt: m.sentAt,
          aiStatus: textual ? 'PENDING' : 'SKIPPED',
        },
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        const seen = await this.prisma.whatsappMessage.findUnique({
          where: { externalId: m.externalId },
          select: { ticketId: true },
        });
        return { stored: false, ticketId: seen?.ticketId ?? null };
      }
      throw e;
    }
    if (!textual) return { stored: true, ticketId: null };

    const hit = await this.matchTrigger(group.clientId, m.body!);
    if (!hit) return { stored: true, ticketId: null };

    const ticketId = await this.openOrAttach(group, hit.phrase, hit.rest, m, senderUserId);
    await this.prisma.whatsappMessage.update({
      where: { id: row.id },
      data: { ticketId, triggerPhraseId: hit.phrase.id, aiStatus: 'SKIPPED' },
    });
    return { stored: true, ticketId };
  }

  /** Contato do cliente cujo telefone casa (pelos 8 últimos dígitos) com o do remetente. */
  private async findSender(clientId: string, senderPhone: string): Promise<string | null> {
    const key = phoneKey(senderPhone);
    if (!key) return null;
    const contacts = await this.prisma.user.findMany({
      where: { clientId, type: 'CLIENT', phone: { not: null } },
      select: { id: true, phone: true },
    });
    return contacts.find((c) => phoneKey(c.phone) === key)?.id ?? null;
  }

  /** Frases ativas do cliente; a mais longa que casa no início da mensagem vence. */
  private async matchTrigger(clientId: string, body: string) {
    const phrases = await this.prisma.triggerPhrase.findMany({ where: { clientId, active: true } });
    const byLength = [...phrases].sort((a, b) => b.phraseNorm.length - a.phraseNorm.length);
    for (const phrase of byLength) {
      const hit = matchStart(body, phrase.phraseNorm);
      if (hit) return { phrase, rest: hit.rest };
    }
    return null;
  }

  private async openOrAttach(
    group: WhatsappGroup,
    phrase: TriggerPhrase,
    rest: string,
    m: ParsedWhatsappMessage,
    senderUserId: string | null,
  ): Promise<string> {
    const open = await this.prisma.whatsappMessage.findFirst({
      where: {
        groupId: group.id,
        triggerPhraseId: phrase.id,
        ticketId: { not: null },
        ticket: { status: { notIn: [...TERMINAL] } },
      },
      orderBy: { sentAt: 'desc' },
      select: { ticketId: true },
    });
    if (open?.ticketId) {
      await this.events.record(this.prisma, open.ticketId, 'WHATSAPP_IN', {
        groupId: group.id,
        sender: m.senderName ?? m.senderPhone,
        text: m.body,
      });
      return open.ticketId;
    }

    const who = m.senderName ?? (m.senderPhone || 'desconhecido');
    const origin = `Origem: grupo WhatsApp "${group.name ?? group.externalId}" — ${who}${
      senderUserId ? '' : ' (remetente não identificado)'
    }`;
    const ticket = await this.tickets.create({
      origin: 'WHATSAPP',
      clientId: group.clientId,
      requesterId: senderUserId,
      title: phrase.title?.trim() || phrase.phrase,
      description: `${rest || m.body}\n\n${origin}`,
      categoryId: phrase.categoryId,
      priority: phrase.priority,
    });
    this.logger.log(`Chamado ${ticket.number} aberto por gatilho "${phrase.phrase}" no grupo ${group.id}.`);
    return ticket.id;
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd /c/Users/renan/os-exec/backend && npx vitest run src/whatsapp/whatsapp.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/renan/os-exec && git add backend/src/whatsapp
git commit -m "feat(whatsapp): ingestão de mensagens com gatilho e deduplicação"
```

---

### Task 8: Webhook, módulo e boot real

**Files:**
- Create: `backend/src/whatsapp/whatsapp-webhook.controller.ts`, `backend/src/whatsapp/whatsapp-webhook.controller.spec.ts`
- Create: `backend/src/whatsapp/whatsapp.module.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: `parseEvolutionMessage` (Task 4), `WhatsappService` (Task 7), `WhatsappGroupsService/Controller` (Task 5), `TriggerPhrasesService/Controller` (Task 6).
- Produces: `verifyWebhookSecret(received, expected): boolean`; `POST /api/whatsapp/webhook` (header `x-webhook-secret`); `WhatsappModule`.

- [ ] **Step 1: Escrever os testes**

```ts
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { WhatsappWebhookController, verifyWebhookSecret } from './whatsapp-webhook.controller.js';

describe('verifyWebhookSecret', () => {
  it('só aceita o segredo exato; fail-closed sem segredo configurado', () => {
    expect(verifyWebhookSecret('abc', 'abc')).toBe(true);
    expect(verifyWebhookSecret('abd', 'abc')).toBe(false);
    expect(verifyWebhookSecret(undefined, 'abc')).toBe(false);
    expect(verifyWebhookSecret('', '')).toBe(false);
    expect(verifyWebhookSecret('x', '')).toBe(false);
  });
});

const payload = {
  event: 'messages.upsert',
  data: {
    key: { remoteJid: '1203630@g.us', fromMe: false, id: 'A1', participant: '5519999991234@s.whatsapp.net' },
    message: { conversation: 'Sistema caiu' },
    messageTimestamp: 1760000000,
  },
};
const req = (body: unknown) => ({ rawBody: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)) }) as any;

function make(secret = 's3gredo') {
  const whatsapp = { ingest: vi.fn().mockResolvedValue({ stored: true, ticketId: null }) };
  const settings = { get: vi.fn().mockResolvedValue(secret) };
  return { ctrl: new WhatsappWebhookController(whatsapp as any, settings as any), whatsapp };
}

describe('WhatsappWebhookController', () => {
  it('segredo errado → 401 e nada é processado', async () => {
    const { ctrl, whatsapp } = make();
    await expect(ctrl.receive(req(payload), 'errado')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(whatsapp.ingest).not.toHaveBeenCalled();
  });

  it('JSON inválido → 400', async () => {
    const { ctrl } = make();
    await expect(ctrl.receive(req('{nao-json'), 's3gredo')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('evento que não interessa → ignored, sem ingerir', async () => {
    const { ctrl, whatsapp } = make();
    expect(await ctrl.receive(req({ event: 'connection.update' }), 's3gredo')).toEqual({ ignored: true });
    expect(whatsapp.ingest).not.toHaveBeenCalled();
  });

  it('mensagem de grupo válida → ingere', async () => {
    const { ctrl, whatsapp } = make();
    await ctrl.receive(req(payload), 's3gredo');
    expect(whatsapp.ingest).toHaveBeenCalledWith(expect.objectContaining({ groupJid: '1203630@g.us', body: 'Sistema caiu' }));
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /c/Users/renan/os-exec/backend && npx vitest run src/whatsapp/whatsapp-webhook.controller.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar o controller**

`whatsapp-webhook.controller.ts`:

```ts
import { createHash, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../common/public.decorator.js';
import { SettingsService } from '../settings/settings.service.js';
import { WhatsappService } from './whatsapp.service.js';
import { parseEvolutionMessage } from './evolution-payload.js';

/** Compara em tempo constante (hash dos dois lados iguala o tamanho). Fail-closed sem segredo. */
export function verifyWebhookSecret(received: string | undefined, expected: string): boolean {
  if (!received || !expected) return false;
  const a = createHash('sha256').update(received).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

@Public()
@Controller('whatsapp')
export class WhatsappWebhookController {
  constructor(
    private readonly whatsapp: WhatsappService,
    private readonly settings: SettingsService,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-webhook-secret') secret: string | undefined,
  ) {
    const expected = (await this.settings.get('whatsapp.webhookSecret')) ?? '';
    if (!verifyWebhookSecret(secret, expected)) {
      throw new UnauthorizedException('Segredo do webhook inválido.');
    }
    // JSON do corpo cru: o ValidationPipe global (whitelist) removeria os campos aninhados.
    let payload: unknown;
    try {
      payload = JSON.parse(req.rawBody?.toString('utf8') ?? '');
    } catch {
      throw new BadRequestException('Corpo não é um JSON válido.');
    }
    const parsed = parseEvolutionMessage(payload);
    if (!parsed) return { ignored: true };
    return this.whatsapp.ingest(parsed);
  }
}
```

- [ ] **Step 4: Criar o módulo e registrar**

`whatsapp.module.ts` (cresce nas próximas tasks — cada uma acrescenta suas linhas):

```ts
import { Module } from '@nestjs/common';
import { TicketsModule } from '../tickets/tickets.module.js';
import { WhatsappService } from './whatsapp.service.js';
import { WhatsappWebhookController } from './whatsapp-webhook.controller.js';
import { WhatsappGroupsService } from './whatsapp-groups.service.js';
import { WhatsappGroupsController } from './whatsapp-groups.controller.js';
import { TriggerPhrasesService } from './trigger-phrases.service.js';
import { TriggerPhrasesController } from './trigger-phrases.controller.js';

@Module({
  imports: [TicketsModule],
  controllers: [WhatsappWebhookController, WhatsappGroupsController, TriggerPhrasesController],
  providers: [WhatsappService, WhatsappGroupsService, TriggerPhrasesService],
})
export class WhatsappModule {}
```

Em `app.module.ts`: `import { WhatsappModule } from './whatsapp/whatsapp.module.js';` e `WhatsappModule,` no fim do array `imports` (depois de `CrmModule`).

- [ ] **Step 5: Rodar os testes, o build e o BOOT REAL**

Run: `cd /c/Users/renan/os-exec/backend && npx vitest run src/whatsapp && npm run build`
Expected: PASS e build limpo.

Boot real (valida a injeção de dependência, que `new Service(mock)` e `nest build` não pegam):

```bash
cd /c/Users/renan/os-exec/backend && (node dist/main > /tmp/os-boot.log 2>&1 &) ; sleep 8
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3001/api/whatsapp/webhook -H "content-type: application/json" -d '{}'
tail -n 5 /tmp/os-boot.log
```
Expected: `401` e nenhum erro de DI no log. Depois parar o processo (`pkill -f "node dist/main"` ou encerrar pelo gerenciador de tarefas).

- [ ] **Step 6: Commit e checkpoint**

```bash
cd /c/Users/renan/os-exec && git add backend/src
git commit -m "feat(whatsapp): webhook protegido por segredo e módulo WhatsApp"
git push origin main && cd /z/Projetos/OS && git pull --ff-only
```

---

### Task 9: Estado da conexão, QR e uso da IA

**Files:**
- Create: `backend/src/whatsapp/evolution-status.service.ts`, `backend/src/whatsapp/evolution-status.service.spec.ts`
- Create: `backend/src/whatsapp/ai-usage.service.ts`, `backend/src/whatsapp/ai-usage.service.spec.ts`
- Create: `backend/src/whatsapp/whatsapp-status.controller.ts`
- Modify: `backend/src/whatsapp/whatsapp.module.ts`

**Interfaces:**
- Produces: `EvolutionStatusService.check(): Promise<{ configured: boolean; state: string; disconnectedSince: string | null }>` e `qr(): Promise<{ base64: string | null; pairingCode: string | null }>`.
- Produces: `AiUsageService.usedToday()`, `limit()`, `isPaused()`, `add(inputTokens, outputTokens)`; `DEFAULT_DAILY_TOKEN_LIMIT = 500_000`.
- Produces: `GET /whatsapp/status` → `{ connection, ai: { usedToday, limit, paused } }` (ADMIN/AGENT); `GET /whatsapp/qr` (ADMIN).

- [ ] **Step 1: Escrever os testes**

`evolution-status.service.spec.ts`:

```ts
import { EvolutionStatusService } from './evolution-status.service.js';

const cfg: Record<string, string | undefined> = {
  'whatsapp.evolution.url': 'http://evolution-api:8080/',
  'whatsapp.evolution.apiKey': 'k',
  'whatsapp.evolution.instance': 'os',
};
const settings = (over: Record<string, string | undefined> = {}) => ({
  get: vi.fn().mockImplementation((key: string) => Promise.resolve({ ...cfg, ...over }[key])),
});
const reply = (body: unknown, ok = true) => vi.fn().mockResolvedValue({ ok, json: () => Promise.resolve(body) });

afterEach(() => vi.unstubAllGlobals());

describe('EvolutionStatusService', () => {
  it('sem configuração → configured=false', async () => {
    const s = new EvolutionStatusService(settings({ 'whatsapp.evolution.url': undefined }) as any);
    expect(await s.check()).toMatchObject({ configured: false, state: 'not_configured' });
  });

  it('conectado: state=open, sem aviso', async () => {
    const fetchMock = reply({ instance: { instanceName: 'os', state: 'open' } });
    vi.stubGlobal('fetch', fetchMock);
    const r = await new EvolutionStatusService(settings() as any).check();
    expect(r).toEqual({ configured: true, state: 'open', disconnectedSince: null });
    expect(fetchMock.mock.calls[0][0]).toBe('http://evolution-api:8080/instance/connectionState/os');
    expect(fetchMock.mock.calls[0][1].headers.apikey).toBe('k');
  });

  it('inalcançável marca disconnectedSince e mantém o instante original; reconectar limpa', async () => {
    const s = new EvolutionStatusService(settings() as any);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const a = await s.check();
    expect(a.state).toBe('unreachable');
    expect(a.disconnectedSince).toBeTruthy();
    const b = await s.check();
    expect(b.disconnectedSince).toBe(a.disconnectedSince);
    vi.stubGlobal('fetch', reply({ instance: { state: 'open' } }));
    expect((await s.check()).disconnectedSince).toBeNull();
  });

  it('qr devolve base64/pairingCode quando existem', async () => {
    vi.stubGlobal('fetch', reply({ base64: 'data:image/png;base64,AAA', pairingCode: 'ABCD-1234', count: 1 }));
    expect(await new EvolutionStatusService(settings() as any).qr()).toEqual({
      base64: 'data:image/png;base64,AAA',
      pairingCode: 'ABCD-1234',
    });
  });
});
```

`ai-usage.service.spec.ts`:

```ts
import { AiUsageService, DEFAULT_DAILY_TOKEN_LIMIT } from './ai-usage.service.js';

function make(row: any, limit?: number) {
  const prisma = {
    aiUsage: { findUnique: vi.fn().mockResolvedValue(row), upsert: vi.fn().mockResolvedValue({}) },
  };
  const settings = { getNumber: vi.fn().mockResolvedValue(limit) };
  return { service: new AiUsageService(prisma as any, settings as any), prisma };
}

describe('AiUsageService', () => {
  it('soma entrada+saída do dia; sem registro = 0', async () => {
    expect(await make({ inputTokens: 100, outputTokens: 20 }).service.usedToday()).toBe(120);
    expect(await make(null).service.usedToday()).toBe(0);
  });

  it('limite configurado ou padrão; valor inválido cai no padrão', async () => {
    expect(await make(null, 1000).service.limit()).toBe(1000);
    expect(await make(null, undefined).service.limit()).toBe(DEFAULT_DAILY_TOKEN_LIMIT);
    expect(await make(null, 0).service.limit()).toBe(DEFAULT_DAILY_TOKEN_LIMIT);
  });

  it('pausa ao atingir o teto', async () => {
    expect(await make({ inputTokens: 900, outputTokens: 100 }, 1000).service.isPaused()).toBe(true);
    expect(await make({ inputTokens: 10, outputTokens: 10 }, 1000).service.isPaused()).toBe(false);
  });

  it('add faz upsert incrementando', async () => {
    const { service, prisma } = make(null);
    await service.add(50, 5);
    const arg = prisma.aiUsage.upsert.mock.calls[0][0];
    expect(arg.create).toMatchObject({ inputTokens: 50, outputTokens: 5, calls: 1 });
    expect(arg.update).toEqual({ inputTokens: { increment: 50 }, outputTokens: { increment: 5 }, calls: { increment: 1 } });
    expect(arg.where.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /c/Users/renan/os-exec/backend && npx vitest run src/whatsapp/evolution-status.service.spec.ts src/whatsapp/ai-usage.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`evolution-status.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service.js';

export interface WhatsappConnection {
  configured: boolean;
  state: string;
  disconnectedSince: string | null;
}

@Injectable()
export class EvolutionStatusService {
  // ponytail: instante da queda só em memória (reiniciar o backend zera). Persistir se virar auditoria.
  private disconnectedSince: Date | null = null;

  constructor(private readonly settings: SettingsService) {}

  private async cfg() {
    const [url, apiKey, instance] = await Promise.all([
      this.settings.get('whatsapp.evolution.url'),
      this.settings.get('whatsapp.evolution.apiKey'),
      this.settings.get('whatsapp.evolution.instance'),
    ]);
    return url && apiKey && instance ? { url: url.replace(/\/+$/, ''), apiKey, instance } : null;
  }

  async check(): Promise<WhatsappConnection> {
    const c = await this.cfg();
    if (!c) return { configured: false, state: 'not_configured', disconnectedSince: null };

    let state = 'unreachable';
    try {
      const res = await fetch(`${c.url}/instance/connectionState/${encodeURIComponent(c.instance)}`, {
        headers: { apikey: c.apiKey },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const j = (await res.json()) as { instance?: { state?: string }; state?: string };
        state = j?.instance?.state ?? j?.state ?? 'unknown';
      }
    } catch {
      /* inalcançável */
    }
    if (state === 'open') this.disconnectedSince = null;
    else if (!this.disconnectedSince) this.disconnectedSince = new Date();
    return { configured: true, state, disconnectedSince: this.disconnectedSince?.toISOString() ?? null };
  }

  /** QR de pareamento (formato da resposta de `GET /instance/connect/{instance}` — conferir na Task 20). */
  async qr(): Promise<{ base64: string | null; pairingCode: string | null }> {
    const c = await this.cfg();
    if (!c) return { base64: null, pairingCode: null };
    try {
      const res = await fetch(`${c.url}/instance/connect/${encodeURIComponent(c.instance)}`, {
        headers: { apikey: c.apiKey },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return { base64: null, pairingCode: null };
      const j = (await res.json()) as { base64?: string; pairingCode?: string };
      return { base64: j.base64 ?? null, pairingCode: j.pairingCode ?? null };
    } catch {
      return { base64: null, pairingCode: null };
    }
  }
}
```

`ai-usage.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';

export const DEFAULT_DAILY_TOKEN_LIMIT = 500_000;

/** Dia civil no fuso de São Paulo (YYYY-MM-DD). */
function today(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
}

@Injectable()
export class AiUsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async usedToday(): Promise<number> {
    const r = await this.prisma.aiUsage.findUnique({ where: { day: today() } });
    return r ? r.inputTokens + r.outputTokens : 0;
  }

  async limit(): Promise<number> {
    const v = await this.settings.getNumber('ai.dailyTokenLimit');
    return v && v > 0 ? v : DEFAULT_DAILY_TOKEN_LIMIT;
  }

  async isPaused(): Promise<boolean> {
    return (await this.usedToday()) >= (await this.limit());
  }

  async add(inputTokens: number, outputTokens: number): Promise<void> {
    const day = today();
    await this.prisma.aiUsage.upsert({
      where: { day },
      create: { day, inputTokens, outputTokens, calls: 1 },
      update: {
        inputTokens: { increment: inputTokens },
        outputTokens: { increment: outputTokens },
        calls: { increment: 1 },
      },
    });
  }
}
```

`whatsapp-status.controller.ts`:

```ts
import { Controller, Get } from '@nestjs/common';
import { Roles } from '../common/roles.decorator.js';
import { EvolutionStatusService } from './evolution-status.service.js';
import { AiUsageService } from './ai-usage.service.js';

@Controller('whatsapp')
export class WhatsappStatusController {
  constructor(
    private readonly status: EvolutionStatusService,
    private readonly usage: AiUsageService,
  ) {}

  @Get('status')
  @Roles('ADMIN', 'AGENT')
  async get() {
    const [connection, usedToday, limit] = await Promise.all([
      this.status.check(),
      this.usage.usedToday(),
      this.usage.limit(),
    ]);
    return { connection, ai: { usedToday, limit, paused: usedToday >= limit } };
  }

  @Get('qr')
  @Roles('ADMIN')
  qr() {
    return this.status.qr();
  }
}
```

No `whatsapp.module.ts`: importar os três e adicionar `WhatsappStatusController` em `controllers` e `EvolutionStatusService, AiUsageService` em `providers`.

- [ ] **Step 4: Rodar e ver passar**

Run: `cd /c/Users/renan/os-exec/backend && npx vitest run src/whatsapp && npm run build`
Expected: PASS e build limpo.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/renan/os-exec && git add backend/src/whatsapp
git commit -m "feat(whatsapp): estado da conexão, QR e controle de uso da IA"
```

---

### Task 10: Classificador de IA (Claude Haiku 5.5)

**Files:**
- Modify: `backend/package.json` (deps `@anthropic-ai/sdk`, `zod`)
- Create: `backend/src/whatsapp/ai-classifier.service.ts`, `backend/src/whatsapp/ai-classifier.service.spec.ts`

**Interfaces:**
- Consumes: `SettingsService.get('ai.anthropicApiKey')`.
- Produces:
  ```ts
  export const MODEL = 'claude-haiku-5-5';
  export interface ChatLine { sender: string; text: string }
  export interface ClassifyInput { clientName: string; context: ChatLine[]; pending: ChatLine[] }
  export interface TriageItem { messageIndexes: number[]; isRequest: boolean; urgency: number; sentiment: number; summary: string }
  export interface ClassifyOutput { items: TriageItem[]; inputTokens: number; outputTokens: number }
  export class AiNotConfiguredError extends Error {}
  export function buildUserPrompt(input: ClassifyInput): string;
  export function sanitizeItems(raw: unknown, pendingCount: number): TriageItem[];
  AiClassifierService.classify(input: ClassifyInput): Promise<ClassifyOutput>;
  ```

- [ ] **Step 1: Instalar as dependências**

Run: `cd /c/Users/renan/os-exec/backend && npm install @anthropic-ai/sdk zod`
Expected: `package.json` e `package-lock.json` atualizados. Conferir que `@anthropic-ai/sdk/helpers/zod` existe: `ls node_modules/@anthropic-ai/sdk/helpers/zod*`.

- [ ] **Step 2: Escrever os testes**

```ts
import { AiClassifierService, AiNotConfiguredError, buildUserPrompt, sanitizeItems } from './ai-classifier.service.js';

describe('buildUserPrompt', () => {
  it('numera só as mensagens novas e separa o contexto', () => {
    const p = buildUserPrompt({
      clientName: 'Acme',
      context: [{ sender: 'Ana', text: 'bom dia' }],
      pending: [{ sender: 'Beto', text: 'a internet caiu' }, { sender: 'Ana', text: 'e o wifi também' }],
    });
    expect(p).toContain('Cliente: Acme');
    expect(p).toContain('Ana: bom dia');
    expect(p).toContain('[0] Beto: a internet caiu');
    expect(p).toContain('[1] Ana: e o wifi também');
    expect(p.indexOf('Contexto')).toBeLessThan(p.indexOf('[0]'));
  });
});

describe('sanitizeItems', () => {
  it('descarta índices fora do intervalo/duplicados e limita faixas', () => {
    const items = sanitizeItems(
      [{ messageIndexes: [0, 0, 7, -1, 1.5, 1], isRequest: true, urgency: 9, sentiment: -3, summary: '  Internet caiu  ' }],
      2,
    );
    expect(items).toEqual([{ messageIndexes: [0, 1], isRequest: true, urgency: 5, sentiment: -1, summary: 'Internet caiu' }]);
  });

  it('item sem nenhum índice válido ou sem resumo é descartado', () => {
    expect(sanitizeItems([{ messageIndexes: [9], isRequest: true, urgency: 3, sentiment: 0, summary: 'x' }], 2)).toEqual([]);
    expect(sanitizeItems([{ messageIndexes: [0], isRequest: true, urgency: 3, sentiment: 0, summary: '   ' }], 2)).toEqual([]);
  });

  it('urgência vira inteira de 1 a 5; lixo vira lista vazia', () => {
    const [i] = sanitizeItems([{ messageIndexes: [0], isRequest: false, urgency: 2.6, sentiment: 0.2, summary: 'ok' }], 1);
    expect(i.urgency).toBe(3);
    expect(sanitizeItems('lixo', 1)).toEqual([]);
    expect(sanitizeItems(null, 1)).toEqual([]);
  });
});

describe('AiClassifierService', () => {
  it('sem chave configurada → AiNotConfiguredError (e nunca chama a API)', async () => {
    const service = new AiClassifierService({ get: vi.fn().mockResolvedValue(undefined) } as any);
    await expect(service.classify({ clientName: 'A', context: [], pending: [{ sender: 'x', text: 'y' }] })).rejects.toBeInstanceOf(AiNotConfiguredError);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd /c/Users/renan/os-exec/backend && npx vitest run src/whatsapp/ai-classifier.service.spec.ts`
Expected: FAIL.

- [ ] **Step 4: Implementar**

`ai-classifier.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { SettingsService } from '../settings/settings.service.js';

export const MODEL = 'claude-haiku-5-5';

export interface ChatLine {
  sender: string;
  text: string;
}
export interface ClassifyInput {
  clientName: string;
  /** Mensagens anteriores, só para entender o assunto. NÃO são classificadas. */
  context: ChatLine[];
  /** Mensagens novas; a IA devolve índices (0..n-1) referentes a esta lista. */
  pending: ChatLine[];
}
export interface TriageItem {
  messageIndexes: number[];
  isRequest: boolean;
  urgency: number;
  sentiment: number;
  summary: string;
}
export interface ClassifyOutput {
  items: TriageItem[];
  inputTokens: number;
  outputTokens: number;
}

export class AiNotConfiguredError extends Error {
  constructor() {
    super('Chave da API da Anthropic não configurada (Configurações > WhatsApp).');
    this.name = 'AiNotConfiguredError';
  }
}

// Faixas (1-5, -1..1) não vão no schema: restrições numéricas variam no suporte a saída
// estruturada. `sanitizeItems` aplica os limites depois.
const Schema = z.object({
  items: z.array(
    z.object({
      message_indexes: z.array(z.number()),
      is_request: z.boolean(),
      urgency: z.number(),
      sentiment: z.number(),
      summary: z.string(),
    }),
  ),
});

const SYSTEM_PROMPT = `Você faz a triagem de mensagens de um grupo de WhatsApp de suporte entre uma empresa de informática e segurança eletrônica e um cliente.

Para cada ASSUNTO distinto nas mensagens NOVAS, devolva um item com:
- message_indexes: os índices (como aparecem entre colchetes) das mensagens novas que compõem o assunto;
- is_request: true se o cliente pede ajuda, reporta um problema ou reclama; false para conversa, agradecimento ou simples informação;
- urgency: de 1 a 5 (5 = parada total ou segurança em risco; 3 = problema que atrapalha; 1 = pedido sem pressa);
- sentiment: de -1 (muito insatisfeito) a 1 (muito satisfeito);
- summary: uma frase objetiva em português para servir de título do chamado.

Use as mensagens de CONTEXTO apenas para entender o assunto; nunca as classifique. Mensagens sem conteúdo relevante não precisam de item. Não invente fatos.`;

export function buildUserPrompt(input: ClassifyInput): string {
  const ctx = input.context.length
    ? input.context.map((l) => `${l.sender}: ${l.text}`).join('\n')
    : '(sem contexto anterior)';
  const novas = input.pending.map((l, i) => `[${i}] ${l.sender}: ${l.text}`).join('\n');
  return `Cliente: ${input.clientName}\n\nContexto (já tratado — não classificar):\n${ctx}\n\nMensagens novas:\n${novas}`;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Aplica limites e descarta o que não faz sentido (índice inválido, resumo vazio). */
export function sanitizeItems(raw: unknown, pendingCount: number): TriageItem[] {
  if (!Array.isArray(raw)) return [];
  const out: TriageItem[] = [];
  for (const r of raw) {
    if (typeof r !== 'object' || r === null) continue;
    const o = r as Record<string, unknown>;
    const idx = Array.isArray(o.messageIndexes) ? o.messageIndexes : [];
    const messageIndexes = [
      ...new Set(idx.filter((i): i is number => Number.isInteger(i) && i >= 0 && i < pendingCount)),
    ].sort((a, b) => a - b);
    const summary = typeof o.summary === 'string' ? o.summary.trim() : '';
    if (!messageIndexes.length || !summary) continue;
    out.push({
      messageIndexes,
      isRequest: o.isRequest === true,
      urgency: Math.round(clamp(Number(o.urgency) || 1, 1, 5)),
      sentiment: clamp(Number(o.sentiment) || 0, -1, 1),
      summary,
    });
  }
  return out;
}

@Injectable()
export class AiClassifierService {
  constructor(private readonly settings: SettingsService) {}

  async classify(input: ClassifyInput): Promise<ClassifyOutput> {
    const apiKey = await this.settings.get('ai.anthropicApiKey');
    if (!apiKey) throw new AiNotConfiguredError();

    const client = new Anthropic({ apiKey });
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(input) }],
      output_config: { effort: 'low', format: zodOutputFormat(Schema) },
    });
    if (response.stop_reason === 'refusal' || !response.parsed_output) {
      throw new Error('Resposta da IA recusada ou fora do formato.');
    }
    const items = response.parsed_output.items.map((i) => ({
      messageIndexes: i.message_indexes,
      isRequest: i.is_request,
      urgency: i.urgency,
      sentiment: i.sentiment,
      summary: i.summary,
    }));
    return {
      items: sanitizeItems(items, input.pending.length),
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `cd /c/Users/renan/os-exec/backend && npx vitest run src/whatsapp/ai-classifier.service.spec.ts && npm run build`
Expected: PASS e build limpo (se o `tsc` reclamar do tipo de `output_config`/`messages.parse`, abrir `node_modules/@anthropic-ai/sdk` e ajustar ao tipo real — a forma `messages.parse` + `zodOutputFormat` está na documentação da skill claude-api).

- [ ] **Step 6: Commit**

```bash
cd /c/Users/renan/os-exec && git add backend/package.json backend/package-lock.json backend/src/whatsapp
git commit -m "feat(whatsapp): classificador de mensagens com Claude Haiku 5.5"
```

---

### Task 11: Triagem em lote, crons e retenção

**Files:**
- Create: `backend/src/whatsapp/triage.service.ts`, `backend/src/whatsapp/triage.service.spec.ts`
- Create: `backend/src/whatsapp/whatsapp.cron.ts`, `backend/src/whatsapp/whatsapp.cron.spec.ts`
- Modify: `backend/src/whatsapp/whatsapp.module.ts`

**Interfaces:**
- Consumes: `isTrivial` (Task 3), `AiClassifierService`/`AiNotConfiguredError`/`ChatLine` (Task 10), `AiUsageService` (Task 9), `EvolutionStatusService.check` (Task 9).
- Produces: `TriageService.run(): Promise<void>`; `WhatsappCron` (`triageRun`, `statusCheck`, `retention`).

- [ ] **Step 1: Escrever os testes da triagem**

```ts
import { AiNotConfiguredError } from './ai-classifier.service.js';
import { TriageService } from './triage.service.js';

const group = { id: 'g1', clientId: 'c1', client: { name: 'Acme' } };
const m = (id: string, body: string, over: any = {}) => ({
  id, body, senderName: 'Beto', senderPhone: '55', sentAt: new Date(`2026-10-11T12:0${id.slice(1)}:00Z`), ...over,
});

function make(over: { pending?: any[]; context?: any[]; paused?: boolean; classify?: any } = {}) {
  const prisma: any = {
    whatsappGroup: { findMany: vi.fn().mockResolvedValue([group]) },
    whatsappMessage: {
      findMany: vi.fn().mockImplementation(({ where }: any) =>
        Promise.resolve(where.aiStatus === 'PENDING' ? (over.pending ?? []) : (over.context ?? [])),
      ),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      update: vi.fn().mockResolvedValue({}),
    },
    ticketSuggestion: { create: vi.fn().mockResolvedValue({}) },
  };
  prisma.$transaction = vi.fn().mockImplementation((fn: any) => fn(prisma));
  const classifier = {
    classify: over.classify ?? vi.fn().mockResolvedValue({ items: [], inputTokens: 100, outputTokens: 10 }),
  };
  const usage = { isPaused: vi.fn().mockResolvedValue(over.paused ?? false), add: vi.fn().mockResolvedValue(undefined) };
  return { service: new TriageService(prisma, classifier as any, usage as any), prisma, classifier, usage };
}

describe('TriageService.run', () => {
  it('pausado pelo teto diário → não chama a IA', async () => {
    const { service, classifier } = make({ paused: true, pending: [m('m1', 'a rede caiu')] });
    await service.run();
    expect(classifier.classify).not.toHaveBeenCalled();
  });

  it('triviais viram SKIPPED e não vão para a IA', async () => {
    const { service, prisma, classifier } = make({ pending: [m('m1', 'ok'), m('m2', 'bom dia')] });
    await service.run();
    expect(classifier.classify).not.toHaveBeenCalled();
    expect(prisma.whatsappMessage.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['m1', 'm2'] } },
      data: { aiStatus: 'SKIPPED' },
    });
  });

  it('envia pendentes úteis com contexto; cria sugestão e marca ANALYZED', async () => {
    const classify = vi.fn().mockResolvedValue({
      items: [{ messageIndexes: [0, 1], isRequest: true, urgency: 4, sentiment: -0.6, summary: 'Internet caiu no escritório' }],
      inputTokens: 300,
      outputTokens: 40,
    });
    const { service, prisma, usage } = make({
      classify,
      pending: [m('m1', 'a internet caiu'), m('m2', 'ninguém consegue acessar'), m('m3', 'ok')],
      context: [m('m0', 'bom dia pessoal')],
    });
    await service.run();

    const input = classify.mock.calls[0][0];
    expect(input.clientName).toBe('Acme');
    expect(input.pending.map((l: any) => l.text)).toEqual(['a internet caiu', 'ninguém consegue acessar']);
    expect(input.context.map((l: any) => l.text)).toEqual(['bom dia pessoal']);
    expect(usage.add).toHaveBeenCalledWith(300, 40);

    const s = prisma.ticketSuggestion.create.mock.calls[0][0].data;
    expect(s).toMatchObject({ groupId: 'g1', clientId: 'c1', messageIds: ['m1', 'm2'], urgency: 4, summary: 'Internet caiu no escritório' });
    expect(s.excerpt).toContain('a internet caiu');
    expect(prisma.whatsappMessage.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['m1', 'm2'] } },
      data: { aiStatus: 'ANALYZED' },
    });
  });

  it('item que não é pedido não gera sugestão, mas a mensagem é ANALYZED com sentimento', async () => {
    const classify = vi.fn().mockResolvedValue({
      items: [{ messageIndexes: [0], isRequest: false, urgency: 1, sentiment: 0.8, summary: 'Agradecimento' }],
      inputTokens: 50, outputTokens: 5,
    });
    const { service, prisma } = make({ classify, pending: [m('m1', 'muito obrigado pelo atendimento')] });
    await service.run();
    expect(prisma.ticketSuggestion.create).not.toHaveBeenCalled();
    expect(prisma.whatsappMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'm1' }, data: expect.objectContaining({ sentiment: 0.8 }) }),
    );
  });

  it('IA sem chave → mensagens ficam PENDING, sem contar tentativa', async () => {
    const { service, prisma } = make({
      classify: vi.fn().mockRejectedValue(new AiNotConfiguredError()),
      pending: [m('m1', 'a rede caiu')],
    });
    await service.run();
    expect(prisma.whatsappMessage.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { aiAttempts: { increment: 1 } } }),
    );
  });

  it('erro da IA → conta tentativa e marca FAILED quem chegou a 3', async () => {
    const { service, prisma } = make({
      classify: vi.fn().mockRejectedValue(new Error('rate limit')),
      pending: [m('m1', 'a rede caiu')],
    });
    await service.run();
    expect(prisma.whatsappMessage.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['m1'] } },
      data: { aiAttempts: { increment: 1 } },
    });
    expect(prisma.whatsappMessage.updateMany).toHaveBeenCalledWith({
      where: { groupId: 'g1', aiStatus: 'PENDING', aiAttempts: { gte: 3 } },
      data: { aiStatus: 'FAILED' },
    });
  });
});
```

`whatsapp.cron.spec.ts`:

```ts
import { WhatsappCron } from './whatsapp.cron.js';

function make(days?: number) {
  const prisma = { whatsappMessage: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) } };
  const settings = { getNumber: vi.fn().mockResolvedValue(days) };
  const triage = { run: vi.fn().mockResolvedValue(undefined) };
  const status = { check: vi.fn().mockResolvedValue({}) };
  return { cron: new WhatsappCron(triage as any, status as any, prisma as any, settings as any), prisma, triage, status };
}

describe('WhatsappCron', () => {
  it('retenção apaga mensagens mais antigas que o configurado (padrão 90 dias)', async () => {
    const { cron, prisma } = make();
    const before = Date.now();
    await cron.retention();
    const cutoff: Date = prisma.whatsappMessage.deleteMany.mock.calls[0][0].where.sentAt.lt;
    expect(before - cutoff.getTime()).toBeGreaterThanOrEqual(90 * 24 * 3600_000 - 1000);
  });

  it('retenção configurada é respeitada; valor inválido (0) cai no padrão', async () => {
    const a = make(30);
    await a.cron.retention();
    const c1: Date = a.prisma.whatsappMessage.deleteMany.mock.calls[0][0].where.sentAt.lt;
    expect(Date.now() - c1.getTime()).toBeLessThan(31 * 24 * 3600_000);
    const b = make(0);
    await b.cron.retention();
    const c2: Date = b.prisma.whatsappMessage.deleteMany.mock.calls[0][0].where.sentAt.lt;
    expect(Date.now() - c2.getTime()).toBeGreaterThan(89 * 24 * 3600_000);
  });

  it('triageRun e statusCheck delegam', async () => {
    const { cron, triage, status } = make();
    await cron.triageRun();
    await cron.statusCheck();
    expect(triage.run).toHaveBeenCalled();
    expect(status.check).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /c/Users/renan/os-exec/backend && npx vitest run src/whatsapp/triage.service.spec.ts src/whatsapp/whatsapp.cron.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar a triagem**

`triage.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AiClassifierService, AiNotConfiguredError } from './ai-classifier.service.js';
import { AiUsageService } from './ai-usage.service.js';
import { isTrivial } from './text.util.js';

const BATCH = 40; // mensagens pendentes por chamada
const CONTEXT = 6; // mensagens anteriores só para contexto
const MAX_ATTEMPTS = 3;

@Injectable()
export class TriageService {
  private readonly logger = new Logger(TriageService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly classifier: AiClassifierService,
    private readonly usage: AiUsageService,
  ) {}

  /** Uma rodada: processa os grupos com mensagens PENDING, respeitando o teto diário. */
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      if (await this.usage.isPaused()) {
        this.logger.warn('Teto diário de tokens da IA atingido — triagem pausada até amanhã.');
        return;
      }
      const groups = await this.prisma.whatsappGroup.findMany({
        where: { active: true, messages: { some: { aiStatus: 'PENDING' } } },
        include: { client: { select: { name: true } } },
      });
      for (const g of groups) {
        if (await this.usage.isPaused()) break;
        await this.triageGroup(g).catch((err) =>
          this.logger.error(`Falha ao triar o grupo ${g.id}: ${(err as Error).message}`),
        );
      }
    } finally {
      this.running = false;
    }
  }

  private async triageGroup(g: { id: string; clientId: string; client: { name: string } }) {
    const pending = await this.prisma.whatsappMessage.findMany({
      where: { groupId: g.id, aiStatus: 'PENDING' },
      orderBy: { sentAt: 'asc' },
      take: BATCH,
    });
    const useful = pending.filter((m) => m.body && !isTrivial(m.body));
    const trivialIds = pending.filter((m) => !useful.includes(m)).map((m) => m.id);
    if (trivialIds.length) {
      await this.prisma.whatsappMessage.updateMany({ where: { id: { in: trivialIds } }, data: { aiStatus: 'SKIPPED' } });
    }
    if (!useful.length) return;

    const before = await this.prisma.whatsappMessage.findMany({
      where: { groupId: g.id, sentAt: { lt: useful[0].sentAt }, body: { not: null } },
      orderBy: { sentAt: 'desc' },
      take: CONTEXT,
    });
    const line = (m: { senderName: string | null; senderPhone: string; body: string | null }) => ({
      sender: m.senderName ?? (m.senderPhone || 'alguém'),
      text: m.body ?? '',
    });

    let out;
    try {
      out = await this.classifier.classify({
        clientName: g.client.name,
        context: before.reverse().map(line),
        pending: useful.map(line),
      });
    } catch (err) {
      if (err instanceof AiNotConfiguredError) {
        this.logger.warn(err.message);
        return; // segue PENDING, sem gastar tentativas
      }
      this.logger.error(`IA falhou no grupo ${g.id}: ${(err as Error).message}`);
      const ids = useful.map((m) => m.id);
      await this.prisma.whatsappMessage.updateMany({ where: { id: { in: ids } }, data: { aiAttempts: { increment: 1 } } });
      await this.prisma.whatsappMessage.updateMany({
        where: { groupId: g.id, aiStatus: 'PENDING', aiAttempts: { gte: MAX_ATTEMPTS } },
        data: { aiStatus: 'FAILED' },
      });
      return;
    }

    await this.usage.add(out.inputTokens, out.outputTokens);
    await this.prisma.$transaction(async (tx) => {
      for (const item of out.items) {
        const msgs = item.messageIndexes.map((i) => useful[i]);
        for (const msg of msgs) {
          await tx.whatsappMessage.update({
            where: { id: msg.id },
            data: { sentiment: item.sentiment, aiResult: item as unknown as Prisma.InputJsonValue },
          });
        }
        if (item.isRequest) {
          await tx.ticketSuggestion.create({
            data: {
              groupId: g.id,
              clientId: g.clientId,
              messageIds: msgs.map((x) => x.id),
              excerpt: msgs.map((x) => `${x.senderName ?? x.senderPhone}: ${x.body}`).join('\n').slice(0, 1000),
              urgency: item.urgency,
              sentiment: item.sentiment,
              summary: item.summary,
            },
          });
        }
      }
      // ponytail: toda mensagem útil enviada vira ANALYZED (a IA viu, com ou sem assunto).
      await tx.whatsappMessage.updateMany({
        where: { id: { in: useful.map((m) => m.id) } },
        data: { aiStatus: 'ANALYZED' },
      });
    });
  }
}
```

`whatsapp.cron.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { TriageService } from './triage.service.js';
import { EvolutionStatusService } from './evolution-status.service.js';

const DEFAULT_RETENTION_DAYS = 90;

@Injectable()
export class WhatsappCron {
  private readonly logger = new Logger(WhatsappCron.name);

  constructor(
    private readonly triage: TriageService,
    private readonly status: EvolutionStatusService,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  @Cron('*/5 * * * *')
  async triageRun(): Promise<void> {
    await this.triage.run();
  }

  /** Mantém o instante da queda atualizado mesmo sem ninguém olhando a tela. */
  @Cron('*/5 * * * *')
  async statusCheck(): Promise<void> {
    await this.status.check();
  }

  @Cron('30 3 * * *')
  async retention(): Promise<void> {
    const configured = await this.settings.getNumber('whatsapp.retentionDays');
    const days = configured && configured >= 1 ? configured : DEFAULT_RETENTION_DAYS;
    const cutoff = new Date(Date.now() - days * 24 * 3600_000);
    const { count } = await this.prisma.whatsappMessage.deleteMany({ where: { sentAt: { lt: cutoff } } });
    if (count) this.logger.log(`Retenção: ${count} mensagens apagadas (mais de ${days} dias).`);
  }
}
```

No `whatsapp.module.ts`: importar e acrescentar aos `providers`: `AiClassifierService, TriageService, WhatsappCron`.

- [ ] **Step 4: Rodar e ver passar**

Run: `cd /c/Users/renan/os-exec/backend && npx vitest run src/whatsapp && npm run build`
Expected: PASS e build limpo.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/renan/os-exec && git add backend/src/whatsapp
git commit -m "feat(whatsapp): triagem em lote por IA, crons e retenção"
```

---

### Task 12: Sugestões (aceitar/descartar) e mensagens de um chamado

**Files:**
- Create: `backend/src/whatsapp/dto/suggestion.dto.ts`
- Create: `backend/src/whatsapp/suggestions.service.ts`, `backend/src/whatsapp/suggestions.service.spec.ts`
- Create: `backend/src/whatsapp/suggestions.controller.ts`
- Create: `backend/src/whatsapp/whatsapp-messages.controller.ts`
- Modify: `backend/src/whatsapp/whatsapp.module.ts`

**Interfaces:**
- Consumes: `TicketsService.create`.
- Produces: `SuggestionsService.list(status?)`, `accept(id, actorId, dto)`, `discard(id, actorId)`; `priorityFromUrgency(u): TicketPriority`.
- Produces: rotas `GET /whatsapp/suggestions?status=`, `POST /whatsapp/suggestions/:id/accept`, `POST /whatsapp/suggestions/:id/discard`, `GET /whatsapp/messages?ticketId=`.

- [ ] **Step 1: Escrever os testes**

```ts
import { ConflictException, NotFoundException } from '@nestjs/common';
import { SuggestionsService, priorityFromUrgency } from './suggestions.service.js';

const suggestion = {
  id: 's1', groupId: 'g1', clientId: 'c1', messageIds: ['m1', 'm2'],
  excerpt: 'Beto: a internet caiu', urgency: 4, summary: 'Internet caiu', status: 'OPEN',
};

function make(over: { found?: any; claimed?: number; createError?: Error } = {}) {
  const prisma = {
    ticketSuggestion: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue('found' in over ? over.found : suggestion),
      updateMany: vi.fn().mockResolvedValue({ count: over.claimed ?? 1 }),
      update: vi.fn().mockResolvedValue({}),
    },
    whatsappMessage: {
      findFirst: vi.fn().mockResolvedValue({ senderUserId: 'u7' }),
      updateMany: vi.fn().mockResolvedValue({}),
    },
  };
  const tickets = {
    create: over.createError ? vi.fn().mockRejectedValue(over.createError) : vi.fn().mockResolvedValue({ id: 't1', number: '2026-0001' }),
  };
  return { service: new SuggestionsService(prisma as any, tickets as any), prisma, tickets };
}

describe('priorityFromUrgency', () => {
  it.each([[5, 'URGENT'], [4, 'HIGH'], [3, 'MEDIUM'], [2, 'LOW'], [1, 'LOW']])('urgência %i → %s', (u, p) => {
    expect(priorityFromUrgency(u)).toBe(p);
  });
});

describe('SuggestionsService', () => {
  it('lista por status (padrão OPEN), mais urgentes primeiro', async () => {
    const { service, prisma } = make();
    await service.list();
    const arg = prisma.ticketSuggestion.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ status: 'OPEN' });
    expect(arg.orderBy).toEqual([{ urgency: 'desc' }, { createdAt: 'asc' }]);
  });

  it('aceitar cria o chamado WHATSAPP, vincula as mensagens e registra a decisão', async () => {
    const { service, prisma, tickets } = make();
    const t = await service.accept('s1', 'admin1', { categoryId: 'cat1' });
    expect(t.id).toBe('t1');
    expect(tickets.create).toHaveBeenCalledWith({
      origin: 'WHATSAPP', clientId: 'c1', requesterId: 'u7',
      title: 'Internet caiu', description: 'Beto: a internet caiu', categoryId: 'cat1', priority: 'HIGH',
    });
    expect(prisma.ticketSuggestion.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 's1', status: 'OPEN' }, data: { status: 'ACCEPTED', decidedById: 'admin1' },
    });
    expect(prisma.whatsappMessage.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['m1', 'm2'] } }, data: { ticketId: 't1' } });
  });

  it('título informado pelo técnico prevalece sobre o resumo', async () => {
    const { service, tickets } = make();
    await service.accept('s1', 'admin1', { title: '  Internet fora do ar  ' });
    expect(tickets.create.mock.calls[0][0].title).toBe('Internet fora do ar');
  });

  it('sugestão inexistente → 404; já decidida → 409 e nenhum chamado criado', async () => {
    const a = make({ found: null });
    await expect(a.service.accept('x', 'u', {})).rejects.toBeInstanceOf(NotFoundException);
    const b = make({ claimed: 0 });
    await expect(b.service.accept('s1', 'u', {})).rejects.toBeInstanceOf(ConflictException);
    expect(b.tickets.create).not.toHaveBeenCalled();
  });

  it('se criar o chamado falha, a sugestão volta para OPEN', async () => {
    const { service, prisma } = make({ createError: new Error('boom') });
    await expect(service.accept('s1', 'u', {})).rejects.toThrow('boom');
    expect(prisma.ticketSuggestion.updateMany).toHaveBeenLastCalledWith({
      where: { id: 's1', status: 'ACCEPTED', ticketId: null },
      data: { status: 'OPEN', decidedById: null, decidedAt: null },
    });
  });

  it('descartar usa a mesma barreira atômica', async () => {
    const { service, prisma } = make();
    await service.discard('s1', 'admin1');
    expect(prisma.ticketSuggestion.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 's1', status: 'OPEN' }, data: { status: 'DISCARDED', decidedById: 'admin1' },
    });
    await expect(make({ claimed: 0 }).service.discard('s1', 'u')).rejects.toBeInstanceOf(ConflictException);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /c/Users/renan/os-exec/backend && npx vitest run src/whatsapp/suggestions.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`dto/suggestion.dto.ts`:

```ts
import { IsOptional, IsString } from 'class-validator';

export class AcceptSuggestionDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;
}
```

`suggestions.service.ts`:

```ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { SuggestionStatus, TicketPriority } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TicketsService } from '../tickets/tickets.service.js';
import type { AcceptSuggestionDto } from './dto/suggestion.dto.js';

export function priorityFromUrgency(u: number): TicketPriority {
  if (u >= 5) return 'URGENT';
  if (u === 4) return 'HIGH';
  if (u === 3) return 'MEDIUM';
  return 'LOW';
}

@Injectable()
export class SuggestionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: TicketsService,
  ) {}

  list(status: SuggestionStatus = 'OPEN') {
    return this.prisma.ticketSuggestion.findMany({
      where: { status },
      orderBy: [{ urgency: 'desc' }, { createdAt: 'asc' }],
      take: 200,
      include: {
        group: { select: { name: true, externalId: true } },
        client: { select: { id: true, name: true } },
      },
    });
  }

  /** Barreira atômica: só quem muda OPEN → novo status prossegue (clique duplo/2 técnicos). */
  private async claim(id: string, status: 'ACCEPTED' | 'DISCARDED', actorId: string) {
    const r = await this.prisma.ticketSuggestion.updateMany({
      where: { id, status: 'OPEN' },
      data: { status, decidedById: actorId, decidedAt: new Date() },
    });
    if (r.count === 0) throw new ConflictException('Esta sugestão já foi decidida.');
  }

  async accept(id: string, actorId: string, dto: AcceptSuggestionDto) {
    const s = await this.prisma.ticketSuggestion.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Sugestão não encontrada.');
    await this.claim(id, 'ACCEPTED', actorId);
    try {
      const first = await this.prisma.whatsappMessage.findFirst({
        where: { id: { in: s.messageIds } },
        orderBy: { sentAt: 'asc' },
        select: { senderUserId: true },
      });
      const ticket = await this.tickets.create({
        origin: 'WHATSAPP',
        clientId: s.clientId,
        requesterId: first?.senderUserId ?? null,
        title: dto.title?.trim() || s.summary,
        description: s.excerpt,
        categoryId: dto.categoryId ?? null,
        priority: priorityFromUrgency(s.urgency),
      });
      await this.prisma.ticketSuggestion.update({ where: { id }, data: { ticketId: ticket.id } });
      await this.prisma.whatsappMessage.updateMany({ where: { id: { in: s.messageIds } }, data: { ticketId: ticket.id } });
      return ticket;
    } catch (err) {
      await this.prisma.ticketSuggestion.updateMany({
        where: { id, status: 'ACCEPTED', ticketId: null },
        data: { status: 'OPEN', decidedById: null, decidedAt: null },
      });
      throw err;
    }
  }

  async discard(id: string, actorId: string) {
    await this.claim(id, 'DISCARDED', actorId);
    return { ok: true };
  }
}
```

`suggestions.controller.ts`:

```ts
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import type { SuggestionStatus } from '@prisma/client';
import { Roles } from '../common/roles.decorator.js';
import { CurrentUser } from '../common/current-user.decorator.js';
import type { CurrentUserData } from '../common/current-user.decorator.js';
import { SuggestionsService } from './suggestions.service.js';
import { AcceptSuggestionDto } from './dto/suggestion.dto.js';

@Controller('whatsapp/suggestions')
@Roles('ADMIN', 'AGENT')
export class SuggestionsController {
  constructor(private readonly suggestions: SuggestionsService) {}

  @Get()
  list(@Query('status') status?: SuggestionStatus) {
    return this.suggestions.list(status);
  }

  @Post(':id/accept')
  accept(@Param('id') id: string, @Body() dto: AcceptSuggestionDto, @CurrentUser() actor: CurrentUserData) {
    return this.suggestions.accept(id, actor.id, dto);
  }

  @Post(':id/discard')
  discard(@Param('id') id: string, @CurrentUser() actor: CurrentUserData) {
    return this.suggestions.discard(id, actor.id);
  }
}
```

`whatsapp-messages.controller.ts` (leitura simples; sem service/teste próprio — é um `findMany` com `where`):

```ts
import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../common/roles.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('whatsapp/messages')
@Roles('ADMIN', 'AGENT')
export class WhatsappMessagesController {
  constructor(private readonly prisma: PrismaService) {}

  /** Mensagens de WhatsApp que originaram/foram anexadas a um chamado. */
  @Get()
  byTicket(@Query('ticketId') ticketId?: string) {
    if (!ticketId) throw new BadRequestException('ticketId é obrigatório.');
    return this.prisma.whatsappMessage.findMany({
      where: { ticketId },
      orderBy: { sentAt: 'asc' },
      take: 100,
      select: {
        id: true, senderName: true, senderPhone: true, body: true, sentAt: true,
        group: { select: { name: true } },
      },
    });
  }
}
```

No `whatsapp.module.ts`: adicionar `SuggestionsController, WhatsappMessagesController` a `controllers` e `SuggestionsService` a `providers`.

- [ ] **Step 4: Rodar e ver passar**

Run: `cd /c/Users/renan/os-exec/backend && npx vitest run src/whatsapp && npm run build`
Expected: PASS e build limpo.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/renan/os-exec && git add backend/src/whatsapp
git commit -m "feat(whatsapp): fila de sugestões (aceitar/descartar) e mensagens do chamado"
```

---

### Task 13: Teste de integração (Postgres real, DI completa)

**Files:**
- Create: `backend/src/whatsapp/whatsapp.integration.spec.ts`

**Interfaces:**
- Consumes: `AppModule` (todo o grafo de DI real), `WhatsappService`, rota `POST /api/whatsapp/webhook`.

- [ ] **Step 1: Escrever o teste**

```ts
import { randomBytes } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../app.module.js';
import { SettingsService } from '../settings/settings.service.js';

// INTEGRAÇÃO: Postgres real + grafo de DI completo (pega o tipo de falha que
// `new Service(mock)` e `nest build` não pegam). Sem banco no ar, pula com aviso.
const PFX = `WA-${Date.now()}`;
const GROUP = `${Date.now()}@g.us`;
const SECRET = 'segredo-de-teste';

let prisma: PrismaClient | undefined;
let app: INestApplication | undefined;
let available = false;
const id: Record<string, string> = {};

async function cleanup(p: PrismaClient) {
  await p.whatsappMessage.deleteMany({ where: { group: { externalId: GROUP } } });
  await p.ticketSuggestion.deleteMany({ where: { client: { name: { startsWith: PFX } } } });
  await p.whatsappGroup.deleteMany({ where: { externalId: GROUP } });
  await p.triggerPhrase.deleteMany({ where: { client: { name: { startsWith: PFX } } } });
  await p.ticketEvent.deleteMany({ where: { ticket: { client: { name: { startsWith: PFX } } } } });
  await p.ticket.deleteMany({ where: { client: { name: { startsWith: PFX } } } });
  await p.user.deleteMany({ where: { email: { endsWith: `@${PFX.toLowerCase()}.itest` } } });
  await p.client.deleteMany({ where: { name: { startsWith: PFX } } });
  await p.setting.deleteMany({ where: { key: 'whatsapp.webhookSecret' } });
}

const payload = (msgId: string, text: string, participant = '5519999991234@s.whatsapp.net') => ({
  event: 'messages.upsert',
  instance: 'os',
  data: {
    key: { remoteJid: GROUP, fromMe: false, id: msgId, participant },
    pushName: 'Fulano',
    message: { conversation: text },
    messageTimestamp: Math.floor(Date.now() / 1000),
  },
});

describe('WhatsApp — webhook até chamado (Postgres real)', () => {
  beforeAll(async () => {
    prisma = new PrismaClient();
    try {
      await prisma.$connect();
      available = true;
    } catch {
      console.warn('[whatsapp.integration] Postgres indisponível — pulando.');
      return;
    }
    process.env.APP_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
    await cleanup(prisma);

    const client = await prisma.client.create({ data: { name: `${PFX} Cliente` } });
    id.clientId = client.id;
    const contact = await prisma.user.create({
      data: {
        name: `${PFX} Contato`, email: `contato@${PFX.toLowerCase()}.itest`,
        type: 'CLIENT', role: 'CONTACT', clientId: client.id, phone: '551999991234', // sem o 9º dígito
      },
    });
    id.contactId = contact.id;
    await prisma.whatsappGroup.create({ data: { externalId: GROUP, clientId: client.id, name: 'Suporte' } });
    await prisma.triggerPhrase.create({
      data: { clientId: client.id, phrase: 'Sem conexão', phraseNorm: 'sem conexao', priority: 'HIGH', title: 'Sem internet' },
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
    await app.get(SettingsService).set('whatsapp.webhookSecret', SECRET);
  }, 60_000);

  afterAll(async () => {
    if (prisma && available) await cleanup(prisma);
    await prisma?.$disconnect();
    await app?.close();
  });

  const post = (body: unknown, secret = SECRET) =>
    request(app!.getHttpServer()).post('/whatsapp/webhook').set('x-webhook-secret', secret).send(body as object);

  it('segredo errado → 401', async () => {
    if (!available) return;
    await post(payload('X0', 'Sem conexão'), 'errado').expect(401);
  });

  it('gatilho cria o chamado WHATSAPP, vinculado ao contato pelo telefone', async () => {
    if (!available) return;
    const res = await post(payload('A1', 'SEM CONEXÃO - escritório sem rede')).expect(200);
    expect(res.body.ticketId).toBeTruthy();
    const t = await prisma!.ticket.findUnique({ where: { id: res.body.ticketId } });
    expect(t).toMatchObject({ origin: 'WHATSAPP', clientId: id.clientId, requesterId: id.contactId, priority: 'HIGH', title: 'Sem internet' });
    expect(t!.description).toContain('escritório sem rede');
    id.ticketId = t!.id;
  });

  it('reentrega do mesmo evento não duplica mensagem nem chamado', async () => {
    if (!available) return;
    await post(payload('A1', 'SEM CONEXÃO - escritório sem rede')).expect(200);
    expect(await prisma!.whatsappMessage.count({ where: { group: { externalId: GROUP } } })).toBe(1);
    expect(await prisma!.ticket.count({ where: { clientId: id.clientId } })).toBe(1);
  });

  it('mesma frase com chamado aberto vira evento no mesmo chamado', async () => {
    if (!available) return;
    await post(payload('A2', 'Sem conexão de novo, agora na recepção')).expect(200);
    expect(await prisma!.ticket.count({ where: { clientId: id.clientId } })).toBe(1);
    const ev = await prisma!.ticketEvent.findMany({ where: { ticketId: id.ticketId, type: 'WHATSAPP_IN' } });
    expect(ev).toHaveLength(1);
  });

  it('mensagem sem gatilho fica PENDING para a IA, de remetente desconhecido (LID)', async () => {
    if (!available) return;
    await post(payload('A3', 'a impressora parou', '99887766554433@lid')).expect(200);
    const m = await prisma!.whatsappMessage.findFirst({ where: { body: 'a impressora parou' } });
    expect(m).toMatchObject({ aiStatus: 'PENDING', senderPhone: '', senderUserId: null, ticketId: null });
  });

  it('grupo não cadastrado é ignorado sem gravar nada', async () => {
    if (!available) return;
    const other = payload('A4', 'Sem conexão');
    other.data.key.remoteJid = '999999999@g.us';
    await post(other).expect(200);
    expect(await prisma!.whatsappMessage.count({ where: { externalId: { contains: '999999999@g.us' } } })).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar**

Run: `cd /c/Users/renan/os-exec && docker compose up -d postgres && cd backend && npx vitest run --config ./vitest.config.integration.ts src/whatsapp`
Expected: PASS. Se o `AppModule` falhar ao subir por DI, **esse é o bug que o teste existe para pegar**: corrigir o `WhatsappModule` (imports/providers) e rodar de novo.

- [ ] **Step 3: Commit e checkpoint**

```bash
cd /c/Users/renan/os-exec && git add backend/src/whatsapp
git commit -m "test(whatsapp): integração do webhook ao chamado com Postgres real"
git push origin main && cd /z/Projetos/OS && git pull --ff-only
```

---

### Task 14: Frontend — base (lib, tipos, rótulos, telefone do contato)

**Files:**
- Create: `frontend/src/lib/whatsapp.ts`
- Modify: `frontend/src/lib/tickets.ts`, `frontend/src/components/ticket-timeline.tsx`, `frontend/src/components/contact-form.tsx`, `frontend/src/app/app/clientes/[id]/page.tsx` (somente `ContactsTab`)

**Interfaces:**
- Produces (`lib/whatsapp.ts`): tipos `WhatsappGroup`, `TriggerPhrase`, `Suggestion`, `WhatsappStatus`, `TicketWhatsappMessage`; hooks `useGroups(clientId)`, `useCreateGroup()`, `useUpdateGroup()`, `useRemoveGroup()`, `usePhrases(clientId | null)`, `useSavePhrase()`, `useRemovePhrase()`, `useApplyDefaults()`, `useWhatsappStatus()`, `useSuggestions()`, `useAcceptSuggestion()`, `useDiscardSuggestion()`, `useTicketMessages(ticketId)`.

- [ ] **Step 1: Criar `lib/whatsapp.ts`**

```ts
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { TicketPriority } from './tickets';

export interface WhatsappGroup {
  id: string;
  externalId: string;
  name: string | null;
  clientId: string;
  active: boolean;
}

export interface TriggerPhrase {
  id: string;
  clientId: string | null;
  phrase: string;
  categoryId: string | null;
  priority: TicketPriority;
  title: string | null;
  active: boolean;
}

export interface Suggestion {
  id: string;
  summary: string;
  excerpt: string;
  urgency: number;
  sentiment: number | null;
  createdAt: string;
  group: { name: string | null; externalId: string };
  client: { id: string; name: string };
}

export interface WhatsappStatus {
  connection: { configured: boolean; state: string; disconnectedSince: string | null };
  ai: { usedToday: number; limit: number; paused: boolean };
}

export interface TicketWhatsappMessage {
  id: string;
  senderName: string | null;
  senderPhone: string;
  body: string | null;
  sentAt: string;
  group: { name: string | null };
}

// --- grupos ---
export function useGroups(clientId: string) {
  return useQuery({
    queryKey: ['wa-groups', clientId],
    queryFn: () => api<WhatsappGroup[]>(`/whatsapp/groups?clientId=${clientId}`),
  });
}

export function useCreateGroup(clientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { externalId: string; name?: string }) =>
      api<WhatsappGroup>('/whatsapp/groups', { method: 'POST', body: { clientId, ...body } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wa-groups', clientId] }),
  });
}

export function useUpdateGroup(clientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; active?: boolean; name?: string }) => {
      const { id, ...body } = v;
      return api<WhatsappGroup>(`/whatsapp/groups/${id}`, { method: 'PATCH', body });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wa-groups', clientId] }),
  });
}

export function useRemoveGroup(clientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/whatsapp/groups/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wa-groups', clientId] }),
  });
}

// --- frases ---
export function usePhrases(clientId: string | null) {
  return useQuery({
    queryKey: ['wa-phrases', clientId],
    queryFn: () => api<TriggerPhrase[]>(`/whatsapp/phrases${clientId ? `?clientId=${clientId}` : ''}`),
  });
}

export interface PhraseInput {
  phrase: string;
  categoryId?: string | null;
  priority?: TicketPriority;
  title?: string | null;
  active?: boolean;
}

export function useSavePhrase(clientId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id?: string } & PhraseInput) => {
      const { id, ...body } = v;
      return id
        ? api<TriggerPhrase>(`/whatsapp/phrases/${id}`, { method: 'PATCH', body })
        : api<TriggerPhrase>('/whatsapp/phrases', {
            method: 'POST',
            body: { ...body, categoryId: body.categoryId || undefined, ...(clientId ? { clientId } : {}) },
          });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wa-phrases', clientId] }),
  });
}

export function useRemovePhrase(clientId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/whatsapp/phrases/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wa-phrases', clientId] }),
  });
}

export function useApplyDefaults(clientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<{ created: number }>('/whatsapp/phrases/apply-defaults', { method: 'POST', body: { clientId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wa-phrases', clientId] }),
  });
}

// --- status e triagem ---
export function useWhatsappStatus() {
  return useQuery({
    queryKey: ['wa-status'],
    queryFn: () => api<WhatsappStatus>('/whatsapp/status'),
    refetchInterval: 60_000,
  });
}

export function useSuggestions() {
  return useQuery({
    queryKey: ['wa-suggestions'],
    queryFn: () => api<Suggestion[]>('/whatsapp/suggestions'),
    refetchInterval: 30_000,
  });
}

export function useAcceptSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; title?: string; categoryId?: string }) => {
      const { id, ...body } = v;
      return api<{ id: string; number: string }>(`/whatsapp/suggestions/${id}/accept`, { method: 'POST', body });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wa-suggestions'] }),
  });
}

export function useDiscardSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ ok: boolean }>(`/whatsapp/suggestions/${id}/discard`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wa-suggestions'] }),
  });
}

export function useTicketMessages(ticketId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['wa-ticket-messages', ticketId],
    queryFn: () => api<TicketWhatsappMessage[]>(`/whatsapp/messages?ticketId=${ticketId}`),
    enabled,
  });
}
```

- [ ] **Step 2: Tipos e rótulos do chamado**

Em `lib/tickets.ts`:
- `export type TicketOrigin = 'EMAIL' | 'PORTAL' | 'MANUAL' | 'CONTRACT' | 'WHATSAPP';`
- em `ORIGIN_LABELS`, acrescentar `WHATSAPP: 'WhatsApp',`
- em `TicketEvent['type']`, acrescentar `| 'WHATSAPP_IN'` depois de `'EMAIL_OUT'`.
- em `PublicUser`, acrescentar `phone?: string | null;`

Em `components/ticket-timeline.tsx`:
- em `EVENT_TAGS`: `WHATSAPP_IN: 'WhatsApp',`
- em `eventText`, antes de `case 'VISIT_SCHEDULED':`:

```tsx
    case 'WHATSAPP_IN':
      return `WhatsApp — ${d.sender ?? 'alguém'}: ${d.text ?? ''}`;
```

- [ ] **Step 3: Telefone no formulário de contato e na lista**

`components/contact-form.tsx`: em `ContactValues` acrescentar `phone: string;`; criar `const [phone, setPhone] = useState('');`; no `onSubmit` enviar `{ name: name.trim(), email: email.trim(), role, phone: phone.trim() }`; e, depois do campo de e-mail, acrescentar:

```tsx
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ct-phone">Telefone / WhatsApp</Label>
        <Input
          id="ct-phone"
          placeholder="(19) 99999-1234"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>
```

`app/app/clientes/[id]/page.tsx`, em `ContactsTab`:
1. `const [editingPhone, setEditingPhone] = useState<PublicUser | null>(null); const [phoneValue, setPhoneValue] = useState('');`
2. nova mutation, ao lado de `setActive`:

```tsx
  const savePhone = useMutation({
    mutationFn: (v: { id: string; phone: string }) =>
      api(`/users/${v.id}`, { method: 'PATCH', body: { phone: v.phone } }),
    onSuccess: () => {
      invalidate();
      setEditingPhone(null);
      toast.success('Telefone atualizado.');
    },
    onError: errToast,
  });
```

3. coluna `<th ...>Telefone</th>` entre "E-mail" e "Papel" (e `colSpan={6}` na linha vazia), com `<td className="px-3 py-2 text-muted-foreground">{c.phone ?? '—'}</td>`;
4. botão na célula de ações, antes de "Reenviar convite":

```tsx
                    <button
                      type="button"
                      className="text-primary hover:underline"
                      onClick={() => {
                        setEditingPhone(c);
                        setPhoneValue(c.phone ?? '');
                      }}
                    >
                      Telefone
                    </button>
```

5. diálogo, depois do `Dialog` de "Novo contato":

```tsx
      <Dialog open={!!editingPhone} onClose={() => setEditingPhone(null)} title="Telefone do contato">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Usado para reconhecer quem escreve nos grupos de WhatsApp. {editingPhone?.name}
          </p>
          <Input
            aria-label="Telefone"
            placeholder="(19) 99999-1234"
            value={phoneValue}
            onChange={(e) => setPhoneValue(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              disabled={savePhone.isPending}
              onClick={() => editingPhone && savePhone.mutate({ id: editingPhone.id, phone: phoneValue })}
            >
              Salvar
            </Button>
            <Button variant="outline" onClick={() => setEditingPhone(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      </Dialog>
```

e `import { Input } from '@/components/ui/input';` no topo do arquivo.

- [ ] **Step 4: Verificar tipos**

Run: `cd /c/Users/renan/os-exec/frontend && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/renan/os-exec && git add frontend/src
git commit -m "feat(frontend): base do WhatsApp (hooks, rótulos) e telefone do contato"
```

---

### Task 15: Frontend — aba "WhatsApp" na ficha do cliente

**Files:**
- Create: `frontend/src/components/trigger-phrases-panel.tsx`
- Create: `frontend/src/components/whatsapp-client-tab.tsx`
- Modify: `frontend/src/app/app/clientes/[id]/page.tsx`

**Interfaces:**
- Consumes: hooks da Task 14, `PRIORITY_LABELS`.
- Produces: `<TriggerPhrasesPanel clientId={string | null} />` (reutilizado na Config com `null`); `<WhatsappClientTab clientId />`.

- [ ] **Step 1: `trigger-phrases-panel.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { PRIORITY_LABELS, type TicketPriority } from '@/lib/tickets';
import {
  useApplyDefaults,
  usePhrases,
  useRemovePhrase,
  useSavePhrase,
  type TriggerPhrase,
} from '@/lib/whatsapp';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

const errToast = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Falha na operação.');

interface Category { id: string; name: string }

/** Lista/edita frases de gatilho. `clientId = null` edita o PADRÃO GLOBAL. */
export function TriggerPhrasesPanel({ clientId }: { clientId: string | null }) {
  const { data: phrases } = usePhrases(clientId);
  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: () => api<Category[]>('/categories') });
  const save = useSavePhrase(clientId);
  const remove = useRemovePhrase(clientId);
  const defaults = useApplyDefaults(clientId ?? '');

  const [editing, setEditing] = useState<Partial<TriggerPhrase> | null>(null);

  const catName = (id: string | null) => categories?.find((c) => c.id === id)?.name ?? '—';

  function submit() {
    if (!editing?.phrase?.trim()) return;
    save.mutate(
      {
        id: editing.id,
        phrase: editing.phrase,
        categoryId: editing.categoryId || null,
        priority: editing.priority ?? 'MEDIUM',
        title: editing.title || null,
      },
      {
        onSuccess: () => {
          setEditing(null);
          toast.success('Frase salva.');
        },
        onError: errToast,
      },
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Quando uma mensagem do grupo <b>começa</b> com a frase (sem diferenciar maiúsculas e acentos), o
          chamado é aberto na hora. O resto da mensagem vira a descrição.
        </p>
        <div className="flex gap-2">
          {clientId && (
            <Button
              variant="outline"
              disabled={defaults.isPending}
              onClick={() =>
                defaults.mutate(undefined, {
                  onSuccess: (r) => toast.success(r.created ? `${r.created} frase(s) copiada(s).` : 'Nada novo para copiar.'),
                  onError: errToast,
                })
              }
            >
              Aplicar frases padrão
            </Button>
          )}
          <Button onClick={() => setEditing({ priority: 'MEDIUM' })}>Nova frase</Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Frase</th>
              <th className="px-3 py-2 font-medium">Categoria</th>
              <th className="px-3 py-2 font-medium">Prioridade</th>
              <th className="px-3 py-2 font-medium">Situação</th>
              <th className="px-3 py-2 font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {phrases?.map((p) => (
              <tr key={p.id} className="border-t border-border">
                <td className="px-3 py-2">
                  <div>{p.phrase}</div>
                  {p.title && <div className="text-xs text-muted-foreground">Título: {p.title}</div>}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{catName(p.categoryId)}</td>
                <td className="px-3 py-2">{PRIORITY_LABELS[p.priority]}</td>
                <td className="px-3 py-2">
                  <Badge tone={p.active ? 'green' : 'neutral'}>{p.active ? 'Ativa' : 'Inativa'}</Badge>
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-3">
                    <button type="button" className="text-primary hover:underline" onClick={() => setEditing(p)}>
                      Editar
                    </button>
                    <button
                      type="button"
                      className="text-primary hover:underline"
                      onClick={() => save.mutate({ id: p.id, phrase: p.phrase, active: !p.active }, { onError: errToast })}
                    >
                      {p.active ? 'Desativar' : 'Ativar'}
                    </button>
                    <button
                      type="button"
                      className="text-destructive hover:underline"
                      onClick={() => {
                        if (confirm(`Apagar a frase "${p.phrase}"?`)) remove.mutate(p.id, { onError: errToast });
                      }}
                    >
                      Apagar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {phrases && phrases.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                  Nenhuma frase cadastrada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Editar frase' : 'Nova frase'}>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ph-phrase">Frase</Label>
            <Input
              id="ph-phrase"
              placeholder="Sistema caiu"
              value={editing?.phrase ?? ''}
              onChange={(e) => setEditing((v) => ({ ...v, phrase: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ph-title">Título do chamado (opcional)</Label>
            <Input
              id="ph-title"
              placeholder="Usa a própria frase se ficar vazio"
              value={editing?.title ?? ''}
              onChange={(e) => setEditing((v) => ({ ...v, title: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ph-cat">Categoria</Label>
            <Select
              id="ph-cat"
              value={editing?.categoryId ?? ''}
              onChange={(e) => setEditing((v) => ({ ...v, categoryId: e.target.value || null }))}
            >
              <option value="">Sem categoria</option>
              {categories?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ph-prio">Prioridade</Label>
            <Select
              id="ph-prio"
              value={editing?.priority ?? 'MEDIUM'}
              onChange={(e) => setEditing((v) => ({ ...v, priority: e.target.value as TicketPriority }))}
            >
              {(Object.keys(PRIORITY_LABELS) as TicketPriority[]).map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={save.isPending}>
              Salvar
            </Button>
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: `whatsapp-client-tab.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api';
import { useCreateGroup, useGroups, useRemoveGroup, useUpdateGroup } from '@/lib/whatsapp';
import { TriggerPhrasesPanel } from '@/components/trigger-phrases-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const errToast = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Falha na operação.');

export function WhatsappClientTab({ clientId }: { clientId: string }) {
  const { data: groups } = useGroups(clientId);
  const create = useCreateGroup(clientId);
  const update = useUpdateGroup(clientId);
  const remove = useRemoveGroup(clientId);
  const [externalId, setExternalId] = useState('');
  const [name, setName] = useState('');

  return (
    <div className="flex flex-col gap-8 pt-4">
      <section className="flex flex-col gap-3">
        <h2 className="text-[14px] font-semibold">Grupos do cliente</h2>
        <p className="text-sm text-muted-foreground">
          Cole o <b>ID do grupo</b> (algo como <code>120363000000000001@g.us</code>) copiado da Evolution. Só
          os grupos cadastrados aqui são lidos; qualquer pessoa do grupo conta, conhecida ou não.
        </p>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!externalId.trim()) return;
            create.mutate(
              { externalId, name: name || undefined },
              {
                onSuccess: () => {
                  setExternalId('');
                  setName('');
                  toast.success('Grupo cadastrado.');
                },
                onError: errToast,
              },
            );
          }}
        >
          <div className="flex min-w-[260px] flex-1 flex-col gap-1.5">
            <Label htmlFor="wg-id">ID do grupo</Label>
            <Input id="wg-id" value={externalId} onChange={(e) => setExternalId(e.target.value)} />
          </div>
          <div className="flex min-w-[180px] flex-col gap-1.5">
            <Label htmlFor="wg-name">Apelido (opcional)</Label>
            <Input id="wg-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <Button type="submit" disabled={create.isPending}>
            Adicionar grupo
          </Button>
        </form>

        <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Apelido</th>
                <th className="px-3 py-2 font-medium">ID</th>
                <th className="px-3 py-2 font-medium">Situação</th>
                <th className="px-3 py-2 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {groups?.map((g) => (
                <tr key={g.id} className="border-t border-border">
                  <td className="px-3 py-2">{g.name ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{g.externalId}</td>
                  <td className="px-3 py-2">
                    <Badge tone={g.active ? 'green' : 'neutral'}>{g.active ? 'Lendo' : 'Pausado'}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-3">
                      <button
                        type="button"
                        className="text-primary hover:underline"
                        onClick={() => update.mutate({ id: g.id, active: !g.active }, { onError: errToast })}
                      >
                        {g.active ? 'Pausar' : 'Retomar'}
                      </button>
                      <button
                        type="button"
                        className="text-destructive hover:underline"
                        onClick={() => {
                          if (confirm('Remover o grupo apaga também as mensagens gravadas dele. Continuar?'))
                            remove.mutate(g.id, { onError: errToast });
                        }}
                      >
                        Remover
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {groups && groups.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">
                    Nenhum grupo cadastrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[14px] font-semibold">Frases de gatilho</h2>
        <TriggerPhrasesPanel clientId={clientId} />
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Ligar a aba na ficha do cliente**

Em `app/app/clientes/[id]/page.tsx`: `import { WhatsappClientTab } from '@/components/whatsapp-client-tab';`; no array de abas, antes de `chamados`: `{ value: 'whatsapp', label: 'WhatsApp' },`; e depois de `{tab === 'oportunidades' && ...}`: `{tab === 'whatsapp' && <WhatsappClientTab clientId={id} />}`.

- [ ] **Step 4: Verificar tipos**

Run: `cd /c/Users/renan/os-exec/frontend && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/renan/os-exec && git add frontend/src
git commit -m "feat(frontend): aba WhatsApp na ficha do cliente (grupos e frases)"
```

---

### Task 16: Frontend — aba "WhatsApp" em Configurações

**Files:**
- Create: `frontend/src/app/app/config/tabs/whatsapp-tab.tsx`
- Modify: `frontend/src/app/app/config/page.tsx`

**Interfaces:**
- Consumes: `useWhatsappStatus`, `TriggerPhrasesPanel clientId={null}`, `GET/PUT /settings`, `GET /whatsapp/qr`.

- [ ] **Step 1: Criar `whatsapp-tab.tsx`**

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { useWhatsappStatus } from '@/lib/whatsapp';
import { TriggerPhrasesPanel } from '@/components/trigger-phrases-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type SettingsView = Record<string, string | boolean>;
const errToast = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Falha na operação.');

const STATE_LABEL: Record<string, string> = {
  open: 'Conectado',
  close: 'Desconectado',
  connecting: 'Conectando…',
  unreachable: 'Evolution inalcançável',
  not_configured: 'Não configurado',
};

export default function WhatsappTab() {
  const qc = useQueryClient();
  const { data: status } = useWhatsappStatus();
  const { data } = useQuery({ queryKey: ['settings'], queryFn: () => api<SettingsView>('/settings') });
  const [qr, setQr] = useState<{ base64: string | null; pairingCode: string | null } | null>(null);
  const [form, setForm] = useState({
    url: '', instance: '', evoKey: '', webhookSecret: '', aiKey: '', aiLimit: '', retention: '',
  });

  useEffect(() => {
    if (data)
      setForm((f) => ({
        ...f,
        url: (data['whatsapp.evolution.url'] as string) ?? '',
        instance: (data['whatsapp.evolution.instance'] as string) ?? '',
        aiLimit: (data['ai.dailyTokenLimit'] as string) ?? '',
        retention: (data['whatsapp.retentionDays'] as string) ?? '',
      }));
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      api('/settings', {
        method: 'PUT',
        body: {
          values: {
            'whatsapp.evolution.url': form.url,
            'whatsapp.evolution.instance': form.instance,
            'ai.dailyTokenLimit': form.aiLimit,
            'whatsapp.retentionDays': form.retention,
            ...(form.evoKey ? { 'whatsapp.evolution.apiKey': form.evoKey } : {}),
            ...(form.webhookSecret ? { 'whatsapp.webhookSecret': form.webhookSecret } : {}),
            ...(form.aiKey ? { 'ai.anthropicApiKey': form.aiKey } : {}),
          },
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['wa-status'] });
      setForm((f) => ({ ...f, evoKey: '', webhookSecret: '', aiKey: '' }));
      toast.success('Configurações do WhatsApp salvas.');
    },
    onError: errToast,
  });

  const fetchQr = useMutation({
    mutationFn: () => api<{ base64: string | null; pairingCode: string | null }>('/whatsapp/qr'),
    onSuccess: (r) => (r.base64 || r.pairingCode ? setQr(r) : toast.error('Sem QR agora (já conectado ou Evolution indisponível).')),
    onError: errToast,
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const conn = status?.connection;
  const ai = status?.ai;

  return (
    <div className="flex flex-col gap-8 pt-4">
      <section className="flex max-w-lg flex-col gap-3">
        <h2 className="text-[14px] font-semibold">Conexão</h2>
        <div className="flex items-center gap-2">
          <Badge tone={conn?.state === 'open' ? 'green' : 'red'}>{STATE_LABEL[conn?.state ?? ''] ?? conn?.state ?? '…'}</Badge>
          {conn?.disconnectedSince && (
            <span className="text-sm text-muted-foreground">
              desde {new Date(conn.disconnectedSince).toLocaleString('pt-BR')}
            </span>
          )}
        </div>
        <Button variant="outline" className="self-start" disabled={fetchQr.isPending} onClick={() => fetchQr.mutate()}>
          Gerar QR code de pareamento
        </Button>
        {qr?.base64 && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr.base64} alt="QR code do WhatsApp" className="h-56 w-56 rounded border border-border bg-white p-2" />
        )}
        {qr?.pairingCode && <p className="text-sm">Código de pareamento: <b>{qr.pairingCode}</b></p>}
        {ai && (
          <p className="text-sm text-muted-foreground">
            IA hoje: {ai.usedToday.toLocaleString('pt-BR')} / {ai.limit.toLocaleString('pt-BR')} tokens
            {ai.paused && <b className="text-destructive"> — pausada até amanhã</b>}
          </p>
        )}
      </section>

      <section className="flex max-w-lg flex-col gap-4">
        <h2 className="text-[14px] font-semibold">Evolution API</h2>
        <div className="flex flex-col gap-1">
          <Label>URL interna</Label>
          <Input placeholder="http://evolution-api:8080" value={form.url} onChange={set('url')} />
        </div>
        <div className="flex flex-col gap-1">
          <Label>Nome da instância</Label>
          <Input placeholder="os" value={form.instance} onChange={set('instance')} />
        </div>
        <div className="flex flex-col gap-1">
          <Label>Chave da API da Evolution</Label>
          <Input type="password" placeholder={data?.['whatsapp.evolution.apiKeySet'] ? '•••••••• (configurada)' : ''} value={form.evoKey} onChange={set('evoKey')} />
        </div>
        <div className="flex flex-col gap-1">
          <Label>Segredo do webhook</Label>
          <Input type="password" placeholder={data?.['whatsapp.webhookSecretSet'] ? '•••••••• (configurado)' : ''} value={form.webhookSecret} onChange={set('webhookSecret')} />
          <p className="text-xs text-muted-foreground">Vai no header <code>x-webhook-secret</code> configurado no webhook da Evolution.</p>
        </div>
      </section>

      <section className="flex max-w-lg flex-col gap-4">
        <h2 className="text-[14px] font-semibold">Inteligência artificial</h2>
        <p className="text-xs text-muted-foreground">
          O texto das mensagens dos grupos é enviado à API da Anthropic para triagem. Avise os participantes dos grupos.
        </p>
        <div className="flex flex-col gap-1">
          <Label>Chave da API da Anthropic</Label>
          <Input type="password" placeholder={data?.['ai.anthropicApiKeySet'] ? '•••••••• (configurada)' : 'sk-ant-…'} value={form.aiKey} onChange={set('aiKey')} />
        </div>
        <div className="flex flex-col gap-1">
          <Label>Teto diário de tokens</Label>
          <Input placeholder="500000" value={form.aiLimit} onChange={set('aiLimit')} />
        </div>
        <div className="flex flex-col gap-1">
          <Label>Guardar mensagens por (dias)</Label>
          <Input placeholder="90" value={form.retention} onChange={set('retention')} />
        </div>
        <Button className="self-start" disabled={save.isPending} onClick={() => save.mutate()}>
          Salvar
        </Button>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[14px] font-semibold">Frases de gatilho padrão</h2>
        <p className="text-sm text-muted-foreground">
          Copiadas para um cliente pelo botão "Aplicar frases padrão" na aba WhatsApp dele. Mudar aqui depois não altera os clientes já criados.
        </p>
        <TriggerPhrasesPanel clientId={null} />
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Registrar na página de Configurações**

Em `app/app/config/page.tsx`: `import WhatsappTab from './tabs/whatsapp-tab';` junto dos outros imports de abas; no array de abas de admin, depois de `{ value: 'email', label: 'E-mail' },` acrescentar `{ value: 'whatsapp', label: 'WhatsApp' },`; e depois de `{tab === 'email' && isAdmin && <EmailTab />}` acrescentar `{tab === 'whatsapp' && isAdmin && <WhatsappTab />}`.

- [ ] **Step 3: Verificar tipos**

Run: `cd /c/Users/renan/os-exec/frontend && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
cd /c/Users/renan/os-exec && git add frontend/src
git commit -m "feat(frontend): aba WhatsApp em Configurações (conexão, IA, retenção, frases padrão)"
```

---

### Task 17: Frontend — Triagem, menu e mensagens no chamado

**Files:**
- Create: `frontend/src/app/app/triagem/page.tsx`
- Create: `frontend/src/components/ticket-whatsapp-messages.tsx`
- Modify: `frontend/src/components/nav.tsx`, `frontend/src/app/app/chamados/[id]/page.tsx`

**Interfaces:**
- Consumes: `useSuggestions`, `useAcceptSuggestion`, `useDiscardSuggestion`, `useWhatsappStatus`, `useTicketMessages`.

- [ ] **Step 1: Página de Triagem**

`app/app/triagem/page.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api';
import { useAcceptSuggestion, useDiscardSuggestion, useSuggestions, useWhatsappStatus } from '@/lib/whatsapp';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const errToast = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Falha na operação.');
const URGENCY_TONE = ['neutral', 'neutral', 'blue', 'amber', 'red', 'red'] as const;

export default function TriagemPage() {
  const router = useRouter();
  const { data: suggestions } = useSuggestions();
  const { data: status } = useWhatsappStatus();
  const accept = useAcceptSuggestion();
  const discard = useDiscardSuggestion();

  const conn = status?.connection;
  const disconnected = conn?.configured && conn.state !== 'open';

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Triagem do WhatsApp</h1>

      {disconnected && (
        <p className="rounded-md border border-warning bg-warning px-3 py-2 text-sm text-warning-foreground">
          WhatsApp desconectado
          {conn?.disconnectedSince && ` desde ${new Date(conn.disconnectedSince).toLocaleString('pt-BR')}`}. Mensagens
          deste período podem não ter chegado. Reconecte em Configurações &gt; WhatsApp.
        </p>
      )}
      {status?.ai.paused && (
        <p className="rounded-md border border-warning bg-warning px-3 py-2 text-sm text-warning-foreground">
          Teto diário de tokens da IA atingido — novas sugestões voltam amanhã (as frases de gatilho continuam).
        </p>
      )}

      <p className="text-sm text-muted-foreground">
        Pedidos que a IA encontrou nos grupos e que não casaram com nenhuma frase de gatilho. Confirme para abrir o
        chamado ou descarte.
      </p>

      <ul className="flex flex-col gap-3">
        {suggestions?.map((s) => (
          <li key={s.id} className="rounded-xl bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={URGENCY_TONE[s.urgency] ?? 'neutral'}>Urgência {s.urgency}</Badge>
              <span className="text-sm font-medium">{s.client.name}</span>
              <span className="text-xs text-muted-foreground">
                {s.group.name ?? s.group.externalId} · {new Date(s.createdAt).toLocaleString('pt-BR')}
              </span>
            </div>
            <p className="mt-2 text-[15px] font-medium">{s.summary}</p>
            <pre className="mt-2 whitespace-pre-wrap rounded bg-muted/50 p-2 text-xs text-muted-foreground">{s.excerpt}</pre>
            <div className="mt-3 flex gap-2">
              <Button
                disabled={accept.isPending}
                onClick={() =>
                  accept.mutate(
                    { id: s.id },
                    {
                      onSuccess: (t) => {
                        toast.success(`Chamado ${t.number} criado.`);
                        router.push(`/app/chamados/${t.id}`);
                      },
                      onError: errToast,
                    },
                  )
                }
              >
                Criar chamado
              </Button>
              <Button
                variant="outline"
                disabled={discard.isPending}
                onClick={() => discard.mutate(s.id, { onSuccess: () => toast.success('Descartada.'), onError: errToast })}
              >
                Descartar
              </Button>
            </div>
          </li>
        ))}
        {suggestions && suggestions.length === 0 && (
          <li className="py-8 text-center text-sm text-muted-foreground">Nenhuma sugestão pendente.</li>
        )}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Mensagens de origem na ficha do chamado**

`components/ticket-whatsapp-messages.tsx`:

```tsx
'use client';

import { useTicketMessages } from '@/lib/whatsapp';

export function TicketWhatsappMessages({ ticketId, origin }: { ticketId: string; origin: string }) {
  const { data } = useTicketMessages(ticketId, origin === 'WHATSAPP');
  if (!data || data.length === 0) return null;

  return (
    <section className="rounded-xl bg-card p-5 shadow-sm">
      <h2 className="mb-3 text-[14px] font-semibold">Mensagens do WhatsApp</h2>
      <ul className="flex flex-col gap-2">
        {data.map((m) => (
          <li key={m.id} className="text-[13px]">
            <span className="font-medium">{m.senderName ?? (m.senderPhone || 'alguém')}</span>
            <span className="text-muted-foreground">
              {' '}
              · {m.group.name ?? 'grupo'} · {new Date(m.sentAt).toLocaleString('pt-BR')}
            </span>
            <div>{m.body}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

Em `app/app/chamados/[id]/page.tsx`: `import { TicketWhatsappMessages } from '@/components/ticket-whatsapp-messages';` e, logo antes de `<KnowledgeSuggestions ticketId={id} />`, `<TicketWhatsappMessages ticketId={id} origin={ticket.origin} />`.

- [ ] **Step 3: Menu**

Em `components/nav.tsx`, depois da linha `atendimento.push({ href: '/app/agenda', ... })` acrescentar:

```tsx
  if (privileged) atendimento.push({ href: '/app/triagem', label: 'Triagem WhatsApp', icon: 'forum' });
```

- [ ] **Step 4: Verificar tipos e build**

Run: `cd /c/Users/renan/os-exec/frontend && npx tsc --noEmit && npm run build`
Expected: sem erros e build limpo.

- [ ] **Step 5: Commit e checkpoint**

```bash
cd /c/Users/renan/os-exec && git add frontend/src
git commit -m "feat(frontend): fila de triagem do WhatsApp, menu e mensagens no chamado"
git push origin main && cd /z/Projetos/OS && git pull --ff-only
```

---

### Task 18: Infra — Evolution, Redis e banco da Evolution na stack

**Files:**
- Modify: `portainer-stack.yml`, `portainer-stack.env`, `deploy/stack.env.example`, `docker-compose.yml`, `deploy/README.md`

> **Verificar antes de escrever:** a tag da imagem e os nomes exatos das variáveis mudam entre versões da Evolution. Run: `docker manifest inspect atendai/evolution-api:v2.2.3 > /dev/null && echo ok`. Se a tag não existir, procurar a tag v2 estável atual no Docker Hub (`atendai/evolution-api` ou `evoapicloud/evolution-api`) e conferir as variáveis no `.env.example` do repositório da Evolution.

- [ ] **Step 1: `portainer-stack.yml`**

Antes de `cloudflared`, acrescentar os três serviços (a Evolution **não** expõe porta; só o backend a alcança pela rede interna):

```yaml
  evolution-db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: evolution
      POSTGRES_PASSWORD: ${EVOLUTION_DB_PASSWORD}
      POSTGRES_DB: evolution
    volumes:
      - evolution_db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U evolution -d evolution"]
      interval: 10s
      timeout: 5s
      retries: 10
    networks:
      - os-net

  evolution-redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes:
      - evolution_redis:/data
    networks:
      - os-net

  # Conector do WhatsApp (API NÃO oficial, somente leitura no nosso uso). Sem portas
  # no host: o backend fala com ela em http://evolution-api:8080.
  evolution-api:
    image: atendai/evolution-api:v2.2.3
    restart: unless-stopped
    depends_on:
      evolution-db:
        condition: service_healthy
      evolution-redis:
        condition: service_started
    environment:
      SERVER_URL: http://evolution-api:8080
      AUTHENTICATION_API_KEY: ${EVOLUTION_API_KEY}
      DATABASE_ENABLED: "true"
      DATABASE_PROVIDER: postgresql
      DATABASE_CONNECTION_URI: "postgresql://evolution:${EVOLUTION_DB_PASSWORD}@evolution-db:5432/evolution"
      DATABASE_SAVE_DATA_INSTANCE: "true"
      # Não guardamos mensagens na Evolution: o OS é o dono do histórico.
      DATABASE_SAVE_DATA_NEW_MESSAGE: "false"
      DATABASE_SAVE_MESSAGE_UPDATE: "false"
      DATABASE_SAVE_DATA_CONTACTS: "false"
      DATABASE_SAVE_DATA_CHATS: "false"
      CACHE_REDIS_ENABLED: "true"
      CACHE_REDIS_URI: redis://evolution-redis:6379/6
      CACHE_REDIS_PREFIX_KEY: evolution
      CACHE_LOCAL_ENABLED: "false"
      # Webhook por instância (configurado via API, ver deploy/README.md). Manter
      # WEBHOOK_BASE64 desligado: payload com mídia estoura o limite do backend.
      WEBHOOK_GLOBAL_ENABLED: "false"
    volumes:
      - evolution_instances:/evolution/instances
    networks:
      - os-net
```

e em `volumes:` acrescentar `evolution_db:`, `evolution_redis:`, `evolution_instances:`.

- [ ] **Step 2: Variáveis**

`portainer-stack.env` e `deploy/stack.env.example` (mesmo bloco, com o comentário no segundo):

```
# --- WhatsApp (Evolution API) ---
# Chave que protege a API da Evolution (gere com: openssl rand -hex 32).
EVOLUTION_API_KEY=TROQUE_32_BYTES_HEX
EVOLUTION_DB_PASSWORD=TROQUE_SENHA_FORTE_DA_EVOLUTION
```

- [ ] **Step 3: `docker-compose.yml` (dev)**

Acrescentar `evolution-db`, `evolution-redis` e `evolution-api` com as mesmas definições, mas com `POSTGRES_PASSWORD: ${EVOLUTION_DB_PASSWORD:-evolution}`, `AUTHENTICATION_API_KEY: ${EVOLUTION_API_KEY:-dev-evolution-key}`, a URI do banco com a mesma senha padrão, `ports: ["127.0.0.1:8080:8080"]` na `evolution-api`, e volumes `evolution_db`, `evolution_redis`, `evolution_instances`.

- [ ] **Step 4: `deploy/README.md`**

Acrescentar a seção "WhatsApp (Evolution API)" com:
1. Variáveis novas (`EVOLUTION_API_KEY`, `EVOLUTION_DB_PASSWORD`) e que a Evolution não expõe porta.
2. Criar a instância (executar de dentro da rede, ex.: `docker exec <backend> sh` ou pelo terminal do Portainer no container do backend):
   ```bash
   curl -X POST http://evolution-api:8080/instance/create -H "apikey: $EVOLUTION_API_KEY" -H "Content-Type: application/json" \
     -d '{"instanceName":"os","qrcode":true,"integration":"WHATSAPP-BAILEYS"}'
   ```
3. Configurar o webhook da instância (corpo conforme a versão — conferir na documentação da Evolution):
   ```bash
   curl -X POST http://evolution-api:8080/webhook/set/os -H "apikey: $EVOLUTION_API_KEY" -H "Content-Type: application/json" \
     -d '{"webhook":{"enabled":true,"url":"http://backend:3001/api/whatsapp/webhook","webhookByEvents":false,"webhookBase64":false,"headers":{"x-webhook-secret":"<MESMO SEGREDO de Config > WhatsApp>"},"events":["MESSAGES_UPSERT"]}}'
   ```
4. Em `/app/config` > WhatsApp: URL `http://evolution-api:8080`, instância `os`, chave da Evolution, segredo do webhook, chave da Anthropic; clicar "Gerar QR code" e parear o celular **dedicado**.
5. Como obter o ID de um grupo (`GET /group/fetchAllGroups/os?getParticipants=false` com o header `apikey`) e colar na aba WhatsApp do cliente.
6. Avisos: API não oficial (risco de banimento do número que escuta — usar chip separado, somente leitura); LGPD (avisar participantes; o texto vai para a API da Anthropic).

- [ ] **Step 5: Validar o compose**

Run: `cd /c/Users/renan/os-exec && docker compose -f portainer-stack.yml --env-file portainer-stack.env config > /dev/null && echo ok && docker compose config > /dev/null && echo ok-dev`
Expected: `ok` e `ok-dev` (sem erros de sintaxe/variável).

- [ ] **Step 6: Commit**

```bash
cd /c/Users/renan/os-exec && git add portainer-stack.yml portainer-stack.env deploy docker-compose.yml
git commit -m "chore(deploy): Evolution API, Redis e banco da Evolution na stack"
```

---

### Task 19: E2E (Playwright) e limpeza do seed

**Files:**
- Create: `frontend/e2e/whatsapp-triagem.spec.ts`
- Modify: `frontend/e2e/seed-e2e.ts`

**Interfaces:**
- Consumes: `E2E_CLIENT_ID`, `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD` (de `seed-e2e.ts`), `PrismaClient`.

- [ ] **Step 1: Limpeza no seed**

Em `seed-e2e.ts`, na função de limpeza, **antes** do `prisma.user.deleteMany(...)`/`prisma.client.deleteMany({ where: { id: E2E_CLIENT_ID } })`, acrescentar:

```ts
  // WhatsApp: grupos/frases/sugestões do cliente E2E (FK para Client).
  await prisma.whatsappMessage.deleteMany({ where: { group: { clientId: E2E_CLIENT_ID } } });
  await prisma.ticketSuggestion.deleteMany({ where: { clientId: E2E_CLIENT_ID } });
  await prisma.whatsappGroup.deleteMany({ where: { clientId: E2E_CLIENT_ID } });
  await prisma.triggerPhrase.deleteMany({ where: { OR: [{ clientId: E2E_CLIENT_ID }, { phrase: { startsWith: 'E2E ' } }] } });
```

(Se o chamado criado pelo E2E referenciar o cliente, o `ticket.deleteMany` existente na limpeza já o remove; conferir a ordem e, se necessário, apagar `ticketEvent`/`ticket` do cliente antes.)

- [ ] **Step 2: Escrever o E2E**

`frontend/e2e/whatsapp-triagem.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, E2E_CLIENT_ID } from './seed-e2e';

async function loginAsAdmin(page: Page) {
  await page.goto('/app/login');
  await page.locator('#email').fill(E2E_ADMIN_EMAIL);
  await page.locator('#password').fill(E2E_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/app');
}

test('cadastra grupo e frase na ficha do cliente e cria chamado a partir de uma sugestão', async ({ page }) => {
  test.setTimeout(90_000);
  const stamp = Date.now();
  const jid = `${stamp}@g.us`;
  const phrase = `E2E Sistema caiu ${stamp}`;
  const prisma = new PrismaClient();

  await loginAsAdmin(page);

  // 1. Ficha do cliente → aba WhatsApp → grupo por ID
  await page.goto(`/app/clientes/${E2E_CLIENT_ID}`);
  await page.getByRole('button', { name: 'WhatsApp' }).click();
  await page.locator('#wg-id').fill('isso-nao-e-um-id');
  await page.getByRole('button', { name: 'Adicionar grupo' }).click();
  await expect(page.getByText(/ID inválido/)).toBeVisible();
  await page.locator('#wg-id').fill(jid);
  await page.locator('#wg-name').fill(`Suporte E2E ${stamp}`);
  await page.getByRole('button', { name: 'Adicionar grupo' }).click();
  await expect(page.getByText('Grupo cadastrado.')).toBeVisible();
  await expect(page.getByText(jid)).toBeVisible();

  // 2. Frase de gatilho
  await page.getByRole('button', { name: 'Nova frase' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nova frase' });
  await dialog.locator('#ph-phrase').fill(phrase);
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Frase salva.')).toBeVisible();
  await expect(page.getByText(phrase)).toBeVisible();

  // 3. Sugestão da IA (semeada direto no banco — a IA real nunca roda em teste)
  const group = await prisma.whatsappGroup.findUniqueOrThrow({ where: { externalId: jid } });
  const resumo = `Impressora parada E2E ${stamp}`;
  await prisma.ticketSuggestion.create({
    data: {
      groupId: group.id, clientId: E2E_CLIENT_ID, messageIds: [], urgency: 4,
      summary: resumo, excerpt: 'Beto: a impressora do financeiro parou',
    },
  });

  // 4. Triagem → criar chamado
  await page.goto('/app/triagem');
  await expect(page.getByText(resumo)).toBeVisible();
  await page.getByRole('button', { name: 'Criar chamado' }).first().click();
  await page.waitForURL(/\/app\/chamados\/.+/);
  await expect(page.getByText(resumo)).toBeVisible();

  await prisma.$disconnect();
});
```

> O seletor `.first()` assume que a sugestão semeada é a única/primeira; se houver outras sugestões no banco de teste, filtrar pelo cartão que contém `resumo` (`page.locator('li', { hasText: resumo }).getByRole('button', { name: 'Criar chamado' })`).

- [ ] **Step 3: Rodar**

Com backend e frontend de teste no ar (ver `frontend/playwright.config.ts`):
Run: `cd /c/Users/renan/os-exec/frontend && npx playwright test e2e/whatsapp-triagem.spec.ts`
Expected: PASS. (Lembrete do projeto: o rate limit do login é 10/min; rodar a suíte completa em sequência rápida pode dar 429 — reiniciar o backend entre rodadas.)

- [ ] **Step 4: Rodar a suíte E2E completa uma vez**

Run: `cd /c/Users/renan/os-exec/frontend && npx playwright test`
Expected: todas as specs verdes (a nova + as anteriores, incluindo a limpeza do seed sem quebra de FK).

- [ ] **Step 5: Commit e checkpoint**

```bash
cd /c/Users/renan/os-exec && git add frontend/e2e
git commit -m "test(e2e): grupo, frase de gatilho e criação de chamado pela triagem do WhatsApp"
git push origin main && cd /z/Projetos/OS && git pull --ff-only
```

---

### Task 20: Release 0.12.0, verificação final e teste com celular real

**Files:**
- Modify: `CHANGELOG.md`, `backend/package.json` (version), `frontend/package.json` (version), `docs/roadmap.md`

- [ ] **Step 1: CHANGELOG e versões**

Em `CHANGELOG.md`, acima de `## [0.11.0]`:

```markdown
## [0.12.0] - 2026-10-DD

### Adicionado
- **WhatsApp como canal (fase 1, somente leitura)**: o OS escuta os grupos de
  WhatsApp dos clientes pela Evolution API (na stack) e não envia nada de volta.
  Cada cliente cadastra o **ID do grupo**; qualquer pessoa do grupo conta, e o
  telefone do contato (`User.phone`) só identifica quem escreveu.
- **Frases de gatilho** por cliente ("Sistema caiu", "Sem conexão"…) com
  categoria, prioridade e título: a mensagem que *começa* com a frase abre o
  chamado na hora (origem `WHATSAPP`), sem IA; a mesma frase no mesmo grupo com
  chamado aberto vira andamento do chamado. Conjunto padrão global em
  Configurações, copiado para o cliente.
- **Triagem por IA** (Claude Haiku 5.5): mensagens sem gatilho são analisadas em
  lote (~5 min) e viram sugestões em `/app/triagem` (criar chamado ou descartar).
  Teto diário de tokens, retenção das mensagens (90 dias) e aviso de WhatsApp
  desconectado.
- Aba **WhatsApp** na ficha do cliente e em Configurações; telefone no cadastro
  de contatos; mensagens de origem na ficha do chamado.

### Infra
- Stack ganha `evolution-api`, `evolution-redis` e `evolution-db`; novas envs
  `EVOLUTION_API_KEY` e `EVOLUTION_DB_PASSWORD`. Dependências novas no backend:
  `@anthropic-ai/sdk` e `zod`.
```

Trocar `DD` pela data real da release. `backend/package.json` e `frontend/package.json`: `"version": "0.12.0"`. Em `docs/roadmap.md`, marcar "WhatsApp como canal" como entregue (fase 1) e manter o item "buscar grupos da Evolution" como próximo.

- [ ] **Step 2: Suítes completas**

Run:
```bash
cd /c/Users/renan/os-exec/backend && npm test && npm run test:integration && npm run build
cd /c/Users/renan/os-exec/frontend && npx tsc --noEmit && npm run build
```
Expected: tudo verde.

- [ ] **Step 3: Boot real do backend**

Run: `cd /c/Users/renan/os-exec/backend && (node dist/main > /tmp/os-boot.log 2>&1 &) ; sleep 8; curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3001/api/whatsapp/webhook -d '{}' ; tail -n 5 /tmp/os-boot.log`
Expected: `401` e sem erro de DI. Encerrar o processo depois.

- [ ] **Step 4: Teste manual com o celular real (ambiente de desenvolvimento)**

1. `docker compose up -d` (sobe Evolution, Redis e bancos).
2. Seguir `deploy/README.md`: criar a instância `os`, configurar o webhook com o segredo, preencher `/app/config` > WhatsApp, gerar o QR e parear o celular dedicado. **Conferir o formato real da resposta de `GET /instance/connect/os`** (campo `base64`/`pairingCode`) e, se divergir, ajustar `EvolutionStatusService.qr()` e o teste.
3. Obter o ID de um grupo de teste (`fetchAllGroups`), cadastrar na aba WhatsApp de um cliente de teste, aplicar frases padrão, cadastrar o telefone de um contato.
4. Escrever no grupo "Sistema caiu - teste" → conferir o chamado criado (origem WhatsApp, solicitante correto).
5. **Capturar um payload real** de `messages.upsert` de grupo (log do backend ou webhook de teste) e comparar com `evolution-payload.spec.ts`: remetente (`participant`/`participantPn`/LID), `messageTimestamp`. Se divergir, atualizar o fixture e o parser.
6. Escrever uma mensagem sem gatilho ("a impressora do financeiro parou") → em até ~5 min aparece na Triagem (com a chave da Anthropic configurada); conferir o custo em `ai_usage`.
7. Desligar o celular/Evolution → o aviso de desconexão aparece em Config e na Triagem.

- [ ] **Step 5: Commit, tag e checkpoint**

```bash
cd /c/Users/renan/os-exec && git add -A CHANGELOG.md backend/package.json frontend/package.json docs/roadmap.md
git commit -m "chore(release): 0.12.0 - WhatsApp como canal (escuta, gatilhos e triagem por IA)"
git tag v0.12.0
git push origin main --tags && cd /z/Projetos/OS && git pull --ff-only
```

> **Deploy** (bump de `OS_TAG` e build/push das imagens) **não faz parte deste plano**: ao final, perguntar ao usuário se é para rodar agora (regra do projeto). Lembrar que a stack em produção precisa das envs novas (`EVOLUTION_API_KEY`, `EVOLUTION_DB_PASSWORD`) antes do "Pull and redeploy".

---

## Auto-revisão

**Cobertura do spec:** §1 entregas — conector (T18), grupos por ID (T5, T15), gatilhos + padrão global (T6, T15, T16), triagem IA (T10–T12, T17) ✔. §3 modelo (T1) ✔ incl. refinamentos `aiAttempts`/`triggerPhraseId`/`AiUsage`. §4 fluxo — webhook+segredo (T8), descarte de grupo não cadastrado e `fromMe` (T4, T7), identificação por telefone (T2, T7), gatilho + frase mais longa + dedup (T3, T7), job de IA + triviais + sugestão (T10, T11), Triagem (T12, T17) ✔. §5 IA — chave cifrada (T1), `usage` + teto diário (T9, T11), cliente injetável/sem API real em teste (T10, T11) ✔. §6 telas — aba do cliente (T15), Config (T16), Triagem (T17), link de mensagens no chamado (T12, T17), telefone do contato (T14) ✔. §7 falhas — desconexão (T9, T16, T17), IA fora do ar/sem chave/formato inválido (T10, T11), segredo errado (T8), teto (T9, T11), retenção (T11) ✔. §8 testes — unit (todas), integração com DI real (T13), boot real (T8, T20), E2E (T19), manual com celular (T20) ✔. §9 ordem ✔. §10 riscos (API não oficial, requisitos da Evolution) — T18 verifica imagem/variáveis; T20 valida payload e QR reais ✔.

**Placeholders:** nenhum "TBD"; os pontos que dependem de confirmação externa (tag/variáveis da Evolution, formato do QR, campo do remetente) estão marcados explicitamente com o passo que os resolve (T4, T9, T18, T20).

**Consistência de tipos:** `ParsedWhatsappMessage` (T4) usado em T7/T8; `ChatLine`/`ClassifyInput`/`AiNotConfiguredError` (T10) usados em T11; `AiUsageService.add/isPaused` (T9) usados em T11; `priorityFromUrgency` (T12); `TriggerPhrase.priority` é `TicketPriority` no schema (T1), no DTO (T6) e no front (T14). Nomes de rota batem entre backend (T5, T6, T9, T12) e `lib/whatsapp.ts` (T14).
