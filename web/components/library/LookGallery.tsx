'use client';
/* =====================================================================
   LookGallery — looks de cor tipo LUT com miniatura do quadro atual.
   Intensidade 0–100%. Aplica no clipe selecionado / clipe no playhead,
   ou no vídeo todo como camada de ajuste (não destrutivo).
   ===================================================================== */
import { useEffect, useMemo, useState } from 'react';
import Icon from '@/components/ui/Icon';
import { useEditor } from '@/lib/store';
import { clipsAt, findClip } from '@/lib/ops';
import { emit } from '@/lib/events';
import type { Clip, MediaAsset, Project } from '@/lib/types';
import { LOOKS, LOOK_CATEGORY_LABELS, detectLook, lookAdjustmentOps, lookClipOps, lookFilters, type LookCategory, type LookDef } from '@/lib/library/looks';
import { MiniCanvas, SCENE_ASSET, drawMini, miniMedia, miniProject } from './mini';
import { PillRow, Empty } from './shared';
import { matchesQuery } from '@/lib/library/search';

type Cat = LookCategory | 'todos';
type Target = 'clip' | 'all';
const CATS: { id: Cat; label: string }[] = [{ id: 'todos', label: 'Todos' }, ...(Object.keys(LOOK_CATEGORY_LABELS) as LookCategory[]).map((id) => ({ id, label: LOOK_CATEGORY_LABELS[id] }))];
const FRAME_ASSET = '__lib_frame__';

/** quadro de referência: miniatura do clipe visual no playhead (ou do selecionado) */
function useReferenceFrame(clip: Clip | undefined, assets: Record<string, MediaAsset>, playhead: number): HTMLImageElement | null {
  const src = useMemo(() => {
    if (!clip || (clip.type !== 'video' && clip.type !== 'image')) return null;
    const a = assets[clip.assetId];
    if (!a) return null;
    if (a.kind === 'image') return a.url ?? a.thumbnails?.[0] ?? null;
    const th = a.thumbnails;
    if (!th?.length) return null;
    const local = clip.type === 'video' ? clip.in + Math.max(0, playhead - clip.start) * (clip.speed || 1) : 0;
    const i = Math.max(0, Math.min(th.length - 1, Math.round((local / Math.max(0.01, a.duration)) * (th.length - 1))));
    return th[i];
  }, [clip, assets, playhead]);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!src) { setImg(null); return; }
    const el = new Image();
    el.onload = () => setImg(el);
    el.onerror = () => setImg(null);
    el.src = src;
  }, [src]);
  return img;
}

function LookTile({ def, selected, frame, onPick }: { def: LookDef | null; selected: boolean; frame: HTMLImageElement | null; onPick: () => void }) {
  const project: Project = useMemo(() => miniProject('4:5', [], {
    sceneAsset: frame ? FRAME_ASSET : SCENE_ASSET,
    sceneFilters: def ? lookFilters(def.id, 1) : [],
  }), [def, frame]);
  const media = useMemo(() => miniMedia(frame ? { [FRAME_ASSET]: frame } : undefined), [frame]);
  return (
    <button type="button" className={`ep-lib-card sm${selected ? ' on' : ''}`} onClick={onPick} aria-pressed={selected} title={def?.description}>
      <span className="ep-lib-thumb portrait">
        <MiniCanvas animate={false} label={def ? `Look ${def.name}` : 'Sem look'} deps={[project, media]} draw={(ctx) => drawMini(ctx, project, 0, media)} />
        {selected && <span className="ep-lib-badge"><Icon name="check" size={14} /></span>}
      </span>
      <span className="ep-lib-cardlb">{def ? def.name : 'Original'}</span>
    </button>
  );
}

