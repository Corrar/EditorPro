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
  const text = (data.text ?? '').trim();
  return { text, words: punctuateWords(words, text || (data.segments ?? []).map((s) => s.text).join(' ')), provider: p.name, model: p.model };
}

const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
const HAS_PUNCT = /[.,!?;:…]/;

/**
 * A API de áudio (OpenAI/Groq) devolve as palavras com tempo SEM pontuação ("Oi", "gente", "hoje"…) e a
 * pontuação só no `text`. Sem ela a legenda saía sem vírgula/ponto e as frases não quebravam no fim da
 * frase. Aqui cada palavra recebe a forma escrita do `text` (pontuação e maiúsculas), alinhando em ordem
 * pelo texto normalizado; palavra que não casa fica como veio. Palavras que já trazem pontuação: intactas.
 */
export function punctuateWords(words: TranscribeWord[], text: string): TranscribeWord[] {
  if (!words.length || !HAS_PUNCT.test(text) || words.some((w) => HAS_PUNCT.test(w.word))) return words;
  const toks = text.split(/\s+/).filter(Boolean).map((raw) => ({ raw, n: norm(raw) })).filter((t) => t.n);
  const out = words.map((w) => ({ ...w }));
  let j = 0;
  for (let i = 0; i < out.length && j < toks.length;) {
    const wn = norm(out[i].word);
    if (!wn) { i++; continue; }
    // procura o token nas próximas posições (o texto pode ter uma palavra a mais/menos que a lista)
    let k = -1;
    for (let d = 0; d < 4 && j + d < toks.length; d++) if (toks[j + d].n === wn) { k = j + d; break; }
    if (k < 0 && toks[j].n.startsWith(wn)) k = j;
    if (k < 0) { i++; continue; }
    const tok = toks[k];
    if (tok.n === wn) {
      out[i].word = tok.raw;
      i++; j = k + 1;
      continue;
    }
    // token escrito junto ("meia-noite", "fazê-lo") e palavras separadas: junta até fechar o token
    let acc = wn, e = i;
    while (acc.length < tok.n.length && e + 1 < out.length && tok.n.startsWith(acc + norm(out[e + 1].word))) { e++; acc += norm(out[e].word); }
    if (acc === tok.n) {
      const lead = /^[^\p{L}\p{N}]*/u.exec(tok.raw)![0], tail = /[^\p{L}\p{N}]*$/u.exec(tok.raw)![0];
      if (lead) out[i].word = lead + out[i].word.trim();
      if (tail) out[e].word = out[e].word.trim() + tail;
      i = e + 1; j = k + 1;
    } else i++;
  }
  return out;
}
