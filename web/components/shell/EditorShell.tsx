'use client';
/* =====================================================================
   EditorShell — composição do app (dono: sessão "shell"), no padrão Radar:
   sidebar recolhível (desktop) | conteúdo (tela inicial ou editor)
   + barra inferior e menu em bottom-sheet no celular.
   - restaura o último projeto ao abrir (exceto /?novo=1 → wizard)
   - autosave enquanto edita; tema claro/escuro persistido; toasts
   - ingestão via 'ep:attach-files' e por arquivos soltos na janela
   ===================================================================== */
import { useCallback, useEffect, useRef, useState } from 'react';
import { emit } from '@/lib/events';
import { ingestFile, ingestFiles, listenAttachFiles } from '@/lib/media/ingest';
import { projectNameFromBrief, sequenceOps } from '@/lib/media/place';
import { flushAutosave, openProject, resetWorkspace, restoreLastProject, startAutosave, startFromProject } from '@/lib/persist';
import { projectFromTemplate } from './templates';
import { useShellUi } from './ui';
import { useEditor } from '@/lib/store';
import type { AspectRatio } from '@/lib/types';
import Home, { type WizardInput } from './Home';
import MobileNav from './MobileNav';
import SettingsModal from './SettingsModal';
import Sidebar from './Sidebar';
import Toasts from './Toasts';
import Workspace from './Workspace';
import type { ToolId } from './tools';

type View = 'loading' | 'home' | 'editor';
const THEME_KEY = 'ep_theme';
const SB_KEY = 'ep_sb_min';
const DEFAULT_BRIEF = 'Edite este material em um vídeo dinâmico: corte as pausas, mantenha o ritmo e adicione legendas.';

const mq = (q: string) => typeof window !== 'undefined' && window.matchMedia(q).matches;

