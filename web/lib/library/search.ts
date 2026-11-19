/* busca única da biblioteca (puro): mesma regra em todas as galerias */
import { TEMPLATES, TEMPLATE_CATEGORY_LABELS } from './templates';
import { CAPTION_PRESETS, CAPTION_CATEGORY_LABELS } from './captions';
import { TEXT_ANIMATIONS, CLIP_ANIMATIONS, TEXT_ANIM_GROUP_LABELS, CLIP_ANIM_GROUP_LABELS } from './animations';
import { LOOKS, LOOK_CATEGORY_LABELS } from './looks';
import { SFX_CATALOG, SFX_CATEGORY_LABELS } from './sfx';
import { searchFonts } from './fonts';

export const normSearch = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/** todas as palavras da busca aparecem em algum dos campos (sem acento/caixa) */
export function matchesQuery(query: string | undefined, fields: (string | undefined)[]): boolean {
  const q = normSearch(query ?? '');
  if (!q) return true;
  const hay = normSearch(fields.filter(Boolean).join(' '));
  return q.split(/\s+/).every((w) => hay.includes(w));
}

export type LibrarySection = 'modelos' | 'textos' | 'legendas' | 'animacoes' | 'looks' | 'sons' | 'fontes';

/** quantos itens de cada aba batem com a busca */
export function searchLibrary(query: string): Record<LibrarySection, number> {
  const tpl = (kind: 'texto' | 'motion') => TEMPLATES.filter((t) => t.kind === kind && matchesQuery(query, [t.name, t.description, TEMPLATE_CATEGORY_LABELS[t.category]])).length;
  return {
    modelos: tpl('motion'),
    textos: tpl('texto'),
    legendas: CAPTION_PRESETS.filter((c) => matchesQuery(query, [c.name, c.description, c.sample, CAPTION_CATEGORY_LABELS[c.category]])).length,
    animacoes: TEXT_ANIMATIONS.filter((a) => a.id !== 'none' && matchesQuery(query, [a.name, a.description, TEXT_ANIM_GROUP_LABELS[a.group], 'texto'])).length
      + CLIP_ANIMATIONS.filter((a) => matchesQuery(query, [a.name, a.description, CLIP_ANIM_GROUP_LABELS[a.group], 'clipe'])).length,
    looks: LOOKS.filter((l) => matchesQuery(query, [l.name, l.description, LOOK_CATEGORY_LABELS[l.category], 'cor filtro'])).length,
    sons: SFX_CATALOG.filter((s) => matchesQuery(query, [s.name, s.description, SFX_CATEGORY_LABELS[s.category], 'som efeito'])).length,
    fontes: searchFonts(query).length,
  };
}
