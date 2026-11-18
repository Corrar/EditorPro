/* modelos de projeto (puro): criam o projeto com trilhas/estilo prontos */
import { CAPTION_PRESETS } from '@/components/panels/presets';
import { createProject, makeTextClip, DEFAULT_TEXT_STYLE } from '@/lib/defaults';
import type { AspectRatio, Project } from '@/lib/types';

export interface ProjectTemplate { id: string; label: string; desc: string; aspect: AspectRatio; emoji: string }

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  { id: 'reels-captions', label: 'Reels com legenda', desc: '9:16 · legenda bold-pop · gancho', aspect: '9:16', emoji: '📱' },
  { id: 'tutorial', label: 'Tutorial 16:9', desc: 'Título + passos + legenda clássica', aspect: '16:9', emoji: '🎓' },
  { id: 'ad-15', label: 'Anúncio 15s', desc: '1:1 · gancho, oferta e CTA', aspect: '1:1', emoji: '📣' },
  { id: 'story', label: 'Story 4:5', desc: 'Feed vertical com fundo desfocado', aspect: '4:5', emoji: '✨' },
];

export function projectFromTemplate(id: string): Project {
  const tpl = PROJECT_TEMPLATES.find((t) => t.id === id) ?? PROJECT_TEMPLATES[0];
  const p = createProject({ name: tpl.label, aspect: tpl.aspect });
  const text = p.tracks.find((t) => t.kind === 'text')!;
  const cap = (preset: string) => ({ ...p.captions, enabled: true, style: { ...p.captions.style, ...CAPTION_PRESETS.find((c) => c.id === preset)!.style } });
  if (tpl.id === 'reels-captions') {
    text.clips = [makeTextClip('Você precisa ver isso 👀', 0, 2.5, { label: 'gancho', position: { x: 0.5, y: 0.2 }, animation: 'bounce', templateId: 'hook', style: { ...DEFAULT_TEXT_STYLE, fontSize: 88, fontWeight: 900, background: '#D9641E', strokeWidth: 0, shadow: false } })];
    p.captions = cap('bold-pop');
    p.canvas = { type: 'blur', blur: 0.6 };
  } else if (tpl.id === 'tutorial') {
    text.clips = [makeTextClip('Como fazer em 3 passos', 0, 3, { label: 'título', position: { x: 0.5, y: 0.45 }, animation: 'fade', templateId: 'title', style: { ...DEFAULT_TEXT_STYLE, fontFamily: 'Montserrat', fontSize: 110, fontWeight: 900 } })];
    p.captions = cap('classic');
  } else if (tpl.id === 'ad-15') {
    text.clips = [
      makeTextClip('Pare de rolar! ✋', 0, 2, { label: 'gancho', position: { x: 0.5, y: 0.25 }, animation: 'pop', templateId: 'hook' }),
      makeTextClip('Só hoje: 30% OFF', 6, 4, { label: 'oferta', position: { x: 0.5, y: 0.5 }, animation: 'zoom', templateId: 'price', style: { ...DEFAULT_TEXT_STYLE, color: '#1C1F22', background: '#FFD23F', strokeWidth: 0, backgroundRadius: 24 } }),
      makeTextClip('Toque em Saiba mais →', 11, 4, { label: 'CTA', position: { x: 0.5, y: 0.82 }, animation: 'slide-up', templateId: 'cta', style: { ...DEFAULT_TEXT_STYLE, color: '#FFFFFF', background: '#D9641E', strokeWidth: 0, backgroundRadius: 40 } }),
    ];
    p.captions = cap('boxed');
  } else if (tpl.id === 'story') {
    p.canvas = { type: 'blur', blur: 0.8 };
    p.captions = cap('minimal');
  }
  return p;
}
