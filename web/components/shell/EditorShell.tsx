'use client';
/* =====================================================================
   EditorShell — composição do app (dono: sessão "shell").
   - tela inicial (wizard + Meus projetos) ou editor (Workspace)
   - restaura o último projeto ao abrir; autosave enquanto edita
   - tema claro/escuro persistido; toasts; ingestão via 'ep:attach-files'
   ===================================================================== */
import { useCallback, useEffect, useRef, useState } from 'react';
import { emit } from '@/lib/events';
import { ingestFile, ingestFiles, listenAttachFiles } from '@/lib/media/ingest';
import { projectNameFromBrief, sequenceOps } from '@/lib/media/place';
import { flushAutosave, openProject, resetWorkspace, restoreLastProject, startAutosave } from '@/lib/persist';
import { useEditor } from '@/lib/store';
import type { AspectRatio } from '@/lib/types';
import Home, { type WizardInput } from './Home';
import Toasts from './Toasts';
import Workspace from './Workspace';

type View = 'loading' | 'home' | 'editor';
const THEME_KEY = 'ep_theme';
const DEFAULT_BRIEF = 'Edite este material em um vídeo dinâmico: corte as pausas, mantenha o ritmo e adicione legendas.';

export default function EditorShell() {
  const [dark, setDark] = useState(true);
  const [view, setView] = useState<View>('loading');
  const [busy, setBusy] = useState<string | null>(null);
  const pendingBrief = useRef<string | null>(null);
  const projectName = useEditor((s) => s.project.name);
  const hasContent = useEditor((s) => s.project.tracks.some((t) => t.clips.length > 0) || Object.keys(s.assets).length > 0);

  // tema
  useEffect(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved) setDark(saved === 'dark');
    } catch {}
  }, []);
  const toggleTheme = useCallback(() => {
    setDark((d) => {
      try { localStorage.setItem(THEME_KEY, d ? 'light' : 'dark'); } catch {}
      return !d;
    });
  }, []);

  // ingestão pedida por outros módulos + restauração do último projeto
  useEffect(() => listenAttachFiles(), []);
  useEffect(() => {
    let alive = true;
    restoreLastProject().then((ok) => { if (alive) setView(ok ? 'editor' : 'home'); });
    return () => { alive = false; };
  }, []);

  // arquivos soltos fora de uma área de drop: no editor viram mídia; na tela inicial, só evita o navegador abrir o arquivo
  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const over = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e) || e.defaultPrevented) return;
      e.preventDefault();
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (view === 'editor' && files.length) emit('ep:attach-files', { files });
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('drop', drop); };
  }, [view]);

  // autosave só enquanto o editor está aberto
  useEffect(() => {
    if (view !== 'editor') return;
    const stop = startAutosave();
    // 1ª edição com IA: dispara depois que o Workspace (e o ChatPanel) montaram
    if (pendingBrief.current !== null) {
      const brief = pendingBrief.current;
      pendingBrief.current = null;
      setTimeout(() => emit('ep:start-ai-edit', { brief }), 60);
    }
    return stop;
  }, [view]);

  const goHome = useCallback(() => {
    flushAutosave();
    useEditor.getState().setPlaying(false);
    setView('home');
  }, []);

  const startWizard = async (w: WizardInput) => {
    const brief = w.brief.trim() || DEFAULT_BRIEF;
    try {
      resetWorkspace({ name: projectNameFromBrief(w.brief, w.material[0]?.name.replace(/\.[^.]+$/, '') ?? 'Novo projeto'), aspect: w.aspect, brief });
      const total = w.material.length + (w.reference ? 1 : 0);
      let done = 0;
      const tick = () => setBusy(total ? `Preparando mídia ${Math.min(done + 1, total)}/${total}…` : 'Abrindo editor…');
      tick();
      const material = await ingestFiles(w.material, undefined, () => { done++; tick(); });
      let referenceAssetId: string | undefined;
      if (w.reference) {
        try {
          referenceAssetId = (await ingestFile(w.reference, 'reference')).id;
        } catch (e) {
          emit('ep:toast', { text: e instanceof Error ? e.message : 'Não consegui ler o vídeo de exemplo', kind: 'error' });
        }
        done++;
      }
      const st = useEditor.getState();
      const ops = sequenceOps(st.project, material);
      st.dispatch([...ops, { op: 'set_project', patch: { brief, referenceAssetId } }], { history: false });
      pendingBrief.current = brief;
      setView('editor');
    } finally {
      setBusy(null);
    }
  };

  const openEmpty = (aspect: AspectRatio) => {
    resetWorkspace({ aspect });
    setView('editor');
  };

  const open = async (id: string) => {
    if (id !== useEditor.getState().project.id || !hasContent) {
      const ok = await openProject(id).catch(() => false);
      if (!ok) { emit('ep:toast', { text: 'Não consegui abrir este projeto', kind: 'error' }); return; }
    }
    setView('editor');
  };

  return (
    <div className={`ep-root${dark ? ' dark' : ''}`}>
      {view === 'loading' && (
        <div className="ep-boot"><div className="ep-logo"><div className="mark"><span /><i /></div></div><span className="ep-spin" /></div>
      )}
      {view === 'home' && (
        <Home
          dark={dark} onTheme={toggleTheme} onStart={startWizard} onEmpty={openEmpty} onOpen={open} busy={busy}
          canResume={hasContent ? projectName : null} onResume={() => setView('editor')}
        />
      )}
      {view === 'editor' && <Workspace dark={dark} onTheme={toggleTheme} onHome={goHome} />}
      <Toasts />
    </div>
  );
}
