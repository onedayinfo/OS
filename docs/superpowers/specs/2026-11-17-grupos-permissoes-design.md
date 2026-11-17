# Grupos de usuários internos e permissão por tela — design

Data: 2026-11-17 · Status: aguardando aprovação

## Intenção

Existe um funcionário que é "quase admin", mas que não deve acessar algumas telas (exemplo: CRM). Os papéis fixos `ADMIN`/`AGENT` não dão conta disso. A ideia é criar **grupos** de usuários internos, cada um com uma lista de telas permitidas, e associar um grupo ao usuário.

## Objetivos

- Cadastrar grupos (nome + telas permitidas) em Configurações.
- Associar no máximo um grupo a cada usuário interno.
- Fazer o bloqueio valer de verdade: menu, página e **API**.
- Manter quem não tem grupo exatamente como funciona hoje, sem quebrar nada no deploy.

## Fora do escopo

- Permissão por ação (ver x editar) dentro de uma tela. O controle é só por tela.
- Grupos para usuários do portal do cliente (`MANAGER`/`CONTACT`).
- Vários grupos por usuário.
- Granularidade por aba de Configurações (com uma exceção, ver "Regras").

## Anti-objetivos (seria um fracasso mesmo funcionando)

- O usuário restrito conseguir acessar o CRM pela URL direta ou pela API.
- O usuário restrito conseguir **mudar o próprio grupo** (ou o de outra pessoa) e se dar acesso de volta.
- Bloquear uma tela quebrar outra, por exemplo o seletor de cliente no formulário de chamado.

## Abordagens consideradas

- **A — Grupos com telas permitidas, por cima do papel (ESCOLHIDA pelo usuário).** O papel continua decidindo o que dá para fazer; o grupo restringe quais telas. Sem grupo, tudo continua como hoje.
- B — Lista de "telas bloqueadas" na ficha de cada usuário. Mais simples, mas obriga a repetir a configuração para cada pessoa com o mesmo perfil.
- Esconder só no menu — descartada: não protege nada para quem conhece a URL.

## Como funciona

### Modelo

- `UserGroup { id, name @unique, screens String[], createdAt, updatedAt }`.
- `User.groupId String?`, com relação opcional para `UserGroup` e `onDelete: SetNull`.
- Excluir um grupo deixa seus membros sem grupo, ou seja, sem restrição. **A tela de exclusão avisa isso.**

### Telas (chaves fixas no código, uma lista só no backend e espelhada no front)

`dashboard`, `agenda`, `triagem`, `campo`, `clientes`, `ativos`, `contratos`, `crm`, `orcamentos`, `catalogo`, `estoque`, `base-conhecimento`, `config`.

- **Chamados / OS fica sempre liberado.** É a tela inicial (`/app`) e o centro do sistema. *(Decisão minha.)*
- A visibilidade por papel que já existe continua valendo. Exemplo: `campo` só aparece para AGENT. O grupo só **tira** telas, nunca acrescenta.

### Regras

1. **Sem grupo** → comportamento atual.
2. **Com grupo** → só as telas marcadas. O papel continua decidindo o que dá para fazer dentro delas.
3. **Gestão de grupos e troca de grupo de usuário: só ADMIN sem grupo** ("admin pleno"). Na aba Usuários, um admin com grupo não vê o campo Grupo nem a aba Grupos, e a API recusa a troca com 403. Isso fecha o anti-objetivo de alguém se autopromover. *(Decisão minha.)*
4. **Seletores continuam abertos.** Os `GET` de lista usados como seletor em outras telas (clientes, locais, ativos, categorias, catálogo, usuários internos etc.) não são bloqueados por tela, só pelo papel, como hoje. A tela bloqueia as páginas do módulo, o detalhe e as escritas.

### Backend

- Novo decorator `@Screen('crm')`, usado na classe do controller ou no método, e novo `ScreenGuard` global, registrado depois do `RolesGuard` em `common.module.ts`.
- O guard só age se a rota tiver `@Screen` e o usuário for interno com grupo. Ele busca o grupo atual no banco (não usa o JWT), para que mudar o grupo valha na hora, sem precisar de novo login.
  - `// ponytail:` uma query por request protegida. Se pesar, colocar um cache em memória invalidado ao salvar o grupo.
- Rotas de seletor (regra 4) ficam isentas, por exemplo com `@Screen()` sobrescrito no método ou com um `@SkipScreen()`. O mecanismo exato fica a critério do builder.
- Mapear os controllers para as telas. O alvo garantido é `crm`, mas todas as telas da lista precisam estar cobertas.
- CRUD `/api/user-groups` (ADMIN pleno). `PATCH` do usuário aceita `groupId` (ADMIN pleno).
- O `/me` (ou equivalente) passa a devolver `screens: string[] | null` (`null` = sem restrição).
- A auditoria já registra as escritas pelo interceptor global; não precisa de nada novo.

### Frontend

- `nav.tsx`: filtra os links por `user.screens`.
- Guarda de página: se a rota atual pertence a uma tela não permitida, redireciona para `/app` com um aviso "Sem acesso a esta tela". Basta um ponto central (layout do `/app` ou hook), não precisa ser uma checagem por página.
- Esconder também os pontos de entrada em outras telas, por exemplo a aba "Oportunidades" na ficha do cliente quando não há `crm`, e a seção "Orçamentos" no chamado quando não há `orcamentos`.
- Configurações → nova aba **Grupos** (nome + checkboxes das telas, contagem de membros). Aba Usuários ganha a coluna e o campo "Grupo" (só admin pleno).

### Testes

- Unit do `ScreenGuard`: sem grupo passa; com grupo sem a tela dá 403; rota isenta passa; usuário de portal não é afetado.
- Integração: usuário ADMIN com grupo sem `crm` → `GET /api/opportunities` dá 403, `GET /api/clients` (seletor) dá 200, `PATCH` do próprio `groupId` dá 403.
- E2E: o mesmo usuário não vê CRM no menu, e `/app/crm` redireciona.

### Deploy

Migração `add_user_groups` no boot. Nenhuma env nova. Versão 0.21.0.

## Deixado para o builder

- O mecanismo de isenção das rotas de seletor e a lista exata delas.
- O mapeamento controller → tela, rota a rota.
- Onde fica a lista compartilhada de telas no front (pode duplicar a constante, como já é feito com `template.util`).
