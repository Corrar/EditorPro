'use client';
/* =====================================================================
   FontPicker — busca + categorias + prévia na própria fonte.
   Sem onChange: aplica nos textos selecionados (ou nas legendas, se não
   houver texto selecionado). A fonte é baixada só quando a linha aparece.
   ===================================================================== */
import { useMemo, useRef, useState, useEffect } from 'react';
import Icon from '@/components/ui/Icon';
import { useEditor } from '@/lib/store';
import { findClip, type EditOp } from '@/lib/ops';
import type { TextClip } from '@/lib/types';
import { FONT_CATEGORY_LABELS, ensureFont, fontStack, nearestWeight, searchFonts, type FontCategory, type FontDef } from '@/lib/library/fonts';
import { PillRow, SearchPill } from './shared';
import { useVisible } from './mini';

type Cat = FontCategory | 'todas';
const CATS: { id: Cat; label: string }[] = [{ id: 'todas', label: 'Todas' }, ...(Object.keys(FONT_CATEGORY_LABELS) as FontCategory[]).map((id) => ({ id, label: FONT_CATEGORY_LABELS[id] }))];

function FontRow({ f, selected, sample, onPick }: { f: FontDef; selected: boolean; sample: string; onPick: (f: FontDef) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const visible = useVisible(ref);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    ensureFont(f.family, [f.display]).then((ok) => { if (alive) setReady(ok); });
    return () => { alive = false; };
  }, [visible, f.family, f.display]);
  return (
    <button ref={ref} type="button" className={`ep-row ep-lib-fontrow${selected ? ' on' : ''}`} onClick={() => onPick(f)} aria-pressed={selected}>
      <span className="ep-lib-fontname" style={{ fontFamily: ready ? fontStack(f.family) : undefined, fontWeight: f.display }}>
        {sample || f.family}
      </span>
      <span className="ep-lib-fontmeta">
        <span className="meta">{f.family !== sample && sample ? `${f.family} · ` : ''}{FONT_CATEGORY_LABELS[f.category]}</span>
        {selected && <Icon name="check" size={18} />}
      </span>
    </button>
  );
}

export default function FontPicker({ value, onChange, sample: sampleProp, query }: { value?: string; onChange?: (family: string, weight: number) => void; sample?: string; query?: string }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<Cat>('todas');
  const selection = useEditor((s) => s.selection);
  const project = useEditor((s) => s.project);
  const dispatch = useEditor((s) => s.dispatch);

  const selectedTexts = useMemo(
    () => selection.map((id) => findClip(project, id)?.clip).filter((c): c is TextClip => c?.type === 'text'),
    [selection, project],
  );
  const target = onChange ? 'custom' : selectedTexts.length ? 'texts' : 'captions';
  const current = value ?? (target === 'texts' ? selectedTexts[0]?.style.fontFamily : project.captions.style.fontFamily);
  const sample = sampleProp ?? (target === 'texts' ? selectedTexts[0]?.text.split('\n')[0].slice(0, 22) : '') ?? '';

  const effQ = query ?? q;
  const list = useMemo(() => searchFonts(effQ, cat), [effQ, cat]);

  const pick = (f: FontDef) => {
    if (onChange) { onChange(f.family, f.display); return; }
    if (target === 'texts') {
      const ops: EditOp[] = selectedTexts.map((c) => ({
        op: 'update_clip', clipId: c.id,
        patch: { style: { ...c.style, fontFamily: f.family, fontWeight: nearestWeight(f.family, c.style.fontWeight || f.display) } },
        explain: `Fonte ${f.family}`,
      }));
      dispatch(ops);
    } else {
      const w = nearestWeight(f.family, project.captions.style.fontWeight || f.display);
      dispatch({ op: 'set_caption_style', style: { fontFamily: f.family, fontWeight: w }, explain: `Legendas em ${f.family}` });
    }
  };

  return (
    <div className="ep-lib ep-lib-fonts">
      {query === undefined && <SearchPill value={q} onChange={setQ} placeholder="Buscar fonte" />}
      <PillRow value={cat} options={CATS} onChange={setCat} label="Categorias de fonte" />
      {target !== 'custom' && (
        <div className="ep-lib-target">Aplicando em: <b>{target === 'texts' ? (selectedTexts.length > 1 ? `${selectedTexts.length} textos` : 'texto selecionado') : 'legendas'}</b></div>
      )}
      <div className="ep-lib-fontlist">
        {list.map((f) => <FontRow key={f.family} f={f} selected={current === f.family} sample={sample} onPick={pick} />)}
        {!list.length && <div className="ep-lib-empty">Nenhuma fonte encontrada.</div>}
      </div>
      <p className="ep-lib-note">Fontes de licença aberta (OFL/Apache) do Google Fonts.</p>
    </div>
  );
}
