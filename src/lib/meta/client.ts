// Cliente de baixo nivel da Meta Marketing API. So fetch, sem SDK.
// Roda no processo do MCP server (Node standalone); o token nunca vai pro modelo.

const API_VERSION = process.env.META_API_VERSION || 'v23.0';
const GRAPH = `https://graph.facebook.com/${API_VERSION}`;

export interface MetaConfig {
  token: string;
  /** Sempre com prefixo act_, ex: act_123. */
  adAccountId: string;
  pageId: string;
  igAccountId?: string;
}

/** Le e valida as env vars. Lanca erro claro se faltar algo essencial. */
export function getMetaConfig(): MetaConfig {
  const token = process.env.META_SYSTEM_USER_TOKEN;
  const adAccountId = process.env.META_AD_ACCOUNT_ID;
  const pageId = process.env.META_PAGE_ID;

  const missing = [
    !token && 'META_SYSTEM_USER_TOKEN',
    !adAccountId && 'META_AD_ACCOUNT_ID',
    !pageId && 'META_PAGE_ID',
  ].filter(Boolean);

  if (missing.length) {
    throw new Error(`Config da Meta incompleta. Defina: ${missing.join(', ')}`);
  }

  return {
    token: token!,
    adAccountId: adAccountId!.startsWith('act_') ? adAccountId! : `act_${adAccountId}`,
    pageId: pageId!,
    igAccountId: process.env.META_IG_ACCOUNT_ID || undefined,
  };
}

interface GraphError {
  error?: { message: string; type: string; code: number; fbtrace_id: string };
}

/**
 * Wrapper das chamadas Graph. GET via querystring, POST via form-urlencoded.
 * Objetos aninhados (targeting, etc.) sao serializados em JSON automaticamente.
 */
export async function graph<T = unknown>(
  path: string,
  opts: { method?: 'GET' | 'POST'; token: string; params?: Record<string, unknown> } = {
    token: '',
  },
): Promise<T> {
  const { method = 'GET', token, params = {} } = opts;
  const serialized: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    serialized[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
  }

  let url = `${GRAPH}/${path}`;
  const init: RequestInit = { method };

  if (method === 'GET') {
    const qs = new URLSearchParams({ ...serialized, access_token: token });
    url += `?${qs}`;
  } else {
    init.body = new URLSearchParams({ ...serialized, access_token: token });
  }

  const res = await fetch(url, init);
  const json = (await res.json()) as T & GraphError;

  if (!res.ok || json.error) {
    const e = json.error;
    throw new Error(
      e ? `Meta API [${e.code}]: ${e.message} (trace ${e.fbtrace_id})` : `Meta API HTTP ${res.status}`,
    );
  }
  return json;
}

/** Resolve nomes de interesse em {id, name} via Targeting Search. Ignora os que nao casam. */
export async function searchInterests(
  names: string[],
  token: string,
): Promise<{ id: string; name: string }[]> {
  const resolved = await Promise.all(
    names.map(async (q) => {
      try {
        const r = await graph<{ data: { id: string; name: string }[] }>('search', {
          token,
          params: { type: 'adinterest', q, limit: 1 },
        });
        return r.data?.[0] ? { id: r.data[0].id, name: r.data[0].name } : null;
      } catch {
        return null;
      }
    }),
  );
  return resolved.filter((x): x is { id: string; name: string } => x !== null);
}

/** Sobe a imagem (base64) pra biblioteca do ad account e devolve o image_hash. */
export async function uploadImageBytes(base64: string, cfg: MetaConfig): Promise<string> {
  const r = await graph<{ images: Record<string, { hash: string; url: string }> }>(
    `${cfg.adAccountId}/adimages`,
    { method: 'POST', token: cfg.token, params: { bytes: base64 } },
  );
  const first = Object.values(r.images)[0];
  if (!first?.hash) throw new Error('Upload da imagem falhou: sem hash na resposta');
  return first.hash;
}

/** Link direto pro Gerenciador de Anuncios filtrando a campanha criada. */
export function adsManagerUrl(adAccountId: string, campaignId: string): string {
  const numeric = adAccountId.replace('act_', '');
  return `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${numeric}&selected_campaign_ids=${campaignId}`;
}