export default function EditorShell() {
  const [dark, setDark] = useState(true);
  const [view, setView] = useState<View>('loading');
  const [busy, setBusy] = useState<string | null>(null);
  const [tool, setTool] = useState<ToolId>('media');
  const [sideOpen, setSideOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [sbMin, setSbMin] = useState(false);
  const [settings, setSettings] = useState(false);
  const [focusWizard, setFocusWizard] = useState(false);
  const pendingBrief = useRef<string | null>(null);
  const projectName = useEditor((s) => s.project.name);
  const hasContent = useEditor((s) => s.project.tracks.some((t) => t.clips.length > 0) || Object.keys(s.assets).length > 0);

  // preferências
  useEffect(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      // padrão: segue o sistema; escolha manual salva tem prioridade
      setDark(saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches);
      if (localStorage.getItem(SB_KEY) === '1' || mq('(max-width: 1100px)')) setSbMin(true);
    } catch {}
    if (mq('(max-width: 1099px)')) setSideOpen(false);
    // sem escolha manual, acompanha a troca de tema do sistema
    const sys = window.matchMedia('(prefers-color-scheme: dark)');
    const onSys = () => { try { if (!localStorage.getItem(THEME_KEY)) setDark(sys.matches); } catch { setDark(sys.matches); } };
    sys.addEventListener('change', onSys);
    // ao encolher a janela para ≤1099 (gavetas), fecha painel e chat sobrepostos
    const m = window.matchMedia('(max-width: 1099px)');
    const onChange = () => { if (m.matches) { setSideOpen(false); setChatOpen(false); } };
    m.addEventListener('change', onChange);
    return () => { m.removeEventListener('change', onChange); sys.removeEventListener('change', onSys); };
  }, []);

  // altura real da área visível (teclado virtual do celular não cobre o chat)
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const upd = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty('--kb', `${Math.round(kb)}px`);
      document.documentElement.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
    };
    upd();
    vv.addEventListener('resize', upd);
    vv.addEventListener('scroll', upd);
    return () => { vv.removeEventListener('resize', upd); vv.removeEventListener('scroll', upd); };
  }, []);

  // 900–1099: ao inserir algo na timeline, a gaveta fecha para mostrar o resultado
  useEffect(() => useEditor.subscribe((st, prev) => {
    if (st.project === prev.project || !mq('(min-width: 900px) and (max-width: 1099px)')) return;
    const count = (p: typeof st.project) => p.tracks.reduce((n, t) => n + t.clips.length, 0) + p.captions.segments.length;
    if (count(st.project) > count(prev.project) && !st.live.running) setSideOpen(false);
  }), []);

  // painéis pediram para abrir o chat ("apontar para qualquer coisa")
  const chatRequest = useShellUi((s) => s.chatRequest);
  useEffect(() => {
    if (!chatRequest) return;
    if (mq('(max-width: 1099px)')) setSideOpen(false);
    setChatOpen(true);
  }, [chatRequest]);

  // seleção de clipe: no celular a ferramenta "Editar" vira a primeira opção; se o painel Editar já estava aberto, segue
  const selCount = useEditor((s) => s.selection.length);
  useEffect(() => { if (!selCount && tool === 'edit') setSideOpen((v) => (mq('(max-width: 1099px)') ? false : v)); }, [selCount, tool]);
  const toggleTheme = useCallback(() => {
    setDark((d) => {
      try { localStorage.setItem(THEME_KEY, d ? 'light' : 'dark'); } catch {}
      return !d;
    });
  }, []);
  const toggleSb = () => setSbMin((v) => { try { localStorage.setItem(SB_KEY, v ? '0' : '1'); } catch {} return !v; });

  // ingestão pedida por outros módulos + restauração (ou wizard direto em /?novo=1)
  useEffect(() => listenAttachFiles(), []);
  useEffect(() => {
    let alive = true;
    const url = new URL(window.location.href);
    if (url.searchParams.has('novo')) {
      url.searchParams.delete('novo');
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
      // carrega o último projeto em segundo plano (para "Voltar para…"), mas abre o wizard
      restoreLastProject().finally(() => { if (alive) { setFocusWizard(true); setView('home'); } });
    } else {
      restoreLastProject().then((ok) => { if (alive) setView(ok ? 'editor' : 'home'); });
    }
    return () => { alive = false; };
  }, []);

  // arquivos soltos fora de uma área de drop: no editor viram mídia; na tela inicial só evita abrir o arquivo
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

  // autosave só com o editor aberto; 1ª edição com IA depois que o ChatPanel montou
  useEffect(() => {
    if (view !== 'editor') return;
    const stop = startAutosave();
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

  const pickTool = (id: ToolId) => {
    if (view !== 'editor') { setTool(id); setSideOpen(true); setView('editor'); return; }
    if (mq('(max-width: 1099px)')) setChatOpen(false);
    if (id === tool) setSideOpen((v) => !v);
    else { setTool(id); setSideOpen(true); }
  };
  const openChat = (open: boolean) => {
    if (view !== 'editor') setView('editor');
    if (open && mq('(max-width: 1099px)')) setSideOpen(false);
    setChatOpen(open);
  };

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
      }
      const st = useEditor.getState();
      st.dispatch([...sequenceOps(st.project, material), { op: 'set_project', patch: { brief, referenceAssetId } }], { history: false });
      pendingBrief.current = brief;
      setTool('media');
      if (mq('(max-width: 1099px)')) { setSideOpen(false); setChatOpen(true); } // telas menores: abre o chat p/ acompanhar a IA
      setView('editor');
    } finally {
      setBusy(null);
    }
  };

  const openEmpty = (aspect: AspectRatio) => {
    resetWorkspace({ aspect });
    setTool('media');
    setSideOpen(!mq('(max-width: 1099px)')); // telas menores: gaveta começa fechada
    setView('editor');
  };

  const importNew = (files: File[]) => {
    resetWorkspace({ aspect: '9:16' });
    setTool('media');
    setSideOpen(true);
    setView('editor');
    setTimeout(() => emit('ep:attach-files', { files }), 0);
  };

  const fromTemplate = (id: string) => {
    startFromProject(projectFromTemplate(id));
    setTool('media');
    setSideOpen(!mq('(max-width: 1099px)')); // telas menores: gaveta começa fechada
    setView('editor');
  };

  const open = async (id: string) => {
    if (id !== useEditor.getState().project.id || !hasContent) {
      const ok = await openProject(id).catch(() => false);
      if (!ok) { emit('ep:toast', { text: 'Não consegui abrir este projeto', kind: 'error' }); return; }
    }
    if (mq('(max-width: 1099px)')) setSideOpen(false);
    setView('editor');
  };

  const nav = {
    view: view === 'editor' ? 'editor' as const : 'home' as const,
    tool, toolOpen: view === 'editor' && sideOpen, dark,
    onTool: pickTool, onHome: goHome, onSettings: () => setSettings(true), onTheme: toggleTheme,
  };

  return (
    <div className={`ep-root${dark ? ' dark' : ''}`}>
      {view === 'loading' ? (
        <div className="ep-boot"><div className="ep-logo"><div className="mark"><span /><i /></div></div><span className="ep-spin" /></div>
      ) : (
        <div className={`ep-shell v-${view}`}>
          <Sidebar {...nav} min={sbMin} onToggleMin={toggleSb} />
          <div className="ep-content">
            {view === 'home' && (
              <Home
                onStart={startWizard} onEmpty={openEmpty} onOpen={open} onTemplate={fromTemplate}
                onTool={pickTool} onImport={importNew} onTheme={toggleTheme} dark={dark} busy={busy} focusWizard={focusWizard}
                canResume={hasContent ? projectName : null} onResume={() => setView('editor')}
              />
            )}
            {view === 'editor' && <Workspace tool={tool} sideOpen={sideOpen} onCloseSide={() => setSideOpen(false)} chatOpen={chatOpen} onChat={openChat} />}
          </div>
          <MobileNav {...nav} chatOpen={chatOpen} onChat={openChat} />
        </div>
      )}
      {settings && <SettingsModal dark={dark} onTheme={toggleTheme} onClose={() => setSettings(false)} />}
      <Toasts />
    </div>
  );
}