export default function LookGallery({ onApply, query }: { onApply?: (lookId: string | null, intensity: number) => void; query?: string }) {
  const [cat, setCat] = useState<Cat>('todos');
  const project = useEditor((s) => s.project);
  const assets = useEditor((s) => s.assets);
  const playhead = useEditor((s) => s.playhead);
  const selection = useEditor((s) => s.selection);
  const dispatch = useEditor((s) => s.dispatch);

  // alvo: clipe visual selecionado, senão o de cima no playhead
  const target = useMemo(() => {
    const sel = selection.map((id) => findClip(project, id)?.clip).find((c) => c && (c.type === 'video' || c.type === 'image' || c.type === 'adjustment'));
    if (sel) return sel;
    return clipsAt(project, playhead).map((x) => x.clip).filter((c) => c.type === 'video' || c.type === 'image').pop();
  }, [selection, project, playhead]);
  const frameClip = target?.type === 'adjustment' ? clipsAt(project, playhead).map((x) => x.clip).filter((c) => c.type === 'video' || c.type === 'image').pop() : target;
  const frame = useReferenceFrame(frameClip, assets, playhead);

  const applied = target && 'filters' in target ? detectLook(target.filters) : null;
  const [intensity, setIntensity] = useState(applied?.intensity ?? 1);
  const [mode, setMode] = useState<Target>(target ? 'clip' : 'all');
  const [last, setLast] = useState<string | null>(applied?.id ?? null);
  useEffect(() => { if (applied) { setLast(applied.id); setIntensity(applied.intensity); } }, [applied?.id, applied?.intensity]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!target && mode === 'clip') setMode('all'); }, [target, mode]);

  const apply = (id: string | null, k = intensity) => {
    setLast(id);
    if (onApply) return onApply(id, k);
    if (mode === 'clip' && target) {
      dispatch(id ? lookClipOps(project, [target.id], id, k) : [{ op: 'update_clip', clipId: target.id, patch: { filters: [] }, explain: 'Sem look' }]);
    } else if (id) {
      dispatch(lookAdjustmentOps(project, id, k));
      emit('ep:toast', { text: 'Look aplicado em uma camada de ajuste sobre o vídeo todo', kind: 'ok' });
    }
  };

  const list = LOOKS.filter((l) => (cat === 'todos' || l.category === cat) && matchesQuery(query, [l.name, l.description, LOOK_CATEGORY_LABELS[l.category], 'cor filtro']));
  const selectedId = mode === 'clip' ? applied?.id ?? (target && 'filters' in target && !target.filters.length ? null : undefined) : undefined;

  return (
    <div className="ep-lib ep-lib-looks">
      <div className="ep-lib-seg" role="radiogroup" aria-label="Aplicar look em">
        <button type="button" role="radio" aria-checked={mode === 'clip'} className={mode === 'clip' ? 'on' : ''} disabled={!target} onClick={() => setMode('clip')}>
          {target?.type === 'adjustment' ? 'Camada selecionada' : 'Clipe'}
        </button>
        <button type="button" role="radio" aria-checked={mode === 'all'} className={mode === 'all' ? 'on' : ''} onClick={() => setMode('all')}>Vídeo todo</button>
      </div>
      <label className="ep-lib-range">
        <span className="ep-lib-rangetop"><span>Intensidade</span><b>{Math.round(intensity * 100)}%</b></span>
        <input type="range" min={0} max={100} step={5} value={Math.round(intensity * 100)}
          onChange={(e) => setIntensity(Number(e.target.value) / 100)}
          onPointerUp={() => { if (mode === 'clip' && last) apply(last); }}
          onKeyUp={() => { if (mode === 'clip' && last) apply(last); }}
          aria-label="Intensidade do look" />
      </label>
      <PillRow value={cat} options={CATS} onChange={setCat} label="Categorias de look" />
      {!list.length && <Empty>Nenhum look encontrado{query ? ` para “${query}”` : ''}.</Empty>}
      <div className="ep-lib-grid sm">
        {mode === 'clip' && <LookTile def={null} selected={selectedId === null} frame={frame} onPick={() => apply(null)} />}
        {list.map((l) => <LookTile key={l.id} def={l} selected={selectedId === l.id} frame={frame} onPick={() => apply(l.id)} />)}
      </div>
    </div>
  );
}
