'use client';
import Icon from '@/components/ui/Icon';
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
import ReviewTab from './ReviewTab';
import { MotionTemplateGallery } from '@/components/library';
import { askAI } from '@/components/shell/ui';
import { formatTime } from '@/lib/util';

export type InspectorTool = 'review' | 'edit' | 'text' | 'stickers' | 'captions' | 'effects' | 'filters' | 'adjust' | 'transitions' | 'audio' | 'canvas' | 'templates';

export const INSPECTOR_TABS: { id: InspectorTool; label: string }[] = [
  { id: 'edit', label: 'Editar' },
  { id: 'audio', label: 'Áudio' },
  { id: 'text', label: 'Texto' },
  { id: 'stickers', label: 'Stickers' },
  { id: 'templates', label: 'Modelos' },
  { id: 'effects', label: 'Efeitos' },
  { id: 'filters', label: 'Filtros' },
  { id: 'transitions', label: 'Transições' },
  { id: 'captions', label: 'Legendas' },
  { id: 'adjust', label: 'Ajustes' },
  { id: 'canvas', label: 'Formatos' },
  { id: 'review', label: 'Revisão' },
];

const TYPE_LABEL = { video: 'Vídeo', image: 'Imagem', audio: 'Áudio', text: 'Texto', sticker: 'Sticker', shape: 'Forma', adjustment: 'Ajuste' } as const;

function SelectionChip() {
  const found = useSelectedClip();
  if (!found) return <span className="ep-selchip off">Nada selecionado</span>;
  const c = found.clip;
  const name = c.type === 'text' ? c.text : c.type === 'sticker' && c.emoji ? `${c.emoji} ${c.label ?? ''}` : c.label || TYPE_LABEL[c.type];
  const ask = () => askAI({ clipIds: [c.id], range: { start: c.start, end: c.start + c.duration }, label: `${TYPE_LABEL[c.type]}: ${name.slice(0, 28)} · ${formatTime(c.start)}–${formatTime(c.start + c.duration)}` });
  return (
    <span className="ep-selwrap">
      <span className="ep-selchip" title={name}>
        <b>{TYPE_LABEL[c.type]}</b>
        <span>{name}</span>
      </span>
      <button type="button" className="ep-askai" onClick={ask} title="Pedir à IA para este clipe" aria-label="Pedir à IA para este clipe"><Icon name="ai" size={14} /> IA</button>
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
        {active !== 'captions' && active !== 'canvas' && active !== 'review' && <SelectionChip />}
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
        {active === 'review' && <ReviewTab />}
        {active === 'transitions' && <TransitionsTab />}
        {active === 'audio' && <AudioTab />}
        {active === 'templates' && <MotionTemplateGallery />}
      </div>
    </div>
  );
}
