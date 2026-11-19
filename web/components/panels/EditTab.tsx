'use client';
/* aba "Editar" contextual: abas por tipo de clipe selecionado (CapCut) */
import { useEffect, useState } from 'react';
import { IconEdit } from '@/components/shell/icons';
import {
  AdjustSection, AnimationSection, BackgroundSection, BlendSection, ChromaSection, CropSection, EditSection, EffectsSection,
  FilterSection, FitSection, MaskSection, MotionSection, SpeedSection, VolumeSection,
} from './ClipSections';
import { EmptyHint, SectionDefaults } from './controls';
import { useSelectedClip } from './hooks';
import { ShapeStyleSection, StickerSection } from './StickersTab';
import { TextEditor } from './TextTab';

type Sub = 'edit' | 'speed' | 'volume' | 'anim' | 'crop' | 'mask' | 'chroma' | 'bg' | 'blend' | 'adjust' | 'filters' | 'effects' | 'fit' | 'motion' | 'style' | 'text';

const LABEL: Record<Sub, string> = {
  edit: 'Editar', speed: 'Velocidade', volume: 'Volume', anim: 'Animação', crop: 'Recortar', mask: 'Máscara', chroma: 'Chroma key',
  bg: 'Remover fundo', blend: 'Composição', adjust: 'Ajustes', filters: 'Filtros', effects: 'Efeitos', fit: 'Encaixe', motion: 'Transformar', style: 'Estilo', text: 'Texto',
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
  // 'all' = inspector completo (seções empilhadas e recolhíveis, como no DaVinci); um item = só aquela seção
  const [sub, setSub] = useState<Sub | 'all'>('all');
  useEffect(() => { if (clip && sub !== 'all' && !subs.includes(sub)) setSub('all'); }, [clip?.type]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!clip) return <EmptyHint icon={<IconEdit />} title="Nenhum clipe selecionado" text="Toque em um clipe na timeline para editar velocidade, animação, recorte, máscara, chroma key, cor e efeitos." />;
  const all = sub === 'all' || !subs.includes(sub);
  const show = (k: Sub) => all || sub === k;
  return (
    <SectionDefaults.Provider value={all ? (t) => OPEN_BY_DEFAULT.has(t) : () => true}>
      <div className="ep-subtabs" role="tablist">
        <button type="button" role="tab" aria-selected={all} className={all ? 'on' : ''} onClick={() => setSub('all')}>Tudo</button>
        {subs.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={!all && k === sub} className={!all && k === sub ? 'on' : ''} onClick={() => setSub(k)}>{LABEL[k]}</button>
        ))}
      </div>
      <div key={`${clip.id}-${all ? 'all' : sub}`} className="ep-subbody">
        {show('edit') && <EditSection clip={clip} />}
        {show('text') && clip.type === 'text' && <TextEditor clip={clip} />}
        {show('style') && clip.type === 'sticker' && <StickerSection clip={clip} />}
        {show('style') && clip.type === 'shape' && <ShapeStyleSection clip={clip} />}
        {show('motion') && (clip.type === 'video' || clip.type === 'image' || clip.type === 'sticker' || clip.type === 'shape') && <MotionSection clip={clip} />}
        {show('blend') && (clip.type === 'video' || clip.type === 'image' || clip.type === 'sticker' || clip.type === 'shape') && <BlendSection clip={clip} />}
        {show('crop') && (clip.type === 'video' || clip.type === 'image') && <CropSection clip={clip} />}
        {show('fit') && (clip.type === 'video' || clip.type === 'image') && <FitSection clip={clip} />}
        {show('speed') && (clip.type === 'video' || clip.type === 'audio') && <SpeedSection clip={clip} />}
        {show('volume') && (clip.type === 'video' || clip.type === 'audio') && <VolumeSection clip={clip} />}
        {show('anim') && (clip.type === 'video' || clip.type === 'image' || clip.type === 'sticker' || clip.type === 'shape') && <AnimationSection clip={clip} />}
        {show('mask') && (clip.type === 'video' || clip.type === 'image' || clip.type === 'shape') && <MaskSection clip={clip} />}
        {show('chroma') && (clip.type === 'video' || clip.type === 'image') && <ChromaSection clip={clip} />}
        {show('bg') && (clip.type === 'video' || clip.type === 'image') && <BackgroundSection clip={clip} />}
        {show('adjust') && (clip.type === 'video' || clip.type === 'image' || clip.type === 'adjustment') && <AdjustSection clip={clip} />}
        {show('filters') && (clip.type === 'video' || clip.type === 'image' || clip.type === 'adjustment') && <FilterSection clip={clip} />}
        {show('effects') && clip.type !== 'audio' && clip.type !== 'text' && <EffectsSection clip={clip} />}
      </div>
    </SectionDefaults.Provider>
  );
}

/** no inspector completo, estas começam abertas; as demais ficam recolhidas (o usuário abre e o app lembra) */
const OPEN_BY_DEFAULT = new Set(['Editar', 'Texto', 'Transformar', 'Composição', 'Velocidade', 'Volume', 'Estilo', 'Sticker']);
