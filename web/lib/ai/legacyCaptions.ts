/* =====================================================================
   Legendas antigas que NÃO vieram da fala (plano 2026-11-19 §1.1).
   Entre ~15:12 e 15:49 UTC de 2026-11-19 a produção punha, quando o Whisper
   não devolvia nada, as palavras do PRÓPRIO pedido (brief) como legenda,
   espalhadas igualmente pelo áudio (demo.ts demoCaptions). Elas ficaram
   salvas no IndexedDB e bloqueavam a transcrição de verdade. Aqui elas são
   reconhecidas para serem tratadas como "sem legenda".
   ===================================================================== */
import type { CaptionSegment, Project } from '../types';

const norm = (w: string) => w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, '');

/** o mesmo texto que demo.ts usava (cópia fiel de demoWordPool) */
function demoWordPool(brief: string): string[] {
  const clean = (brief || '').replace(/["“”]/g, '').replace(/[^\p{L}\p{N}\s!?,.]/gu, ' ');
  const words = clean.split(/\s+/).filter((w) => w.length > 0);
  return words.length >= 4 ? words : 'Este é um exemplo de legenda automática no modo demonstração do EditorPro'.split(' ');
}
const FIXED_POOL = 'Este é um exemplo de legenda automática no modo demonstração do EditorPro'.split(' ');

function words(segs: CaptionSegment[]): { text: string; start: number; end: number }[] {
  return segs.flatMap((s) => (s.words?.length ? s.words : s.text.split(/\s+/).filter(Boolean).map((t) => ({ text: t, start: s.start, end: s.end }))));
}

/** fração de pares vizinhos (a,b) em que b é a palavra seguinte a `a` no texto-fonte, lido em ciclo */
function cyclicMatch(seq: string[], pool: string[]): number {
  const p = pool.map(norm).filter(Boolean);
  if (p.length < 2 || seq.length < 2) return 0;
  const next = new Map<string, Set<string>>();
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    if (!next.has(a)) next.set(a, new Set());
    next.get(a)!.add(b);
  }
  let hit = 0;
  for (let i = 0; i < seq.length - 1; i++) if (next.get(seq[i])?.has(seq[i + 1])) hit++;
  return hit / (seq.length - 1);
}

/** palavras com duração exatamente proporcional ao tamanho (distributeWords) e coladas, sem pausa nenhuma */
function proportionalTiming(segs: CaptionSegment[]): boolean {
  const withWords = segs.filter((s) => (s.words?.length ?? 0) >= 3);
  const total = withWords.reduce((n, s) => n + s.words!.length, 0);
  if (withWords.length < 3 || total < 15) return false;
  let ok = 0;
  for (const s of withWords) {
    const ws = s.words!;
    let prop = true;
    const rate = (ws[0].end - ws[0].start) / Math.max(2, ws[0].text.length);
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i];
      if (i > 0 && w.start - ws[i - 1].end >= 0.25) return false; // pausa real entre palavras = fala de verdade
      if (i > 0 && Math.abs(w.start - ws[i - 1].end) > 0.002) prop = false;
      // a última palavra de distributeWords fecha no fim do segmento (arredondamento): não conta
      if (i < ws.length - 1 && Math.abs((w.end - w.start) - rate * Math.max(2, w.text.length)) > 0.004 + 0.02 * (w.end - w.start)) prop = false;
    }
    if (prop) ok++;
  }
  return ok / withWords.length >= 0.8;
}

/** legendas salvas por versões antigas que não vieram da fala (texto do pedido ou frase de exemplo) */
export function isLegacyFakeCaptions(p: Pick<Project, 'brief' | 'captions'>): boolean {
  const c = p.captions;
  if (!c || c.source !== undefined || !c.segments.length) return false;
  const ws = words(c.segments);
  const seq = ws.map((w) => norm(w.text)).filter(Boolean);
  if (seq.length >= 4) {
    if (cyclicMatch(seq, demoWordPool(p.brief)) >= 0.8) return true;
    if (cyclicMatch(seq, FIXED_POOL) >= 0.8) return true;
  }
  return proportionalTiming(c.segments);
}

/** o projeto precisa de transcrição de verdade? (sem legenda, ou só a legenda antiga falsa) */
export function captionsNeedTranscription(p: Pick<Project, 'brief' | 'captions'>): boolean {
  return !p.captions.segments.length || isLegacyFakeCaptions(p);
}

/** as legendas atuais são a fala transcrita? (para a IA nunca tratar texto inventado como fala) */
export function captionsAreSpeech(p: Pick<Project, 'brief' | 'captions'>): boolean {
  if (!p.captions.segments.length) return false;
  if (p.captions.source) return p.captions.source === 'transcription';
  return !isLegacyFakeCaptions(p);
}
