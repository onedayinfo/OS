# Webhook de eventos externos — design

**Data:** 2026-11-12 · **Status:** aprovado (2026-11-12)

## 1. Objetivo
Permitir que sistemas e dispositivos externos (Zabbix, Uptime Kuma, central de alarme, NVR, scripts) abram chamados no OS mandando um `POST` JSON.

## 2. Decisões (do brainstorm)
- **Ação:** cada evento abre chamado; se já existe chamado **não fechado** para o mesmo `externalId` daquela integração, só adiciona um andamento interno (deduplicação).
- **Autenticação:** token **por integração**, cadastrado em Config. Cada integração tem cliente fixo. Revogar uma não afeta as outras.
- **Formato:** JSON genérico próprio (sem adaptadores por ferramenta nesta fase).

## 3. Modelo
```prisma
model Integration {
  id          String   @id @default(cuid())
  name        String              // "Zabbix — Cliente X"
  clientId    String
  categoryId  String?             // categoria padrão dos chamados
  tokenHash   String   @unique    // sha256 do token; token puro só aparece 1x na criação
  active      Boolean  @default(true)
  lastEventAt DateTime?
  createdAt   DateTime @default(now())
  client      Client   @relation(...)
  category    Category? @relation(...)
}
```
`Ticket.integrationId?` + `Ticket.externalId?` com índice `[integrationId, externalId]`. `TicketOrigin` ganha `INTEGRATION`.

## 4. Endpoint
`POST /api/integrations/events` · `@Public()` · header `Authorization: Bearer <token>` (ou `x-webhook-token`).

```json
{
  "title": "Servidor SRV01 sem resposta",      // obrigatório, ≤200
  "description": "ping falhou 3x",             // opcional, ≤10000
  "severity": "high",                          // low|medium|high|urgent → prioridade; padrão medium
  "externalId": "zabbix-12345",                // opcional; chave de deduplicação
  "assetSerial": "ABC123"                      // opcional; vincula ativo do cliente (e o local dele)
}
```
Respostas: `201 {ticketId, number, created: true}` · `200 {ticketId, number, created: false}` (dedup) · `401` token inválido/inativo · `400` payload inválido. Token comparado por hash (lookup por `tokenHash`). Rate limit próprio (60/min por IP, `express-rate-limit` já instalado).

Criação via método novo `TicketsService.createFromIntegration` (mesmo padrão sem ator de `createFromQuote`) — reaproveita numeração, SLA, vínculo de contrato (`resolveForTicket`) e notificações.

## 5. Frontend
Aba **Integrações** em `/app/config` (só ADMIN): lista (nome, cliente, ativo, último evento), criar (mostra o token **uma vez** + URL + exemplo `curl`), ativar/desativar, regenerar token, excluir. Chamado mostra origem "Integração: <nome>".

## 6. Fora de escopo (fase futura)
Fechamento automático no evento "resolvido"; adaptadores nativos (Zabbix/Grafana); webhooks de **saída** (OS notificando outros sistemas); fila/triagem de eventos.

## 7. Testes
Unit: hash/validação do token, mapeamento severity→prioridade, dedup (aberto → andamento; fechado → chamado novo), `assetSerial` de outro cliente ignorado. Integração (Postgres real): POST com token válido cria chamado; inativo → 401. Boot real (`start:prod`) uma vez, por causa do histórico de DI.
