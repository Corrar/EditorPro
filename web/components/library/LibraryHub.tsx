'use client';
/* =====================================================================
   LibraryHub — todas as galerias da biblioteca em abas de pílula.
   O shell pode montar este painel inteiro ou cada galeria separada.
   ===================================================================== */
import { useEffect, useMemo, useState } from 'react';
import Icon, { type IconName } from '@/components/ui/Icon';
import FontPicker from './FontPicker';
import CaptionStyleGallery from './CaptionStyleGallery';
import TextTemplateGallery from './TextTemplateGallery';
import MotionTemplateGallery from './MotionTemplateGallery';
import AnimationPicker from './AnimationPicker';
import LookGallery from './LookGallery';
import SfxList from './SfxList';
import { SearchPill } from './shared';
import { searchLibrary } from '@/lib/library/search';

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
  const [q, setQ] = useState('');
  const query = q.trim();
  const counts = useMemo(() => (query ? searchLibrary(query) : null), [query]);
  // aba atual sem resultado: pula para a primeira aba que tem
  useEffect(() => {
    if (!counts || counts[tab] > 0) return;
    const first = shown.find((t) => counts[t.id] > 0);
    if (first) setTab(first.id);
  }, [counts]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = counts ? shown.reduce((n, t) => n + counts[t.id], 0) : 0;
  return (
    <div className="ep-lib-hub">
      <SearchPill value={q} onChange={setQ} placeholder="Buscar na biblioteca" />
      <div className="ep-lib-tabs" role="tablist" aria-label="Biblioteca">
        {shown.map((t) => {
          const n = counts?.[t.id];
          return (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id}
              className={`ep-pill2${tab === t.id ? ' on' : ''}${n === 0 ? ' dim' : ''}`} onClick={() => setTab(t.id)}>
              <Icon name={t.icon} size={18} /> {t.label}
              {n !== undefined && <span className="ep-lib-count">{n}</span>}
            </button>
          );
        })}
      </div>
      {counts && !total && <div className="ep-lib-empty">Nada encontrado para “{query}”. Tente outra palavra (ex.: “neon”, “título”, “whoosh”).</div>}
      <div className="ep-lib-body" role="tabpanel">
        {tab === 'modelos' && <MotionTemplateGallery query={query} />}
        {tab === 'textos' && <TextTemplateGallery query={query} />}
        {tab === 'legendas' && <CaptionStyleGallery query={query} />}
        {tab === 'animacoes' && <AnimationPicker query={query} />}
        {tab === 'looks' && <LookGallery query={query} />}
        {tab === 'sons' && <SfxList query={query} />}
        {tab === 'fontes' && <FontPicker query={query} />}
      </div>
    </div>
  );
}
