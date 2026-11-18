'use client';
/* celular (≤900px): barra inferior de botões circulares + bottom-sheet "Menu" (padrão Radar) */
import { useState } from 'react';
import { useInstallPrompt } from '@/lib/pwa';
import { IconChat, IconCog, IconDownload, IconFolder, IconGrid, IconLogout, IconMoon, IconSun, IconTimeline } from './icons';
import type { NavProps } from './Sidebar';
import { logout } from './session';
import { TOOLS, type ToolId } from './tools';

export type Pane = 'timeline' | 'chat' | 'side';

export default function MobileNav({ pane, onPane, ...p }: NavProps & { pane: Pane; onPane: (x: Pane) => void }) {
  const [open, setOpen] = useState(false);
  const { canInstall, install, iosHint } = useInstallPrompt();
  const ed = p.view === 'editor';
  const isTool = (id: ToolId) => ed && pane === 'side' && p.tool === id;
  const go = (fn: () => void) => { fn(); setOpen(false); };
  const primary: { key: string; label: string; icon: React.ReactNode; active: boolean; run: () => void }[] = [
    { key: 'timeline', label: 'Timeline', icon: <IconTimeline size={21} />, active: ed && pane === 'timeline', run: () => onPane('timeline') },
    { key: 'media', label: 'Mídia', icon: (() => { const I = TOOLS[0].Icon; return <I size={21} />; })(), active: isTool('media'), run: () => p.onTool('media') },
    { key: 'text', label: 'Texto', icon: (() => { const I = TOOLS[1].Icon; return <I size={21} />; })(), active: isTool('text'), run: () => p.onTool('text') },
    { key: 'chat', label: 'Chat IA', icon: <IconChat size={21} />, active: ed && pane === 'chat', run: () => onPane('chat') },
  ];

  return (
    <>
      <nav className="ep-bottomnav" aria-label="Navegação">
        {primary.map((b) => (
          <button key={b.key} type="button" className={`ep-bnitem${b.active ? ' active' : ''}`} onClick={() => go(b.run)} aria-label={b.label} title={b.label}>
            <span className="ic">{b.icon}</span><span className="lb">{b.label}</span>
          </button>
        ))}
        <button type="button" className={`ep-bnitem${open ? ' active' : ''}`} onClick={() => setOpen((v) => !v)} aria-label="Abrir menu" title="Menu">
          <span className="ic"><IconGrid size={21} /></span><span className="lb">Menu</span>
        </button>
      </nav>

      {open && (
        <div className="ep-menusheet-bg" onClick={() => setOpen(false)}>
          <div className="ep-menusheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Menu">
            <div className="ep-menugrip" />
            <div className="ep-menutitle">Ferramentas</div>
            <div className="ep-menugrid">
              {TOOLS.map(({ id, label, Icon }) => (
                <button key={id} type="button" className={`ep-menucell${isTool(id) ? ' active' : ''}`} onClick={() => go(() => p.onTool(id))}>
                  <Icon size={20} /><span className="t">{label}</span>
                </button>
              ))}
            </div>
            <div className="ep-menutitle" style={{ marginTop: 16 }}>Conta</div>
            <div className="ep-menugrid">
              <button type="button" className={`ep-menucell${p.view === 'home' ? ' active' : ''}`} onClick={() => go(p.onHome)}><IconFolder size={20} /><span className="t">Meus projetos</span></button>
              <button type="button" className="ep-menucell" onClick={() => go(p.onSettings)}><IconCog size={20} /><span className="t">Configurações</span></button>
              <button type="button" className="ep-menucell" onClick={() => go(p.onTheme)}>{p.dark ? <IconSun size={20} /> : <IconMoon size={20} />}<span className="t">{p.dark ? 'Tema claro' : 'Tema escuro'}</span></button>
              {(canInstall || iosHint) && (
                <button type="button" className="ep-menucell ep-installcell" onClick={() => (canInstall ? go(() => void install()) : go(p.onSettings))}>
                  <IconDownload size={20} /><span className="t">Instalar app</span>
                </button>
              )}
              <button type="button" className="ep-menucell danger" onClick={() => void logout()}><IconLogout size={20} /><span className="t">Sair</span></button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
