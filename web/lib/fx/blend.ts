/* modos de mesclagem → globalCompositeOperation do canvas (todos nativos do canvas 2D) */
import type { BlendMode } from '../types';
import { BLEND_CATALOG } from './catalog';

export const BLEND_OPS = Object.fromEntries(BLEND_CATALOG.map((b) => [b.kind, b.op])) as Record<BlendMode, GlobalCompositeOperation>;

export function blendOp(mode: BlendMode | undefined): GlobalCompositeOperation {
  return (mode && BLEND_OPS[mode]) || 'source-over';
}
