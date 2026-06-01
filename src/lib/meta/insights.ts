// Leitura de desempenho (Insights API) e acoes de otimizacao (budget / status).
// So fetch, via o wrapper graph(). Roda no processo do MCP — token nunca vai pro modelo.

import { graph, type MetaConfig } from './client';

export type InsightLevel = 'account' | 'campaign' | 'adset' | 'ad';

/** Janelas pre-definidas da Meta. */
export type DatePreset =
  | 'today'
  | 'yesterday'
  | 'last_3d'
  | 'last_7d'
  | 'last_14d'
  | 'last_30d'
  | 'maximum';

/** Uma linha de desempenho ja parseada (numeros, nao strings). */
export interface InsightRow {
  /** ID da entidade (campaign/adset/ad) — vazio no nivel account. */
  id: string;
  name: string;
  spend: number;
  impressions: number;
  reach: number;
  frequency: number;
  clicks: number;
  /** Click-through rate em %. */
  ctr: number;
  /** Custo por clique no link. */
  cpc: number;
  /** Custo por mil impressoes. */
  cpm: number;
  /** Resultado principal conforme o objetivo (cliques no link, etc.), quando disponivel. */
  results: number;
  /** Custo por resultado (spend / results), quando ha resultados. */
  costPerResult: number | null;
}

const FIELDS = [
  'campaign_id',
  'campaign_name',
  'adset_id',
  'adset_name',
  'ad_id',
  'ad_name',
  'spend',
  'impressions',
  'reach',
  'frequency',
  'clicks',
  'ctr',
  'cpc',
  'cpm',
  'actions',
].join(',');

interface RawInsight {
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  frequency?: string;
  clicks?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  actions?: { action_type: string; value: string }[];
}

const num = (v: string | undefined): number => (v == null ? 0 : Number(v) || 0);

/** Extrai o "resultado" mais relevante das actions (clique no link de preferencia). */
function pickResults(actions?: { action_type: string; value: string }[]): number {
  if (!actions?.length) return 0;
  const find = (t: string) => actions.find((a) => a.action_type === t);
  const hit =
    find('link_click') ||
    find('landing_page_view') ||
    find('post_engagement') ||
    find('onsite_conversion.messaging_conversation_started_7d');
  return hit ? Number(hit.value) || 0 : 0;
}

function parseRow(level: InsightLevel, r: RawInsight): InsightRow {
  const id =
    level === 'ad'
      ? r.ad_id
      : level === 'adset'
        ? r.adset_id
        : level === 'campaign'
          ? r.campaign_id
          : '';
  const name =
    level === 'ad'
      ? r.ad_name
      : level === 'adset'
        ? r.adset_name
        : level === 'campaign'
          ? r.campaign_name
          : 'Conta';
  const spend = num(r.spend);
  const results = pickResults(r.actions);
  return {
    id: id || '',
    name: name || '(sem nome)',
    spend,
    impressions: num(r.impressions),
    reach: num(r.reach),
    frequency: num(r.frequency),
    clicks: num(r.clicks),
    ctr: num(r.ctr),
    cpc: num(r.cpc),
    cpm: num(r.cpm),
    results,
    costPerResult: results > 0 ? spend / results : null,
  };
}

/**
 * Le o desempenho via Insights API. Se `objectId` vier, consulta aquela entidade;
 * senao, a conta inteira. `level` define o detalhamento das linhas retornadas.
 */
export async function getInsights(
  opts: { objectId?: string; level?: InsightLevel; datePreset?: DatePreset },
  cfg: MetaConfig,
): Promise<InsightRow[]> {
  const level = opts.level ?? 'campaign';
  const node = opts.objectId || cfg.adAccountId;
  const r = await graph<{ data: RawInsight[] }>(`${node}/insights`, {
    token: cfg.token,
    params: {
      level,
      date_preset: opts.datePreset ?? 'last_7d',
      fields: FIELDS,
      limit: 200,
    },
  });
  return (r.data ?? []).map((row) => parseRow(level, row));
}

/**
 * Atualiza o orcamento DIARIO de um conjunto de anuncios (ad set).
 * As campanhas criadas por este agente tem o budget no ad set.
 * @returns o novo valor em centavos efetivamente aplicado.
 */
export async function updateAdSetBudget(
  adSetId: string,
  dailyBudgetBRL: number,
  cfg: MetaConfig,
): Promise<number> {
  const cents = Math.round(dailyBudgetBRL * 100);
  if (cents < 100) throw new Error('Orcamento diario minimo invalido (< R$1).');
  await graph(adSetId, {
    method: 'POST',
    token: cfg.token,
    params: { daily_budget: cents },
  });
  return cents;
}

/**
 * Liga (ACTIVE) ou pausa (PAUSED) uma campanha, conjunto ou anuncio (qualquer um aceita `status`).
 * ATIVAR coloca no ar (passa a gastar); PAUSAR interrompe. Confirme com a pessoa antes.
 */
export async function setStatus(
  id: string,
  status: 'ACTIVE' | 'PAUSED',
  cfg: MetaConfig,
): Promise<void> {
  await graph(id, { method: 'POST', token: cfg.token, params: { status } });
}
