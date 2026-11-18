/* =====================================================================
   Timeline — utilidades puras sobre clipes (asset, selos de estado).
   ===================================================================== */
import type { Clip, Id, MediaAsset } from '../types';

/** assetId do clipe (sticker pode não ter; texto/forma/ajuste não têm) */
export function assetIdOf(c: Clip): Id | undefined {
  return 'assetId' in c ? c.assetId : undefined;
}

export function assetOf(c: Clip, assets: Record<Id, MediaAsset>): MediaAsset | undefined {
  const id = assetIdOf(c);
  return id ? assets[id] : undefined;
}

const PRESET_NAMES: Record<string, string> = {
  montage: 'montagem', hero: 'herói', bullet: 'bala', 'jump-cut': 'jump cut', 'flash-in': 'flash in', 'flash-out': 'flash out',
};

export interface ClipBadges {
  /** "2x", "0.5x", "curva", "herói"… */
  speed?: string;
  reverse?: boolean;
  /** nº de efeitos visuais + de áudio */
  effects?: number;
  mask?: boolean;
  chroma?: boolean;
  keyframes?: number;
}

export function clipBadges(c: Clip): ClipBadges {
  const b: ClipBadges = {};
  if (c.type === 'video' || c.type === 'audio') {
    if (c.speedPreset) b.speed = PRESET_NAMES[c.speedPreset] ?? 'curva';
    else if (c.speedCurve?.length) b.speed = 'curva';
    else if (c.speed && Math.abs(c.speed - 1) > 1e-3) b.speed = `${+c.speed.toFixed(2)}x`;
    if (c.reverse) b.reverse = true;
    const n = (c.type === 'video' ? c.effects?.length ?? 0 : 0) + (c.audioEffects?.length ?? 0);
    if (n) b.effects = n;
  }
  if (c.type === 'image' || c.type === 'sticker' || c.type === 'shape') {
    if (c.effects?.length) b.effects = c.effects.length;
  }
  if (c.type === 'adjustment') {
    const n = (c.effects?.length ?? 0) + c.filters.length + (c.colorPreset && c.colorPreset !== 'none' ? 1 : 0);
    if (n) b.effects = n;
  }
  if ('mask' in c && c.mask) b.mask = true;
  if ('chromaKey' in c && c.chromaKey) b.chroma = true;
  const kf = (c as { keyframes?: unknown[] }).keyframes;
  if (kf?.length) b.keyframes = kf.length;
  return b;
}
