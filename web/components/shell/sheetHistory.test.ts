import { beforeEach, describe, expect, it } from 'vitest';
import { useEditor } from '@/lib/store';
import { createProject } from '@/lib/defaults';
import { sheetConfirm, sheetReset } from './sheetHistory';

const setName = (n: string) => useEditor.getState().dispatch({ op: 'set_project', patch: { name: n } });

describe('ToolSheet com histórico cheio (B4)', () => {
  beforeEach(() => { useEditor.getState().loadProject(createProject({ name: 'início' })); });

  it('↺ volta ao estado da abertura mesmo com past saturado em 100', () => {
    for (let i = 0; i < 120; i++) setName(`n${i}`);
    expect(useEditor.getState().past.length).toBe(100);
    const before = useEditor.getState().project;
    setName('sheet-1'); setName('sheet-2'); setName('sheet-3');
    const patch = sheetReset(useEditor.getState(), before)!;
    useEditor.setState(patch);
    expect(useEditor.getState().project.name).toBe('n119');
    expect(useEditor.getState().future).toEqual([]);
  });

  it('✓ vira 1 desfazer mesmo com past saturado', () => {
    for (let i = 0; i < 120; i++) setName(`n${i}`);
    const before = useEditor.getState().project;
    setName('a'); setName('b'); setName('c');
    const patch = sheetConfirm(useEditor.getState(), before);
    if (patch) useEditor.setState(patch);
    expect(useEditor.getState().project.name).toBe('c');
    useEditor.getState().undo();
    expect(useEditor.getState().project.name).toBe('n119');
  });

  it('sem mudanças não mexe em nada', () => {
    const before = useEditor.getState().project;
    expect(sheetReset(useEditor.getState(), before)).toBeNull();
    expect(sheetConfirm(useEditor.getState(), before)).toBeNull();
  });
});
