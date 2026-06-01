#!/usr/bin/env node
import 'dotenv/config';

import fs from 'fs';
import path from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { getMetaConfig, graph } from '../src/lib/meta/client';
import { launchPausedCampaign } from '../src/lib/meta/campaigns';
import { generateCreative } from '../src/lib/images/openai';
import { getInsights, setStatus, updateAdSetBudget } from '../src/lib/meta/insights';
import type { CampaignPlan } from '../src/lib/meta/types';

// ============================================================
// MCP: Agente de Trafego Pago
// O cerebro e o Claude Code — ele le a persona (squads/traffic-masters), conversa
// com voce (human-in-the-loop) e usa estas ferramentas pra EXECUTAR.
// Tudo criado na Meta nasce PAUSADO. Imagem e gravada em disco (fica fora do
// contexto do modelo); o caminho do arquivo viaja entre as ferramentas.
// ============================================================

const CREATIVES_DIR = path.join(process.cwd(), 'creatives');

const server = new McpServer({ name: 'traffic-agent', version: '1.0.0' });

// --- 1) Sanity check da conexao com a Meta (rode antes de gastar tokens) ---
server.registerTool(
  'check_meta_connection',
  {
    title: 'Verificar conexao Meta',
    description:
      'Confere se o token e o Ad Account estao configurados, retornando nome, moeda e status da conta. Use isto primeiro.',
    inputSchema: {},
  },
  async () => {
    const cfg = getMetaConfig();
    const acc = await graph<{ name: string; currency: string; account_status: number }>(
      cfg.adAccountId,
      { token: cfg.token, params: { fields: 'name,currency,account_status' } },
    );
    const sandbox = process.env.META_AD_ACCOUNT_ID?.includes('sandbox') ? ' (parece SANDBOX)' : '';
    return {
      content: [
        {
          type: 'text',
          text:
            `Conectado: ${acc.name} | moeda ${acc.currency} | status ${acc.account_status}${sandbox}\n` +
            `Ad Account: ${cfg.adAccountId} | Page: ${cfg.pageId}` +
            (cfg.igAccountId ? ` | IG: ${cfg.igAccountId}` : ''),
        },
      ],
    };
  },
);

// --- 2) Gerar criativo (gpt-image-1) → grava em disco, devolve o caminho ---
server.registerTool(
  'generate_creative',
  {
    title: 'Gerar criativo (imagem)',
    description:
      'Gera a imagem do anuncio com gpt-image-1 a partir de um prompt (em ingles). Salva em ./creatives e retorna o caminho do arquivo — passe esse caminho para create_paused_campaign.',
    inputSchema: {
      prompt: z.string().describe('Prompt detalhado em ingles. Sem texto sobreposto, salvo se pedido.'),
      size: z
        .enum(['1024x1024', '1024x1536', '1536x1024'])
        .default('1024x1024')
        .describe('1:1 feed, 2:3 stories/reels, 3:2 paisagem.'),
    },
  },
  async ({ prompt, size }) => {
    const b64 = await generateCreative(prompt, size);
    fs.mkdirSync(CREATIVES_DIR, { recursive: true });
    const file = path.join(CREATIVES_DIR, `creative-${Date.now()}.png`);
    fs.writeFileSync(file, Buffer.from(b64, 'base64'));
    return { content: [{ type: 'text', text: `Criativo gerado: ${file}` }] };
  },
);

// --- 3) Criar campanha PAUSADA na Meta (Campaign → AdSet → Creative → Ad) ---
server.registerTool(
  'create_paused_campaign',
  {
    title: 'Criar campanha (PAUSADA)',
    description:
      'Cria a estrutura completa na Meta SEMPRE em status PAUSED. Nada vai pro ar ate voce ativar no Gerenciador. Requer o caminho da imagem gerada por generate_creative.',
    inputSchema: {
      imagePath: z.string().describe('Caminho do arquivo retornado por generate_creative.'),
      campaignName: z.string(),
      objective: z.enum(['OUTCOME_TRAFFIC', 'OUTCOME_AWARENESS', 'OUTCOME_ENGAGEMENT']),
      dailyBudgetBRL: z.number().positive().describe('Orcamento diario em reais (ex: 50 = R$50/dia).'),
      audience: z.object({
        countries: z.array(z.string()).describe('ISO-2, ex: ["BR"]'),
        age_min: z.number().int().min(13).max(65),
        age_max: z.number().int().min(13).max(65),
        genders: z.array(z.union([z.literal(1), z.literal(2)])).default([]),
        interests: z.array(z.string()).default([]).describe('Nomes de interesses Meta; resolvidos para IDs.'),
      }),
      creative: z.object({
        primaryText: z.string(),
        headline: z.string(),
        description: z.string(),
        cta: z.enum([
          'LEARN_MORE',
          'SHOP_NOW',
          'SIGN_UP',
          'BOOK_TRAVEL',
          'CONTACT_US',
          'SUBSCRIBE',
          'GET_OFFER',
          'SEND_MESSAGE',
        ]),
        linkUrl: z.string().url(),
      }),
    },
  },
  async (args) => {
    const cfg = getMetaConfig();
    if (!fs.existsSync(args.imagePath)) {
      throw new Error(`Imagem nao encontrada: ${args.imagePath}. Gere com generate_creative primeiro.`);
    }
    const b64 = fs.readFileSync(args.imagePath).toString('base64');

    const plan: CampaignPlan = {
      campaignName: args.campaignName,
      objective: args.objective,
      dailyBudgetBRL: args.dailyBudgetBRL,
      audience: args.audience,
      creative: { ...args.creative, imagePrompt: '' },
      rationale: '',
    };

    const r = await launchPausedCampaign(plan, b64, cfg);
    return {
      content: [
        {
          type: 'text',
          text:
            `Campanha criada PAUSADA. Nada esta veiculando ainda.\n` +
            `Campaign: ${r.campaignId}\nAdSet: ${r.adSetId}\nAd: ${r.adId}\n` +
            `Revise e ative no Gerenciador: ${r.adsManagerUrl}`,
        },
      ],
    };
  },
);

