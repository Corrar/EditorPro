'use client';
import { useEffect, useState } from 'react';
import { emit } from '@/lib/events';
import { gcBlobs, listProjects } from '@/lib/persist';
import { trashedAssetIds } from '@/lib/media/trash';
import { useInstallPrompt } from '@/lib/pwa';
import { useEditor } from '@/lib/store';
import { IconClose, IconShare } from './icons';
import { InstallButton } from './Sidebar';
import { logout } from './session';

export default function SettingsModal({ dark, onTheme, onClose }: { dark: boolean; onTheme: () => void; onClose: () => void }) {
  const [count, setCount] = useState<number | null>(null);
  const [usage, setUsage] = useState<string | null>(null);
  const { installed, iosHint, canInstall } = useInstallPrompt();

  useEffect(() => {
    listProjects().then((l) => setCount(l.length)).catch(() => setCount(0));
    navigator.storage?.estimate?.().then((e) => {
      if (e.usage != null) setUsage(`${(e.usage / 1024 / 1024).toFixed(1)} MB${e.quota ? ` de ${(e.quota / 1024 / 1024 / 1024).toFixed(1)} GB` : ''}`);
    }).catch(() => {});
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const clean = async () => {
    const n = await gcBlobs([...Object.keys(useEditor.getState().assets), ...trashedAssetIds()]).catch(() => 0);
    emit('ep:toast', { text: n ? `${n} arquivo(s) sem uso removidos` : 'Nada para limpar', kind: 'ok' });
  };

  return (
    <div className="ep-modal-bg" onClick={onClose}>
      <div className="ep-modal ep-settings" role="dialog" aria-modal="true" aria-label="Configurações" onClick={(e) => e.stopPropagation()}>
        <div className="ep-modal-top">
          <div><div className="ep-title">Configurações</div><div className="ep-cardsub">Preferências deste navegador</div></div>
          <button type="button" className="ep-iconbtn" onClick={onClose} aria-label="Fechar"><IconClose size={16} /></button>
        </div>
        <div className="ep-setrow">
          <div><b>Tema</b><span>Escuro (marrom quente) ou claro</span></div>
          <div className="ep-seg">
            <button type="button" className={dark ? 'on' : ''} onClick={() => !dark && onTheme()}>Escuro</button>
            <button type="button" className={!dark ? 'on' : ''} onClick={() => dark && onTheme()}>Claro</button>
          </div>
        </div>
        <div className="ep-setrow">
          <div><b>App instalado</b><span>{installed ? 'Você já está usando o app instalado.' : canInstall ? 'Instale para abrir em janela própria, com atalho na área de trabalho.' : iosHint ? 'No iPhone/iPad use o menu Compartilhar.' : 'Use o menu do navegador → “Instalar EditorPro”.'}</span></div>
          {!installed && <InstallButton />}
        </div>
        {iosHint && !installed && (
          <p className="ep-pnote" style={{ marginTop: 6 }}>Toque em <IconShare size={13} /> <b>Compartilhar</b> → <b>Adicionar à Tela de Início</b>.</p>
        )}
        <div className="ep-setrow">
          <div><b>Armazenamento local</b><span>{count ?? '…'} projeto(s) salvos neste navegador{usage ? ` · ${usage}` : ''}. Salvamento automático ligado.</span></div>
          <button type="button" className="ep-pillbtn" onClick={clean}>Limpar mídia sem uso</button>
        </div>
        <div className="ep-setrow">
          <div><b>Conta</b><span>Encerrar a sessão neste aparelho</span></div>
          <button type="button" className="ep-btn danger" onClick={() => void logout()}>Sair</button>
        </div>
      </div>
    </div>
  );
}
