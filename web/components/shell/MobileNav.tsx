'use client';
/* celular (≤899px): barra inferior de botões circulares (Mídia, Texto, Legendas,
   Efeitos, IA, Menu) + bottom-sheet "Menu" com tudo (padrão Radar) */
import { useState } from 'react';
import { useInstallPrompt } from '@/lib/pwa';
import { useEditor } from '@/lib/store';
import { IconChat, IconCog, IconDownload, IconFolder, IconGrid, IconLogout, IconMoon, IconSun } from './icons';
import type { NavProps } from './Sidebar';
import { logout } from './session';
import { TOOLS, toolDef, type ToolId } from './tools';

const PRIMARY: ToolId[] = ['media', 'text', 'captions', 'effects'];

export default function MobileNav({ chatOpen, onChat, ...p }: NavProps & { chatOpen: boolean; onChat: (open: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const { canInstall, install, iosHint } = useInstallPrompt();
  const hasSel = useEditor((s) => s.selection.length > 0);
  const ed = p.view === 'editor';
  const isTool = (id: ToolId) => ed && p.toolOpen && p.tool === id;
  const go = (fn: () => void) => { fn(); setOpen(false); };
  const primary = hasSel ? (['edit', ...PRIMARY.slice(0, 3)] as ToolId[]) : PRIMARY;

  return (
    <>
      <nav className={`ep-bottomnav${ed && chatOpen ? ' chat' : ''}`} aria-label="Ferramentas">
        {primary.map((id) => {
          const { label, Icon } = toolDef(id);
          return (
            <button key={id} type="button" className={`ep-bnitem${isTool(id) ? ' active' : ''}`} onClick={() => go(() => { onChat(false); p.onTool(id); })} aria-label={label} title={label}>
              <span className="ic"><Icon size={21} /></span><span className="lb">{label}</span>
            </button>
          );
        })}
        <button type="button" className={`ep-bnitem${ed && chatOpen ? ' active' : ''}`} onClick={() => go(() => onChat(!chatOpen))} aria-label="Chat com a IA" title="IA">
          <span className="ic"><IconChat size={21} /></span><span className="lb">IA</span>
        </button>
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
              {TOOLS.filter((t) => t.id !== 'edit' || hasSel).map(({ id, label, Icon }) => (
                <button key={id} type="button" className={`ep-menucell${isTool(id) ? ' active' : ''}`} onClick={() => go(() => { onChat(false); p.onTool(id); })}>
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
