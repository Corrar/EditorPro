'use client';
/* =====================================================================
   LibraryHub — todas as galerias da biblioteca em abas de pílula.
   O shell pode montar este painel inteiro ou cada galeria separada.
   ===================================================================== */
import { useState } from 'react';
import Icon, { type IconName } from '@/components/ui/Icon';
import FontPicker from './FontPicker';
import CaptionStyleGallery from './CaptionStyleGallery';
import TextTemplateGallery from './TextTemplateGallery';
import MotionTemplateGallery from './MotionTemplateGallery';
import AnimationPicker from './AnimationPicker';
import LookGallery from './LookGallery';
import SfxList from './SfxList';

export type LibraryTab = 'modelos' | 'textos' | 'legendas' | 'animacoes' | 'looks' | 'sons' | 'fontes';

const TABS: { id: LibraryTab; label: string; icon: IconName }[] = [
  { id: 'modelos', label: 'Modelos', icon: 'templates' },
  { id: 'textos', label: 'Títulos', icon: 'text' },
  { id: 'legendas', label: 'Legendas', icon: 'captions' },
  { id: 'animacoes', label: 'Animações', icon: 'effects' },
  { id: 'looks', label: 'Looks', icon: 'filters' },
  { id: 'sons', label: 'Sons', icon: 'audio' },
  { id: 'fontes', label: 'Fontes', icon: 'edit' },
];

export default function LibraryHub({ initial = 'modelos', tabs }: { initial?: LibraryTab; tabs?: LibraryTab[] }) {
  const shown = tabs ? TABS.filter((t) => tabs.includes(t.id)) : TABS;
  const [tab, setTab] = useState<LibraryTab>(shown.some((t) => t.id === initial) ? initial : shown[0].id);
  return (
    <div className="ep-lib-hub">
      <div className="ep-lib-tabs" role="tablist" aria-label="Biblioteca">
        {shown.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`ep-pill2${tab === t.id ? ' on' : ''}`} onClick={() => setTab(t.id)}>
            <Icon name={t.icon} size={18} /> {t.label}
          </button>
        ))}
      </div>
      <div className="ep-lib-body" role="tabpanel">
        {tab === 'modelos' && <MotionTemplateGallery />}
        {tab === 'textos' && <TextTemplateGallery />}
        {tab === 'legendas' && <CaptionStyleGallery />}
        {tab === 'animacoes' && <AnimationPicker />}
        {tab === 'looks' && <LookGallery />}
        {tab === 'sons' && <SfxList />}
        {tab === 'fontes' && <FontPicker />}
      </div>
    </div>
  );
}
