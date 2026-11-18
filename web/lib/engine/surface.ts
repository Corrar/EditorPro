/* canvases auxiliares reaproveitados (evita alocar a cada quadro) */
export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

export function makeCanvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, w); c.height = Math.max(1, h);
  return c;
}

const pool = new WeakMap<object, AnyCanvas[]>();

/** canvas temporário limpo de tamanho w×h, por dono + slot */
export function scratch(owner: object, w: number, h: number, slot: number): { c: AnyCanvas; ctx: Ctx } {
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  let list = pool.get(owner);
  if (!list) { list = []; pool.set(owner, list); }
  let c = list[slot];
  if (!c || c.width !== w || c.height !== h) {
    c = makeCanvas(w, h);
    list[slot] = c;
  }
  const ctx = c.getContext('2d') as Ctx;
  resetCtx(ctx);
  ctx.clearRect(0, 0, w, h);
  return { c, ctx };
}

export function resetCtx(ctx: Ctx) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.imageSmoothingEnabled = true;
}

/** pseudoaleatório determinístico (efeitos iguais no preview e no export) */
export function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

let noiseTile: AnyCanvas | null = null;
export function noise(): AnyCanvas {
  if (noiseTile) return noiseTile;
  const n = 160;
  const c = makeCanvas(n, n);
  const ctx = c.getContext('2d') as Ctx;
  const img = ctx.createImageData(n, n);
  let seed = 1234567;
  for (let i = 0; i < n * n; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const v = seed % 256;
    img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 110;
  }
  ctx.putImageData(img, 0, 0);
  noiseTile = c;
  return c;
}
