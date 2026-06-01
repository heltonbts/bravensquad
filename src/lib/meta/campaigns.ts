import {
  adsManagerUrl,
  graph,
  searchInterests,
  uploadImageBytes,
  type MetaConfig,
} from './client';
import type { CampaignObjective, CampaignPlan, LaunchResult } from './types';

// Cada objetivo precisa de um par valido (optimization_goal + billing_event).
// MVP suporta os objetivos que NAO exigem pixel/promoted_object.
const OPTIMIZATION: Record<CampaignObjective, { goal: string; billing: string } | null> = {
  OUTCOME_TRAFFIC: { goal: 'LINK_CLICKS', billing: 'IMPRESSIONS' },
  OUTCOME_AWARENESS: { goal: 'REACH', billing: 'IMPRESSIONS' },
  OUTCOME_ENGAGEMENT: { goal: 'POST_ENGAGEMENT', billing: 'IMPRESSIONS' },
  // Exigem pixel/conversao configurados — fora do MVP:
  OUTCOME_LEADS: null,
  OUTCOME_SALES: null,
};

/** Monta o objeto de segmentacao da Meta a partir do plano. */
async function buildTargeting(plan: CampaignPlan, cfg: MetaConfig) {
  const { audience } = plan;
  const targeting: Record<string, unknown> = {
    geo_locations: { countries: audience.countries },
    age_min: audience.age_min,
    age_max: audience.age_max,
    // Respeita a segmentacao do agente — sem expansao automatica de publico.
    targeting_automation: { advantage_audience: 0 },
  };
  if (audience.genders?.length) targeting.genders = audience.genders;

  if (audience.interests?.length) {
    const interests = await searchInterests(audience.interests, cfg.token);
    if (interests.length) targeting.flexible_spec = [{ interests }];
  }
  return targeting;
}

/**
 * Cria a estrutura completa na Meta, SEMPRE em status PAUSED.
 * Nada e veiculado ate o usuario ativar manualmente no Gerenciador.
 *
 * @param imageBase64 imagem do criativo ja gerada (gpt-image-1), em base64.
 */
export async function launchPausedCampaign(
  plan: CampaignPlan,
  imageBase64: string,
  cfg: MetaConfig,
): Promise<LaunchResult> {
  const opt = OPTIMIZATION[plan.objective];
  if (!opt) {
    throw new Error(
      `Objetivo ${plan.objective} exige pixel/conversao configurados — fora do MVP. ` +
        `Use OUTCOME_TRAFFIC, OUTCOME_AWARENESS ou OUTCOME_ENGAGEMENT.`,
    );
  }

  // Meta usa centavos da moeda da conta. Assumimos BRL.
  const dailyBudgetCents = Math.round(plan.dailyBudgetBRL * 100);
  if (dailyBudgetCents < 100) {
    throw new Error('Orcamento diario minimo invalido (< R$1).');
  }

  // 1) Campanha (PAUSED)
  const campaign = await graph<{ id: string }>(`${cfg.adAccountId}/campaigns`, {
    method: 'POST',
    token: cfg.token,
    params: {
      name: plan.campaignName,
      objective: plan.objective,
      status: 'PAUSED',
      special_ad_categories: [],
    },
  });

  // 2) Conjunto de anuncios (PAUSED) — orcamento, segmentacao, otimizacao
  const targeting = await buildTargeting(plan, cfg);
  const adSet = await graph<{ id: string }>(`${cfg.adAccountId}/adsets`, {
    method: 'POST',
    token: cfg.token,
    params: {
      name: `${plan.campaignName} — Conjunto 1`,
      campaign_id: campaign.id,
      status: 'PAUSED',
      daily_budget: dailyBudgetCents,
      billing_event: opt.billing,
      optimization_goal: opt.goal,
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      targeting,
    },
  });

  // 3) Criativo — sobe a imagem e monta o object_story_spec
  const imageHash = await uploadImageBytes(imageBase64, cfg);
  const linkData: Record<string, unknown> = {
    image_hash: imageHash,
    link: plan.creative.linkUrl,
    message: plan.creative.primaryText,
    name: plan.creative.headline,
    description: plan.creative.description,
    call_to_action: { type: plan.creative.cta, value: { link: plan.creative.linkUrl } },
  };
  const objectStorySpec: Record<string, unknown> = { page_id: cfg.pageId, link_data: linkData };
  if (cfg.igAccountId) objectStorySpec.instagram_actor_id = cfg.igAccountId;

  const creative = await graph<{ id: string }>(`${cfg.adAccountId}/adcreatives`, {
    method: 'POST',
    token: cfg.token,
    params: { name: `${plan.campaignName} — Criativo 1`, object_story_spec: objectStorySpec },
  });

  // 4) Anuncio (PAUSED)
  const ad = await graph<{ id: string }>(`${cfg.adAccountId}/ads`, {
    method: 'POST',
    token: cfg.token,
    params: {
      name: `${plan.campaignName} — Anuncio 1`,
      adset_id: adSet.id,
      creative: { creative_id: creative.id },
      status: 'PAUSED',
    },
  });

  return {
    campaignId: campaign.id,
    adSetId: adSet.id,
    creativeId: creative.id,
    adId: ad.id,
    adsManagerUrl: adsManagerUrl(cfg.adAccountId, campaign.id),
  };
}
