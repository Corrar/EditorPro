'use client';
/* sidebar no padrão Radar: logo + recolher, busca, grupos "Projeto" e "Conta",
   instalar app, menu do usuário e rodapé Sair + tema. Versão .min só com ícones. */
import { useEffect, useRef, useState } from 'react';
import { useInstallPrompt } from '@/lib/pwa';
import { useEditor } from '@/lib/store';
import { IconChev, IconCog, IconCollapse, IconDownload, IconFolder, IconLogout, IconMoon, IconSearch, IconShare, IconSun } from './icons';
import Logo from './Logo';
import { logout } from './session';
import { usePendingComments } from '@/components/panels/ReviewTab';
import { TOOLS, type ToolId } from './tools';

export interface NavProps {
  view: 'home' | 'editor';
  tool: ToolId;
  toolOpen: boolean;
  dark: boolean;
  onTool: (t: ToolId) => void;
  onHome: () => void;
  onSettings: () => void;
  onTheme: () => void;
}

/** botão "Instalar app" (Chrome/Edge/Android) ou dica do iOS */
export function InstallButton({ compact }: { compact?: boolean }) {
  const { canInstall, install, iosHint } = useInstallPrompt();
  const [tip, setTip] = useState(false);
  if (!canInstall && !iosHint) return null;
  return (
    <div className="ep-installwrap">
      <button
        type="button" className={`ep-pillbtn ep-installbtn${compact ? ' icon' : ''}`} title="Instalar app"
        onClick={() => (canInstall ? void install() : setTip((v) => !v))}
      >
        <IconDownload size={15} /><span className="t">Instalar app</span>
      </button>
      {tip && iosHint && (
        <div className="ep-iostip" role="note">
          No iPhone/iPad: toque em <b><IconShare size={13} /> Compartilhar</b> e depois em <b>Adicionar à Tela de Início</b>.
          <button type="button" onClick={() => setTip(false)} aria-label="Fechar dica">✕</button>
        </div>
      )}
    </div>
  );
}

export default function Sidebar({ min, onToggleMin, ...p }: NavProps & { min: boolean; onToggleMin: () => void }) {
  const [q, setQ] = useState('');
  const [menu, setMenu] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const clipCount = useEditor((s) => s.project.tracks.reduce((n, t) => n + t.clips.length, 0));
  const assetCount = useEditor((s) => Object.keys(s.assets).length);
  const segCount = useEditor((s) => s.project.captions.segments.length);
  const hasSel = useEditor((s) => s.selection.length > 0);
  const pendingCm = usePendingComments();

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menu]);

  const ql = q.trim().toLowerCase();
  const tools = TOOLS.filter((t) => (t.id !== 'edit' || hasSel || p.tool === 'edit') && (!ql || t.label.toLowerCase().includes(ql)));
  const account = [
    { id: 'projects', label: 'Meus projetos', Icon: IconFolder, on: p.view === 'home', go: p.onHome },
    { id: 'settings', label: 'Configurações', Icon: IconCog, on: false, go: p.onSettings },
  ].filter((a) => !ql || a.label.toLowerCase().includes(ql));
  const counts: Partial<Record<ToolId, number>> = { media: assetCount, captions: segCount };

  return (
    <aside className={`ep-sidebar${min ? ' min' : ''}`}>
      <div className="ep-rail">
        <div className="ep-sbhead">
          <Logo onClick={p.onHome} />
          <button type="button" className="ep-iconbtn sm" onClick={onToggleMin} title={min ? 'Expandir menu' : 'Recolher menu'} aria-label={min ? 'Expandir menu' : 'Recolher menu'}><IconCollapse size={15} /></button>
        </div>
        <div className="ep-sbdiv" />
        <label className="ep-search" onClick={() => min && onToggleMin()}>
          <IconSearch size={15} />
          <input ref={searchRef} type="text" placeholder="Buscar ferramenta…" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
          {q && <button type="button" className="kbd" onClick={() => setQ('')}>Esc</button>}
        </label>
        <div className="ep-navlist">
          {tools.length > 0 && <div className="ep-sect">Projeto</div>}
          {tools.map(({ id, label, Icon }) => {
            const active = p.view === 'editor' && p.tool === id && p.toolOpen;
            return (
              <button key={id} type="button" className={`ep-navitem${active ? ' active' : ''}`} onClick={() => p.onTool(id)} title={label} aria-pressed={active}>
                <span className="ib"><Icon size={17} /></span><span className="t">{label}</span>
                {id === 'review' && pendingCm ? <span className="nb mono">{pendingCm}</span> : counts[id] ? <span className="c mono">{counts[id]}</span> : null}
              </button>
            );
          })}
          {account.length > 0 && <div className="ep-sect">Conta</div>}
          {account.map(({ id, label, Icon, on, go }) => (
            <button key={id} type="button" className={`ep-navitem${on ? ' active' : ''}`} onClick={go} title={label}>
              <span className="ib"><Icon size={17} /></span><span className="t">{label}</span>
            </button>
          ))}
          {!tools.length && !account.length && <div className="ep-navempty">Nada encontrado para “{q}”.</div>}
          {p.view === 'editor' && !min && (
            <div className="ep-sbproj">
              <span className="ep-label">Neste projeto</span>
              <span><b className="mono">{clipCount}</b> clipe{clipCount === 1 ? '' : 's'} · <b className="mono">{assetCount}</b> mídia{assetCount === 1 ? '' : 's'}</span>
            </div>
          )}
        </div>
        <InstallButton compact={min} />
        <div className="ep-userwrap">
          {menu && (
            <div className="ep-usermenu" onClick={(e) => e.stopPropagation()}>
              <button type="button" onClick={() => { setMenu(false); p.onHome(); }}><IconFolder size={15} />Meus projetos</button>
              <button type="button" onClick={() => { setMenu(false); p.onSettings(); }}><IconCog size={15} />Configurações</button>
              <div className="sep" />
              <button type="button" className="danger" onClick={() => void logout()}><IconLogout size={15} />Sair da conta</button>
            </div>
          )}
          <button type="button" className="ep-user" aria-expanded={menu} onClick={(e) => { e.stopPropagation(); setMenu((v) => !v); }}>
            <span className="av">B</span>
            <span className="ucol"><span className="nm">Bruno</span><span className="r2">Conta EditorPro</span></span>
            <span className="chev"><IconChev size={15} /></span>
          </button>
        </div>
        <div className="ep-sbfoot">
          <button type="button" className="ep-logout" onClick={() => void logout()} title="Sair"><IconLogout size={15} /><span className="t">Sair</span></button>
          <button type="button" className="ep-themebtn" onClick={p.onTheme} title={p.dark ? 'Tema claro' : 'Tema escuro'} aria-label="Alternar tema">
            {p.dark ? <IconSun size={16} /> : <IconMoon size={16} />}
          </button>
        </div>
      </div>
    </aside>
  );
}
