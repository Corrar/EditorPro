/* =====================================================================
   Ponte de eventos da IA (ep:start-ai-edit, ep:generate-captions).
   ChatPanel e AiPopup podem estar montados juntos ou sozinhos: a ponte
   é registrada uma única vez (contagem de referências).
   ===================================================================== */
import { useEffect } from 'react';
import { on } from '../events';
import { useAIChat } from './chatStore';

let refs = 0;
let off: (() => void) | null = null;

export function acquireAIBridge(): () => void {
  if (refs++ === 0) {
    const a = on('ep:start-ai-edit', ({ brief }) => { useAIChat.getState().firstEdit(brief); });
    const b = on('ep:generate-captions', ({ language }) => { useAIChat.getState().captions(language); });
    off = () => { a(); b(); };
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--refs === 0) { off?.(); off = null; }
  };
}

export function useAIBridge() {
  useEffect(() => acquireAIBridge(), []);
}