// --- 4) Ler desempenho (Insights API) — read-only, base pra otimizar ---
server.registerTool(
  'get_campaign_insights',
  {
    title: 'Ler desempenho (insights)',
    description:
      'Le metricas reais da Meta (gasto, impressoes, alcance, cliques, CTR, CPC, CPM e custo por resultado). ' +
      'Sem objectId, traz a conta inteira por campanha. Passe um campaignId/adSetId e level pra detalhar. ' +
      'Use isto pra decidir otimizacoes. So leitura — nao altera nada.',
    inputSchema: {
      objectId: z
        .string()
        .optional()
        .describe('ID de campanha/conjunto/anuncio. Vazio = conta inteira.'),
      level: z
        .enum(['account', 'campaign', 'adset', 'ad'])
        .default('campaign')
        .describe('Detalhamento das linhas retornadas.'),
      datePreset: z
        .enum(['today', 'yesterday', 'last_3d', 'last_7d', 'last_14d', 'last_30d', 'maximum'])
        .default('last_7d')
        .describe('Janela de tempo.'),
    },
  },
  async ({ objectId, level, datePreset }) => {
    const cfg = getMetaConfig();
    const rows = await getInsights({ objectId, level, datePreset }, cfg);
    if (!rows.length) {
      return { content: [{ type: 'text', text: `Sem dados para ${datePreset} (nada veiculou ainda?).` }] };
    }
    const lines = rows.map((r) => {
      const cpr = r.costPerResult != null ? `R$${r.costPerResult.toFixed(2)}` : '—';
      return (
        `• ${r.name}${r.id ? ` [${r.id}]` : ''}\n` +
        `   gasto R$${r.spend.toFixed(2)} | impr ${r.impressions} | alcance ${r.reach} | freq ${r.frequency.toFixed(2)}\n` +
        `   cliques ${r.clicks} | CTR ${r.ctr.toFixed(2)}% | CPC R$${r.cpc.toFixed(2)} | CPM R$${r.cpm.toFixed(2)}\n` +
        `   resultados ${r.results} | custo/resultado ${cpr}`
      );
    });
    return {
      content: [{ type: 'text', text: `Desempenho (${datePreset}, nivel ${level}):\n\n${lines.join('\n\n')}` }],
    };
  },
);

// --- 5) Ajustar orcamento diario do conjunto (otimizacao automatica) ---
server.registerTool(
  'adjust_budget',
  {
    title: 'Ajustar orcamento diario',
    description:
      'Atualiza o orcamento DIARIO (em reais) de um conjunto de anuncios (ad set). ' +
      'Pode aplicar direto como parte da otimizacao automatica — nao tira nada do ar, so muda o quanto investe por dia.',
    inputSchema: {
      adSetId: z.string().describe('ID do conjunto de anuncios (ad set).'),
      newDailyBudgetBRL: z.number().positive().describe('Novo orcamento diario em reais (ex: 80 = R$80/dia).'),
    },
  },
  async ({ adSetId, newDailyBudgetBRL }) => {
    const cfg = getMetaConfig();
    const cents = await updateAdSetBudget(adSetId, newDailyBudgetBRL, cfg);
    return {
      content: [
        { type: 'text', text: `Orcamento do conjunto ${adSetId} atualizado para R$${(cents / 100).toFixed(2)}/dia.` },
      ],
    };
  },
);

// --- 6) Pausar / reativar (CONFIRMAR com a pessoa antes) ---
server.registerTool(
  'set_campaign_status',
  {
    title: 'Pausar ou reativar',
    description:
      'Liga (ACTIVE) ou pausa (PAUSED) uma campanha, conjunto ou anuncio. ' +
      'PAUSAR interrompe a veiculacao; ATIVAR coloca no ar e passa a gastar. ' +
      'Estas duas acoes afetam o que esta no ar — SEMPRE confirme com a pessoa antes de chamar.',
    inputSchema: {
      id: z.string().describe('ID da campanha, conjunto ou anuncio.'),
      status: z.enum(['ACTIVE', 'PAUSED']),
    },
  },
  async ({ id, status }) => {
    const cfg = getMetaConfig();
    await setStatus(id, status, cfg);
    const verbo = status === 'PAUSED' ? 'PAUSADO' : 'ATIVADO (no ar)';
    return { content: [{ type: 'text', text: `${id} agora esta ${verbo}.` }] };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('traffic-agent MCP server failed:', err);
  process.exit(1);
});
