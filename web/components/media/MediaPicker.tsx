'use client';
/* =====================================================================
   "Adicionar mídia" em tela cheia, estilo CapCut: abas Vídeos/Fotos/Áudio,
   grade de 3 colunas com a mídia já importada (Recentes, entre projetos),
   seleção múltipla numerada na ordem do toque e "Adicionar (N)" fixo.
   1º bloco = "Galeria do celular" (Photo Picker do sistema, sem o
   "Escolha uma ação"), 2º = "Câmera". Um PWA não lista a galeria do
   celular — o que já passou por aqui fica salvo para as próximas edições.
   ===================================================================== */
import { useEffect, useMemo, useState } from 'react';
import Icon from '@/components/ui/Icon';
import { emit } from '@/lib/events';
import { ingestFiles, useIngestQueue } from '@/lib/media/ingest';
import { sequenceOps } from '@/lib/media/place';
import { getKV, setKV } from '@/lib/persist/db';
import { recentsOf, type RecentMedia, type StoredAsset } from '@/lib/persist/pure';
import { loadRecents, restoreRecent, useRecents } from '@/lib/persist/recents';
import { useEditor } from '@/lib/store';
import type { MediaAsset } from '@/lib/types';
import { formatTime } from '@/lib/util';
import { closeMediaPicker, useMediaPicker } from './pickerStore';
import { useFilePickers, type PickKind } from './pickers';
import Waveform from './Waveform';

type Tab = 'video' | 'image' | 'audio';
const TABS: { id: Tab; label: string }[] = [{ id: 'video', label: 'Vídeos' }, { id: 'image', label: 'Fotos' }, { id: 'audio', label: 'Áudio' }];
const HINT_KEY = 'pickerHintSeen';

interface Item { id: string; asset: StoredAsset | MediaAsset; recent?: RecentMedia }

