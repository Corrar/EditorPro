/* =====================================================================
   Biblioteca · Fontes (dono: sessão "biblioteca").
   Catálogo curado de famílias do Google Fonts — TODAS com licença aberta
   (SIL OFL 1.1 ou Apache 2.0). Nada é empacotado: o CSS é injetado sob
   demanda por ensureFont() e o navegador baixa só os pesos usados.
   ===================================================================== */
import type { Project } from '../types';

export type FontCategory = 'impacto' | 'moderna' | 'condensada' | 'elegante' | 'manuscrita' | 'divertida' | 'mono';

export const FONT_CATEGORY_LABELS: Record<FontCategory, string> = {
  impacto: 'Impacto', moderna: 'Moderna', condensada: 'Condensada', elegante: 'Elegante',
  manuscrita: 'Manuscrita', divertida: 'Divertida', mono: 'Mono',
};

export interface FontDef {
  family: string;
  category: FontCategory;
  /** pesos disponíveis no Google Fonts (usados no seletor e no CSS) */
  weights: number[];
  license: 'OFL' | 'Apache';
  /** peso sugerido para títulos/legendas */
  display: number;
  /** fonte estreita (afeta estimativa de largura dos modelos) */
  narrow?: boolean;
  /** palavras extras p/ a busca */
  tags?: string;
}

const W = (a: number, b: number, step = 100) => { const out: number[] = []; for (let w = a; w <= b; w += step) out.push(w); return out; };

export const FONT_CATALOG: FontDef[] = [
  // impacto
  { family: 'Anton', category: 'impacto', weights: [400], license: 'OFL', display: 400, narrow: true, tags: 'legenda creator grossa' },
  { family: 'Archivo Black', category: 'impacto', weights: [400], license: 'OFL', display: 400, tags: 'pesada título' },
  { family: 'Montserrat', category: 'impacto', weights: W(400, 900), license: 'OFL', display: 900, tags: 'geométrica legenda' },
  { family: 'League Spartan', category: 'impacto', weights: W(400, 900), license: 'OFL', display: 800, tags: 'geométrica' },
  // moderna
  { family: 'Poppins', category: 'moderna', weights: W(400, 900), license: 'OFL', display: 800, tags: 'padrão redonda' },
  { family: 'Inter', category: 'moderna', weights: W(400, 900), license: 'OFL', display: 800, tags: 'interface limpa' },
  { family: 'Plus Jakarta Sans', category: 'moderna', weights: W(400, 800), license: 'OFL', display: 800, tags: 'marca app' },
  { family: 'DM Sans', category: 'moderna', weights: [400, 500, 700, 900], license: 'OFL', display: 700, tags: 'limpa' },
  { family: 'Space Grotesk', category: 'moderna', weights: [400, 500, 700], license: 'OFL', display: 700, tags: 'tech' },
  { family: 'Rubik', category: 'moderna', weights: W(400, 900), license: 'OFL', display: 800, tags: 'arredondada' },
  { family: 'Outfit', category: 'moderna', weights: W(400, 900), license: 'OFL', display: 800, tags: 'geométrica' },
  { family: 'Sora', category: 'moderna', weights: W(400, 800), license: 'OFL', display: 700, tags: 'tech' },
  // condensada
  { family: 'Bebas Neue', category: 'condensada', weights: [400], license: 'OFL', display: 400, narrow: true, tags: 'título cinema caixa alta' },
  { family: 'Oswald', category: 'condensada', weights: W(400, 700), license: 'OFL', display: 700, narrow: true, tags: 'notícia' },
  { family: 'Barlow Condensed', category: 'condensada', weights: W(400, 900), license: 'OFL', display: 800, narrow: true, tags: 'esporte' },
  // elegante
  { family: 'Playfair Display', category: 'elegante', weights: W(400, 900), license: 'OFL', display: 700, tags: 'serifa revista luxo' },
  { family: 'DM Serif Display', category: 'elegante', weights: [400], license: 'OFL', display: 400, tags: 'serifa título' },
  { family: 'Cormorant Garamond', category: 'elegante', weights: W(400, 700), license: 'OFL', display: 600, tags: 'serifa casamento' },
  { family: 'Lora', category: 'elegante', weights: W(400, 700), license: 'OFL', display: 600, tags: 'serifa leitura' },
  { family: 'Libre Baskerville', category: 'elegante', weights: [400, 700], license: 'OFL', display: 700, tags: 'serifa clássica' },
  // manuscrita
  { family: 'Permanent Marker', category: 'manuscrita', weights: [400], license: 'Apache', display: 400, tags: 'marcador pincel' },
  { family: 'Caveat', category: 'manuscrita', weights: W(400, 700), license: 'OFL', display: 700, tags: 'caneta anotação' },
  { family: 'Pacifico', category: 'manuscrita', weights: [400], license: 'OFL', display: 400, tags: 'praia retrô' },
  { family: 'Dancing Script', category: 'manuscrita', weights: W(400, 700), license: 'OFL', display: 700, tags: 'cursiva convite' },
  { family: 'Kalam', category: 'manuscrita', weights: [300, 400, 700], license: 'OFL', display: 700, tags: 'caderno' },
  // divertida
  { family: 'Bangers', category: 'divertida', weights: [400], license: 'OFL', display: 400, tags: 'quadrinhos hq' },
  { family: 'Luckiest Guy', category: 'divertida', weights: [400], license: 'Apache', display: 400, tags: 'desenho infantil' },
  { family: 'Righteous', category: 'divertida', weights: [400], license: 'OFL', display: 400, tags: 'retrô 80s' },
  { family: 'Lilita One', category: 'divertida', weights: [400], license: 'OFL', display: 400, tags: 'jogo pop' },
  { family: 'Fredoka', category: 'divertida', weights: W(400, 700), license: 'OFL', display: 700, tags: 'redonda fofa' },
  { family: 'Chewy', category: 'divertida', weights: [400], license: 'Apache', display: 400, tags: 'chiclete' },
  // mono
  { family: 'JetBrains Mono', category: 'mono', weights: W(400, 800), license: 'OFL', display: 700, tags: 'código tutorial' },
  { family: 'Space Mono', category: 'mono', weights: [400, 700], license: 'OFL', display: 700, tags: 'máquina de escrever' },
];

