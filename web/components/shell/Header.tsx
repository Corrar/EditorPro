'use client';
/* header do editor (padrão .ep-header do Radar): título editável + pílulas de status + ações */
import { useEffect, useState } from 'react';
import { emit } from '@/lib/events';
import { projectDuration } from '@/lib/ops';
import { useSaveStatus } from '@/lib/persist';
import { useEditor } from '@/lib/store';
import type { AspectRatio } from '@/lib/types';
import { formatTime } from '@/lib/util';
import { openExport } from './exportPref';
import { IconClose, IconExport, IconRedo, IconSearch, IconUndo } from './icons';
import ResolutionPill from './ResolutionPill';

const ASPECTS: AspectRatio[] = ['9:16', '16:9', '1:1', '4:5'];

function AspectGlyph({ a }: { a: AspectRatio }) {
  const [w, h] = a.split(':').map(Number);
  const k = 12 / Math.max(w, h);
  return <i className="ep-aglyph" style={{ width: Math.round(w * k), height: Math.round(h * k) }} />;
}

function ProjectName() {
  const name = useEditor((s) => s.project.name);
  const dispatch = useEditor((s) => s.dispatch);
  const [val, setVal] = useState(name);
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (!focus) setVal(name); }, [name, focus]);
  const commit = () => {
    const v = val.trim() || 'Projeto sem título';
    if (v !== name) dispatch({ op: 'set_project', patch: { name: v } });
    setVal(v);
  };
  return (
    <input
      className="ep-h1 ep-projname" value={val} aria-label="Nome do projeto" spellCheck={false} title="Clique para renomear"
      onFocus={(e) => { setFocus(true); e.target.select(); }}
      onBlur={() => { setFocus(false); commit(); }}
      onChange={(e) => setVal(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') { if (e.key === 'Escape') setVal(name); (e.target as HTMLInputElement).blur(); } }}
    />
  );
}

function SaveBadge() {
  const { status } = useSaveStatus();
  const label = { idle: '', saving: 'Salvando…', saved: 'Salvo', error: 'Erro ao salvar', unavailable: 'Sem armazenamento local' }[status];
  if (!label) return null;
  return <span className={`ep-save s-${status}`}><i />{label}</span>;
}

export default function Header({ onHome, onSearch }: { onHome?: () => void; onSearch?: () => void }) {
  const aspect = useEditor((s) => s.project.aspect);
  const duration = useEditor((s) => projectDuration(s.project));
  const clips = useEditor((s) => s.project.tracks.reduce((n, t) => n + t.clips.length, 0));
  const dispatch = useEditor((s) => s.dispatch);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const live = useEditor((s) => s.live);

  return (
    <header className="ep-header">
      <div className="ep-hmain">
        {onHome && <button type="button" className="ep-hback" onClick={onHome} aria-label="Fechar e voltar ao início" title="Início"><IconClose size={22} /></button>}
        <ProjectName />
        <div className="ep-stats">
          <span className="ep-statpill"><span className="dot" style={{ background: 'var(--green)' }} /><b className="mono">{formatTime(duration)}</b><span>duração</span></span>
          <span className="ep-statpill"><span className="dot" style={{ background: '#EBAF7E' }} /><b className="mono">{aspect}</b><span>formato</span></span>
          <span className="ep-statpill"><span className="dot" style={{ background: 'var(--faint)' }} /><b className="mono">{clips}</b><span>clipe{clips === 1 ? '' : 's'}</span></span>
          {live.running ? (
            <span className="ep-statpill live"><span className="dot" /><b className="mono">{live.done}/{live.total}</b><span>IA editando</span></span>
          ) : <SaveBadge />}
        </div>
      </div>
      <div className="ep-hactions">
        <div className="ep-undo">
          <button type="button" className="ep-iconbtn" onClick={undo} disabled={!canUndo} title="Desfazer" aria-label="Desfazer"><IconUndo size={17} /></button>
          <button type="button" className="ep-iconbtn" onClick={redo} disabled={!canRedo} title="Refazer" aria-label="Refazer"><IconRedo size={17} /></button>
        </div>
        <div className="ep-seg ep-aspects" role="radiogroup" aria-label="Formato">
          {ASPECTS.map((a) => (
            <button key={a} type="button" role="radio" aria-checked={aspect === a} className={aspect === a ? 'on' : ''} onClick={() => aspect !== a && dispatch({ op: 'set_aspect', aspect: a })} title={`Formato ${a}`}>
              <AspectGlyph a={a} />{a}
            </button>
          ))}
        </div>
        <select className="ep-select ep-aspect-sel" value={aspect} aria-label="Formato" onChange={(e) => dispatch({ op: 'set_aspect', aspect: e.target.value as AspectRatio })}>
          {ASPECTS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        {onSearch && <button type="button" className="ep-hsearch" onClick={onSearch} aria-label="Buscar ferramentas e biblioteca" title="Buscar"><IconSearch size={21} /></button>}
        <ResolutionPill />
        <button type="button" className="ep-btn primary ep-exportbtn" onClick={() => (window.matchMedia('(max-width: 899px)').matches ? openExport() : emit('ep:open-export', {}))}>
          <IconExport size={16} /><span>Exportar</span>
        </button>
      </div>
    </header>
  );
}
