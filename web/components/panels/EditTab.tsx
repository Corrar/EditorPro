'use client';
/* aba "Editar" contextual: abas por tipo de clipe selecionado (CapCut) */
import { useEffect, useState } from 'react';
import { IconEdit } from '@/components/shell/icons';
import {
  AdjustSection, AnimationSection, BackgroundSection, BlendSection, ChromaSection, CropSection, EditSection, EffectsSection,
  FilterSection, FitSection, MaskSection, MotionSection, SpeedSection, VolumeSection,
} from './ClipSections';
import { EmptyHint } from './controls';
import { useSelectedClip } from './hooks';
import { ShapeStyleSection, StickerSection } from './StickersTab';
import { TextEditor } from './TextTab';

type Sub = 'edit' | 'speed' | 'volume' | 'anim' | 'crop' | 'mask' | 'chroma' | 'bg' | 'blend' | 'adjust' | 'filters' | 'effects' | 'fit' | 'motion' | 'style' | 'text';

const LABEL: Record<Sub, string> = {
  edit: 'Editar', speed: 'Velocidade', volume: 'Volume', anim: 'Animação', crop: 'Recortar', mask: 'Máscara', chroma: 'Chroma key',
  bg: 'Remover fundo', blend: 'Mesclagem', adjust: 'Ajustes', filters: 'Filtros', effects: 'Efeitos', fit: 'Encaixe', motion: 'Posição', style: 'Estilo', text: 'Texto',
};

const SUBS: Record<string, Sub[]> = {
  video: ['edit', 'speed', 'volume', 'anim', 'motion', 'crop', 'mask', 'chroma', 'bg', 'blend', 'adjust', 'filters', 'effects', 'fit'],
  image: ['edit', 'anim', 'motion', 'crop', 'mask', 'chroma', 'bg', 'blend', 'adjust', 'filters', 'effects', 'fit'],
  audio: ['edit', 'volume', 'speed'],
  text: ['text', 'edit'],
  sticker: ['style', 'edit', 'anim', 'motion', 'blend', 'effects'],
  shape: ['style', 'edit', 'anim', 'motion', 'mask', 'blend', 'effects'],
  adjustment: ['adjust', 'filters', 'effects', 'edit'],
};

export default function EditTab() {
  const found = useSelectedClip();
  const clip = found?.clip;
  const subs = clip ? SUBS[clip.type] : [];
  const [sub, setSub] = useState<Sub>('edit');
  useEffect(() => { if (clip && !subs.includes(sub)) setSub(subs[0]); }, [clip?.type]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!clip) return <EmptyHint icon={<IconEdit />} title="Nenhum clipe selecionado" text="Toque em um clipe na timeline para editar velocidade, animação, recorte, máscara, chroma key, cor e efeitos." />;
  const s = subs.includes(sub) ? sub : subs[0];
  return (
    <>
      <div className="ep-subtabs" role="tablist">
        {subs.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={k === s} className={k === s ? 'on' : ''} onClick={() => setSub(k)}>{LABEL[k]}</button>
        ))}
      </div>
      <div key={`${clip.id}-${s}`} className="ep-subbody">
        {s === 'edit' && <EditSection clip={clip} />}
        {s === 'text' && clip.type === 'text' && <TextEditor clip={clip} />}
        {s === 'speed' && (clip.type === 'video' || clip.type === 'audio') && <SpeedSection clip={clip} />}
        {s === 'volume' && (clip.type === 'video' || clip.type === 'audio') && <VolumeSection clip={clip} />}
        {s === 'anim' && (clip.type === 'video' || clip.type === 'image' || clip.type === 'sticker' || clip.type === 'shape') && <AnimationSection clip={clip} />}
        {s === 'motion' && (clip.type === 'video' || clip.type === 'image' || clip.type === 'sticker' || clip.type === 'shape') && <MotionSection clip={clip} />}
        {s === 'crop' && (clip.type === 'video' || clip.type === 'image') && <CropSection clip={clip} />}
        {s === 'mask' && (clip.type === 'video' || clip.type === 'image' || clip.type === 'shape') && <MaskSection clip={clip} />}
        {s === 'chroma' && (clip.type === 'video' || clip.type === 'image') && <ChromaSection clip={clip} />}
        {s === 'bg' && (clip.type === 'video' || clip.type === 'image') && <BackgroundSection clip={clip} />}
        {s === 'blend' && (clip.type === 'video' || clip.type === 'image' || clip.type === 'sticker' || clip.type === 'shape') && <BlendSection clip={clip} />}
        {s === 'adjust' && (clip.type === 'video' || clip.type === 'image' || clip.type === 'adjustment') && <AdjustSection clip={clip} />}
        {s === 'filters' && (clip.type === 'video' || clip.type === 'image' || clip.type === 'adjustment') && <FilterSection clip={clip} />}
        {s === 'effects' && clip.type !== 'audio' && clip.type !== 'text' && <EffectsSection clip={clip} />}
        {s === 'fit' && (clip.type === 'video' || clip.type === 'image') && <FitSection clip={clip} />}
        {s === 'style' && clip.type === 'sticker' && <StickerSection clip={clip} />}
        {s === 'style' && clip.type === 'shape' && <ShapeStyleSection clip={clip} />}
      </div>
    </>
  );
}
