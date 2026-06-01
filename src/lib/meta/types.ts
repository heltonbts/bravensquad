// Tipos do agente de trafego pago.
// O "plano" e o que o Claude devolve; e tambem o que o usuario revisa antes de
// aprovar. So depois da aprovacao ele vira objetos reais (PAUSADOS) na Meta.

/** Objetivos suportados no MVP (Outcome-Driven Ad Experiences). */
export type CampaignObjective =
  | 'OUTCOME_TRAFFIC'
  | 'OUTCOME_ENGAGEMENT'
  | 'OUTCOME_LEADS'
  | 'OUTCOME_SALES'
  | 'OUTCOME_AWARENESS';

/** Call-to-action do anuncio (subset comum). */
export type CallToAction =
  | 'LEARN_MORE'
  | 'SHOP_NOW'
  | 'SIGN_UP'
  | 'BOOK_TRAVEL'
  | 'CONTACT_US'
  | 'SUBSCRIBE'
  | 'GET_OFFER'
  | 'SEND_MESSAGE';

/** Segmentacao. Interesses sao por nome — o client resolve pra IDs na Meta. */
export interface AudienceSpec {
  /** Codigos ISO-2 dos paises, ex: ["BR"]. */
  countries: string[];
  age_min: number;
  age_max: number;
  /** 1 = masculino, 2 = feminino. Vazio = todos. */
  genders?: (1 | 2)[];
  /** Interesses por nome (ex: "Marketing digital"). Resolvidos via Targeting Search. */
  interests?: string[];
}

export interface CreativeSpec {
  /** Prompt que sera enviado ao gpt-image-1 pra gerar a imagem. */
  imagePrompt: string;
  /** Texto principal do anuncio (primary text). */
  primaryText: string;
  /** Titulo curto. */
  headline: string;
  /** Descricao do link. */
  description: string;
  cta: CallToAction;
  /** URL de destino. */
  linkUrl: string;
}

/** Plano completo de campanha — saida do agente, entrada da execucao. */
export interface CampaignPlan {
  campaignName: string;
  objective: CampaignObjective;
  /** Orcamento diario em BRL (reais, nao centavos). */
  dailyBudgetBRL: number;
  audience: AudienceSpec;
  creative: CreativeSpec;
  /** Justificativa do agente — por que esse plano. Mostrado na revisao. */
  rationale: string;
}

/** Resultado da criacao na Meta (tudo PAUSADO). */
export interface LaunchResult {
  campaignId: string;
  adSetId: string;
  creativeId: string;
  adId: string;
  /** Link direto pro Gerenciador de Anuncios. */
  adsManagerUrl: string;
}
