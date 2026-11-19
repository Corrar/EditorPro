'use client';
/* =====================================================================
   <ColorPanel/> — página de Cor estilo DaVinci (desktop e celular).
   Edita o clipe selecionado (vídeo/imagem/camada de ajuste) via
   dispatch({op:'update_clip', patch:{colorGrade}}).
   ===================================================================== */
import '@/styles/color.css';
import { useEffect, useState } from 'react';
import { useEditor } from '@/lib/store';
import type { ColorGrade } from '@/lib/types';
import { isNeutralGrade, normalizeGrade } from '@/lib/color/grade';
import { setCompare, getCompare } from '@/lib/color';
import { emit } from '@/lib/events';
import Icon from '@/components/ui/Icon';
import { Pills, ColorSlider } from './controls';
import { useGradableSelection, useGradeEditor, writeGrade, isGradable } from './useGrade';
import { WheelsTab } from './Wheels';
import { CurvesTab } from './Curves';
import { BasicTab, HslTab } from './Tabs';
import { LooksTab } from './Looks';
import { ScopesTab, useScopes } from './Scopes';
import { useClipFrame } from './useClipFrame';

export type ColorTab = 'wheels' | 'curves' | 'hsl' | 'basic' | 'looks' | 'scopes';
const CLIP_KEY = 'ep-color-clipboard';

function readClipboard(): ColorGrade | null {
  try { const s = localStorage.getItem(CLIP_KEY); return s ? (JSON.parse(s) as ColorGrade) : null; } catch { return null; }
}

/** força o preview a redesenhar (mesmo conteúdo, objeto novo; sem histórico) */
function touch(clipId: string) {
  const st = useEditor.getState();
  const c = st.project.tracks.flatMap((t) => t.clips).find((k) => k.id === clipId);
  if (c && isGradable(c)) st.dispatch({ op: 'update_clip', clipId, patch: { colorGrade: c.colorGrade ? { ...c.colorGrade } : undefined } }, { history: false });
}

