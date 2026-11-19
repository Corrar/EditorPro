'use client';
/* celular (≤899px): barra inferior .ep-tabbar (Início, Mídia, Texto/Editar, IA, Menu — ativo em
   círculo laranja; no editor só fica na paisagem — em retrato quem manda é a MobileToolbar) + Menu em bottom-sheet .ep-sheet2 (busca, card de IA, acesso rápido, seções) */
import { useEffect, useState } from 'react';
import { useInstallPrompt } from '@/lib/pwa';
import { useEditor } from '@/lib/store';
import { usePendingComments } from '@/components/panels/ReviewTab';
import { IconChat, IconChevRight, IconClose, IconCog, IconDownload, IconFolder, IconGrid, IconHome, IconLogout, IconMoon, IconSearch, IconSpark, IconSun } from './icons';
import type { NavProps } from './Sidebar';
import { logout } from './session';
import { useVisibleTools, toolAttr, toolDef, type ToolId } from './tools';

export default function MobileNav({ chatOpen, onChat, menuOpen, onMenuOpen, focusSearch, ...p }: NavProps & {
  chatOpen: boolean; onChat: (open: boolean) => void; menuOpen?: boolean; onMenuOpen?: (open: boolean) => void; focusSearch?: boolean;
}) {
  // estado do menu pode vir de fora (no editor, o item "Mais" da barra de ferramentas também abre)
  const [ownOpen, setOwnOpen] = useState(false);
  const open = menuOpen ?? ownOpen;
  const setOpen = (v: boolean | ((o: boolean) => boolean)) => {
    const next = typeof v === 'function' ? v(open) : v;
    if (onMenuOpen) onMenuOpen(next); else setOwnOpen(next);
  };
  const [q, setQ] = useState('');
  const { canInstall, install, iosHint } = useInstallPrompt();
  const hasSel = useEditor((s) => s.selection.length > 0);
  const pendingCm = usePendingComments();
  const ed = p.view === 'editor';
  const isTool = (id: ToolId) => ed && p.toolOpen && p.tool === id;
  const go = (fn: () => void) => { fn(); setOpen(false); };
  useEffect(() => { if (!open) setQ(''); }, [open]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open]);

  const second: ToolId = hasSel ? 'edit' : 'text';
  const tabs: { key: string; label: string; icon: React.ReactNode; active: boolean; run: () => void }[] = [
    { key: 'home', label: 'Início', icon: <IconHome size={22} />, active: !open && p.view === 'home', run: () => { onChat(false); p.onHome(); } },
    { key: 'media', label: 'Mídia', icon: (() => { const I = toolDef('media').Icon; return <I size={22} />; })(), active: !open && isTool('media') && !chatOpen, run: () => { onChat(false); p.onTool('media'); } },
    { key: second, label: toolDef(second).label, icon: (() => { const I = toolDef(second).Icon; return <I size={22} />; })(), active: !open && isTool(second) && !chatOpen, run: () => { onChat(false); p.onTool(second); } },
    { key: 'ai', label: 'IA', icon: <IconChat size={22} />, active: !open && ed && chatOpen, run: () => onChat(!chatOpen) },
  ];

  const ql = q.trim().toLowerCase();
  const visibleTools = useVisibleTools();
  const tools = visibleTools.filter((t) => (t.id !== 'edit' || hasSel) && (!ql || t.label.toLowerCase().includes(ql)));
  const match = (s: string) => !ql || s.toLowerCase().includes(ql);

  return (
    <>
      <nav className={`ep-tabbar ep-mtabbar${ed && chatOpen ? ' chat' : ''}`} aria-label="Navegação">
        {tabs.map((t) => (
          <button key={t.key} type="button" className={`ep-tab${t.active ? ' on' : ''}`} onClick={() => go(t.run)} aria-label={t.label} aria-current={t.active ? 'page' : undefined}>
            <span className="ic">{t.icon}</span><span className="lb">{t.label}</span>
          </button>
        ))}
        <button type="button" className={`ep-tab${open ? ' on' : ''}`} onClick={() => setOpen((v) => !v)} aria-label="Abrir menu" aria-expanded={open}>
          <span className="ic"><IconGrid size={22} />{pendingCm ? <span className="bdot" /> : null}</span><span className="lb">Menu</span>
        </button>
      </nav>

      {open && (
        <div className="ep-menusheet-bg" onClick={() => setOpen(false)}>
          <div className="ep-sheet2 ep-menusheet2" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Menu">
            <div className="ep-sheet2-head">
              <span />
              <span className="ep-h-sheet">Menu</span>
              <button type="button" className="ep-circle" onClick={() => setOpen(false)} aria-label="Fechar menu"><IconClose size={20} /></button>
            </div>
            <label className="ep-searchpill">
              <IconSearch size={18} />
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar ferramenta" aria-label="Buscar ferramenta" autoFocus={!!focusSearch} />
            </label>

            {match('assistente ia chat') && (
              <button type="button" className="ep-aicard ep-menu-ai" onClick={() => go(() => onChat(true))}>
                <span className="spark"><IconSpark size={24} /></span>
                <span><span className="t">Assistente IA</span><span className="d">Peça qualquer edição: “corta as pausas”, “legenda maior”…</span></span>
              </button>
            )}

            {tools.length > 0 && <h3 className="ep-h-section ep-menu-h">Acesso rápido</h3>}
            <div className="ep-tiles ep-menu-tiles">
              {tools.map(({ id, label, Icon }) => (
                <button key={id} type="button" data-ep-tool={toolAttr(id)} className={`ep-tile${isTool(id) ? ' on' : ''}`} onClick={() => go(() => { onChat(false); p.onTool(id); })}>
                  <span className="ic"><Icon size={24} /></span>
                  <span className="lb">{label}{id === 'review' && pendingCm ? <span className="ep-tag accent ep-menu-count">{pendingCm}</span> : null}</span>
                </button>
              ))}
            </div>

            <h3 className="ep-h-section ep-menu-h">Projeto</h3>
            <div className="ep-rows">
              {match('meus projetos') && <button type="button" className="ep-row" onClick={() => go(p.onHome)}><span>Meus projetos</span><IconFolder size={20} /></button>}
              {match('início home') && <button type="button" className="ep-row" onClick={() => go(p.onHome)}><span>Início</span><IconHome size={20} /></button>}
            </div>

            <h3 className="ep-h-section ep-menu-h">Conta</h3>
            <div className="ep-rows">
              <button type="button" className="ep-row" onClick={() => go(p.onSettings)}><span>Configurações</span><IconCog size={20} /></button>
              <button type="button" className="ep-row" onClick={() => go(p.onTheme)}><span>{p.dark ? 'Tema claro' : 'Tema escuro'}</span>{p.dark ? <IconSun size={20} /> : <IconMoon size={20} />}</button>
              {(canInstall || iosHint) && <button type="button" className="ep-row" onClick={() => (canInstall ? go(() => void install()) : go(p.onSettings))}><span>Instalar app</span><IconDownload size={20} /></button>}
              <button type="button" className="ep-row danger" onClick={() => void logout()}><span>Sair</span><IconLogout size={20} /></button>
            </div>
            <p className="ep-menu-foot">EditorPro <IconChevRight size={12} /> editor de vídeo com IA</p>
          </div>
        </div>
      )}
    </>
  );
}
