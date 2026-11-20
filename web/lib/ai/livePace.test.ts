/* Ritmo ao vivo de lotes grandes: as primeiras ops uma a uma, o resto agrupado (≤ ~8 s no total). */
import { beforeEach, describe, expect, it } from 'vitest';
import type { EditOp } from '../ops';
import { useEditor } from '../store';
import { createProject, makeTextClip } from '../defaults';
import { sleep } from '../util';
import { groupLabel, LIVE_BUDGET_MS, liveStepDelay, planLiveSteps } from './livePace';
import { AI_CURSOR_STEP_MS } from '../aiCursor';
import { FAST_STEP_MS } from './chatStore';

const cut = (i: number): EditOp => ({ op: 'ripple_delete', start: i, end: i + 0.2, explain: `Corte ${i}` });
const zoom = (i: number): EditOp => ({ op: 'update_clip', clipId: `c${i}`, patch: { keyframes: [] }, explain: `Zoom ${i}` });
const color = (i: number): EditOp => ({ op: 'update_clip', clipId: `c${i}`, patch: { colorPreset: 'warm' }, explain: `Cor ${i}` });
/** lote típico da 1ª edição: 2 pausas + 19 cortes no ritmo + 22 movimentos + 1 legenda */
const firstEdit = (): EditOp[] => [
  ...Array.from({ length: 21 }, (_, i) => cut(i)),
  ...Array.from({ length: 22 }, (_, i) => zoom(i)),
  { op: 'set_caption_style', style: { maxWords: 3 }, explain: 'Legenda' },
];
const total = (ops: EditOp[], base: number) => {
  const plan = planLiveSteps(ops, base);
  return plan.steps.reduce((n, _, k) => n + liveStepDelay(plan, k, base), 0);
};

describe('planLiveSteps', () => {
  it('lote pequeno: uma op por passo com a pausa cheia (o cursor da IA passa por todas)', () => {
    const ops = [cut(1), zoom(1), color(1), cut(2), zoom(2)];
    const plan = planLiveSteps(ops, AI_CURSOR_STEP_MS);
    expect(plan.steps).toEqual([[0], [1], [2], [3], [4]]);
    expect(plan.steps.map((_, k) => liveStepDelay(plan, k, AI_CURSOR_STEP_MS))).toEqual([900, 900, 900, 900, 900]);
  });

  it('44 ops no ritmo normal (900 ms): antes 39,6 s de pausas, agora ≤ 8 s; as primeiras uma a uma', () => {
    const ops = firstEdit();
    expect(ops.length * AI_CURSOR_STEP_MS).toBeGreaterThan(39000); // como era
    const plan = planLiveSteps(ops, AI_CURSOR_STEP_MS);
    expect(plan.full).toBeGreaterThanOrEqual(3);
    expect(plan.steps.slice(0, plan.full).every((g) => g.length === 1)).toBe(true);
    expect(plan.steps.length).toBeLessThanOrEqual(plan.full + 8);
    expect(total(ops, AI_CURSOR_STEP_MS)).toBeLessThanOrEqual(LIVE_BUDGET_MS + 1);
    expect(total(ops, AI_CURSOR_STEP_MS)).toBeLessThanOrEqual(8000);
  });

  it('"Mais rápido" (350 ms): até 8 ops uma a uma e o lote todo ainda mais curto', () => {
    const ops = firstEdit();
    const plan = planLiveSteps(ops, FAST_STEP_MS);
    expect(plan.full).toBe(8);
    expect(total(ops, FAST_STEP_MS)).toBeLessThan(total(ops, AI_CURSOR_STEP_MS));
  });

  it('é uma partição em ordem (nenhuma op some, repete ou troca de lugar) e agrupa por tipo', () => {
    const ops = firstEdit();
    const plan = planLiveSteps(ops, AI_CURSOR_STEP_MS);
    expect(plan.steps.flat()).toEqual(ops.map((_, i) => i));
    // depois das primeiras, os cortes ficam juntos e os movimentos juntos
    const groups = plan.steps.slice(plan.full).map((g) => new Set(g.map((i) => ops[i].op === 'update_clip' ? 'motion' : ops[i].op)));
    expect(groups.every((s) => s.size === 1)).toBe(true);
  });

  it('tipos alternados (muitos grupos pequenos) viram no máximo 8 passos agrupados', () => {
    const ops = Array.from({ length: 60 }, (_, i) => (i % 3 === 0 ? cut(i) : i % 3 === 1 ? zoom(i) : color(i)));
    const plan = planLiveSteps(ops, AI_CURSOR_STEP_MS);
    expect(plan.steps.length - plan.full).toBeLessThanOrEqual(8);
    expect(plan.steps.flat()).toEqual(ops.map((_, i) => i));
    expect(total(ops, AI_CURSOR_STEP_MS)).toBeLessThanOrEqual(8000);
  });

  it('centenas de ops (run_script) continuam ≤ 8 s', () => {
    const ops = Array.from({ length: 400 }, (_, i) => cut(i));
    expect(total(ops, AI_CURSOR_STEP_MS)).toBeLessThanOrEqual(8000);
  });

  it('rótulo do passo agrupado diz o que muda', () => {
    expect(groupLabel([cut(1), cut(2), cut(3)])).toBe('3 cortes');
    expect(groupLabel([zoom(1), zoom(2)])).toBe('Movimento em 2 tomadas');
    expect(groupLabel([cut(1), zoom(2)])).toBe('Mais 2 ajustes de uma vez');
    expect(groupLabel([cut(7)])).toBe('Corte 7');
  });
});

