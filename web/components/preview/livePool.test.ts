import { describe, it, expect, vi } from 'vitest';
import { LiveMediaPool } from './livePool';

describe('LiveMediaPool.destroy desmonta o grafo WebAudio (r2 #7)', () => {
  it('desconecta source/cadeia/ganho e para a cadeia', () => {
    const pool = new LiveMediaPool() as unknown as { routes: WeakMap<object, unknown>; destroy(el: object): void };
    const el = { pause: vi.fn(), removeAttribute: vi.fn(), load: vi.fn(), remove: vi.fn() };
    const route = { source: { disconnect: vi.fn() }, gain: { disconnect: vi.fn() }, chain: { output: { disconnect: vi.fn() }, stop: vi.fn() }, key: 'x' };
    pool.routes.set(el, route);
    pool.destroy(el);
    expect(route.source.disconnect).toHaveBeenCalled();
    expect(route.chain.output.disconnect).toHaveBeenCalled();
    expect(route.chain.stop).toHaveBeenCalled();
    expect(route.gain.disconnect).toHaveBeenCalled();
    expect(pool.routes.has(el)).toBe(false);
    expect(el.remove).toHaveBeenCalled();
  });
});

import { canSound, wantsRoute, perElementGesture } from './livePool';

describe('iOS: som por elemento (r2 #4)', () => {
  const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  const CRIOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1';
  const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
  const PIXEL = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';
  it('detecta WebKit com liberação por elemento', () => {
    expect(perElementGesture(IOS)).toBe(true);
    expect(perElementGesture(CRIOS)).toBe(true);
    expect(perElementGesture(MAC_SAFARI)).toBe(true);
    expect(perElementGesture(PIXEL)).toBe(false);
  });
  it('elemento criado depois do 1º toque fica MUDO no iOS até ser abençoado (antes: play com som recusado → travava)', () => {
    expect(canSound({ unlocked: true, blessed: false, perElement: true, refused: false })).toBe(false);
    expect(canSound({ unlocked: true, blessed: true, perElement: true, refused: false })).toBe(true);
    expect(canSound({ unlocked: true, blessed: false, perElement: false, refused: false })).toBe(true);
    expect(canSound({ unlocked: true, blessed: false, perElement: false, refused: true })).toBe(false);
    expect(canSound({ unlocked: false, blessed: true, perElement: false, refused: false })).toBe(false);
  });
  it('play com som recusado (NotAllowedError) cai para mudo e toca assim mesmo', async () => {
    const { LiveMediaPool } = await import('./livePool');
    const pool = new LiveMediaPool() as unknown as { play(el: object, now: number): void; refused: WeakSet<object> };
    let calls = 0;
    const el = { muted: false, play: vi.fn(() => { calls++; return calls === 1 ? Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' })) : Promise.resolve(); }) };
    pool.play(el, 0);
    await new Promise((r) => setTimeout(r, 0));
    expect(el.muted).toBe(true);
    expect(el.play).toHaveBeenCalledTimes(2);
    expect(pool.refused.has(el)).toBe(true);
  });
});

describe('iOS: volume só leitura → GainNode (r2 #5)', () => {
  const base = { hasCtx: true, routed: false, chain: false, volumeKf: false, gain: 1, volumeReadOnly: true };
  it('volume ≠ 1 (fade, ducking, volume do clipe) roteia pelo GainNode quando el.volume é só leitura', () => {
    expect(wantsRoute({ ...base, gain: 0.4 })).toBe(true);
    expect(wantsRoute({ ...base, gain: 1 })).toBe(false);
    expect(wantsRoute({ ...base, gain: 0.4, volumeReadOnly: false })).toBe(false); // desktop/Android: el.volume basta
    expect(wantsRoute({ ...base, gain: 0.4, hasCtx: false })).toBe(false);
    expect(wantsRoute({ ...base, routed: true, hasCtx: false })).toBe(true); // uma vez no grafo, fica
  });
});

describe('r3: GainNode novo nasce no ganho do clipe (sem estouro de volume cheio)', () => {
  const mkCtx = () => {
    const gains: { gain: { value: number; setTargetAtTime: ReturnType<typeof vi.fn>; setValueAtTime: ReturnType<typeof vi.fn>; cancelScheduledValues: ReturnType<typeof vi.fn> }; connect: ReturnType<typeof vi.fn> }[] = [];
    const ctx = {
      currentTime: 3,
      destination: {},
      createMediaElementSource: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() })),
      createGain: vi.fn(() => {
        // como no navegador: GainNode nasce com gain = 1
        const g = { gain: { value: 1, setTargetAtTime: vi.fn(), setValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() };
        gains.push(g);
        return g;
      }),
    };
    return { ctx, gains };
  };
  it('automação de volume começando em 0,2: o nó começa em 0,2 (antes: rampa de 1 → 0,2 = estalo alto)', async () => {
    const { LiveMediaPool } = await import('./livePool');
    const pool = new LiveMediaPool() as unknown as { actx: unknown; route(el: object, clip: object, gain: number): boolean };
    const { ctx, gains } = mkCtx();
    pool.actx = ctx;
    const el = { volume: 1 };
    const clip = { id: 'a', type: 'audio', assetId: 'x', start: 0, duration: 3, in: 0, speed: 1, volume: 1, keyframes: [{ t: 0, transform: {}, props: { volume: 0.2 } }, { t: 2, transform: {}, props: { volume: 1 } }] };
    expect(pool.route(el, clip, 0.2)).toBe(true);
    expect(gains).toHaveLength(1);
    const g = gains[0].gain;
    // nada de rampa partindo de 1 no nó recém-criado
    expect(g.setTargetAtTime).not.toHaveBeenCalled();
    expect(g.value).toBeCloseTo(0.2);
    // nos passos seguintes, rampa suave normal
    pool.route(el, clip, 0.3);
    expect(g.setTargetAtTime).toHaveBeenLastCalledWith(0.3, 3, expect.any(Number));
  });
  it('elemento mudo reaproveitado (pré-carga → clipe ativo): salta p/ o ganho novo em vez de rampa do anterior', async () => {
    const { LiveMediaPool } = await import('./livePool');
    const pool = new LiveMediaPool() as unknown as { actx: unknown; route(el: object, clip: object, gain: number): boolean };
    const { ctx, gains } = mkCtx();
    pool.actx = ctx;
    const el = { volume: 1, muted: false };
    const clip = { id: 'a', type: 'audio', assetId: 'x', start: 0, duration: 3, in: 0, speed: 1, volume: 1, keyframes: [{ t: 0, transform: {}, props: { volume: 1 } }] };
    pool.route(el, clip, 1);
    el.muted = true;
    pool.route(el, clip, 0.1);
    const g = gains[0].gain;
    expect(g.setValueAtTime).toHaveBeenLastCalledWith(0.1, 3);
    expect(g.setTargetAtTime).not.toHaveBeenCalled();
  });
});
