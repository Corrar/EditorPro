/* Edição ao vivo da IA (applyLive) × ações do usuário no meio dela. */
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditor } from './store';
import { createProject, makeTextClip } from './defaults';
import type { EditOp } from './ops';
import { sleep } from './util';

const textOp = (id: string, start: number): EditOp => ({ op: 'add_clip', trackId: 'track_text_1', clip: { ...makeTextClip(id, start, 1), id } });
const textIds = () => useEditor.getState().project.tracks.flatMap((t) => t.clips).filter((c) => c.type === 'text').map((c) => c.id);

beforeEach(() => {
  useEditor.getState().cancelLive();
  useEditor.getState().loadProject(createProject({ name: 'A' }));
});

describe('applyLive', () => {
  it('aplica tudo como UM passo de desfazer', async () => {
    await useEditor.getState().applyLive([textOp('a', 0), textOp('b', 1)], { delayMs: 4 });
    expect(textIds()).toEqual(['a', 'b']);
    useEditor.getState().undo();
    expect(textIds()).toEqual([]);
  });

  it('abrir outro projeto no meio para a IA: nada cai no projeto novo e o histórico dele fica limpo', async () => {
    const run = useEditor.getState().applyLive([textOp('a', 0), textOp('b', 1), textOp('c', 2), textOp('d', 3)], { delayMs: 20 });
    await sleep(25);
    const novo = createProject({ name: 'B' });
    useEditor.getState().loadProject(novo);
    await run;
    const st = useEditor.getState();
    expect(st.project.id).toBe(novo.id);
    expect(textIds()).toEqual([]);
    expect(st.past).toEqual([]);
    expect(st.live.running).toBe(false);
  });

  it('"Parar" no meio do passo não aplica a op que estava esperando', async () => {
    const run = useEditor.getState().applyLive([textOp('a', 0), textOp('b', 1)], { delayMs: 40 });
    await sleep(5); // dentro da 1ª espera (antes de aplicar 'a')
    useEditor.getState().cancelLive();
    await run;
    expect(textIds()).toEqual([]);
  });

  it('desfazer no meio da IA para a edição e volta ao estado de antes dela (sem perder a edição manual anterior)', async () => {
    useEditor.getState().dispatch(textOp('m', 5));
    const run = useEditor.getState().applyLive([textOp('a', 0), textOp('b', 1), textOp('c', 2)], { delayMs: 20 });
    await sleep(35); // 'a' já aplicado
    expect(textIds()).toContain('a');
    useEditor.getState().undo();
    await run;
    expect(textIds()).toEqual(['m']);
    // o desfazer seguinte tira a edição manual; refazer devolve o que a IA tinha feito
    useEditor.getState().undo();
    expect(textIds()).toEqual([]);
    useEditor.getState().redo();
    expect(textIds()).toEqual(['m']);
    useEditor.getState().redo();
    expect(textIds()).toContain('a');
  });

  it('editar à mão no meio para a IA e mantém as duas coisas no histórico', async () => {
    const run = useEditor.getState().applyLive([textOp('a', 0), textOp('b', 1), textOp('c', 2)], { delayMs: 20 });
    await sleep(35);
    useEditor.getState().dispatch(textOp('m', 5));
    await run;
    const ids = textIds();
    expect(ids).toContain('m');
    expect(ids).not.toContain('c');
    useEditor.getState().undo(); // tira a edição manual
    expect(textIds()).not.toContain('m');
    useEditor.getState().undo(); // tira o lote da IA
    expect(textIds()).toEqual([]);
  });
});
