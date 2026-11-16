# Integrações — construtor de eventos (mapeamento por exemplo) — design

**Data:** 2026-11-16 · **Status:** aprovado (2026-11-16) · **Base:** 0.17.0 (webhook de eventos)

## 1. Problema
O webhook `POST /api/integrations/events` só aceita o nosso JSON (`title`, `severity`…). Equipamentos
como o UniFi Protect mandam o formato deles, sem permitir montar o corpo, e são recusados com 400.

## 2. Ideia
Cada integração aceita **qualquer JSON**. O OS guarda o último evento recebido como **exemplo**; na
tela da integração o técnico vê os campos desse exemplo e **liga cada campo do chamado** a eles.
A partir daí, todo evento é convertido em chamado com esse mapeamento.

## 3. Comportamento do endpoint
Mesma URL e mesmo token. O corpo é lido cru (como no webhook do WhatsApp), limite **2 MB** nesta rota.

1. Todo evento válido (token ok) grava `lastPayload` + `lastPayloadAt` na integração. Strings muito
   longas (> 500 caracteres, ex.: miniatura em base64) são cortadas no exemplo salvo.
2. Se a integração **tem mapeamento** → aplica o mapeamento e abre chamado (com dedup por `externalId`).
3. Senão, se o corpo tem `title` (nosso formato da 0.17.0) → funciona como hoje.
4. Senão → **modo captura**: responde `202 {captured: true}` sem abrir chamado.
5. Mapeamento que resulta em título vazio → `422` (e o exemplo fica salvo para corrigir).

## 4. Mapeamento
Guardado em `Integration.mapping` (JSON). Campos de texto usam **modelo com marcadores**, que cobre
"campo direto", "texto fixo" e "mistura":

| Campo do chamado | Exemplo de modelo |
|---|---|
| Título (obrigatório) | `{{alarm.name}}` ou `Câmera offline: {{alarm.triggers.0.device}}` |
| Descrição | `Gatilho {{alarm.triggers.0.key}} — {{alarm.eventLocalLink}}` |
| ID externo (dedup) | `{{alarm.name}}` |
| Nº de série do ativo | `{{alarm.triggers.0.device}}` |
| Prioridade | fixa (Baixa/Média/Alta/Urgente), padrão Média |

- Caminho com ponto e índice numérico para listas (`a.b.0.c`). Marcador inexistente vira vazio.
- Objeto/lista num marcador vira JSON compacto.

## 5. Tela (Config > Integrações > integração)
- Botão **Mapear campos** abre um painel com:
  - à esquerda, o **último evento recebido** como lista de caminhos → valor (clicar insere
    `{{caminho}}` no campo em foco); sem exemplo: aviso "Envie um evento de teste para esta URL";
  - à direita, os campos do chamado (modelos) + prioridade;
  - **pré-visualização** do chamado que seria aberto com o exemplo atual.
- Botão **Atualizar exemplo** (recarrega; útil depois de disparar um alarme real).
- Lista mostra o selo "Aguardando exemplo" / "Mapeada" / "Formato padrão".

## 6. Modelo
`Integration` ganha `mapping Json?`, `lastPayload Json?`, `lastPayloadAt DateTime?`. Migração aditiva.

## 7. Fora de escopo
Prioridade derivada de um campo (tabela valor→prioridade); condições/filtros (ex.: só abrir para certo
tipo de evento); fechamento automático; anexar a miniatura da câmera. Ficam para depois, se fizerem falta.

## 8. Testes
Unit: resolução de caminhos/modelos (índices, ausentes, objetos), truncamento do exemplo, as 4 rotas
do endpoint (mapeado, padrão, captura, título vazio). E2E manual com `curl` mandando um JSON no
formato do UniFi Protect: captura → mapeia → segundo envio abre chamado → terceiro faz dedup.
