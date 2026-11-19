/* Mudanças no projeto feitas pela PRÓPRIA execução da IA fora do applyLive (dispatch em bloco,
   "desfazer" pedido no chat). O chatStore ignora estas ao detectar edição manual / desfazer do usuário. */
let own = 0;
export function isOwnChange(): boolean { return own > 0; }
export function asOwn<T>(fn: () => T): T {
  own++;
  try { return fn(); } finally { own--; }
}
/** erro de execução interrompida (Parar, desfazer, edição manual, troca de projeto) */
export function abortError(msg = 'Edição parada'): Error {
  const e = new Error(msg);
  e.name = 'AbortError';
  return e;
}
export const isAbort = (e: unknown): boolean => e instanceof Error && e.name === 'AbortError' || (typeof DOMException !== 'undefined' && e instanceof DOMException && e.name === 'AbortError');
