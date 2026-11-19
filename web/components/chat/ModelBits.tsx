'use client';
/* Peças do "vídeo modelo" no chat: chip do modelo ativo, cartão do anexo e ações. */
import Icon from '@/components/ui/Icon';
import { useEditor } from '@/lib/store';
import { useAIChat } from '@/lib/ai/chatStore';
import { SCOPE_LABELS } from '@/lib/ai/model';
import type { Id } from '@/lib/types';

/** "Modelo: nome ✕" — modelo de estilo ativo do projeto */
export function ModelChip({ compact = false }: { compact?: boolean }) {
  const ref = useEditor((s) => (s.project.referenceAssetId && s.project.style ? s.assets[s.project.referenceAssetId] : undefined));
  const clearModel = useAIChat((s) => s.clearModel);
  const busy = useAIChat((s) => s.busy);
  if (!ref) return null;
  const thumb = ref.thumbnails?.[0];
  return (
    <div className={`ep-mdl-chip${compact ? ' compact' : ''}`} role="status" data-testid="model-chip">
      {thumb ? <img src={thumb} alt="" /> : <Icon name="film" size={14} />}
      <span>Modelo: <b>{ref.name}</b></span>
      <button aria-label="Parar de usar este modelo" title="Parar de usar este modelo" disabled={busy} onClick={clearModel}><Icon name="close" size={12} /></button>
    </div>
  );
}

/** miniatura do vídeo anexado (na bolha do usuário) */
export function ModelAttachment({ ids }: { ids: Id[] }) {
  const assets = useEditor((s) => s.assets);
  const list = ids.map((id) => assets[id]).filter(Boolean);
  if (!list.length) return null;
  return (
    <div className="ep-mdl-att">
      {list.map((a) => (
        <div key={a.id} className="ep-mdl-card">
          {a.thumbnails?.[0] ? <img src={a.thumbnails[0]} alt="" /> : <span className="ph"><Icon name="film" size={18} /></span>}
          <span className="nm">{a.name}{a.duration ? <small>{Math.round(a.duration)} s</small> : null}</span>
        </div>
      ))}
    </div>
  );
}

/** "Aplicar este estilo ao meu vídeo" + chips (na resposta da análise) */
export function ModelActions({ assetId }: { assetId: Id }) {
  const active = useEditor((s) => s.project.referenceAssetId === assetId && !!s.project.style);
  const busy = useAIChat((s) => s.busy);
  const applyModel = useAIChat((s) => s.applyModel);
  if (!active) return null;
  return (
    <div className="ep-mdl-actions">
      <button className="ep-mdl-apply" disabled={busy} onClick={() => applyModel('all')}>
        <Icon name="ai" size={15} /> Aplicar este estilo ao meu vídeo
      </button>
      <div className="ep-mdl-chips">
        {(Object.keys(SCOPE_LABELS) as (keyof typeof SCOPE_LABELS)[]).map((k) => (
          <button key={k} className="ep-pill2 ep-ch-chip" disabled={busy} onClick={() => applyModel(k)}>{SCOPE_LABELS[k]}</button>
        ))}
      </div>
    </div>
  );
}
