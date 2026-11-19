/* Worker dos escopos: recebe ImageData reduzido, devolve as contagens (transferíveis). */
import { computeScopes, type ScopeOpts } from './scopes';

const ctx = self as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage: (m: unknown, t?: Transferable[]) => void };
ctx.onmessage = (e: MessageEvent<{ id: number; data: Uint8ClampedArray; width: number; height: number; opts: ScopeOpts }>) => {
  const { id, data, width, height, opts } = e.data;
  const s = computeScopes({ data, width, height }, opts);
  ctx.postMessage({ id, s }, [s.histR.buffer, s.histG.buffer, s.histB.buffer, s.histL.buffer, s.wave.buffer, s.vec.buffer]);
};
