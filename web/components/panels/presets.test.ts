import { describe, expect, it } from 'vitest';
import { makeVideoClip } from '@/lib/defaults';
import type { MediaAsset } from '@/lib/types';
import {
  CAPTION_PRESETS, TEXT_TEMPLATES, captionPreset, filterValue, filtersToCss, parseTimeInput, punchInKeyframes,
  retimeForSpeed, setFilter,
} from './presets';

const asset: MediaAsset = { id: 'a', kind: 'video', role: 'source', name: 'a', mime: 'video/mp4', size: 1, duration: 10 };

describe('presets', () => {
  it('todos os 6 presets de legenda existem', () => {
    expect(CAPTION_PRESETS.map((p) => p.id)).toEqual(['classic', 'bold-pop', 'karaoke', 'minimal', 'boxed', 'neon']);
    expect(captionPreset('neon').style.preset).toBe('neon');
  });
  it('modelos de texto criam TextClip no tempo pedido', () => {
    for (const t of TEXT_TEMPLATES) {
      const c = t.make(4.2);
      expect(c.type).toBe('text');
      expect(c.start).toBe(4.2);
      expect(c.text.length).toBeGreaterThan(0);
    }
  });
});

describe('filtros', () => {
  it('setFilter adiciona, troca e remove em 0', () => {
    let f = setFilter([], 'contrast', 0.3);
    expect(filterValue(f, 'contrast')).toBe(0.3);
    f = setFilter(f, 'contrast', -0.5);
    expect(f).toEqual([{ kind: 'contrast', value: -0.5 }]);
    expect(setFilter(f, 'contrast', 0)).toEqual([]);
  });
  it('filtersToCss combina preset e filtros', () => {
    expect(filtersToCss([], 'none')).toBe('none');
    expect(filtersToCss([{ kind: 'bw', value: 1 }], 'vibrant')).toContain('grayscale(1.00)');
  });
});

describe('velocidade', () => {
  it('mantém o mesmo trecho da mídia', () => {
    expect(retimeForSpeed({ duration: 10, speed: 1 }, 2)).toEqual({ speed: 2, duration: 5 });
    expect(retimeForSpeed({ duration: 5, speed: 2 }, 0.5)).toEqual({ speed: 0.5, duration: 20 });
  });
});

describe('punch-in', () => {
  it('gera keyframes relativos ao clipe no playhead', () => {
    const c = makeVideoClip(asset, 2);
    const k = punchInKeyframes(c, 5);
    expect(k[0]).toMatchObject({ t: 3, transform: { scale: 1 } });
    expect(k[1]).toMatchObject({ t: 3.12, transform: { scale: 1.25 } });
    expect(k.at(-1)!.transform.scale).toBe(1);
    expect(k.every((x, i) => i === 0 || x.t >= k[i - 1].t)).toBe(true);
  });
  it('preserva keyframes fora da janela', () => {
    const c = { ...makeVideoClip(asset, 0), keyframes: [{ t: 0, transform: { scale: 1.1 } }, { t: 3.2, transform: { scale: 2 } }] };
    const k = punchInKeyframes(c, 6);
    expect(k.some((x) => x.t === 0 && x.transform.scale === 1.1)).toBe(true);
    expect(k.some((x) => x.t === 3.2)).toBe(true);
  });
  it('não passa do fim do clipe', () => {
    const c = makeVideoClip(asset, 0, { duration: 1 });
    const k = punchInKeyframes(c, 0.9);
    expect(Math.max(...k.map((x) => x.t))).toBeLessThanOrEqual(1);
  });
});

describe('parseTimeInput', () => {
  it('aceita s, m:s e vírgula', () => {
    expect(parseTimeInput('62.5')).toBe(62.5);
    expect(parseTimeInput('1:02,5')).toBe(62.5);
    expect(parseTimeInput('x')).toBeNull();
    expect(parseTimeInput('')).toBeNull();
  });
});

import { SPEED_PRESETS, cropForRatio, meanSpeed, retimeForCurve } from './presets';

describe('curvas de velocidade', () => {
  it('média por trapézios', () => {
    expect(meanSpeed([{ t: 0, speed: 1 }, { t: 1, speed: 3 }])).toBe(2);
    expect(meanSpeed([])).toBe(1);
    expect(SPEED_PRESETS).toHaveLength(6);
  });
  it('mantém o trecho da mídia ao aplicar e remover', () => {
    const c = { duration: 10, speed: 1 };
    const r = retimeForCurve(c, [{ t: 0, speed: 2 }, { t: 1, speed: 2 }]);
    expect(r.duration).toBeCloseTo(5);
    const back = retimeForCurve({ ...c, duration: r.duration, speedCurve: r.speedCurve }, undefined);
    expect(back.duration).toBeCloseTo(10);
  });
});

describe('recorte', () => {
  it('centraliza na proporção', () => {
    expect(cropForRatio(1920, 1080, 1)).toEqual({ x: (1 - 0.5625) / 2, y: 0, w: 0.5625, h: 1 });
    expect(cropForRatio(1080, 1920, null)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    const c = cropForRatio(1080, 1080, 16 / 9);
    expect(c.w).toBe(1);
    expect(c.h).toBeCloseTo(0.5625);
  });
});