export default function ColorPanel({ initialTab = 'basic' }: { initialTab?: ColorTab }) {
  const clip = useGradableSelection();
  const { grade, set } = useGradeEditor(clip);
  const [tab, setTab] = useState<ColorTab>(initialTab);
  const [split, setSplit] = useState(getCompare().mode === 'split');
  const [hasClip, setHasClip] = useState(() => !!readClipboard());
  const needFrame = tab === 'looks' || tab === 'scopes' || tab === 'curves';
  const frame = useClipFrame(clip, needFrame);
  const scopes = useScopes(frame, grade, tab === 'scopes' || tab === 'curves');

  // segurar "Original": tira a grade sem histórico e devolve ao soltar (funciona em qualquer modo de render)
  const [holding, setHolding] = useState<{ id: string; g?: ColorGrade } | null>(null);
  const holdStart = () => {
    if (!clip || holding) return;
    setHolding({ id: clip.id, g: clip.colorGrade });
    useEditor.getState().dispatch({ op: 'update_clip', clipId: clip.id, patch: { colorGrade: undefined } }, { history: false });
  };
  const holdEnd = () => {
    if (!holding) return;
    useEditor.getState().dispatch({ op: 'update_clip', clipId: holding.id, patch: { colorGrade: holding.g } }, { history: false });
    setHolding(null);
  };
  useEffect(() => () => { if (holding) holdEnd(); }); // segurança ao desmontar

  useEffect(() => () => { if (getCompare().mode === 'split') setCompare({ mode: 'off' }); }, []);

  if (!clip) {
    return (
      <div className="ec-root ec-empty">
        <span className="ec-empty-ic"><Icon name="filters" size={28} /></span>
        <strong>Correção de cor</strong>
        <p>Selecione um clipe de vídeo, imagem ou uma camada de ajuste na timeline para corrigir a cor.</p>
      </div>
    );
  }

  const neutral = isNeutralGrade(grade);
  const shown = holding ? holding.g ?? {} : grade;
  const applyAll = () => {
    const st = useEditor.getState();
    const g = normalizeGrade(grade);
    const ops = st.project.tracks.flatMap((t) => t.clips)
      .filter((c) => (c.type === 'video' || c.type === 'image') && c.id !== clip.id)
      .map((c) => ({ op: 'update_clip' as const, clipId: c.id, patch: { colorGrade: g ? structuredClone(g) : undefined } }));
    if (!ops.length) { emit('ep:toast', { text: 'Não há outros clipes de vídeo ou imagem', kind: 'info' }); return; }
    st.dispatch(ops, { history: true });
    emit('ep:toast', { text: `Cor aplicada a ${ops.length} clipe${ops.length > 1 ? 's' : ''}`, kind: 'ok' });
  };

  return (
    <div className="ec-root">
      <div className="ec-bar">
        <button type="button" className={`ec-chip${holding ? ' on' : ''}`} disabled={neutral && !holding}
          onPointerDown={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); holdStart(); }}
          onPointerUp={holdEnd} onPointerCancel={holdEnd} onLostPointerCapture={holdEnd}
          onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); holdStart(); } }}
          onKeyUp={holdEnd} onContextMenu={(e) => e.preventDefault()}
          aria-label="Segure para ver o original">
          <Icon name="show" size={16} /> Original
        </button>
        <button type="button" className={`ec-chip${split ? ' on' : ''}`} aria-pressed={split}
          onClick={() => { const v = !split; setSplit(v); setCompare({ mode: v ? 'split' : 'off' }); touch(clip.id); }}>
          <Icon name="flip" size={16} /> Dividir
        </button>
        <span className="ec-bar-sp" />
        <button type="button" className="ec-icon-btn" title="Copiar cor" aria-label="Copiar cor" disabled={neutral}
          onClick={() => { try { localStorage.setItem(CLIP_KEY, JSON.stringify(normalizeGrade(grade) ?? {})); } catch { /* */ } setHasClip(true); emit('ep:toast', { text: 'Cor copiada', kind: 'ok' }); }}>
          <Icon name="copy" size={17} />
        </button>
        <button type="button" className="ec-icon-btn" title="Colar cor" aria-label="Colar cor" disabled={!hasClip}
          onClick={() => { const g = readClipboard(); if (g) { writeGrade(clip.id, g, true); emit('ep:toast', { text: 'Cor colada', kind: 'ok' }); } }}>
          <Icon name="replace" size={17} />
        </button>
        <button type="button" className="ec-icon-btn" title="Aplicar a todos os clipes" aria-label="Aplicar a todos os clipes" onClick={applyAll}>
          <Icon name="layers" size={17} />
        </button>
        <button type="button" className="ec-icon-btn" title="Restaurar tudo" aria-label="Restaurar toda a correção" disabled={neutral}
          onClick={() => set(() => ({}), 'once')}>
          <Icon name="rotate" size={17} />
        </button>
      </div>
      {split && (
        <div className="ec-split">
          <ColorSlider label="Divisão antes | depois" value={getCompare().split} min={0.05} max={0.95} def={0.5}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => { setCompare({ split: v }); touch(clip.id); }} />
        </div>
      )}
      <Pills<ColorTab> label="Ferramentas de cor" value={tab} onChange={setTab} options={[
        { id: 'basic', label: 'Básico' }, { id: 'wheels', label: 'Rodas' }, { id: 'curves', label: 'Curvas' },
        { id: 'hsl', label: 'HSL' }, { id: 'looks', label: 'Looks' }, { id: 'scopes', label: 'Escopos' },
      ]} />
      <div className="ec-body">
        {tab === 'basic' && <BasicTab grade={shown} set={set} />}
        {tab === 'wheels' && <WheelsTab grade={shown} set={set} />}
        {tab === 'curves' && <CurvesTab grade={shown} set={set} scopes={scopes} />}
        {tab === 'hsl' && <HslTab grade={shown} set={set} />}
        {tab === 'looks' && <LooksTab grade={shown} set={set} frame={frame} />}
        {tab === 'scopes' && <ScopesTab data={scopes} hasFrame={!!frame} />}
      </div>
    </div>
  );
}
