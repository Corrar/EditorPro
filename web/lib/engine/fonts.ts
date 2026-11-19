/* =====================================================================
   Fontes e emoji automático — ponte tolerante com a biblioteca
   (@/lib/library: ensureFont, emojiFor). Enquanto o módulo não existir
   (ou falhar), cai em document.fonts.load / sem emoji.
   O desenho é síncrono: pedimos a fonte e redesenhamos quando ela chega.
   ===================================================================== */
import type { Project } from '../types';

/** chamado quando uma fonte/emoji fica disponível (o preview redesenha) */
export const assetEvents = { onReady: () => {} };

type Lib = { ensureFont?: (family: string, weights?: number[]) => Promise<unknown>; emojiFor?: (word: string) => string | undefined | null };
let libPromise: Promise<Lib> | null = null;
let lib: Lib | null = null;

function loadLib(): Promise<Lib> {
  if (!libPromise) {
    libPromise = import('@/lib/library')
      .then((m) => { lib = m as unknown as Lib; return lib; })
      .catch(() => { lib = {}; return lib; });
  }
  return libPromise;
}

const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui']);
const done = new Set<string>();
const inflight = new Map<string, Promise<void>>();

function key(family: string, weight: number, italic?: boolean) {
  return `${family}|${weight}|${italic ? 'i' : 'n'}`;
}

/** garante a fonte (assíncrono) */
export function ensureFontLoaded(family: string, weight = 700, italic = false): Promise<void> {
  const fam = (family || '').trim();
  if (!fam || GENERIC.has(fam.toLowerCase()) || typeof document === 'undefined') return Promise.resolve();
  const k = key(fam, weight, italic);
  if (done.has(k)) return Promise.resolve();
  let p = inflight.get(k);
  if (!p) {
    p = (async () => {
      try {
        const l = await loadLib();
        if (l.ensureFont) await Promise.race([l.ensureFont(fam, [weight]), new Promise((r) => setTimeout(r, 6000))]);
        if (document.fonts?.load) {
          await Promise.race([document.fonts.load(`${italic ? 'italic ' : ''}${weight} 48px "${fam}"`), new Promise((r) => setTimeout(r, 4000))]);
        }
      } catch { /* segue com a fonte reserva */ }
      done.add(k);
      inflight.delete(k);
      assetEvents.onReady();
    })();
    inflight.set(k, p);
  }
  return p;
}

/** síncrono p/ o desenho: true se já pode desenhar com a fonte; senão dispara o carregamento */
export function requestFont(family: string, weight = 700, italic = false): boolean {
  const fam = (family || '').trim();
  if (!fam || typeof document === 'undefined') return true;
  if (done.has(key(fam, weight, italic))) return true;
  try {
    if (document.fonts?.check?.(`${italic ? 'italic ' : ''}${weight} 48px "${fam}"`)) {
      // check() devolve true também quando a família nem existe: carregue mesmo assim, sem bloquear
      void ensureFontLoaded(fam, weight, italic);
      return true;
    }
  } catch { /* ok */ }
  void ensureFontLoaded(fam, weight, italic);
  return false;
}

/** export: espera todas as fontes usadas no projeto */
export async function ensureProjectFonts(p: Project): Promise<void> {
  const want: [string, number, boolean][] = [];
  for (const t of p.tracks) for (const c of t.clips) {
    if (c.type === 'text') want.push([c.style.fontFamily, c.style.fontWeight || 700, !!c.style.italic]);
  }
  if (p.captions.enabled && p.captions.segments.length) {
    const s = p.captions.style;
    want.push([s.fontFamily, s.fontWeight || 800, !!s.italic]);
    if (s.autoEmoji) await loadLib();
  }
  await Promise.all(want.map(([f, w, i]) => ensureFontLoaded(f, w, i)));
}

/** emoji da palavra-chave (biblioteca); undefined enquanto não carregou ou sem correspondência */
export function emojiForWord(word: string): string | undefined {
  if (!lib) { void loadLib().then(() => assetEvents.onReady()); return undefined; }
  try { return lib.emojiFor?.(word) ?? undefined; } catch { return undefined; }
}
