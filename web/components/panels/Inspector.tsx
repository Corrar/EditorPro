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
import EffectsTab from './EffectsTab';
import TransitionsTab from './TransitionsTab';
import AudioTab from './AudioTab';

export type InspectorTool = 'text' | 'captions' | 'effects' | 'transitions' | 'audio';

export const INSPECTOR_TABS: { id: InspectorTool; label: string }[] = [
  { id: 'text', label: 'Texto' },
  { id: 'captions', label: 'Legendas' },
  { id: 'effects', label: 'Efeitos' },
  { id: 'transitions', label: 'Transições' },
  { id: 'audio', label: 'Áudio' },
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
        {active !== 'captions' && <SelectionChip />}
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
        {active === 'effects' && <EffectsTab />}
        {active === 'transitions' && <TransitionsTab />}
        {active === 'audio' && <AudioTab />}
      </div>
    </div>
  );
}
