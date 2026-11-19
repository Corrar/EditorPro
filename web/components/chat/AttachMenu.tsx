'use client';
/* =====================================================================
   Botão 📎 do chat/pop-up com menu: "Vídeo modelo (estilo)" | "Mídia para
   o projeto". Desktop = popover sobre o botão; toque = sheet de baixo.
   Arquivos arrastados/colados chegam por `pending` e abrem o mesmo menu.
   ===================================================================== */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '@/components/ui/Icon';

export interface AttachMenuProps {
  onModel: (files: File[]) => void;
  onMedia: (files: File[]) => void;
  /** arquivos soltos/colados esperando a escolha */
  pending?: File[];
  onPendingDone?: () => void;
  disabled?: boolean;
  size?: number;
}

export default function AttachMenu({ onModel, onMedia, pending, onPendingDone, disabled, size = 17 }: AttachMenuProps) {
  const [open, setOpen] = useState(false);
  const modelRef = useRef<HTMLInputElement>(null);
  const mediaRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  // no toque o menu vira sheet: vai para fora dos painéis (que têm containment) via portal
  const [coarse, setCoarse] = useState(false);
  useEffect(() => { setCoarse(typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches); }, []);
  const has = !!pending?.length;
  const hasVideo = !!pending?.some((f) => f.type.startsWith('video/') || /\.(mp4|mov|webm|m4v|mkv)$/i.test(f.name));

  useEffect(() => { if (has) setOpen(true); }, [has]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (boxRef.current?.contains(t) || sheetRef.current?.contains(t)) return;
      close();
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', away); window.removeEventListener('keydown', esc); };
  });

  const close = () => { setOpen(false); if (has) onPendingDone?.(); };
  const choose = (kind: 'model' | 'media') => {
    if (has) {
      (kind === 'model' ? onModel : onMedia)(pending!);
      setOpen(false);
      onPendingDone?.();
      return;
    }
    setOpen(false);
    (kind === 'model' ? modelRef : mediaRef).current?.click();
  };
  const pick = (kind: 'model' | 'media', list: FileList | null, el: HTMLInputElement | null) => {
    const files = list ? Array.from(list) : [];
    if (el) el.value = '';
    if (files.length) (kind === 'model' ? onModel : onMedia)(files);
  };

  const portal = (node: React.ReactNode) => {
    if (!coarse || typeof document === 'undefined') return node;
    const host = boxRef.current?.closest('.ep-root') ?? document.querySelector('.ep-root') ?? document.body;
    return createPortal(node, host);
  };

  return (
    <div className="ep-att" ref={boxRef}>
      <button className="ep-ch-attach" title="Anexar" aria-label="Anexar" aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => (open ? close() : setOpen(true))}>
        <Icon name="attach" size={size} />
      </button>
      <input ref={modelRef} type="file" accept="video/*" multiple hidden onChange={(e) => pick('model', e.target.files, e.currentTarget)} data-testid="att-model" />
      <input ref={mediaRef} type="file" accept="video/*,audio/*,image/*" multiple hidden onChange={(e) => pick('media', e.target.files, e.currentTarget)} data-testid="att-media" />
      {open ? portal(
        <div ref={sheetRef} className={coarse ? 'ep-att-sheet' : undefined}>
          <div className="ep-att-scrim" onClick={close} />
          <div className="ep-att-menu" role="menu" aria-label="Anexar">
            {has ? <div className="ep-att-title">Usar {pending!.length === 1 ? `“${pending![0].name}”` : `${pending!.length} arquivos`} como:</div> : <div className="ep-att-title">Anexar</div>}
            <button role="menuitem" className="ep-att-item" onClick={() => choose('model')} disabled={has && !hasVideo}>
              <span className="ic ai"><Icon name="ai" size={18} /></span>
              <span className="tx"><b>Vídeo modelo (estilo)</b><small>A IA estuda o ritmo, legendas e cores e deixa o seu igual</small></span>
            </button>
            <button role="menuitem" className="ep-att-item" onClick={() => choose('media')}>
              <span className="ic"><Icon name="media" size={18} /></span>
              <span className="tx"><b>Mídia para o projeto</b><small>Vídeos, fotos ou áudio para usar na edição</small></span>
            </button>
          </div>
        </div>,
      ) : null}
    </div>
  );
}

/** arquivos de um evento de soltar/colar */
export function filesFromTransfer(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const out: File[] = [];
  if (dt.files?.length) out.push(...Array.from(dt.files));
  else for (const it of Array.from(dt.items ?? [])) { if (it.kind === 'file') { const f = it.getAsFile(); if (f) out.push(f); } }
  return out.filter((f) => /^(video|audio|image)\//.test(f.type) || /\.(mp4|mov|webm|m4v|mkv|mp3|wav|m4a|aac|ogg|jpe?g|png|webp|gif)$/i.test(f.name));
}
