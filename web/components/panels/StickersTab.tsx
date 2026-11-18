'use client';
/* Stickers (emoji nativo + PNG/GIF próprio) e Formas */
import { useRef, useState } from 'react';
import { makeShapeClip, makeStickerClip } from '@/lib/defaults';
import { emit } from '@/lib/events';
import { ingestFile } from '@/lib/media/ingest';
import { targetTrackId } from '@/lib/media/place';
import { useEditor } from '@/lib/store';
import type { ShapeClip, ShapeKind, StickerClip } from '@/lib/types';
import { IconUpload } from '@/components/shell/icons';
import { ColorField, Section, Slider } from './controls';
import { useClipPatch } from './hooks';
import { SHAPES } from './presets';
import { EMOJI_CATEGORIES } from './stickers';

export function ShapeGlyph({ shape, fill = 'currentColor', stroke, r = 0 }: { shape: ShapeKind; fill?: string; stroke?: string; r?: number }) {
  const sp = { fill, stroke, strokeWidth: stroke ? 2 : 0, strokeLinejoin: 'round' as const };
  const el = {
    rect: <rect x="4" y="8" width="32" height="24" rx={Math.min(8, r / 4)} {...sp} />,
    'rounded-rect': <rect x="4" y="8" width="32" height="24" rx="8" {...sp} />,
    circle: <circle cx="20" cy="20" r="14" {...sp} />,
    triangle: <path d="M20 6 35 33H5Z" {...sp} />,
    star: <path d="m20 4 4.7 9.6 10.6 1.5-7.7 7.5 1.8 10.5L20 28.1l-9.4 5 1.8-10.5-7.7-7.5 10.6-1.5Z" {...sp} />,
    arrow: <path d="M4 16h20V9l12 11-12 11v-7H4Z" {...sp} />,
    line: <rect x="4" y="18" width="32" height="4" rx="2" {...sp} />,
    heart: <path d="M20 34S5 25 5 14.5A7.5 7.5 0 0 1 20 11a7.5 7.5 0 0 1 15 3.5C35 25 20 34 20 34Z" {...sp} />,
    'speech-bubble': <path d="M8 6h24a4 4 0 0 1 4 4v14a4 4 0 0 1-4 4H18l-8 7v-7H8a4 4 0 0 1-4-4V10a4 4 0 0 1 4-4Z" {...sp} />,
  }[shape];
  return <svg viewBox="0 0 40 40" width="100%" height="100%" aria-hidden="true">{el}</svg>;
}

function useAddOverlay() {
  const dispatch = useEditor((s) => s.dispatch);
  const select = useEditor((s) => s.select);
  return (clip: StickerClip | ShapeClip, label: string) => {
    const st = useEditor.getState();
    dispatch({ op: 'add_clip', trackId: targetTrackId(st.project, 'overlay'), clip, explain: `Adicionando ${label}` });
    select([clip.id]);
  };
}

export function StickerSection({ clip }: { clip: StickerClip }) {
  const asset = useEditor((s) => (clip.assetId ? s.assets[clip.assetId] : undefined));
  return (
    <Section title="Sticker">
      <div className="ep-stkprev">{clip.emoji ? <span>{clip.emoji}</span> : asset?.url ? <img src={asset.url} alt="" /> : null}</div>
      <p className="ep-pnote">Ajuste tamanho e posição em “Posição”, entrada/saída em “Animação”.</p>
    </Section>
  );
}

export function ShapeStyleSection({ clip }: { clip: ShapeClip }) {
  const patch = useClipPatch(clip.id);
  return (
    <Section title="Forma">
      <div className="ep-shapegrid">
        {SHAPES.map((s) => (
          <button key={s.id} type="button" className={`ep-shape${clip.shape === s.id ? ' on' : ''}`} onClick={() => patch({ shape: s.id })} title={s.label}>
            <ShapeGlyph shape={s.id} fill={clip.fill} />
          </button>
        ))}
      </div>
      <ColorField label="Preenchimento" value={clip.fill} onChange={(v, h) => patch({ fill: v }, h)} />
      <ColorField label="Contorno" allowNone value={clip.stroke} onChange={(v, h) => patch({ stroke: v || undefined }, h)} />
      <Slider label="Espessura do contorno" value={clip.strokeWidth ?? 0} min={0} max={30} step={1} onChange={(v, h) => patch({ strokeWidth: v }, h)} format={(v) => `${v}px`} reset={0} />
      <Slider label="Raio dos cantos" value={clip.cornerRadius ?? 0} min={0} max={200} step={1} onChange={(v, h) => patch({ cornerRadius: v }, h)} format={(v) => `${v}px`} reset={0} />
    </Section>
  );
}

export default function StickersTab() {
  const [cat, setCat] = useState(EMOJI_CATEGORIES[0].id);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const add = useAddOverlay();
  const at = () => Math.round(useEditor.getState().playhead * 100) / 100;
  const items = EMOJI_CATEGORIES.find((c) => c.id === cat)!.items;

  const importSticker = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      const a = await ingestFile(f, 'broll');
      if (a.kind !== 'image') throw new Error('Use uma imagem PNG, GIF ou WebP');
      add(makeStickerClip(at(), { assetId: a.id }, 3, { label: a.name }), 'sticker');
    } catch (e) {
      emit('ep:toast', { text: e instanceof Error ? e.message : 'Falha ao importar', kind: 'error' });
    } finally { setBusy(false); }
  };

  return (
    <>
      <Section title="Stickers" right={<button type="button" className="ep-mini" onClick={() => input.current?.click()} disabled={busy}><IconUpload size={14} /> {busy ? 'Importando…' : 'PNG/GIF'}</button>}>
        <div className="ep-subtabs inline">
          {EMOJI_CATEGORIES.map((c) => <button key={c.id} type="button" className={c.id === cat ? 'on' : ''} onClick={() => setCat(c.id)}>{c.label}</button>)}
        </div>
        <div className="ep-emojigrid">
          {items.map((e) => (
            <button key={e} type="button" className="ep-emoji" onClick={() => add(makeStickerClip(at(), { emoji: e }, 3, { label: e }), 'sticker')} aria-label={`Adicionar ${e}`}>{e}</button>
          ))}
        </div>
        <input ref={input} type="file" hidden accept="image/png,image/gif,image/webp,image/svg+xml" onChange={(ev) => { void importSticker(ev.target.files?.[0]); ev.target.value = ''; }} />
      </Section>
      <Section title="Formas">
        <div className="ep-shapegrid">
          {SHAPES.map((s) => (
            <button key={s.id} type="button" className="ep-shape" onClick={() => add(makeShapeClip(s.id, at(), 3, { label: s.label }), s.label.toLowerCase())} title={s.label}>
              <ShapeGlyph shape={s.id} fill="var(--green)" />
              <span>{s.label}</span>
            </button>
          ))}
        </div>
      </Section>
    </>
  );
}