const BY_FAMILY = new Map(FONT_CATALOG.map((f) => [f.family.toLowerCase(), f]));

export function fontDef(family: string | undefined): FontDef | undefined {
  return family ? BY_FAMILY.get(family.trim().replace(/^["']|["']$/g, '').toLowerCase()) : undefined;
}

/** peso disponível mais próximo do pedido (evita sintetizar negrito falso) */
export function nearestWeight(family: string, weight: number): number {
  const def = fontDef(family);
  if (!def) return weight;
  return def.weights.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best), def.weights[0]);
}

/** busca por nome, categoria ou tags (sem acento, minúsculas) */
export function searchFonts(query: string, category?: FontCategory | 'todas'): FontDef[] {
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const q = norm(query.trim());
  return FONT_CATALOG.filter((f) => (!category || category === 'todas' || f.category === category)
    && (!q || norm(`${f.family} ${FONT_CATEGORY_LABELS[f.category]} ${f.tags ?? ''}`).includes(q)));
}

/** URL do CSS2 do Google Fonts para as famílias (só as do catálogo; pesos filtrados p/ os existentes) */
export function googleFontsUrl(families: { family: string; weights?: number[] }[]): string | null {
  const parts: string[] = [];
  for (const { family, weights } of families) {
    const def = fontDef(family);
    if (!def) continue;
    const ws = [...new Set((weights?.length ? weights.map((w) => nearestWeight(def.family, w)) : def.weights))].sort((a, b) => a - b);
    const name = def.family.replace(/ /g, '+');
    parts.push(def.weights.length === 1 && ws[0] === 400 ? `family=${name}` : `family=${name}:wght@${ws.join(';')}`);
  }
  return parts.length ? `https://fonts.googleapis.com/css2?${parts.join('&')}&display=swap` : null;
}

/** famílias usadas no projeto (textos + legendas) */
export function projectFonts(p: Project): { family: string; weights: number[] }[] {
  const map = new Map<string, Set<number>>();
  const add = (fam: string | undefined, w: number | undefined) => {
    if (!fam) return;
    const set = map.get(fam) ?? new Set<number>();
    set.add(w || 400);
    map.set(fam, set);
  };
  for (const t of p.tracks) for (const c of t.clips) if (c.type === 'text') add(c.style.fontFamily, c.style.fontWeight);
  add(p.captions.style.fontFamily, p.captions.style.fontWeight);
  return [...map].map(([family, ws]) => ({ family, weights: [...ws] }));
}

/* ---------- carregamento sob demanda (navegador) ---------- */

const loading = new Map<string, Promise<boolean>>();

function injectCss(url: string, key: string) {
  const id = `ep-font-${key}`;
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = url;
  document.head.appendChild(link);
}

/**
 * Garante que a fonte esteja pronta para desenhar no canvas. Injeta o CSS do
 * Google Fonts (uma vez por família) e espera `document.fonts.load` dos pesos.
 * Retorna false (sem lançar) se não for do catálogo, se estiver offline ou se
 * passar do tempo — o engine desenha com a fonte reserva nesse caso.
 */
export function ensureFont(family: string, weights?: number[], timeoutMs = 5000): Promise<boolean> {
  if (typeof document === 'undefined' || !('fonts' in document)) return Promise.resolve(false);
  const def = fontDef(family);
  if (!def) return Promise.resolve(false);
  const ws = [...new Set((weights?.length ? weights : [def.display]).map((w) => nearestWeight(def.family, w)))];
  const key = `${def.family}|${ws.sort().join(',')}`;
  const hit = loading.get(key);
  if (hit) return hit;
  const url = googleFontsUrl([{ family: def.family }]);
  if (url) injectCss(url, def.family.replace(/\W+/g, '-').toLowerCase());
  const job = new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    // o <link> pode ainda não ter carregado: tenta algumas vezes até o @font-face existir
    const attempt = async (n: number): Promise<void> => {
      try {
        const res = await Promise.all(ws.map((w) => document.fonts.load(`${w} 40px "${def.family}"`, 'AaÇã1')));
        if (res.every((r) => r.length > 0)) { clearTimeout(timer); resolve(true); return; }
      } catch { /* tenta de novo */ }
      if (n < 12) setTimeout(() => void attempt(n + 1), 250);
    };
    void attempt(0);
  });
  loading.set(key, job);
  job.then((ok) => { if (!ok) loading.delete(key); });
  return job;
}

/** carrega todas as fontes usadas no projeto (o engine chama antes de exportar) */
export async function ensureProjectFonts(p: Project): Promise<void> {
  await Promise.all(projectFonts(p).map((f) => ensureFont(f.family, f.weights)));
}

/** pilha CSS segura para usar em style={{fontFamily}} */
export function fontStack(family: string): string {
  const def = fontDef(family);
  const generic = def?.category === 'elegante' ? 'serif' : def?.category === 'mono' ? 'monospace' : def?.category === 'manuscrita' ? 'cursive' : 'sans-serif';
  return `"${family}", ${generic}`;
}
