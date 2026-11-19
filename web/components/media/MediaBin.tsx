'use client';
/* =====================================================================
   Biblioteca de mídia: grade de miniaturas, papel editável, importar,
   soltar arquivos, arrastar para a timeline (application/x-ep-asset),
   duplo clique adiciona no fim da trilha compatível, remover.
   Dono: sessão "shell".
   ===================================================================== */
import { useMemo, useRef, useState } from 'react';
import { emit } from '@/lib/events';
import { ingestFiles, useIngestQueue } from '@/lib/media/ingest';
import { placeAssetOp } from '@/lib/media/place';
import { ROLE_LABEL, formatBytes } from '@/lib/media/pure';
import { useEditor } from '@/lib/store';
import type { MediaAsset, MediaKind, MediaRole } from '@/lib/types';
import { formatTime } from '@/lib/util';
import { IconImage, IconMusic, IconPlus, IconTrash, IconUpload, IconVideo } from '@/components/shell/icons';
import UiIcon from '@/components/ui/Icon';
import Waveform from './Waveform';
import GenerateSection from './GenerateSection';

/** vídeo "Modelo": vira a referência de estilo do projeto e pede a análise à IA (pop-up/chat) */
function useAsModel(a: MediaAsset) {
  const st = useEditor.getState();
  if (st.project.referenceAssetId !== a.id) st.dispatch({ op: 'set_project', patch: { referenceAssetId: a.id } }, { history: false });
  emit('ep:open-ai-popup', { prompt: 'Analise este vídeo modelo e aplique o estilo' });
}

export const ASSET_MIME = 'application/x-ep-asset';
const ACCEPT = 'video/*,audio/*,image/*';
type Filter = 'all' | MediaKind;

const KIND_ICON = { video: IconVideo, image: IconImage, audio: IconMusic } as const;

function filesFrom(dt: DataTransfer | null): File[] {
  return dt ? Array.from(dt.files ?? []) : [];
}

