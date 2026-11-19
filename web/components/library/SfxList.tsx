'use client';
/* =====================================================================
   SfxList — efeitos sonoros sintetizados: ouvir (prévia) e inserir no
   playhead (gera WAV, ingere como asset e cria o AudioClip em 1 desfazer).
   ===================================================================== */
import { useEffect, useRef, useState } from 'react';
import Icon from '@/components/ui/Icon';
import { emit } from '@/lib/events';
import { SFX_CATALOG, SFX_CATEGORY_LABELS, insertSfx, previewSfx, type SfxCategory } from '@/lib/library/sfx';
import { PillRow, Empty } from './shared';
import { matchesQuery } from '@/lib/library/search';

type Cat = SfxCategory | 'todos';
const CATS: { id: Cat; label: string }[] = [{ id: 'todos', label: 'Todos' }, ...(Object.keys(SFX_CATEGORY_LABELS) as SfxCategory[]).map((id) => ({ id, label: SFX_CATEGORY_LABELS[id] }))];

export default function SfxList({ onInserted, query }: { onInserted?: (assetId: string) => void; query?: string }) {
  const [cat, setCat] = useState<Cat>('todos');
  const [playing, setPlaying] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  useEffect(() => () => stopRef.current?.(), []);

  const play = async (id: string) => {
    stopRef.current?.();
    stopRef.current = null;
    if (playing === id) { setPlaying(null); return; }
    setPlaying(id);
    try {
      const stop = await previewSfx(id);
      stopRef.current = () => { stop(); setPlaying((p) => (p === id ? null : p)); };
      const def = SFX_CATALOG.find((s) => s.id === id)!;
      setTimeout(() => setPlaying((p) => (p === id ? null : p)), def.duration * 1000 + 150);
    } catch {
      setPlaying(null);
    }
  };

  const insert = async (id: string) => {
    setBusy(id);
    try {
      const asset = await insertSfx(id);
      if (asset) {
        emit('ep:toast', { text: `Efeito “${SFX_CATALOG.find((s) => s.id === id)?.name}” inserido no playhead`, kind: 'ok' });
        onInserted?.(asset.id);
      }
    } catch (e) {
      emit('ep:toast', { text: e instanceof Error ? e.message : 'Não consegui inserir o efeito', kind: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const list = SFX_CATALOG.filter((s) => (cat === 'todos' || s.category === cat) && matchesQuery(query, [s.name, s.description, SFX_CATEGORY_LABELS[s.category], 'som efeito']));
  return (
    <div className="ep-lib ep-lib-sfx">
      <PillRow value={cat} options={CATS} onChange={setCat} label="Categorias de efeito sonoro" />
      {!list.length && <Empty>Nenhum som encontrado{query ? ` para “${query}”` : ''}.</Empty>}
      <div className="ep-rows ep-lib-sfxrows">
        {list.map((s) => (
          <div key={s.id} className="ep-row ep-lib-sfxrow">
            <button type="button" className={`ep-circle sm ep-lib-play${playing === s.id ? ' on' : ''}`} onClick={() => play(s.id)}
              aria-label={playing === s.id ? `Parar ${s.name}` : `Ouvir ${s.name}`}>
              <Icon name={playing === s.id ? 'pause' : 'play'} size={18} />
            </button>
            <span className="ep-lib-sfxtx">
              <span className="ep-lib-sfxname">{s.name}</span>
              <span className="meta">{s.description}</span>
            </span>
            <span className="meta ep-lib-dur">{s.duration.toFixed(1).replace('.', ',')}s</span>
            <button type="button" className="ep-circle sm ep-lib-add" onClick={() => insert(s.id)} disabled={busy === s.id} aria-label={`Inserir ${s.name} no playhead`}>
              {busy === s.id ? <span className="ep-lib-spin" /> : <Icon name="add" size={18} />}
            </button>
          </div>
        ))}
      </div>
      <p className="ep-lib-note">Sons gerados no próprio navegador — livres para usar.</p>
    </div>
  );
}
