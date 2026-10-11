# Roadmap — Sistema de OS

Produto comercial de ordens de serviço para empresas de **TI + segurança
eletrônica** (CFTV, alarme, controle de acesso, cerca elétrica, portões,
interfonia, redes). As duas verticais compartilham o mesmo fluxo: parque de
equipamentos instalado em locais do cliente, contratos de manutenção, visitas
preventivas e corretivas, técnico em campo, peças.

Cada fase é pedida em uma **sessão de conversa separada**: brainstorming →
spec → plano → execução (skill superpowers), fechando com release SemVer +
CHANGELOG.

## Concluído

| Versão | Entrega |
|---|---|
| 0.1.0 | MVP de helpdesk: Chamados (numeração, SLA por prioridade, transições, visibilidade por papel, triagem), andamentos interno/público, anexos, Clientes, Categorias, Usuários (ADMIN/AGENT/MANAGER/CONTACT), auth JWT, e-mail Resend (saída + inbound), portal do cliente, cron de SLA |
| 0.1.1 | Deploy: stack Portainer + Cloudflare Tunnel; hardening de auth (helmet, rate limit, reuse detection de refresh token, correção de IDOR em anexos) |
| 0.2.0 | Configurações no app (Resend, S3, aparência, backup) com segredos criptografados no banco; driver de storage S3; backup export/import + cron diário; white-label (logo, nome, cor) |

O núcleo de "inbox" está resolvido. As fases a seguir transformam isso num
sistema de OS de campo para a vertical.

## Fases planejadas

Caminho crítico: **Ativos → Agenda → Contratos**. Tudo depois de 0.3.0
referencia ativo.

### 0.3.0 — Ativos + Locais · *identidade da vertical*
- **Local/Site** por cliente: endereço, contato no local, observações de acesso
  (chave, horário, cão, síndico)
- **Ativo/Equipamento**: tipo (câmera, DVR/NVR, switch, no-break, controladora
  de acesso, central de alarme, cerca elétrica, catraca, fechadura, roteador…),
  marca/modelo, nº série, IP/MAC, data de instalação, garantia, local, foto,
  status
- Chamado referencia 1+ ativos
- Histórico de intervenções por ativo (deriva dos chamados)
- Importação CSV de ativos (onboarding de cliente novo)

Risco baixo: poucos campos novos, modelo simples.

### 0.4.0 — Agenda e execução em campo
Esse mercado é 80% trabalho no local.
- Agendamento de visita vinculada ao chamado (data/janela, técnico)
- Agenda por técnico / por dia
- Check-in / check-out no local (horário; GPS opcional)
- Checklist de visita por tipo de serviço + fotos antes/depois
- Assinatura do cliente no atendimento (canvas → imagem)
- Apontamento de horas
- Laudo de atendimento em PDF enviado ao cliente
- Front responsivo para o celular do técnico (**online**). Offline real só
  depois que o fluxo online provar valor.
- **Ativos e locais no portal do cliente** (só leitura, sem credenciais nem
  notas internas; cliente escolhe local/ativo ao abrir chamado) — adiado da
  0.3.0 para cá, junto do laudo e do histórico que dão o que mostrar.
- Avaliar puxar **WhatsApp como canal** para dentro desta fase.

### 0.5.0 — Contratos de manutenção recorrente
Receita recorrente — a razão comercial do produto.
- Contrato por cliente: vigência, valor mensal, escopo (locais/ativos cobertos),
  franquia (nº de visitas ou horas/mês), SLA do contrato
- Geração automática de chamados preventivos no calendário do contrato
- Consumo de franquia por chamado; excedente sinalizado
- Renovação / reajuste

### 0.6.0 — Catálogo, orçamento e estoque
Cobre o trabalho fora de contrato (instalação, expansão, troca de equipamento)
e dá custo real ao chamado.
- Catálogo de serviços e produtos (preço, unidade)
- Estoque de materiais: saldo, entrada/saída amarrada ao chamado, requisição,
  estoque mínimo, múltiplos depósitos (inclusive "van do técnico")
- Orçamento: itens do catálogo + mão de obra, versionado, aprovação do cliente
  por link, vira chamado/visita

### 0.7.0 — Gestão, SLA real e satisfação
- Dashboard: chamados abertos/vencidos, tempo médio de atendimento,
  produtividade por técnico, recorrente vs avulso, consumo de franquia por
  contrato, margem por chamado
- SLA "de verdade": pausa em "aguardando cliente", SLA por categoria/contrato
- CSAT/NPS pós-chamado
- Base de conhecimento (procedimentos, manuais por modelo de equipamento)

### CRM — funil de vendas e relacionamento *(inserida fora da sequência original, entre 0.7.0 e 0.8.0)*
- `Opportunity` único (lead ou cliente existente), estágios fixos, timeline
  de notas, follow-up agendado
- Ganho sem cliente prévio cria Cliente automaticamente; link opcional a
  Orçamento
- 100% interno (`ADMIN`/`AGENT`)

Fora de escopo por ora: metas/comissão de vendedor (isso é 0.8.0), relatórios
de funil, importação de leads, estágios configuráveis.

### 0.8.0 — Financeiro e fiscal
- Faturamento recorrente (contrato) + avulso (orçamento aprovado)
- Contas a receber, baixa de pagamento, inadimplência
- Emissão de NFS-e (via API — PlugNotas / Focus NFe / eNotas)
- Cobrança: PIX / boleto / link de pagamento
- Comissão de técnico e vendedor

## Transversal — encaixar entre fases, não deixar para o fim

| Item | Quando |
|---|---|
| **CI** (build + testes + push de imagem) | Antes da 0.3.0 — já está doendo |
| **WhatsApp como canal** (Meta Cloud API ou provedor) | Quase obrigatório na vertical; candidato à 0.4.0 |
| **WhatsApp: buscar grupos da Evolution** (escolher o grupo numa lista em vez de colar o ID) | Depois da fase 1 do WhatsApp (`2026-10-11-whatsapp-canal-design.md`) |
| **Svix no webhook inbound** | Antes de ligar o inbound em produção |
| **pg_dump agendado** | Cedo — o backup atual é lógico da app, não do Postgres |
| **Realtime na fila** (SSE) | Quando o nº de agentes crescer |
| **Multi-tenant** | Só quando for vender como SaaS para fora; hoje single-tenant |

## Design

Fazer **agora**, leve: um documento de padrões de UI (navegação, listas com
filtro, tela de detalhe com timeline, formulários, estados vazios, layout
mobile do técnico) apoiado nos tokens que o white-label já expõe. As fases
0.3–0.6 adicionam muitas telas novas; sem padrão comum, cada sessão inventa o
seu e o produto vira colcha de retalhos.

Deixar para **depois** (após ~0.6.0, quando existir superfície real para
desenhar): identidade visual própria / redesenho, ilustrações, onboarding
guiado, tema do portal do cliente.
