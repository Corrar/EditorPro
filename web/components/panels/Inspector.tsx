'use client';
/* =====================================================================
   Inspetor — abas por ferramenta (Texto, Legendas, Efeitos, Transições,
   Áudio), editando a seleção via dispatch. Dono: sessão "shell".
   Uso: <Inspector tool="text" />  (sem `tool`, mostra abas internas)
   ===================================================================== */
import { useState } from 'react';
import { useSelectedClip } from './hooks';
import TextTab from './TextTab';
import CaptionsTab from './CaptionsTab';
import TransitionsTab from './TransitionsTab';
import AudioTab from './AudioTab';
import EditTab from './EditTab';
import StickersTab from './StickersTab';
import CanvasTab from './CanvasTab';
import { AdjustTool, EffectsTool, FiltersTool } from './LookTabs';

export type InspectorTool = 'edit' | 'text' | 'stickers' | 'captions' | 'effects' | 'filters' | 'adjust' | 'transitions' | 'audio' | 'canvas';

export const INSPECTOR_TABS: { id: InspectorTool; label: string }[] = [
  { id: 'edit', label: 'Editar' },
  { id: 'audio', label: 'Áudio' },
  { id: 'text', label: 'Texto' },
  { id: 'stickers', label: 'Stickers' },
  { id: 'effects', label: 'Efeitos' },
  { id: 'filters', label: 'Filtros' },
  { id: 'transitions', label: 'Transições' },
  { id: 'captions', label: 'Legendas' },
  { id: 'adjust', label: 'Ajustes' },
  { id: 'canvas', label: 'Formatos' },
];

const TYPE_LABEL = { video: 'Vídeo', image: 'Imagem', audio: 'Áudio', text: 'Texto', sticker: 'Sticker', shape: 'Forma', adjustment: 'Ajuste' } as const;

function SelectionChip() {
  const found = useSelectedClip();
  if (!found) return <span className="ep-selchip off">Nada selecionado</span>;
  const c = found.clip;
  const name = c.type === 'text' ? c.text : c.type === 'sticker' && c.emoji ? `${c.emoji} ${c.label ?? ''}` : c.label || TYPE_LABEL[c.type];
  return (
    <span className="ep-selchip" title={name}>
      <b>{TYPE_LABEL[c.type]}</b>
      <span>{name}</span>
    </span>
  );
}

export default function Inspector({ tool, title }: { tool?: InspectorTool; title?: string }) {
  const [inner, setInner] = useState<InspectorTool>('text');
  const active = tool ?? inner;
  const label = title ?? INSPECTOR_TABS.find((t) => t.id === active)?.label;
  return (
    <div className="ep-insp">
      <div className="ep-panelhead">
        <h3>{label}</h3>
        {active !== 'captions' && active !== 'canvas' && <SelectionChip />}
      </div>
      {!tool && (
        <div className="ep-insp-tabs">
          {INSPECTOR_TABS.map((t) => (
            <button key={t.id} type="button" className={t.id === active ? 'on' : ''} onClick={() => setInner(t.id)}>{t.label}</button>
          ))}
        </div>
      )}
      <div className="ep-insp-body" key={active}>
        {active === 'text' && <TextTab />}
        {active === 'captions' && <CaptionsTab />}
        {active === 'edit' && <EditTab />}
        {active === 'stickers' && <StickersTab />}
        {active === 'effects' && <EffectsTool />}
        {active === 'filters' && <FiltersTool />}
        {active === 'adjust' && <AdjustTool />}
        {active === 'canvas' && <CanvasTab />}
        {active === 'transitions' && <TransitionsTab />}
        {active === 'audio' && <AudioTab />}
      </div>
    </div>
  );
}
