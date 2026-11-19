/* Web Worker: renderiza a música fora da thread da interface. */
import { musicWav } from './wav';

interface Req { reqId: number; id: string; duration: number; sampleRate: number; loop: boolean }

const ctx = self as unknown as { onmessage: ((e: MessageEvent<Req>) => void) | null; postMessage: (m: unknown, t?: Transferable[]) => void };

ctx.onmessage = (e) => {
  const { reqId, id, duration, sampleRate, loop } = e.data;
  try {
    const t0 = performance.now();
    const wav = musicWav(id, { duration, sampleRate, loop });
    ctx.postMessage({ reqId, wav, ms: performance.now() - t0 }, [wav]);
  } catch (err) {
    ctx.postMessage({ reqId, error: err instanceof Error ? err.message : String(err) });
  }
};