function AssetCard({ asset, onAdd }: { asset: MediaAsset; onAdd: (a: MediaAsset) => void }) {
  const updateAsset = useEditor((s) => s.updateAsset);
  const usage = useEditor((s) => {
    let n = 0;
    for (const t of s.project.tracks) for (const c of t.clips) if ('assetId' in c && c.assetId === asset.id) n++;
    return n;
  });
  const [scrub, setScrub] = useState<number | null>(null);
  const [confirm, setConfirm] = useState(false);
  const thumbs = asset.thumbnails ?? [];
  const thumb = thumbs.length ? thumbs[scrub ?? Math.floor((thumbs.length - 1) / 3)] : undefined;
  const Icon = KIND_ICON[asset.kind];

  const remove = () => {
    const st = useEditor.getState();
    const ops = st.project.tracks.flatMap((t) => t.clips.filter((c) => 'assetId' in c && c.assetId === asset.id).map((c) => ({ op: 'remove_clip' as const, clipId: c.id })));
    if (ops.length) st.dispatch(ops);
    if (st.project.referenceAssetId === asset.id) st.dispatch({ op: 'set_project', patch: { referenceAssetId: undefined } });
    st.select(st.selection.filter((id) => !ops.some((o) => o.clipId === id)));
    st.removeAsset(asset.id);
    emit('ep:toast', { text: `“${asset.name}” removido da biblioteca`, kind: 'info' });
  };

  return (
    <div
      className={`ep-asset k-${asset.kind}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(ASSET_MIME, asset.id);
        e.dataTransfer.setData('text/plain', asset.name);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onDoubleClick={() => onAdd(asset)}
      title={`${asset.name}\nDuplo clique para adicionar à timeline · arraste para posicionar`}
    >
      <div
        className="ep-asset-thumb"
        onMouseMove={(e) => {
          if (thumbs.length < 2) return;
          const r = e.currentTarget.getBoundingClientRect();
          setScrub(Math.max(0, Math.min(thumbs.length - 1, Math.floor(((e.clientX - r.left) / r.width) * thumbs.length))));
        }}
        onMouseLeave={() => setScrub(null)}
      >
        {thumb ? <img src={thumb} alt="" draggable={false} /> : asset.kind === 'audio' ? <Waveform peaks={asset.waveform} className="ep-asset-wave" /> : <span className="ep-asset-skel" />}
        <span className="ep-asset-kind"><Icon size={13} /></span>
        {asset.kind !== 'image' && <span className="ep-asset-dur mono">{formatTime(asset.duration)}</span>}
        {usage > 0 && <span className="ep-asset-used" title={`${usage} clipe(s) na timeline`}>{usage}× na timeline</span>}
        <div className="ep-asset-actions">
          <button type="button" title="Adicionar no fim da timeline" onClick={(e) => { e.stopPropagation(); onAdd(asset); }}><IconPlus size={15} /></button>
          <button type="button" title="Remover" onClick={(e) => { e.stopPropagation(); setConfirm(true); }}><IconTrash size={15} /></button>
        </div>
        {confirm && (
          <div className="ep-asset-confirm" onDoubleClick={(e) => e.stopPropagation()}>
            <p>Remover da biblioteca?{usage > 0 && <><br /><small>{usage} clipe(s) sairão da timeline</small></>}</p>
            <div>
              <button type="button" className="ep-mini" onClick={() => setConfirm(false)}>Cancelar</button>
              <button type="button" className="ep-mini danger" onClick={remove}>Remover</button>
            </div>
          </div>
        )}
      </div>
      <div className="ep-asset-meta">
        <span className="ep-asset-name">{asset.name}</span>
        <span className="ep-asset-row">
          <select
            className={`ep-role r-${asset.role}`} value={asset.role} aria-label="Papel da mídia"
            onChange={(e) => updateAsset(asset.id, { role: e.target.value as MediaRole })}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {(Object.keys(ROLE_LABEL) as MediaRole[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
          <span className="ep-asset-size">{formatBytes(asset.size)}</span>
        </span>
        {asset.role === 'reference' && asset.kind === 'video' && (
          <button type="button" className="ep-asset-usemodel" onClick={() => useAsModel(asset)}>
            <UiIcon name="ai" size={14} /> Usar como modelo da IA
          </button>
        )}
      </div>
    </div>
  );
}

export default function MediaBin() {
  const assets = useEditor((s) => s.assets);
  const jobs = useIngestQueue((s) => s.jobs);
  const [filter, setFilter] = useState<Filter>('all');
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  const list = useMemo(() => Object.values(assets).filter((a) => filter === 'all' || a.kind === filter), [assets, filter]);
  const counts = useMemo(() => {
    const c = { all: 0, video: 0, image: 0, audio: 0 } as Record<Filter, number>;
    for (const a of Object.values(assets)) { c.all++; c[a.kind]++; }
    return c;
  }, [assets]);

  const importFiles = async (files: File[]) => {
    if (!files.length) return;
    const done = await ingestFiles(files);
    if (done.length) emit('ep:toast', { text: done.length === 1 ? `“${done[0].name}” importado` : `${done.length} arquivos importados`, kind: 'ok' });
  };

  const add = (a: MediaAsset) => {
    const st = useEditor.getState();
    const op = placeAssetOp(st.project, a);
    st.dispatch(op);
    if (op.op === 'add_clip') { st.select([op.clip.id]); st.setPlayhead(op.clip.start); }
    emit('ep:toast', { text: `“${a.name}” adicionado à timeline`, kind: 'ok' });
  };

  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

  return (
    <div
      className={`ep-media${over ? ' over' : ''}`}
      onDragEnter={(e) => { if (!hasFiles(e)) return; e.preventDefault(); depth.current++; setOver(true); }}
      onDragOver={(e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
      onDragLeave={() => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); }}
      onDrop={(e) => { if (!hasFiles(e)) return; e.preventDefault(); depth.current = 0; setOver(false); void importFiles(filesFrom(e.dataTransfer)); }}
    >
      <div className="ep-panelhead">
        <h3>Mídia</h3>
        <button type="button" className="ep-btn primary ep-btn-sm" onClick={() => input.current?.click()}>
          <IconUpload size={15} /> Importar
        </button>
        <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { void importFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
      </div>

      {counts.all > 0 && (
        <div className="ep-mfilter" role="tablist">
          {(['all', 'video', 'image', 'audio'] as Filter[]).map((f) => (
            <button key={f} type="button" role="tab" aria-selected={filter === f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
              {{ all: 'Tudo', video: 'Vídeo', image: 'Imagem', audio: 'Áudio' }[f]}
              <span className="c">{counts[f]}</span>
            </button>
          ))}
        </div>
      )}

      {!counts.all && !jobs.length ? (
        <button type="button" className="ep-mdrop" onClick={() => input.current?.click()}>
          <span className="ic"><IconUpload size={22} /></span>
          <b>Solte vídeos, fotos e músicas aqui</b>
          <span>ou clique para escolher arquivos</span>
        </button>
      ) : (
        <div className="ep-mgrid">
          {jobs.map((j) => (
            <div key={j.id} className="ep-asset loading" aria-busy="true">
              <div className="ep-asset-thumb"><span className="ep-asset-skel" /><span className="ep-spin" /></div>
              <div className="ep-asset-meta"><span className="ep-asset-name">{j.name}</span><span className="ep-asset-size">{j.stage}</span></div>
            </div>
          ))}
          {list.filter((a) => !jobs.some((j) => j.id === a.id)).map((a) => <AssetCard key={a.id} asset={a} onAdd={add} />)}
          {!list.length && !jobs.length && <p className="ep-pnote">Nenhum item deste tipo.</p>}
        </div>
      )}

      <GenerateSection />
      {counts.all > 0 && <p className="ep-mtip">Dica: arraste para a timeline ou dê duplo clique para colocar no fim.</p>}
      {over && <div className="ep-mover"><IconUpload size={26} /><b>Solte para importar</b></div>}
    </div>
  );
}
