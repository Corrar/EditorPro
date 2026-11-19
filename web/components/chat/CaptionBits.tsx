'use client';
/* =====================================================================
   Legendas no chat (dono: módulo ai/legendas):
   - RunActions: botões honestos depois da resposta ("Tentar transcrever de
     novo", "Ligar CC e transcrever", "Escrever manualmente")
   - LegacyCaptionsChip: aviso quando o projeto tem legenda antiga que NÃO
     veio da fala (versão de 2026-11-19 que usava o texto do pedido)
   ===================================================================== */
import Icon from '@/components/ui/Icon';
import { useEditor } from '@/lib/store';
import { useAIChat, type RunState } from '@/lib/ai/chatStore';
import { isLegacyFakeCaptions } from '@/lib/ai/legacyCaptions';

export function RunActions({ msgId, run }: { msgId: string; run?: RunState }) {
  const action = useAIChat((s) => s.action);
  const busy = useAIChat((s) => s.busy);
  if (!run?.done || !run.actions?.length) return null;
  return (
    <div className="ep-ch-askbtns" role="group" aria-label="O que fazer agora">
      {run.actions.map((a, i) => (
        <button key={a.id} className={`ep-ch-askbtn${i === 0 ? ' primary' : ''}`} disabled={busy} onClick={() => void action(msgId, a.id)}>{a.label}</button>
      ))}
    </div>
  );
}

export function LegacyCaptionsChip() {
  const legacy = useEditor((s) => isLegacyFakeCaptions(s.project));
  const hasMedia = useEditor((s) => s.project.tracks.some((t) => t.clips.some((c) => c.type === 'video' || c.type === 'audio')));
  const busy = useAIChat((s) => s.busy);
  const action = useAIChat((s) => s.action);
  if (!legacy || !hasMedia) return null;
  return (
    <div className="ep-ch-ask" role="status" data-testid="legacy-captions">
      <p><Icon name="captions" size={14} /> Estas legendas não vieram da fala (versão antiga do app). Refazer pela fala?</p>
      <div className="ep-ch-askbtns">
        <button className="ep-ch-askbtn primary" disabled={busy} onClick={() => void action('legacy', 'captions:redo')}>Refazer pela fala</button>
      </div>
    </div>
  );
}
