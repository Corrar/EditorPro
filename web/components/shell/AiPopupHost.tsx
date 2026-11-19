'use client';
/* =====================================================================
   v2.3 — contêiner do pop-up da IA no editor do celular (≤899px retrato):
   - botão flutuante ✦ (56px, canto inferior esquerdo, acima da barra de ferramentas)
   - sheet ~45% com o preview visível em cima → AiPopup (módulo ai)
   - minimizar → AiLiveBadge ("IA editando 3/8") sobre o preview; tocar reabre.
     Sem nada rodando, a pílula some e o botão ✦ volta.
   - "Abrir conversa completa" → chat inteiro
   ===================================================================== */
import { useMemo } from 'react';
import Icon from '@/components/ui/Icon';
import AiPopup, { AiLiveBadge } from '@/components/chat/AiPopup';
import { useAIChat } from '@/lib/ai/chatStore';
import { liveSummary } from '@/lib/ai/live';
import { useEditor } from '@/lib/store';

export type AiPopupMode = 'closed' | 'open' | 'min';

export default function AiPopupHost({ mode, setMode, onOpenChat, fabHidden, focus }: {
  mode: AiPopupMode; setMode: (m: AiPopupMode) => void; onOpenChat: () => void; fabHidden?: boolean; focus?: boolean;
}) {
  const messages = useEditor((s) => s.messages);
  const runs = useAIChat((s) => s.runs);
  const live = useMemo(() => liveSummary(messages, runs), [messages, runs]);
  const active = live.working || live.waiting;
  const showFab = !fabHidden && (mode === 'closed' || (mode === 'min' && !active));
  return (
    <>
      {showFab && (
        <button type="button" className={`ep-aifab2${active ? ' live' : ''}`} onClick={() => setMode('open')} aria-label="Editar com IA">
          <Icon name="ai" size={24} />
        </button>
      )}
      {mode !== 'open' && active && (
        <div className="ep-aibadge-slot"><AiLiveBadge onClick={() => setMode('open')} /></div>
      )}
      {mode === 'open' && (
        <div className="ep-aipop" role="dialog" aria-modal="false" aria-label="Editar com IA">
          <AiPopup autoFocus={focus} onMinimize={() => setMode('min')} onExpand={() => { setMode('closed'); onOpenChat(); }} />
        </div>
      )}
    </>
  );
}
