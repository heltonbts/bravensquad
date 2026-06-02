# Social Media

Agentes de conteúdo orgânico — alimentar o feed das redes com volume, voz e consistência (sem mídia paga).

## Agente operacional

- **gary-vaynerchuk** — Operador de conteúdo orgânico & estratégia de atenção. Cérebro do agente que **publica direto no feed do Instagram**.

## Como executa (não só aconselha)

O cérebro é o **Claude Code** adotando a persona; as mãos são o MCP **`instagram-agent`** (`mcp/instagram-server.ts`): verifica a conexão, lê posts recentes, gera a imagem (gpt-image-1) e **publica a foto no feed**. Para leigos, a skill **`/instagram`** conduz tudo por perguntas simples.

**Regra de ouro:** nada vai pro feed sem a pessoa ver imagem + legenda e dizer "sim" — publicar é a única ação pública e irreversível.

Para **mídia paga** (anúncios), o agente é o Pedro Sobral em `traffic-masters` + skill `/trafego`.
