/* =====================================================================
   Eventos entre módulos (desacopla sessões paralelas). Contrato da principal.
   Quem emite / quem escuta:
   - 'ep:open-export'        shell (botão Exportar)   -> engine (ExportDialog)
   - 'ep:start-ai-edit'      shell (wizard)           -> ai (pipeline da 1ª edição)
   - 'ep:generate-captions'  shell (painel Legendas)  -> ai (transcrição)
   - 'ep:attach-files'       ai (chat) / qualquer     -> shell (ingestão de mídia)
   - 'ep:toast'              qualquer                 -> shell (toasts)
   ===================================================================== */
import type { MediaRole } from './types';

export interface EpEvents {
  'ep:open-export': Record<string, never>;
  'ep:start-ai-edit': { brief: string };
  'ep:generate-captions': { language?: string };
  'ep:attach-files': { files: File[]; role?: MediaRole };
  'ep:toast': { text: string; kind?: 'info' | 'ok' | 'error' };
}

export function emit<K extends keyof EpEvents>(name: K, detail: EpEvents[K]): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

/** assina um evento; devolve função para cancelar (use em useEffect) */
export function on<K extends keyof EpEvents>(name: K, fn: (detail: EpEvents[K]) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const h = (e: Event) => fn((e as CustomEvent<EpEvents[K]>).detail);
  window.addEventListener(name, h);
  return () => window.removeEventListener(name, h);
}
