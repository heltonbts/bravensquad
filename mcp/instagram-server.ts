#!/usr/bin/env node
import 'dotenv/config';

import fs from 'fs';
import path from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { getMetaConfig } from '../src/lib/meta/client';
import { generateCreative } from '../src/lib/images/openai';
import {
  getIgAccount,
  getRecentMedia,
  uploadPublicImageUrl,
  publishFeedPhoto,
} from '../src/lib/meta/instagram';

// ============================================================
// MCP: Agente de Feed do Instagram
// O cerebro e o Claude Code — ele le a persona (squads/social-media), conversa
// com voce (human-in-the-loop) e usa estas ferramentas pra EXECUTAR.
// Publicar e a unica acao publica/irreversivel: so depois do "sim" da pessoa.
// Imagem e gravada em disco (fica fora do contexto do modelo); o caminho viaja
// entre as ferramentas. Pra publicar, a imagem e hospedada numa URL publica.
// ============================================================

const POSTS_DIR = path.join(process.cwd(), 'posts');

const server = new McpServer({ name: 'instagram-agent', version: '1.0.0' });

// --- 1) Sanity check da conexao com o Instagram (rode antes de tudo) ---
server.registerTool(
  'check_ig_connection',
  {
    title: 'Verificar conexao Instagram',
    description:
      'Confere se a conta IG Business/Creator esta vinculada e o token tem permissao, retornando @usuario, seguidores e total de posts. Use isto primeiro.',
    inputSchema: {},
  },
  async () => {
    const cfg = getMetaConfig();
    const acc = await getIgAccount(cfg);
    return {
      content: [
        {
          type: 'text',
          text:
            `Conectado: @${acc.username}` +
            (acc.name ? ` (${acc.name})` : '') +
            ` | ${acc.followers_count} seguidores | ${acc.media_count} posts`,
        },
      ],
    };
  },
);

// --- 2) Ler posts recentes (read-only) — pra casar a voz e nao repetir ---
server.registerTool(
  'get_recent_posts',
  {
    title: 'Ler posts recentes',
    description:
      'Le as ultimas publicacoes do feed (legenda, link, curtidas e comentarios). ' +
      'Use pra entender o tom/voz da conta e evitar repetir tema. So leitura — nao altera nada.',
    inputSchema: {
      limit: z.number().int().min(1).max(12).default(6).describe('Quantos posts trazer (1 a 12).'),
    },
  },
  async ({ limit }) => {
    const cfg = getMetaConfig();
    const posts = await getRecentMedia(cfg, limit);
    if (!posts.length) {
      return { content: [{ type: 'text', text: 'A conta ainda nao tem posts publicados.' }] };
    }
    const lines = posts.map((p, i) => {
      const cap = (p.caption ?? '').replace(/\s+/g, ' ').trim();
      const short = cap.length > 140 ? `${cap.slice(0, 140)}…` : cap || '(sem legenda)';
      return (
        `${i + 1}. ${short}\n` +
        `   ❤️ ${p.like_count ?? 0} | 💬 ${p.comments_count ?? 0} | ${p.permalink}`
      );
    });
    return { content: [{ type: 'text', text: `Ultimos ${posts.length} posts:\n\n${lines.join('\n\n')}` }] };
  },
);

// --- 3) Gerar a imagem do post (gpt-image-1) → grava em disco, devolve caminho ---
server.registerTool(
  'generate_post_image',
  {
    title: 'Gerar imagem do post',
    description:
      'Gera a imagem do post com gpt-image-1 a partir de um prompt (em ingles). Salva em ./posts e retorna o caminho do arquivo — passe esse caminho para publish_feed_post.',
    inputSchema: {
      prompt: z.string().describe('Prompt detalhado em ingles. Sem texto sobreposto, salvo se pedido.'),
      size: z
        .enum(['1024x1024', '1024x1536'])
        .default('1024x1024')
        .describe('1024x1024 = quadrado (feed padrao); 1024x1536 = retrato (feed vertical).'),
    },
  },
  async ({ prompt, size }) => {
    const b64 = await generateCreative(prompt, size);
    fs.mkdirSync(POSTS_DIR, { recursive: true });
    const file = path.join(POSTS_DIR, `post-${Date.now()}.png`);
    fs.writeFileSync(file, Buffer.from(b64, 'base64'));
    return { content: [{ type: 'text', text: `Imagem gerada: ${file}` }] };
  },
);

// --- 4) Publicar no feed (CONFIRMAR com a pessoa antes — acao publica) ---
server.registerTool(
  'publish_feed_post',
  {
    title: 'Publicar no feed (PUBLICO)',
    description:
      'Publica uma FOTO UNICA no feed do Instagram com a legenda. ' +
      'Esta acao e PUBLICA e IRREVERSIVEL (vai pro feed na hora) — SEMPRE confirme com a pessoa, ' +
      'mostrando a imagem e a legenda, e so chame depois de um "sim" explicito. ' +
      'Requer o caminho da imagem gerada por generate_post_image.',
    inputSchema: {
      imagePath: z.string().describe('Caminho do arquivo retornado por generate_post_image.'),
      caption: z.string().describe('Legenda completa do post (texto + hashtags), em pt-BR.'),
    },
  },
  async ({ imagePath, caption }) => {
    const cfg = getMetaConfig();
    if (!fs.existsSync(imagePath)) {
      throw new Error(`Imagem nao encontrada: ${imagePath}. Gere com generate_post_image primeiro.`);
    }
    const b64 = fs.readFileSync(imagePath).toString('base64');
    const imageUrl = await uploadPublicImageUrl(b64, cfg);
    const r = await publishFeedPhoto({ imageUrl, caption }, cfg);
    return {
      content: [
        {
          type: 'text',
          text: `Publicado no feed! 🎉\nPost: ${r.permalink}\n(id ${r.mediaId})`,
        },
      ],
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('instagram-agent MCP server failed:', err);
  process.exit(1);
});
