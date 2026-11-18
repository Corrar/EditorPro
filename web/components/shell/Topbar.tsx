'use client';
import { useEffect, useState } from 'react';
import { emit } from '@/lib/events';
import { useSaveStatus } from '@/lib/persist';
import { useEditor } from '@/lib/store';
import type { AspectRatio } from '@/lib/types';
import { IconExport, IconHome, IconMoon, IconRedo, IconSun, IconUndo } from './icons';
import Logo from './Logo';

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
      className="ep-projname" value={val} aria-label="Nome do projeto" spellCheck={false}
      onFocus={(e) => { setFocus(true); e.target.select(); }}
      onBlur={() => { setFocus(false); commit(); }}
      onChange={(e) => setVal(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') { if (e.key === 'Escape') setVal(name); (e.target as HTMLInputElement).blur(); } }}
      style={{ width: `${Math.min(28, Math.max(8, val.length + 1))}ch` }}
    />
  );
}

function SaveBadge() {
  const { status } = useSaveStatus();
  const label = { idle: '', saving: 'Salvando…', saved: 'Salvo', error: 'Erro ao salvar', unavailable: 'Sem armazenamento local' }[status];
  if (!label) return null;
  return <span className={`ep-save s-${status}`}><i />{label}</span>;
}

export default function Topbar({ dark, onTheme, onHome }: { dark: boolean; onTheme: () => void; onHome: () => void }) {
  const aspect = useEditor((s) => s.project.aspect);
  const dispatch = useEditor((s) => s.dispatch);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const live = useEditor((s) => s.live.running);

  return (
    <header className="ep-topbar">
      <button type="button" className="ep-iconbtn ep-homebtn" onClick={onHome} title="Meus projetos" aria-label="Meus projetos"><IconHome size={18} /></button>
      <Logo />
      <span className="ep-tsep" />
      <ProjectName />
      <SaveBadge />
      {live && <span className="ep-livebadge"><i />IA editando</span>}
      <span className="ep-tspace" />
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
      <div className="ep-undo">
        <button type="button" className="ep-iconbtn" onClick={undo} disabled={!canUndo} title="Desfazer" aria-label="Desfazer"><IconUndo size={17} /></button>
        <button type="button" className="ep-iconbtn" onClick={redo} disabled={!canRedo} title="Refazer" aria-label="Refazer"><IconRedo size={17} /></button>
      </div>
      <button type="button" className="ep-iconbtn" onClick={onTheme} title={dark ? 'Tema claro' : 'Tema escuro'} aria-label="Alternar tema">
        {dark ? <IconSun size={17} /> : <IconMoon size={17} />}
      </button>
      <button type="button" className="ep-btn primary ep-exportbtn" onClick={() => emit('ep:open-export', {})}>
        <IconExport size={16} /><span>Exportar</span>
      </button>
    </header>
  );
}
