import { describe, it, expect } from 'vitest';
import {
  driftDecision, warmPosition, WARM_START, PlaybackClock, QualityGovernor, prerollPlan, frameReady, frameInterval,
  SEEK_DRIFT, KICK_GRACE_MS, MAX_HOLD_MS, PREROLL,
} from './syncPolicy';
import type { Project, VideoClip } from '@/lib/types';
import { createProject } from '@/lib/defaults';

const vclip = (id: string, start: number, duration: number, inPt: number): VideoClip => ({
  id, type: 'video', assetId: 'a1', start, duration, in: inPt, speed: 1, volume: 1,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, filters: [],
});

/** projeto "pós-IA": o MESMO asset cortado em 5 clipes por ripple_delete */
function rippleProject(): Project {
  const p = createProject({ name: 't', aspect: '9:16' });
  const v = p.tracks.find((t) => t.kind === 'video')!;
  v.clips = [0, 1, 2, 3, 4].map((i) => vclip('c' + i, i * 5, 5, i * 6.5));
  return p;
}

describe('driftDecision (sincronia sem seek a cada desvio)', () => {
  it('desvio pequeno não faz seek', () => {
    expect(driftDecision({ drift: 0.2, rate: 1, sinceKickMs: 5000, lead: false }).seek).toBe(false);
    expect(driftDecision({ drift: -0.4, rate: 1, sinceKickMs: 5000, lead: true }).seek).toBe(false);
  });
  it('secundário atrasado acelera, adiantado desacelera (até ±5%)', () => {
    expect(driftDecision({ drift: 0.2, rate: 1, sinceKickMs: 5000, lead: false }).rate).toBeCloseTo(1.05);
    expect(driftDecision({ drift: -0.12, rate: 1, sinceKickMs: 5000, lead: false }).rate).toBeCloseTo(0.97);
    expect(driftDecision({ drift: 0.01, rate: 2, sinceKickMs: 5000, lead: false }).rate).toBe(2);
  });
  it('principal nunca recebe ajuste de velocidade (o relógio o segue)', () => {
    expect(driftDecision({ drift: 0.3, rate: 1.5, sinceKickMs: 5000, lead: true }).rate).toBe(1.5);
  });
  it(`desvio > ${SEEK_DRIFT}s faz seek, mas só depois da carência de play/seek`, () => {
    expect(driftDecision({ drift: 0.8, rate: 1, sinceKickMs: KICK_GRACE_MS - 1, lead: true }).seek).toBe(false);
    expect(driftDecision({ drift: 0.8, rate: 1, sinceKickMs: KICK_GRACE_MS, lead: true }).seek).toBe(true);
  });
  it('desvio enorme (seek do usuário) faz seek na hora', () => {
    expect(driftDecision({ drift: 5, rate: 1, sinceKickMs: 0, lead: false }).seek).toBe(true);
  });
});

describe('PlaybackClock', () => {
  it('sem vídeo principal avança com o tempo de parede', () => {
    const c = new PlaybackClock();
    c.reset(2, 1000);
    let t = 0;
    for (let w = 1100; w <= 1500; w += 100) t = c.tick(w, null);
    expect(t).toBeCloseTo(2.5);
  });
  it('converge para o tempo do vídeo sem saltos', () => {
    const c = new PlaybackClock();
    c.reset(0, 0);
    let t = 0;
    for (let i = 1; i <= 60; i++) t = c.tick(i * 33, { videoT: i * 0.033 - 0.2, stalled: false });
    expect(Math.abs(t - (60 * 0.033 - 0.2))).toBeLessThan(0.02);
  });
  it('segura o relógio enquanto o vídeo engasga (até o limite) e depois segue', () => {
    const c = new PlaybackClock();
    c.reset(10, 0);
    expect(c.tick(100, { videoT: 10, stalled: true })).toBe(10);
    expect(c.tick(300, { videoT: 10, stalled: true })).toBe(10);
    // passa do limite: volta a andar (o último quadro fica na tela, sem preto)
    let t = 10;
    for (let w = 400; w <= 1400; w += 100) t = c.tick(w, { videoT: 10, stalled: true });
    expect(t).toBeGreaterThan(10);
    expect(MAX_HOLD_MS).toBeLessThanOrEqual(800);
  });
  it('ignora pausas longas da aba (salto máximo de 250 ms por tick)', () => {
    const c = new PlaybackClock();
    c.reset(0, 0);
    expect(c.tick(10_000, null)).toBeCloseTo(0.25);
  });
});

describe('QualityGovernor (histerese: sem alternar e sem redimensionar à toa)', () => {
  it('quadros baratos nunca reduzem', () => {
    const g = new QualityGovernor();
    for (let i = 0; i < 300; i++) expect(g.push(10, i * 33)).toBeNull();
    expect(g.factor).toBe(1);
  });
  it('um pico isolado não reduz', () => {
    const g = new QualityGovernor();
    for (let i = 0; i < 300; i++) expect(g.push(i === 100 ? 200 : 10, i * 33)).toBeNull();
  });
  it('custo alto sustentado reduz UM degrau e não oscila', () => {
    const g = new QualityGovernor();
    const changes: number[] = [];
    for (let i = 0; i < 900; i++) { const q = g.push(45, i * 33); if (q !== null) changes.push(q); }
    expect(changes).toEqual([0.75]);
  });
  it('só volta depois de muito tempo folgado', () => {
    const g = new QualityGovernor();
    let i = 0;
    for (; i < 200; i++) g.push(45, i * 33);
    expect(g.factor).toBe(0.75);
    const changes: number[] = [];
    for (let k = 0; k < 120; k++, i++) { const q = g.push(5, i * 33); if (q !== null) changes.push(q); }
    expect(changes).toEqual([]); // < 4 s folgado: ainda não volta
    for (let k = 0; k < 400; k++, i++) { const q = g.push(5, i * 33); if (q !== null) changes.push(q); }
    expect(changes).toEqual([1]);
  });
});

