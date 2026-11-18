/* utilitários pequenos e puros, usados por todos os módulos */

let counter = 0;
export function uid(prefix = 'id'): string {
  counter = (counter + 1) % 1_000_000;
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rnd}`;
}

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** 75.4 -> "1:15.4" (curto) ou "01:15:12" com frames se fps informado */
export function formatTime(sec: number, opts: { fps?: number; decimals?: boolean } = {}): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  if (opts.fps) {
    const f = Math.floor((r - Math.floor(r)) * opts.fps);
    return `${String(m).padStart(2, '0')}:${String(Math.floor(r)).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
  }
  if (opts.decimals) return `${m}:${r.toFixed(1).padStart(4, '0')}`;
  return `${m}:${String(Math.floor(r)).padStart(2, '0')}`;
}

export function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}
