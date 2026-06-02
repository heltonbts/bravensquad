# 009 — Agente de Feed do Instagram (MCP)

O **cérebro é o Claude Code**: ele adota a persona Gary Vaynerchuk, conversa com
você (human-in-the-loop) e usa um **MCP server** pra publicar de verdade no feed
do Instagram. Diferente do tráfego, **publicar é uma ação pública e irreversível**
— o post só vai pro feed depois de você ver imagem + legenda e dizer "sim".

MVP: **foto única no feed**, **post avulso guiado** (um post por vez).

## Arquitetura

```
Claude Code (cérebro)
  ├─ contexto: squads/social-media/agents/gary-vaynerchuk.md  (a persona)
  ├─ conversa com você → imagem + legenda + hashtags
  └─ MCP "instagram-agent" (mcp/instagram-server.ts) — as ferramentas:
        ├─ check_ig_connection        → valida conta IG Business (@user, seguidores)
        ├─ get_recent_posts(limit)    → últimos posts (read-only) p/ casar a voz e não repetir
        ├─ generate_post_image(prompt)→ gpt-image-1, salva em ./posts, devolve o caminho
        └─ publish_feed_post(..)      → publica FOTO ÚNICA no feed (confirmar antes)
```

- **Tokens/credenciais**: só no processo do MCP (lidos de `.env` via dotenv). Nunca entram no contexto do modelo.
- **Imagem**: gravada em disco; só o *caminho* trafega entre ferramentas (blob fora do contexto).
- Lib em `src/lib/meta/instagram.ts` (reusa `src/lib/meta/client.ts`).

## O ponto técnico central — URL pública

A **Instagram Content Publishing API** não aceita os bytes da imagem direto: ela
exige um **`image_url` público HTTPS** e baixa a imagem dos servidores da Meta.
O `gpt-image-1` devolve base64/arquivo local, que não é público.

**Solução (zero credencial nova):** `publish_feed_post` sobe os bytes em
`POST /{ad_account}/adimages` e usa a **`url` pública** retornada (CDN do Facebook)
como `image_url`. Reusa o mesmo token/conta da Meta do agente de tráfego.

**Fluxo de publicação** (`publishFeedPhoto` em `instagram.ts`):
1. `POST /{ig}/media` (`image_url` + `caption`) → `creation_id`.
2. Poll `GET /{creation_id}?fields=status_code` até `FINISHED` (foto é rápido; ~30s de margem).
3. `POST /{ig}/media_publish` (`creation_id`) → `mediaId`.
4. `GET /{mediaId}?fields=permalink` → link do post no ar.

**Risco a validar ao vivo:** se o fetcher do IG não baixar a URL do `/adimages`,
o passo 2 retorna `status_code: ERROR`. **Fallback:** subir como foto **não
publicada** na Página (`POST /{page-id}/photos` com `source` multipart,
`published=false&temporary=true`) e usar `images[0].source` como `image_url`.

## Setup

1. No mesmo `.env` do tráfego, garanta:
   - `META_IG_ACCOUNT_ID` (obrigatório aqui) — conta **IG Business/Creator** vinculada à `META_PAGE_ID`.
   - Token (`META_SYSTEM_USER_TOKEN`) com os escopos: `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`.
   - `META_AD_ACCOUNT_ID` (usado pra hospedar a imagem) e `OPENAI_API_KEY`.
2. O MCP já está registrado em `.mcp.json`. Rode `/mcp` no Claude Code e aprove o `instagram-agent`.
3. Sanidade: peça pra rodar `check_ig_connection`.

## Playbook (como o Claude Code opera)

1. **Vira Gary Vaynerchuk** — carrega `squads/social-media/agents/gary-vaynerchuk.md`.
2. **Tema** — pergunta sobre o que é o post.
3. **Voz** — `get_recent_posts` (silencioso) pra calibrar tom e não repetir.
4. **Imagem** — vira a descrição num prompt em inglês, roda `generate_post_image`, mostra e itera até aprovar.
5. **Legenda** — escreve gancho + corpo + CTA + 3-8 hashtags (pt-BR, no estilo).
6. **Confirma** — mostra imagem + legenda e pede "sim" (lembrando que vai pro ar na hora).
7. **Publica** — só com o "sim", `publish_feed_post`, e devolve o permalink.

## Uso por leigo: skill `/instagram`

A skill `.claude/skills/instagram/` empacota a persona + um **fluxo guiado por
perguntas simples** (sem jargão) por cima deste MCP. O leigo digita `/instagram`
e só responde; o setup técnico (token, escopos, MCP) é feito uma vez pelo operador.
Ideal: **Claude Desktop** (GUI) em vez do terminal.

## Limites do MVP

- Só **foto única** no feed. Carrossel, Reels/vídeo e Stories ficam de fora.
- Sem **agendamento/calendário recorrente** — é um post por vez, na hora.
- Sem edição de legenda pós-publicação e sem insights históricos.
- A conta precisa ser **IG Business/Creator** (contas pessoais não publicam via API).
