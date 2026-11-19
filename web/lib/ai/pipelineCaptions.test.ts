/* legendas no pipeline: só a fala de verdade, motivo real quando falha, origem gravada, legenda antiga refeita */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ transcribe: vi.fn(), status: { configured: false, provider: 'demo', transcribe: null } as Record<string, unknown> }));
vi.mock('./whisper', async (orig) => ({ ...(await orig<typeof import('./whisper')>()), transcribeMedia: h.transcribe, chooseWhisper: async () => ({ model: 'm', device: 'wasm', dtype: 'q8', sizeMB: 77, label: 'Whisper base' }) }));
vi.mock('./client', async (orig) => ({ ...(await orig<typeof import('./client')>()), getStatus: async () => h.status }));

import { useEditor } from '../store';
import { applyOps, type EditOp } from '../ops';
import { createProject, makeVideoClip } from '../defaults';
import type { CaptionSegment, MediaAsset, Project } from '../types';
import { chatEdit, generateCaptions, type PipelineOptions } from './pipeline';
import { demoCaptions } from './demo';

const src: MediaAsset = { id: 'a1', kind: 'video', role: 'source', name: 'fala.mp4', mime: 'video/mp4', size: 1, duration: 20, url: 'blob:fala' };
const base = (brief = ''): Project => applyOps({ ...createProject(), brief }, [{ op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(src, 0, { duration: 20 }), id: 'c1' } }] as EditOp[]).project;
let n = 0;
const reset = (p = base()) => {
  // url nova a cada teste: o cache de transcrição (por id|url) não vaza entre testes
  const asset = { ...src, url: `blob:fala${++n}` };
  useEditor.setState({ project: p, past: [], future: [], assets: { a1: asset }, messages: [], live: { running: false, done: 0, total: 0 } });
};
const applied: EditOp[][] = [];
const opts = (extra: Partial<PipelineOptions> = {}): PipelineOptions => ({
  apply: async (ops) => { applied.push(ops); useEditor.getState().dispatch(ops); return ops.map((o) => o.id ?? ''); },
  ...extra,
});
const speech: CaptionSegment[] = [
  { id: 's1', start: 1, end: 2.4, text: 'Oi gente, hoje eu', words: [{ start: 1, end: 1.3, text: 'Oi' }, { start: 1.35, end: 1.8, text: 'gente,' }, { start: 2, end: 2.2, text: 'hoje' }, { start: 2.2, end: 2.4, text: 'eu' }] },
];

beforeEach(() => { applied.length = 0; h.transcribe.mockReset(); h.status = { configured: false, provider: 'demo', transcribe: null }; });

describe('generateCaptions', () => {
  it('transcrição falhou: nenhuma legenda, motivo real e botão de tentar de novo', async () => {
    reset();
    h.transcribe.mockRejectedValue(new Error('sem memória para o modelo'));
    const r = await generateCaptions(opts());
    expect(r.ops).toEqual([]);
    expect(applied.flat().some((o) => o.op === 'set_captions')).toBe(false);
    expect(r.reply).toMatch(/sem memória para o modelo/);
    expect(r.reply).toMatch(/inventada não serve/);
    expect(r.actions?.map((a) => a.id)).toContain('captions:retry');
    expect(useEditor.getState().project.captions.segments).toEqual([]);
  });

  it('sem fala: diz que não achou fala (não inventa)', async () => {
    reset();
    h.transcribe.mockResolvedValue([]);
    const r = await generateCaptions(opts());
    expect(r.ops).toEqual([]);
    expect(r.reply).toMatch(/Não encontrei fala/);
  });

  it('"Pular transcrição": diz que foi pulada', async () => {
    reset();
    const ctrl = new AbortController();
    h.transcribe.mockImplementation(async () => { ctrl.abort(); throw new DOMException('Transcrição cancelada', 'AbortError'); });
    const r = await generateCaptions(opts({ skippable: (l) => (l ? ctrl.signal : undefined) }));
    expect(r.ops).toEqual([]);
    expect(r.reply).toMatch(/pulada/);
  });

  it('CC desligado (sem servidor): diz isso e oferece ligar', async () => {
    reset();
    const r = await generateCaptions(opts({ whisper: false }));
    expect(h.transcribe).not.toHaveBeenCalled();
    expect(r.reply).toMatch(/CC/);
    expect(r.actions?.[0].id).toBe('captions:cc');
  });

  it('sucesso: grava origem "transcription" e o modelo, e conta de onde veio', async () => {
    reset();
    const logs: string[] = [];
    h.transcribe.mockImplementation(async (_a, o) => { o.onInfo?.({ mode: 'local', label: 'Whisper base' }); return speech; });
    const r = await generateCaptions(opts({ onLog: (l) => logs.push(l) }));
    const c = useEditor.getState().project.captions;
    expect(c.source).toBe('transcription');
    expect(c.model).toBe('Whisper base');
    expect(c.segments.flatMap((s) => s.words!.map((w) => w.text)).join(' ')).toBe('Oi gente, hoje eu');
    expect(logs.join('\n')).toMatch(/no aparelho \(Whisper base/);
    expect(r.reply).toMatch(/Pronto/);
  });

  it('servidor: rótulo de alta precisão no chat', async () => {
    reset();
    h.status = { configured: false, provider: 'demo', transcribe: 'groq' };
    const logs: string[] = [];
    h.transcribe.mockImplementation(async (_a, o) => { o.onInfo?.({ mode: 'server', label: 'Groq whisper-large-v3-turbo' }); return speech; });
    await generateCaptions(opts({ onLog: (l) => logs.push(l) }));
    expect(logs.join('\n')).toMatch(/alta precisão \(Groq whisper-large-v3-turbo\).*enviado/);
    expect(useEditor.getState().project.captions.model).toBe('Groq whisper-large-v3-turbo');
  });
});

describe('legenda antiga de exemplo (salva no IndexedDB)', () => {
  it('"coloque legenda" com a legenda antiga do pedido: retranscreve e troca pela fala', async () => {
    const brief = 'Faça um vídeo dinâmico para o TikTok com legendas amarelas sobre a minha padaria';
    const p0 = base(brief);
    const fake = applyOps(p0, [{ op: 'set_captions', segments: demoCaptions(p0, { a1: [{ start: 0.5, end: 6 }, { start: 7, end: 12 }, { start: 13, end: 19 }] }, brief) }]).project;
    reset(fake);
    h.transcribe.mockResolvedValue(speech);
    const r = await chatEdit('coloque legenda no vídeo', opts());
    expect(h.transcribe).toHaveBeenCalled();
    expect(r.reply).toMatch(/Refiz as legendas pela fala/);
    const text = useEditor.getState().project.captions.segments.map((s) => s.text).join(' ');
    expect(text).toBe('Oi gente, hoje eu');
    expect(text).not.toMatch(/padaria/);
  });

  it('legenda transcrita de verdade não é refeita por "coloque legenda"', async () => {
    reset();
    h.transcribe.mockResolvedValue(speech);
    await generateCaptions(opts());
    h.transcribe.mockClear();
    await chatEdit('coloque legenda no vídeo', opts()).catch(() => null);
    expect(h.transcribe).not.toHaveBeenCalled();
  });
});
