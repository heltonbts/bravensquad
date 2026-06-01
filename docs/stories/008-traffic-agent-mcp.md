# 008 — Agente de Tráfego Pago (MCP)

O **cérebro é o Claude Code**: ele adota a persona Pedro Sobral, conversa com você
(human-in-the-loop) e usa um **MCP server** pra executar de verdade na Meta. Tudo
nasce **PAUSADO** — nada veicula até você ativar no Gerenciador.

## Arquitetura

```
Claude Code (cérebro)
  ├─ contexto: squads/traffic-masters/agents/pedro-sobral.md  (a persona)
  ├─ conversa com você → planeja campanha + copy + prompt do criativo
  └─ MCP "traffic-agent" (mcp/traffic-server.ts) — as ferramentas:
        ├─ check_meta_connection      → valida token/conta
        ├─ generate_creative(prompt)  → gpt-image-1, salva em ./creatives, devolve o caminho
        ├─ create_paused_campaign(..) → Meta Marketing API: Campaign→AdSet→Creative→Ad (PAUSED)
        ├─ get_campaign_insights(..)  → Insights API: gasto, cliques, CTR, CPC, custo/resultado (read-only)
        ├─ adjust_budget(..)          → muda o daily_budget do ad set (automatico; nao tira do ar)
        └─ set_campaign_status(..)    → pausa/reativa campanha|conjunto|anuncio (confirmar antes)
```

- **Tokens/credenciais**: só no processo do MCP (lidos de `.env` via dotenv). Nunca entram no contexto do modelo.
- **Imagem**: gravada em disco; só o *caminho* trafega entre ferramentas (blob fora do contexto).

## Setup

1. `cp .env.example .env` e preencha:
   - `META_SYSTEM_USER_TOKEN`, `META_AD_ACCOUNT_ID` (com `act_`), `META_PAGE_ID` (e `META_IG_ACCOUNT_ID` se quiser IG)
   - `OPENAI_API_KEY`
   - 💡 Comece com um **Ad Account Sandbox** em `META_AD_ACCOUNT_ID` — testa sem gastar.
2. O MCP já está registrado em `.mcp.json`. Rode `/mcp` no Claude Code e aprove o `traffic-agent`.
3. Sanidade: peça pra rodar `check_meta_connection`.

## Playbook (como o Claude Code opera)

1. **Vira Pedro Sobral** — carrega `squads/traffic-masters/agents/pedro-sobral.md`.
2. **Briefing** — pergunta objetivo, oferta, público, orçamento/dia, URL de destino.
3. **Planeja** — monta objetivo (`OUTCOME_TRAFFIC` / `AWARENESS` / `ENGAGEMENT`), público (país/idade/gênero/interesses), copy (primary text, headline, description, CTA) e o prompt do criativo (inglês).
4. **Gera o criativo** — `generate_creative` e te mostra a imagem pra aprovar.
5. **Confirma o plano** — revisa tudo com você ANTES de criar.
6. **Cria PAUSADO** — `create_paused_campaign` e devolve o link do Gerenciador.
7. **Você ativa** manualmente no Gerenciador depois de conferir.

### Otimizacao (depois que esta no ar)

8. **Le o desempenho** — `get_campaign_insights` (gasto, cliques, CTR, custo/resultado).
9. **Decide e age sozinho no budget** — `adjust_budget` sobe o investimento do que vai bem e reduz o que vai mal. Ajuste de orcamento e **automatico** (nao tira nada do ar).
10. **Pausar/reativar so com confirmacao** — `set_campaign_status` so e chamado depois de a pessoa dizer "sim". Sao as unicas acoes que mexem no que esta veiculando.

## Uso por leigo: skill `/trafego`

Para vender a pessoas não-técnicas: a skill `.claude/skills/trafego/` empacota a
persona + um **fluxo guiado por perguntas simples** (sem jargão) por cima deste MCP.
O leigo digita `/trafego` e só responde; o setup técnico (token, MCP, Claude Desktop)
é feito uma vez pelo operador. Ideal: **Claude Desktop** (GUI) em vez do terminal.

## Limites do MVP

- Objetivos com pixel/conversão (`OUTCOME_LEADS`, `OUTCOME_SALES`) ficam de fora — exigem pixel/promoted_object configurados.
- Posicionamentos automáticos (Advantage+ placements).
- Um conjunto de anúncios + um anúncio por campanha.
