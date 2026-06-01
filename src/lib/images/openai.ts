// Geracao do criativo via OpenAI gpt-image-1. So fetch, sem SDK.
// Retorna base64 puro (sem data URI) — pronto pro upload na Meta (/adimages).

export type CreativeSize = '1024x1024' | '1024x1536' | '1536x1024';

/**
 * Gera a imagem do anuncio a partir do prompt escrito pelo agente.
 * @param size 1:1 (feed), 2:3 retrato (stories/reels) ou 3:2 paisagem.
 */
export async function generateCreative(
  prompt: string,
  size: CreativeSize = '1024x1024',
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY nao definida.');

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: 'gpt-image-1', prompt, size, n: 1 }),
  });

  const json = (await res.json()) as {
    data?: { b64_json?: string }[];
    error?: { message: string };
  };

  if (!res.ok || json.error) {
    throw new Error(`OpenAI image: ${json.error?.message || `HTTP ${res.status}`}`);
  }

  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI image: resposta sem b64_json.');
  return b64;
}
