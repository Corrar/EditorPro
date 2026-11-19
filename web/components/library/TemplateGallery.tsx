'use client';
/* =====================================================================
   Galeria de modelos (texto ou motion graphics). Miniaturas animadas
   montadas com buildTemplate() num projeto mínimo; ao escolher, abre o
   formulário de parâmetros + cores da marca e insere no playhead (1 desfazer).
   ===================================================================== */
import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '@/components/ui/Icon';
import { useEditor } from '@/lib/store';
import { applyOps } from '@/lib/ops';
import { emit } from '@/lib/events';
import type { AspectRatio, Project, TextStyle } from '@/lib/types';
import {
  DEFAULT_BRAND, TEMPLATE_CATEGORY_LABELS, buildTemplate, defaultValues, templateFonts, templatesOf,
  type BrandColors, type TemplateCategory, type TemplateDef, type TemplateKind,
} from '@/lib/library/templates';
import { ensureFont, nearestWeight } from '@/lib/library/fonts';
import { MiniCanvas, drawMiniRegion, miniProject, type Region } from './mini';
import { shapeAspect } from '@/lib/engine/shapes';
import { PillRow, Empty, FavButton, usePrefs, withPrefPills, prefFilter } from './shared';
import { matchesQuery } from '@/lib/library/search';

const PREVIEW_ASPECT: AspectRatio = '4:5';
const BRAND_KEY = 'ep-lib-brand';

/* ---------- medição real de texto (canvas) ---------- */

let measureCtx: CanvasRenderingContext2D | null = null;
export function measureText(text: string, style: TextStyle, H: number): number {
  if (typeof document === 'undefined') return 0;
  measureCtx ??= document.createElement('canvas').getContext('2d');
  const ctx = measureCtx!;
  const px = (style.fontSize * H) / 1920;
  const w = nearestWeight(style.fontFamily, style.fontWeight || 700);
  ctx.font = `${style.italic ? 'italic ' : ''}${w} ${px}px "${style.fontFamily}", Poppins, sans-serif`;
  const s = style.uppercase ? text.toLocaleUpperCase('pt-BR') : text;
  const spacing = ((style.letterSpacing ?? 0) * H) / 1920;
  return Math.max(...s.split('\n').map((l) => ctx.measureText(l).width + l.length * spacing));
}

function loadBrand(): BrandColors {
  try { return { ...DEFAULT_BRAND, ...JSON.parse(localStorage.getItem(BRAND_KEY) || '{}') }; } catch { return DEFAULT_BRAND; }
}

/* ---------- prévia ---------- */

/** região que enquadra o conteúdo do modelo (quadrada em frações, pois prévia e quadro têm o mesmo aspecto) */
function contentRegion(p: Project): Region {
  const { width: W, height: H } = p;
  const short = Math.min(W, H);
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  const add = (cx: number, cy: number, w: number, h: number) => {
    x0 = Math.min(x0, cx - w / 2); x1 = Math.max(x1, cx + w / 2);
    y0 = Math.min(y0, cy - h / 2); y1 = Math.max(y1, cy + h / 2);
  };
  for (const t of p.tracks) {
    if (t.id === 'mini_bg') continue;
    for (const c of t.clips) {
      if (c.type === 'text') {
        const px = (c.style.fontSize * H) / 1920;
        const lines = c.text.split('\n').length;
        const pad = c.style.background ? ((c.style.backgroundPadding ?? 12) * H) / 1920 * 2 : 0;
        add(c.position.x, c.position.y, (measureText(c.text, c.style, H) + pad) / W, (px * 1.25 * lines + pad) / H);
      } else if (c.type === 'shape' || c.type === 'sticker') {
        const asp = c.type === 'shape' ? c.aspect ?? shapeAspect(c.shape) : 1;
        let w = short * 0.95 * c.transform.scale;
        let h = asp >= 1 ? w / asp : w;
        if (asp < 1) w = h * asp;
        if (Math.abs(Math.abs(c.transform.rotation % 180) - 90) < 1) [w, h] = [h, w];
        add(0.5 + c.transform.x, 0.5 + c.transform.y, w / W, h / H);
      }
    }
  }
  if (x1 <= x0 || y1 <= y0) return { x: 0, y: 0, w: 1, h: 1 };
  const size = Math.min(1, Math.max(0.5, x1 - x0 + 0.1, y1 - y0 + 0.1));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const clampS = (c: number) => Math.max(0, Math.min(1 - size, c - size / 2));
  return { x: clampS(cx), y: clampS(cy), w: size, h: size };
}

