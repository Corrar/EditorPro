'use client';
/* =====================================================================
   CaptionStyleGallery — estilos de legenda de creator com miniaturas
   animadas desenhadas pelo engine (palavras "faladas" em loop).
   Sem onSelect: aplica nas legendas do projeto (set_caption_style).
   ===================================================================== */
import { useEffect, useMemo, useState } from 'react';
import Icon from '@/components/ui/Icon';
import { useEditor } from '@/lib/store';
import { emit } from '@/lib/events';
import { DEFAULT_CAPTION_STYLE } from '@/lib/defaults';
import type { CaptionSegment, CaptionStyle, Project } from '@/lib/types';
import { CAPTION_CATEGORY_LABELS, CAPTION_PRESETS, captionPresetOp, captionStylePatch, type CaptionCategory, type CaptionPresetDef } from '@/lib/library/captions';
import { emojiForWords } from '@/lib/library/emoji';
import { ensureFont } from '@/lib/library/fonts';
import { MiniCanvas, drawMini, miniProject } from './mini';
import { PillRow, Empty } from './shared';
import { matchesQuery } from '@/lib/library/search';

type Cat = CaptionCategory | 'todos';
const CATS: { id: Cat; label: string }[] = [{ id: 'todos', label: 'Todos' }, ...(Object.keys(CAPTION_CATEGORY_LABELS) as CaptionCategory[]).map((id) => ({ id, label: CAPTION_CATEGORY_LABELS[id] }))];

const LOOP = 2.4;

/** projeto de prévia: 16:10-ish (16:9) com a frase de exemplo falada palavra a palavra */
function captionPreviewProject(def: CaptionPresetDef): Project {
  const words = def.sample.split(/\s+/).filter(Boolean);
  const span = 1.8 / Math.max(1, words.length);
  const seg: CaptionSegment = {
    id: 'pv', start: 0.05, end: LOOP - 0.1, text: def.sample,
    words: words.map((w, i) => ({ id: `w${i}`, text: w, start: 0.05 + i * span, end: 0.05 + (i + 1) * span })),
  };
  const patch = captionStylePatch(def.id, DEFAULT_CAPTION_STYLE)!;
  const style: CaptionStyle = {
    ...DEFAULT_CAPTION_STYLE, ...patch,
    // enquanto o engine não lê todos os campos novos, usa a aparência nativa mais próxima
    preset: def.base,
    fontSize: (patch.fontSize ?? 76) * 2.7,
    position: { x: 0.5, y: def.ownsPosition ? Math.min(0.84, patch.position?.y ?? 0.8) : 0.5 },
    maxWords: Math.min(patch.maxWords ?? 2, 2),
    lines: 1,
  };
  const p = miniProject('16:9', []);
  return { ...p, captions: { enabled: true, language: 'pt-BR', segments: [seg], style } };
}

function PresetTile({ def, selected, onPick }: { def: CaptionPresetDef; selected: boolean; onPick: (d: CaptionPresetDef) => void }) {
  const project = useMemo(() => captionPreviewProject(def), [def]);
  const emoji = def.style.autoEmoji ? emojiForWords(def.sample.split(' ')) : null;
  useEffect(() => { void ensureFont(def.style.fontFamily ?? 'Poppins', [def.style.fontWeight ?? 700]); }, [def]);
  return (
    <button type="button" className={`ep-lib-card${selected ? ' on' : ''}`} onClick={() => onPick(def)} aria-pressed={selected} title={def.description}>
      <span className="ep-lib-thumb wide">
        <MiniCanvas label={`Prévia: ${def.name}`} deps={[project]} draw={(ctx, clock) => drawMini(ctx, project, (clock % LOOP))} />
        {emoji && <span className="ep-lib-emoji" aria-hidden>{emoji}</span>}
        {selected && <span className="ep-lib-badge"><Icon name="check" size={16} /></span>}
      </span>
      <span className="ep-lib-cardlb">{def.name}</span>
    </button>
  );
}

export default function CaptionStyleGallery({ value, onSelect, query }: { value?: string; onSelect?: (id: string) => void; query?: string }) {
  const [cat, setCat] = useState<Cat>('todos');
  const style = useEditor((s) => s.project.captions.style);
  const captions = useEditor((s) => s.project.captions);
  const dispatch = useEditor((s) => s.dispatch);
  const current = value ?? style.preset;
  const list = CAPTION_PRESETS.filter((c) => (cat === 'todos' || c.category === cat) && matchesQuery(query, [c.name, c.description, c.sample, CAPTION_CATEGORY_LABELS[c.category]]));

  const pick = (def: CaptionPresetDef) => {
    if (onSelect) { onSelect(def.id); return; }
    const op = captionPresetOp(def.id, style);
    if (!op) return;
    const ops = [op];
    if (!captions.enabled && captions.segments.length) ops.push({ op: 'toggle_captions', enabled: true });
    dispatch(ops);
    if (!captions.segments.length) emit('ep:toast', { text: `Estilo “${def.name}” escolhido. Gere as legendas para ver no vídeo.`, kind: 'info' });
  };

  return (
    <div className="ep-lib ep-lib-captions">
      <PillRow value={cat} options={CATS} onChange={setCat} label="Categorias de legenda" />
      {!list.length && <Empty>Nenhum estilo encontrado{query ? ` para “${query}”` : ''}.</Empty>}
      <div className="ep-lib-grid wide">
        {list.map((d) => <PresetTile key={d.id} def={d} selected={current === d.id} onPick={pick} />)}
      </div>
    </div>
  );
}