describe('prerollPlan (pré-carga do próximo clipe do mesmo asset)', () => {
  it(`lista o próximo clipe ~${PREROLL}s antes do corte`, () => {
    const p = rippleProject();
    expect(prerollPlan(p, 3).map((x) => x.clip.id)).toEqual([]);
    expect(prerollPlan(p, 4.2).map((x) => x.clip.id)).toEqual(['c1']);
    expect(prerollPlan(p, 9.5).map((x) => x.clip.id)).toEqual(['c2']);
  });
  it('não inclui o clipe que já está tocando', () => {
    const p = rippleProject();
    expect(prerollPlan(p, 5).map((x) => x.clip.id)).toEqual([]);
  });
  it('ignora trilha de vídeo oculta, inclui áudio', () => {
    const p = rippleProject();
    p.tracks.find((t) => t.kind === 'video')!.hidden = true;
    expect(prerollPlan(p, 4.5)).toEqual([]);
  });
});

describe('frameReady / frameInterval', () => {
  it('sem dados ou buscando longe do alvo não desenha (evita quadro preto/errado)', () => {
    expect(frameReady({ readyState: 1, seeking: false, currentTime: 2 }, 2)).toBe(false);
    expect(frameReady({ readyState: 4, seeking: true, currentTime: 0 }, 6.5)).toBe(false);
    expect(frameReady({ readyState: 4, seeking: true, currentTime: 6.45 }, 6.5)).toBe(true);
    expect(frameReady({ readyState: 2, seeking: false, currentTime: 6.5 }, 6.5)).toBe(true);
  });
  it('desenha no fps do projeto (tela de 90/120 Hz não redesenha à toa)', () => {
    expect(frameInterval(30)).toBeCloseTo(1000 / 30 - 4);
    expect(frameInterval(undefined)).toBeCloseTo(1000 / 30 - 4);
    expect(frameInterval(240)).toBeCloseTo(1000 / 60 - 4);
  });
});

describe('warmPosition (partida a quente do próximo clipe)', () => {
  it('antes da janela: pausado um pouco antes da entrada', () => {
    expect(warmPosition(6.5, 1, 1, false)).toEqual({ at: 6.5 - WARM_START, play: false });
  });
  it('na janela: tocando e chega na entrada exatamente no corte', () => {
    const w = warmPosition(6.5, 0.2, 1, false);
    expect(w.play).toBe(true);
    expect(w.at).toBeCloseTo(6.3);
    // posição pausada + avanço na janela = entrada (sem seek na transição pausado → tocando)
    expect(warmPosition(6.5, WARM_START, 1, false).at).toBeCloseTo(6.5 - WARM_START);
  });
  it('respeita a velocidade do clipe', () => {
    expect(warmPosition(10, 0.1, 2, false).at).toBeCloseTo(9.8);
  });
  it('entrada no começo da mídia ou reverso: só pausado na entrada', () => {
    expect(warmPosition(0.1, 0.2, 1, false)).toEqual({ at: 0.1, play: false });
    expect(warmPosition(5, 0.2, 1, true)).toEqual({ at: 5, play: false });
  });
});

describe('frameReady com prova de quadro (rVFC) — Android: seeked antes do quadro', () => {
  const el = { readyState: 4, seeking: false, currentTime: 6.5 };
  it('sem rVFC confia no readyState', () => {
    expect(frameReady(el, 6.5)).toBe(true);
  });
  it('seeked chegou mas nenhum quadro apresentado ainda → espera', () => {
    expect(frameReady(el, 6.5, { presented: undefined, sinceSettleMs: 50 })).toBe(false);
  });
  it('quadro perto do alvo apresentado → pronto', () => {
    expect(frameReady(el, 6.5, { presented: 6.48, sinceSettleMs: 10 })).toBe(true);
  });
  it('quadro apresentado é de outro ponto (seek anterior) → espera', () => {
    expect(frameReady(el, 6.5, { presented: 2, sinceSettleMs: 100 })).toBe(false);
  });
  it('rede de segurança: sem rVFC por muito tempo, segue com o readyState', () => {
    expect(frameReady(el, 6.5, { presented: undefined, sinceSettleMs: 500 })).toBe(true);
  });
  it('seek pedido e ainda sem seeked (sinceSettle negativo) → espera', () => {
    expect(frameReady(el, 6.5, { presented: undefined, sinceSettleMs: -1900 })).toBe(false);
  });
  it('não regride: readyState baixo depois do seek continua bloqueando', () => {
    expect(frameReady({ readyState: 1, seeking: true, currentTime: 0 }, 6.5, { presented: 6.5, sinceSettleMs: 9999 })).toBe(false);
  });
});