export default function MediaPicker() {
  const { open, tab } = useMediaPicker();
  const recents = useRecents((s) => s.list);
  const projectAssets = useEditor((s) => s.assets);
  const jobs = useIngestQueue((s) => s.jobs);
  const [sel, setSel] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState(false);

  useEffect(() => {
    if (!open) { setSel([]); return; }
    void loadRecents();
    getKV<boolean>(HINT_KEY).then((seen) => setHint(!seen)).catch(() => setHint(true));
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') closeMediaPicker(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open]);

  const dismissHint = () => { setHint(false); void setKV(HINT_KEY, true).catch(() => {}); };

  const pickers = useFilePickers(async (files: File[], kind: PickKind) => {
    dismissHint();
    const done = await ingestFiles(files);
    if (!done.length) return;
    const first = done[0].kind as Tab;
    if (kind !== 'audio' && first !== tab) useMediaPicker.setState({ tab: first });
    if (kind === 'audio' && tab !== 'audio') useMediaPicker.setState({ tab: 'audio' });
    // já entram selecionados, na ordem em que vieram
    setSel((s) => [...s, ...done.map((a) => a.id).filter((id) => !s.includes(id))]);
  });

  /** recentes do tipo + mídia do projeto que não coube nos recentes */
  const items = useMemo<Item[]>(() => {
    const rec = recentsOf(recents, tab).map((r) => ({ id: r.asset.id, asset: r.asset, recent: r }));
    const ids = new Set(rec.map((r) => r.id));
    const proj = Object.values(projectAssets)
      .filter((a) => a.kind === tab && a.role !== 'reference' && !ids.has(a.id))
      .map((a) => ({ id: a.id, asset: a }));
    return [...proj, ...rec];
  }, [recents, projectAssets, tab]);

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { video: 0, image: 0, audio: 0 };
    const seen = new Set<string>();
    for (const r of recents) if (r.asset.role !== 'reference' && r.asset.kind in c) { c[r.asset.kind as Tab]++; seen.add(r.asset.id); }
    for (const a of Object.values(projectAssets)) if (!seen.has(a.id) && a.role !== 'reference' && a.kind in c) c[a.kind as Tab]++;
    return c;
  }, [recents, projectAssets]);

  if (!open) return null;

  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const add = async () => {
    if (!sel.length || busy) return;
    setBusy(true);
    try {
      const st = useEditor.getState();
      const all = new Map(recents.map((r) => [r.asset.id, r]));
      const chosen: MediaAsset[] = [];
      for (const id of sel) {
        const have = useEditor.getState().assets[id];
        if (have) { chosen.push(have); continue; }
        const r = all.get(id);
        const a = r ? await restoreRecent(r) : null;
        if (a) { st.addAsset(a); chosen.push(a); }
      }
      if (!chosen.length) { emit('ep:toast', { text: 'Esses arquivos não estão mais salvos aqui', kind: 'error' }); return; }
      const p = useEditor.getState().project;
      st.dispatch(sequenceOps(p, chosen));
      emit('ep:toast', { text: chosen.length === 1 ? `“${chosen[0].name}” adicionado` : `${chosen.length} itens adicionados`, kind: 'ok' });
      closeMediaPicker();
    } finally {
      setBusy(false);
    }
  };

  const loadingHere = jobs.length > 0;
  return (
    <div className="ep-mpick" role="dialog" aria-modal="true" aria-label="Adicionar mídia">
      <div className="ep-mpick-head">
        <button type="button" className="ep-circle sm" onClick={closeMediaPicker} aria-label="Fechar"><Icon name="close" size={20} /></button>
        <h2 className="ep-h-sheet">Adicionar mídia</h2>
        <span />
      </div>
      <div className="ep-mpick-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => useMediaPicker.setState({ tab: t.id })}>
            {t.label}{counts[t.id] ? <span className="c">{counts[t.id]}</span> : null}
          </button>
        ))}
      </div>

      <div className="ep-mpick-body">
        {hint && (
          <div className="ep-mpick-hint" role="note">
            <Icon name="image" size={20} />
            <span>Toque em <b>{tab === 'audio' ? 'Arquivos de áudio' : 'Galeria do celular'}</b> para escolher seus {tab === 'audio' ? 'áudios' : 'vídeos'}. Eles ficam salvos aqui para as próximas edições.</span>
            <button type="button" className="x" onClick={dismissHint} aria-label="Entendi"><Icon name="close" size={16} /></button>
          </div>
        )}
        <div className="ep-mpick-grid">
          {tab === 'audio' ? (
            <button type="button" className="ep-mpick-src" onClick={pickers.openAudio}><Icon name="music" size={26} /><span>Arquivos de áudio</span></button>
          ) : (
            <>
              <button type="button" className="ep-mpick-src main" onClick={pickers.openGallery}><Icon name="image" size={26} /><span>Galeria do celular</span></button>
              <button type="button" className="ep-mpick-src" onClick={pickers.openCamera}><Icon name="video" size={26} /><span>Câmera</span></button>
            </>
          )}
          {loadingHere && jobs.map((j) => (
            <div key={j.id} className="ep-mpick-cell loading" aria-busy="true"><span className="ep-spin" /><span className="nm">{j.stage}</span></div>
          ))}
          {items.filter((it) => !jobs.some((j) => j.id === it.id)).map((it) => {
            const n = sel.indexOf(it.id) + 1;
            const a = it.asset;
            const thumb = a.thumbnails?.[Math.floor(((a.thumbnails?.length ?? 1) - 1) / 3)];
            return (
              <button key={it.id} type="button" className={`ep-mpick-cell${n ? ' on' : ''}`} onClick={() => toggle(it.id)} aria-pressed={!!n} aria-label={`${a.name}${n ? `, selecionado ${n}` : ''}`}>
                {a.kind === 'audio' ? <span className="aud"><Waveform peaks={a.waveform} bars={28} /><span className="nm">{a.name}</span></span> : thumb ? <img src={thumb} alt="" draggable={false} /> : <span className="ep-asset-skel" />}
                {a.kind !== 'image' && <span className="dur mono">{formatTime(a.duration)}</span>}
                <span className={`num${n ? ' on' : ''}`}>{n || ''}</span>
              </button>
            );
          })}
        </div>
        {!items.length && !loadingHere && (
          <p className="ep-mpick-empty">{tab === 'audio' ? 'Nenhum áudio por aqui ainda.' : 'Nada por aqui ainda — escolha da galeria do celular.'}</p>
        )}
      </div>

      <div className="ep-mpick-foot">
        <button type="button" className="ep-cta ep-mpick-add" disabled={!sel.length || busy} onClick={() => void add()}>
          {busy ? <span className="ep-spin sm" /> : null}Adicionar{sel.length ? ` (${sel.length})` : ''}
        </button>
      </div>
      {pickers.inputs}
    </div>
  );
}