function useTemplatePreview(def: TemplateDef, values: Record<string, string>, brand: BrandColors) {
  return useMemo(() => {
    const base = miniProject(PREVIEW_ASPECT, []);
    const ops = buildTemplate(def.id, values, { project: base, at: 0, brand, measure: measureText, duration: def.fullLength ? 4 : undefined });
    const { project } = applyOps(base, ops);
    return project;
  }, [def, values, brand]);
}

function TemplateTile({ def, selected, brand, values, onPick, fav, onFav, onQuick }: {
  def: TemplateDef; selected: boolean; brand: BrandColors; values: Record<string, string>; onPick: (d: TemplateDef) => void;
  fav: boolean; onFav: () => void; onQuick: () => void;
}) {
  const project = useTemplatePreview(def, values, brand);
  const [fontsTick, setFontsTick] = useState(0);
  useEffect(() => {
    let alive = true;
    Promise.all(templateFonts(def.id, project).map((f) => ensureFont(f, [400, 600, 700, 800, 900]))).then(() => { if (alive) setFontsTick((n) => n + 1); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def.id]);
  const loop = (def.fullLength ? 4 : def.duration) + 0.6;
  const region = useMemo(() => contentRegion(project), [project, fontsTick]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={`ep-lib-card${selected ? ' on' : ''}`}>
      <button type="button" className="ep-lib-cardmain" onClick={() => onPick(def)} aria-pressed={selected} title={def.description}>
      <span className="ep-lib-thumb tall">
        <MiniCanvas label={`Prévia: ${def.name}`} deps={[project, fontsTick, region]}
          draw={(ctx, clock) => drawMiniRegion(ctx, project, Math.min(clock % loop, loop - 0.65), region)} />
        {selected && <span className="ep-lib-badge"><Icon name="check" size={16} /></span>}
      </span>
      <span className="ep-lib-cardlb">{def.name}</span>
    </button>
      <FavButton on={fav} onToggle={onFav} label={def.name} />
      <button type="button" className="ep-lib-quickadd" aria-label={`Inserir ${def.name} agora`} onClick={onQuick}>
        <span aria-hidden><Icon name="add" size={18} /></span>
      </button>
      </div>
  );
}

/* ---------- galeria ---------- */

export default function TemplateGallery({ kind, onInserted, query }: { kind: TemplateKind; onInserted?: (clipIds: string[]) => void; query?: string }) {
  const all = useMemo(() => templatesOf(kind), [kind]);
  const cats = useMemo(() => {
    const ids = [...new Set(all.map((t) => t.category))];
    return [{ id: 'todos' as const, label: 'Todos' }, ...ids.map((id) => ({ id, label: TEMPLATE_CATEGORY_LABELS[id] }))];
  }, [all]);
  const defaults = useMemo(() => Object.fromEntries(all.map((t) => [t.id, defaultValues(t)])), [all]);
  const [cat, setCat] = useState<string>('todos');
  const prefs = usePrefs('template');
  const [sel, setSel] = useState<TemplateDef | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [brand, setBrand] = useState<BrandColors>(DEFAULT_BRAND);
  const formRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setBrand(loadBrand()); }, []);
  useEffect(() => {
    if (sel) formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [sel]);

  const pick = (d: TemplateDef) => {
    if (sel?.id === d.id) { setSel(null); return; }
    setSel(d);
    setValues(defaultValues(d));
  };

  const setBrandColor = (k: keyof BrandColors, v: string) => {
    const next = { ...brand, [k]: v };
    setBrand(next);
    try { localStorage.setItem(BRAND_KEY, JSON.stringify(next)); } catch { /* sem armazenamento */ }
  };

  const insertDef = async (def: TemplateDef, vals: Record<string, string>) => {
    prefs.recent(def.id);
    await Promise.all(templateFonts(def.id, useEditor.getState().project).map((f) => ensureFont(f, [400, 600, 700, 800, 900])));
    const st = useEditor.getState();
    const ops = buildTemplate(def.id, vals, { project: st.project, at: st.playhead, brand, measure: measureText });
    if (!ops.length) { emit('ep:toast', { text: 'Preencha pelo menos um texto do modelo', kind: 'error' }); return; }
    st.dispatch(ops);
    const ids = ops.flatMap((o) => (o.op === 'add_clip' ? [o.clip.id] : []));
    st.select(ids);
    emit('ep:toast', { text: `Modelo “${def.name}” inserido`, kind: 'ok' });
    onInserted?.(ids);
  };
  const insert = () => { if (sel) void insertDef(sel, values); };

  const special = prefFilter(all, cat, prefs.favs, prefs.recents);
  const list = (special ?? all.filter((t) => cat === 'todos' || t.category === cat))
    .filter((t) => matchesQuery(query, [t.name, t.description, TEMPLATE_CATEGORY_LABELS[t.category]]));

  return (
    <div className="ep-lib ep-lib-templates">
      {(cats.length > 2 || prefs.favs.length > 0 || prefs.recents.length > 0) && <PillRow value={cat} options={withPrefPills(cats, prefs.favs.filter((id) => all.some((t) => t.id === id)), prefs.recents.filter((id) => all.some((t) => t.id === id)))} onChange={setCat} label="Categorias de modelo" />}
      {!list.length && <Empty>Nenhum modelo encontrado{query ? ` para “${query}”` : ''}.</Empty>}
      <div className="ep-lib-grid">
        {list.map((d) => (
          <TemplateTile key={d.id} def={d} selected={sel?.id === d.id} brand={brand}
            values={sel?.id === d.id ? values : defaults[d.id]} onPick={pick}
            fav={prefs.isFav(d.id)} onFav={() => prefs.toggle(d.id)} onQuick={() => void insertDef(d, sel?.id === d.id ? values : defaults[d.id])} />
        ))}
      </div>
      {sel && (
        <div ref={formRef} className="ep-lib-form" role="group" aria-label={`Editar ${sel.name}`}>
          <div className="ep-lib-formhead">
            <div>
              <div className="ep-lib-title">{sel.name}</div>
              <div className="ep-lib-hint">{sel.description}</div>
            </div>
            <button type="button" className="ep-circle sm" onClick={() => setSel(null)} aria-label="Fechar"><Icon name="close" size={18} /></button>
          </div>
          {sel.params.map((p) => (
            <label key={p.key} className="ep-lib-field">
              <span>{p.label}</span>
              {p.multiline ? (
                <textarea className="ep-textarea" rows={2} value={values[p.key] ?? ''} onChange={(e) => setValues({ ...values, [p.key]: e.target.value })} />
              ) : (
                <input className="ep-input" inputMode={p.type === 'number' ? 'numeric' : undefined} value={values[p.key] ?? ''}
                  onChange={(e) => setValues({ ...values, [p.key]: e.target.value })} />
              )}
            </label>
          ))}
          <div className="ep-lib-colors">
            {([['primary', 'Cor principal'], ['secondary', 'Destaque']] as const).map(([k, lb]) => (
              <label key={k} className="ep-lib-color">
                <input type="color" value={brand[k]} onChange={(e) => setBrandColor(k, e.target.value)} aria-label={lb} />
                <span>{lb}</span>
              </label>
            ))}
            <button type="button" className="ep-lib-link" onClick={() => { setBrand(DEFAULT_BRAND); try { localStorage.removeItem(BRAND_KEY); } catch { /* */ } }}>Restaurar</button>
          </div>
          <button type="button" className="ep-cta accent ep-lib-insert" onClick={insert}>
            <Icon name="add" size={20} /> Inserir no vídeo
          </button>
        </div>
      )}
    </div>
  );
}
