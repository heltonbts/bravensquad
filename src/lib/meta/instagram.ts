// Publicacao organica no feed do Instagram via Instagram Graph API.
// Roda no processo do MCP server (Node standalone); o token nunca vai pro modelo.
//
// Pegadinha central: a Content Publishing API exige image_url PUBLICO (os
// servidores da Meta baixam a imagem). O gpt-image-1 devolve bytes locais, que
// nao sao publicos. Por isso subimos os bytes em /adimages e usamos a `url`
// publica que a Meta retorna (CDN do Facebook) — sem credencial nova.

import { graph, type MetaConfig } from './client';

/** Garante que a conta IG Business esta configurada. Lanca erro claro se faltar. */
export function getIgUserId(cfg: MetaConfig): string {
  if (!cfg.igAccountId) {
    throw new Error(
      'META_IG_ACCOUNT_ID nao definida. O agente de Instagram exige uma conta IG Business/Creator vinculada a Pagina.',
    );
  }
  return cfg.igAccountId;
}

export interface IgAccount {
  username: string;
  name?: string;
  followers_count: number;
  media_count: number;
}

/** Dados basicos da conta IG — usado no check de conexao. */
export async function getIgAccount(cfg: MetaConfig): Promise<IgAccount> {
  const igId = getIgUserId(cfg);
  return graph<IgAccount>(igId, {
    token: cfg.token,
    params: { fields: 'username,name,followers_count,media_count' },
  });
}

export interface IgMedia {
  id: string;
  caption?: string;
  permalink: string;
  like_count?: number;
  comments_count?: number;
  timestamp?: string;
}

/** Ultimas publicacoes do feed (read-only) — pra casar a voz e nao repetir. */
export async function getRecentMedia(cfg: MetaConfig, limit = 6): Promise<IgMedia[]> {
  const igId = getIgUserId(cfg);
  const r = await graph<{ data: IgMedia[] }>(`${igId}/media`, {
    token: cfg.token,
    params: {
      fields: 'caption,permalink,like_count,comments_count,timestamp',
      limit,
    },
  });
  return r.data ?? [];
}

/**
 * Sobe os bytes (base64) pra biblioteca do ad account e devolve a URL PUBLICA.
 * E o mesmo endpoint do uploadImageBytes (que retorna hash); aqui pegamos a url,
 * que e o que a Content Publishing API do IG precisa como image_url.
 */
export async function uploadPublicImageUrl(base64: string, cfg: MetaConfig): Promise<string> {
  const r = await graph<{ images: Record<string, { hash: string; url: string }> }>(
    `${cfg.adAccountId}/adimages`,
    { method: 'POST', token: cfg.token, params: { bytes: base64 } },
  );
  const first = Object.values(r.images)[0];
  if (!first?.url) throw new Error('Upload da imagem falhou: sem url publica na resposta.');
  return first.url;
}

export interface PublishResult {
  mediaId: string;
  permalink: string;
}

/**
 * Publica uma FOTO UNICA no feed do IG:
 *   1) cria o container de midia (image_url + caption)
 *   2) espera o container ficar FINISHED
 *   3) publica o container
 *   4) le o permalink do post
 * Acao publica e irreversivel — quem chama (skill/agente) confirma com a pessoa antes.
 */
export async function publishFeedPhoto(
  args: { imageUrl: string; caption: string },
  cfg: MetaConfig,
): Promise<PublishResult> {
  const igId = getIgUserId(cfg);

  // 1) container
  const container = await graph<{ id: string }>(`${igId}/media`, {
    method: 'POST',
    token: cfg.token,
    params: { image_url: args.imageUrl, caption: args.caption },
  });
  const creationId = container.id;

  // 2) espera processar (foto e rapido; damos ~30s de margem)
  await waitContainerReady(creationId, cfg);

  // 3) publica
  const published = await graph<{ id: string }>(`${igId}/media_publish`, {
    method: 'POST',
    token: cfg.token,
    params: { creation_id: creationId },
  });

  // 4) permalink
  const media = await graph<{ permalink: string }>(published.id, {
    token: cfg.token,
    params: { fields: 'permalink' },
  });

  return { mediaId: published.id, permalink: media.permalink };
}

/** Faz polling do status do container ate FINISHED. Lanca em ERROR/EXPIRED/timeout. */
async function waitContainerReady(creationId: string, cfg: MetaConfig): Promise<void> {
  const maxAttempts = 15;
  const delayMs = 2000;
  for (let i = 0; i < maxAttempts; i++) {
    const { status_code } = await graph<{ status_code: string }>(creationId, {
      token: cfg.token,
      params: { fields: 'status_code' },
    });
    if (status_code === 'FINISHED') return;
    if (status_code === 'ERROR' || status_code === 'EXPIRED') {
      throw new Error(
        `O Instagram nao conseguiu processar a imagem (status ${status_code}). ` +
          `Em geral e a URL da imagem que o IG nao consegue baixar.`,
      );
    }
    await new Promise((res) => setTimeout(res, delayMs));
  }
  throw new Error('Tempo esgotado esperando o Instagram processar a imagem.');
}