describe('applyLive com passos agrupados', () => {
  const textOp = (id: string, start: number): EditOp => ({ op: 'add_clip', trackId: 'track_text_1', clip: { ...makeTextClip(id, start, 1), id } });
  const textIds = () => useEditor.getState().project.tracks.flatMap((t) => t.clips).filter((c) => c.type === 'text').map((c) => c.id);
  beforeEach(() => {
    useEditor.getState().cancelLive();
    useEditor.getState().loadProject(createProject({ name: 'A' }));
  });

  it('aplica o grupo num passo, avisa cada op e continua sendo UM desfazer', async () => {
    const seen: number[] = [];
    const ids = await useEditor.getState().applyLive([textOp('a', 0), textOp('b', 1), textOp('c', 2), textOp('d', 3)], { delayMs: 2, steps: [[0], [1, 2, 3]], onStep: (_o, i) => seen.push(i) });
    expect(ids).toHaveLength(4);
    expect(seen).toEqual([0, 1, 2, 3]);
    expect(textIds()).toEqual(['a', 'b', 'c', 'd']);
    expect(useEditor.getState().live.done).toBe(4);
    useEditor.getState().undo();
    expect(textIds()).toEqual([]);
  });

  it('"Parar" na espera do grupo não aplica nenhuma op dele', async () => {
    const run = useEditor.getState().applyLive([textOp('a', 0), textOp('b', 1), textOp('c', 2)], { delayMs: (k) => (k === 0 ? 4 : 60), steps: [[0], [1, 2]] });
    await sleep(25); // 'a' aplicado; dentro da espera do grupo
    useEditor.getState().cancelLive();
    await run;
    expect(textIds()).toEqual(['a']);
    useEditor.getState().undo();
    expect(textIds()).toEqual([]);
  });

  it('a pausa recebe o índice do passo (ritmo adaptativo)', async () => {
    const asked: [number, number][] = [];
    await useEditor.getState().applyLive([textOp('a', 0), textOp('b', 1), textOp('c', 2)], { delayMs: (k, n) => { asked.push([k, n]); return 0; }, steps: [[0], [1, 2]] });
    expect(asked).toEqual([[0, 2], [0, 2], [1, 2], [1, 2]]);
  });
});
