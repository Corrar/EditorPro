/* =====================================================================
   Transcrição no SERVIDOR (Whisper large, muito mais preciso que o Whisper
   do navegador). Provedores compatíveis com a API de áudio da OpenAI:
   - Groq (grátis com chave): GROQ_API_KEY  → whisper-large-v3-turbo
   - OpenAI (pago):           OPENAI_API_KEY → whisper-1
   Sem chave → o navegador usa o Whisper local (fallback).
   ===================================================================== */
export interface TranscribeWord { word: string; start: number; end: number }
export interface TranscribeResult { text: string; words: TranscribeWord[]; /** provedor/modelo (p/ o chat dizer de onde veio a legenda) */ provider?: string; model?: string }

interface Provider { name: 'groq' | 'openai'; url: string; key: string; model: string }

export function transcribeProvider(): Provider | null {
  const groq = process.env.GROQ_API_KEY?.trim();
  if (groq) return { name: 'groq', url: 'https://api.groq.com/openai/v1/audio/transcriptions', key: groq, model: process.env.GROQ_TRANSCRIBE_MODEL?.trim() || 'whisper-large-v3-turbo' };
  const oa = process.env.OPENAI_API_KEY?.trim();
  if (oa) return { name: 'openai', url: 'https://api.openai.com/v1/audio/transcriptions', key: oa, model: 'whisper-1' };
  return null;
}

export class TranscribeError extends Error {
  /** segundos para tentar de novo (429), quando o provedor diz */
  constructor(message: string, public status = 502, public retryAfter?: number) { super(message); }
}

/** manda um WAV (16 kHz mono) ao provedor e devolve as palavras com tempo (segundos do pedaço) */
export async function transcribeWav(wav: ArrayBuffer, language: string, prompt?: string): Promise<TranscribeResult> {
  const p = transcribeProvider();
  if (!p) throw new TranscribeError('transcrição no servidor não configurada', 501);
  const form = new FormData();
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');
  form.append('model', p.model);
  form.append('language', (language || 'pt').slice(0, 2).toLowerCase());
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  form.append('timestamp_granularities[]', 'segment');
  form.append('temperature', '0');
  if (prompt) form.append('prompt', prompt.slice(0, 400));
  let res: Response;
  try {
    res = await fetch(p.url, { method: 'POST', headers: { Authorization: `Bearer ${p.key}` }, body: form });
  } catch {
    throw new TranscribeError('não consegui falar com o serviço de transcrição', 502);
  }
  const data = (await res.json().catch(() => ({}))) as { text?: string; words?: TranscribeWord[]; segments?: { start: number; end: number; text: string }[]; error?: { message?: string } };
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new TranscribeError('a chave de transcrição foi recusada (confira GROQ_API_KEY na Vercel)', 502);
    if (res.status === 429) {
      const ra = Number(res.headers.get('retry-after'));
      throw new TranscribeError('limite grátis de transcrição atingido por agora — tente em alguns minutos', 429, Number.isFinite(ra) && ra > 0 ? Math.min(60, ra) : undefined);
    }
    // 5xx do provedor continua 5xx (o navegador tenta de novo); 4xx vira 502 (não adianta repetir)
    throw new TranscribeError(data.error?.message || `erro ${res.status} na transcrição`, res.status >= 500 ? 503 : 502);
  }
  let words = (data.words ?? []).filter((w) => w && typeof w.word === 'string' && Number.isFinite(w.start) && Number.isFinite(w.end));
  // provedor sem tempo por palavra: distribui cada frase pelas palavras dela
  if (!words.length && data.segments?.length) {
    words = data.segments.flatMap((s) => {
      const ws = s.text.trim().split(/\s+/).filter(Boolean);
      const step = (s.end - s.start) / Math.max(1, ws.length);
      return ws.map((w, i) => ({ word: w, start: s.start + i * step, end: s.start + (i + 1) * step }));
    });
  }
  return { text: (data.text ?? '').trim(), words, provider: p.name, model: p.model };
}
