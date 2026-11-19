/* resumo do catálogo para a IA (ids + nomes curtos). Puro. */
import { FONT_CATALOG } from './fonts';
import { CAPTION_PRESETS } from './captions';
import { TEXT_ANIMATIONS, CLIP_ANIMATIONS } from './animations';
import { TEMPLATES } from './templates';
import { LOOKS } from './looks';
import { SFX_CATALOG } from './sfx';

export function libraryCatalogForAI(): string {
  const line = (title: string, items: string[]) => `${title}: ${items.join(', ')}`;
  return [
    line('Fontes (fontFamily)', FONT_CATALOG.map((f) => f.family)),
    line('Estilos de legenda (set_caption_style.preset + campos)', CAPTION_PRESETS.map((c) => `${c.id} (${c.name})`)),
    line('Animações de texto (animation/animationOut/animationLoop)', TEXT_ANIMATIONS.map((a) => a.id)),
    line('Animações de clipe (animationIn/Out/Loop.kind)', CLIP_ANIMATIONS.map((a) => a.id)),
    line('Modelos (buildTemplate id; params)', TEMPLATES.map((t) => `${t.id}[${t.params.map((p) => p.key).join('|')}]`)),
    line('Looks de cor (lookFilters id, intensidade 0–1)', LOOKS.map((l) => `${l.id} (${l.name})`)),
    line('Efeitos sonoros (insertSfx id)', SFX_CATALOG.map((s) => `${s.id} (${s.duration}s)`)),
  ].join('\n');
}
