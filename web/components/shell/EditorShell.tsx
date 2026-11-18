'use client';
/* =====================================================================
   EditorShell — composição do app (dono: sessão "shell").
   Versão inicial da sessão principal: só monta o grid e os módulos.
   ===================================================================== */
import { useEffect, useState } from 'react';
import Timeline from '@/components/timeline/Timeline';
import Preview from '@/components/preview/Preview';
import ChatPanel from '@/components/chat/ChatPanel';
import MediaBin from '@/components/media/MediaBin';
import { useEditor } from '@/lib/store';

export default function EditorShell() {
  const [dark, setDark] = useState(true);
  const name = useEditor((s) => s.project.name);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('ep_theme');
      if (saved) setDark(saved === 'dark');
    } catch {}
  }, []);

  return (
    <div className={`ep-root${dark ? ' dark' : ''}`}>
      <div className="ep-app">
        <nav className="ep-rail" aria-label="Ferramentas">
          <div className="ep-logo"><div className="mark"><span /><i /></div></div>
        </nav>
        <header className="ep-topbar">
          <b>{name}</b>
          <span style={{ flex: 1 }} />
          <button className="ep-pillbtn" onClick={undo}>Desfazer</button>
          <button className="ep-pillbtn" onClick={redo}>Refazer</button>
          <button
            className="ep-pillbtn"
            onClick={() => {
              setDark(!dark);
              try { localStorage.setItem('ep_theme', !dark ? 'dark' : 'light'); } catch {}
            }}
          >
            Tema
          </button>
        </header>
        <aside className="ep-side"><MediaBin /></aside>
        <main className="ep-stage"><Preview /></main>
        <section className="ep-chat"><ChatPanel /></section>
        <section className="ep-timeline"><Timeline /></section>
      </div>
    </div>
  );
}
