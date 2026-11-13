# Aba Inventário + sugestões de melhoria — Plano

> Execução por subagentes (tarefa a tarefa). Spec: `docs/superpowers/specs/2026-11-08-inventario-agente-design.md` §8 e §9. O agente (C#) já envia tudo que é usado aqui; **não mexer em `agent/`**.

**Goal:** mostrar o inventário de cada ativo vinculado a um agente e sugerir melhorias automáticas.

## Formato de `specs` (já enviado pelo agente; todo campo pode faltar)

`cpu{nome,nucleos}`, `ramGb` (número), `so{edicao,build,versao}`, `bios{data:'YYYY-MM-DD',versao}`, `tpm{presente:boolean,versao?:string}`, `secureBoot` (boolean), `uefi` (boolean), `discos[{nome,tamanhoGb,tipo:'SSD'|'HDD'?,smart:'OK'|'Atenção'|'Falha'?,livreGb?,sistema?:boolean}]`. O software fica em `AgentDevice.software` (`[{name,version,publisher}]`), o último contato em `Asset.lastSeenAt` / `AgentDevice.lastSeenAt`.

## Decisões (minhas, a conferir)

- **Regras** (só sobre ativos com dispositivo `LINKED`, cliente com contrato válido e contato nos últimos `staleDays`; ver `ContractGateService`): 
  | id | regra | severidade |
  |---|---|---|
  | `ram-baixa` | `ramGb < ramMinGb` (8) | média |
  | `hdd` | disco com `sistema` e `tipo==='HDD'` | média |
  | `disco-cheio` | disco do sistema com `livreGb/tamanhoGb*100 < diskFreePct` (15) | média |
  | `disco-falha` | qualquer disco com `smart==='Falha'` (`'Atenção'` → severidade média, mesma regra `disco-atencao`) | **alta** |
  | `windows-sem-suporte` | `so.edicao` contém "Windows 10" (ou build < 22000) | alta |
  | `sem-win11` | roda Windows 10 **e** (`tpm.presente===false` ou `tpm.versao` não começa com "2" ou `uefi===false` ou `ramGb < 4`) — CPU não é avaliada (não coletada); registrar a limitação no texto da sugestão | média |
  | `equipamento-antigo` | `bios.data` com mais de `biosMaxYears` (5) anos | baixa |
  Campo ausente → a regra não dispara (nunca sugerir por falta de dado).
- **Limiares** em `Setting`: chaves novas `improvements.ramMinGb`, `improvements.diskFreePct`, `improvements.biosMaxYears`, `improvements.staleDays` (valores padrão acima; não secretas), editáveis num cartão "Sugestões de melhoria" em Configurações.
- Sugestão = `{ rule, severity: 'alta'|'media'|'baixa', title, detail }` com texto em pt-BR.

## Global Constraints

- Padrões do repo: NestJS + Prisma, guards/Roles como em `backend/src/agent/*`, serialização que nunca vaza `credentialsEnc`/`tokenHash`/`agentEnrollCode`; frontend Next + React Query como em `frontend/src/app/app/ativos/*`. Texto visível em pt-BR. Commits pequenos em português com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; sem push.

## Review Focus

- `specs` vazio/incompleto não gera sugestão nem quebra a tela. Dado velho (>staleDays) e cliente sem contrato não geram sugestão. Software com milhares de itens: tela com busca e paginação/virtualização simples, sem travar.

---

### Task 1 (backend): motor de regras + endpoints

**Files:** Create `backend/src/agent/improvements.ts` (função pura `evaluate(specs, now, thresholds) -> Suggestion[]`) + `improvements.spec.ts`; `backend/src/agent/improvements.service.ts` (lê limiares do `Setting`, avalia ativos); controller com guards `@Roles('ADMIN','AGENT')`. Modify `settings.keys.ts` (4 chaves).

**Produces:**
- `GET /assets/:id/inventory` → `{ device: {hostname, agentVersion, firstSeenAt, lastSeenAt, ip, mac} | null, specs, software: SoftwareItem[], suggestions: Suggestion[] }` (404 se o ativo não existe; `device: null` e listas vazias se não há agente).
- `GET /agent/improvements?clientId=` → `{ clients: [{ clientId, clientName, total, byRule: Record<rule,number>, items: [{ assetId, label, suggestions: Suggestion[] }] }] }`, só ativos com sugestão.
- `GET /assets` (lista) inclui por ativo `improvementCount` e `improvementMax` ('alta'|'media'|'baixa'|null) calculados em memória a partir de `specs` (sem N+1; sem expor `specs` inteiro na lista se hoje não expõe).

- [ ] Testes unitários de `evaluate` (um por regra, borda de limiar, campo ausente, dado velho) → ver falhar → implementar.
- [ ] Testes do serviço/endpoints (contrato inválido, sem agente, 404), rodar `vitest run src/agent src/assets`.

### Task 2 (frontend)

**Files:** Modify `frontend/src/app/app/ativos/[id]/page.tsx` (aba "Inventário"), `frontend/src/app/app/ativos/page.tsx` (selo + botão "Melhorias sugeridas (N)"), Configurações (cartão dos 4 limiares, no padrão dos outros cartões); Create `frontend/src/app/app/ativos/melhorias/page.tsx`, `frontend/src/lib/improvements.ts`, `frontend/src/components/asset-inventory-tab.tsx`.

- [ ] Aba Inventário: cartões de hardware/sistema (CPU, RAM, discos com barra de uso e selo SSD/HDD/SMART, SO, BIOS, TPM/Secure Boot), "último contato" (relativo + absoluto), sugestões no topo com cor por severidade, tabela de software com busca por nome/fabricante e ordenação. Estado vazio claro ("este ativo não tem agente instalado").
- [ ] Lista de ativos: coluna "Último contato" e selo de melhorias; página `/app/ativos/melhorias` agrupada por cliente com filtro por regra.
- [ ] `tsc` sem erros novos; conferir no navegador com dados do seed (usar o seed e2e ou inserir um `AgentDevice` LINKED de teste).
