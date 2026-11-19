import { afterEach, describe, expect, it } from 'vitest';
import { applyOps, type EditOp } from '../ops';
import { createProject, makeVideoClip } from '../defaults';
import type { ImageClip, MediaAsset, Project, TextClip } from '../types';
import { runSandboxed } from './script/sandbox';
import { runScript, scriptInput } from './script/run';
import { sanitizeOps } from './validate';
import { sanitizeSvg, sanitizeSvgString, rasterSize, svgSize } from './svg';
import { finalizeClaude, filterShaders, graphicTrack } from './finalize';
import { __setCustomShaderModule } from './optional';
import type { EditRequest, EditResponse } from './client';

const src: MediaAsset = { id: 'a1', kind: 'video', role: 'source', name: 'b.mp4', mime: 'video/mp4', size: 1, duration: 20 };
const assets: Record<string, MediaAsset> = { a1: src };
const base = (): Project => applyOps(createProject(), [
  { op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(src, 0), id: 'c1', duration: 10 } },
  { op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(src, 10), id: 'c2', duration: 10, in: 10 } },
] as EditOp[]).project;
const input = () => scriptInput(base(), assets);

afterEach(() => __setCustomShaderModule(undefined));

describe('run_script: sandbox', () => {
  it('gera ops pela API ep (contador 0→100 em textos) e elas passam na validação', () => {
    const r = runSandboxed(`for (let i = 0; i <= 100; i += 10) ep.text({ text: String(i), start: i / 10, duration: 1 });`, input());
    expect('ops' in r).toBe(true);
    if (!('ops' in r)) return;
    expect(r.ops).toHaveLength(11);
    const s = sanitizeOps(r.ops, base(), assets, 3000);
    expect(s.dropped).toEqual([]);
    expect(s.project.tracks.flatMap((t) => t.clips).filter((c) => c.type === 'text').map((c) => (c as TextClip).text)).toContain('100');
  });

  it('rede e armazenamento bloqueados: fetch/XMLHttpRequest/WebSocket/importScripts são undefined', () => {
    for (const g of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'BroadcastChannel', 'self', 'globalThis']) {
      const r = runSandboxed(`if (typeof ${g} !== 'undefined') throw new Error('vazou ${g}');`, input());
      expect(r).not.toHaveProperty('error');
    }
    const r = runSandboxed(`fetch('https://exemplo.com')`, input());
    expect(r).toHaveProperty('error');
  });

  it('erro de execução volta com a linha', () => {
    const r = runSandboxed(`const a = 1;\nconst b = 2;\nnaoExiste();`, input());
    expect(r).toHaveProperty('error');
    if ('error' in r) { expect(r.error).toMatch(/naoExiste/); expect(r.line).toBe(3); }
  });

  it('array devolvido vira ops; limite de ops respeitado', () => {
    const r = runSandboxed(`return [{ op: 'remove_clip', clipId: 'c2', explain: 'x' }];`, input());
    expect(r).toMatchObject({ ops: [{ op: 'remove_clip', clipId: 'c2' }] });
    const big = runSandboxed(`for (let i = 0; i < 10; i++) ep.remove('c1');`, input(), 5);
    expect(big).toHaveProperty('error');
  });

  it('op inválida gerada pelo script cai na validação (com motivo)', () => {
    const r = runSandboxed(`ep.update('nao-existe', { volume: 0.5 }); ep.update('c1', { volume: 0.5 });`, input());
    if (!('ops' in r)) throw new Error('falhou');
    const s = sanitizeOps(r.ops, base(), assets, 3000);
    expect(s.ops).toHaveLength(1);
    expect(s.dropped).toHaveLength(1);
  });

  it('timeout: termina o Worker e devolve erro', async () => {
    let terminated = false;
    const fake = { onmessage: null as ((ev: MessageEvent) => void) | null, onerror: null as ((ev: Event) => void) | null, postMessage() { /* nunca responde (laço infinito) */ }, terminate() { terminated = true; } };
    const r = await runScript('while(true){}', base(), assets, { timeoutMs: 50, makeWorker: () => fake });
    expect(r).toHaveProperty('error');
    expect(terminated).toBe(true);
  });

  it('o Worker de verdade roda a mesma função (fábrica injetada que executa runSandboxed)', async () => {
    const fake = {
      onmessage: null as ((ev: MessageEvent) => void) | null, onerror: null as ((ev: Event) => void) | null,
      postMessage(m: { code: string; input: ReturnType<typeof scriptInput>; maxOps: number }) { setTimeout(() => this.onmessage?.({ data: runSandboxed(m.code, m.input, m.maxOps) } as MessageEvent), 0); },
      terminate() { /* ok */ },
    };
    const r = await runScript(`ep.words().length; ep.remove('c2');`, base(), assets, { makeWorker: () => fake });
    expect(r).toMatchObject({ ops: [{ op: 'remove_clip', clipId: 'c2' }] });
  });
});

describe('add_graphic: SVG saneado (XSS)', () => {
  const evil = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" onload="alert(1)">
    <script>alert(1)</script>
    <foreignObject><iframe src="https://x.com"></iframe></foreignObject>
    <a href="javascript:alert(1)"><rect width="10" height="10" onclick="alert(2)"/></a>
    <image href="https://evil.com/x.png"/>
    <use xlink:href="https://evil.com/s.svg#a"/>
    <use href="#ok"/>
    <set attributeName="href" to="javascript:alert(3)"/>
    <style>@import url(https://evil.com/a.css); .a{fill:url(https://evil.com/f)}</style>
    <rect style="fill:url(https://evil.com/x)" width="5" height="5"/>
    <text x="10" y="50">Olá</text>
  </svg>`;
  it('remove script, foreignObject, on*, javascript:, href/imagem externos e url() externo', () => {
    const s = sanitizeSvgString(evil);
    for (const bad of ['<script', 'foreignObject', 'iframe', 'onload', 'onclick', 'javascript:', 'evil.com', '@import']) expect(s).not.toContain(bad);
    expect(s).toContain('href="#ok"');
    expect(s).toContain('Olá');
  });
  it('sanitizeSvg valida tamanho e raiz; mede o viewBox', () => {
    expect(sanitizeSvg('')).toMatchObject({ ok: false });
    expect(sanitizeSvg('<svg>' + 'a'.repeat(200_001) + '</svg>')).toMatchObject({ ok: false });
    expect(sanitizeSvg('<div>oi</div>')).toMatchObject({ ok: false });
    const ok = sanitizeSvg(evil);
    expect(ok).toMatchObject({ ok: true, width: 200, height: 100 });
    expect(svgSize('<svg width="300" viewBox="0 0 600 200">')).toEqual({ width: 300, height: 100 });
  });
  it('PNG pelo menos da altura do quadro, mantendo a proporção (lado máx. 4096)', () => {
    expect(rasterSize(200, 100, { width: 1080, height: 1920 })).toEqual({ width: 3840, height: 1920 });
    expect(rasterSize(1000, 100, { width: 1080, height: 1920 })).toEqual({ width: 4096, height: 410 });
  });
  it('trilha do gráfico: nunca a principal; reaproveita uma livre por cima', () => {
    const p = base();
    expect(graphicTrack(p, 0, 3)).toMatch(/^track_gfx_/);
    expect(graphicTrack(p, 0, 3, 'track_video_1')).not.toBe('track_video_1');
  });
});

describe('shaders custom: checagem + conserto', () => {
  it('sem o módulo da fx usa a checagem leve; com o módulo usa checkShader', () => {
    __setCustomShaderModule(null);
    const errs: string[] = [];
    const out = filterShaders([{ op: 'update_clip', clipId: 'c1', patch: { effects: [{ kind: 'custom', name: 'Ruim', code: 'vec4 effect(vec2 uv){ return vec4(1.0;' }, { kind: 'custom', code: 'vec4 effect(vec2 uv){ return vec4(1.0); }' }] } }], errs) as { patch: { effects: unknown[] } }[];
    expect(out[0].patch.effects).toHaveLength(1);
    expect(errs[0]).toMatch(/Ruim/);
    __setCustomShaderModule({ checkShader: () => ({ ok: false, error: "'foo' : undeclared identifier", line: 2 }) });
    const e2: string[] = [];
    filterShaders([{ op: 'update_clip', clipId: 'c1', patch: { transitionIn: { kind: 'custom', code: 'vec4 transition(vec2 uv){ return foo; }' } } }], e2);
    expect(e2[0]).toMatch(/undeclared identifier \(linha 2\)/);
  });
});

describe('finalizeClaude: adiados + 1 rodada de conserto', () => {
  const resp = (o: Partial<EditResponse>): EditResponse => ({ reply: 'ok', ops: [], ...o });

  it('script com erro -> conserto com a linha -> ops do conserto aplicadas; não conserta 2x', async () => {
    const calls: EditRequest[] = [];
    let scriptRuns = 0;
    const f = await finalizeClaude(
      resp({ ops: [{ op: 'update_clip', clipId: 'c1', patch: { volume: 0.9 }, explain: 'x' } as EditOp], deferred: [{ kind: 'script', code: 'quebrado' }] }),
      base(),
      {
        userText: 'contador', getAssets: () => assets,
        runScript: async (code, p, a) => { scriptRuns++; return code === 'quebrado' ? { error: 'quebrado is not defined', line: 1, logs: [] } : runSandboxed(code, scriptInput(p, a)); },
        request: async (r) => { calls.push(r); return resp({ reply: 'consertei', deferred: [{ kind: 'script', code: "ep.text({ text: '0', start: 0, duration: 1 })" }] }); },
      },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].mode).toBe('repair');
    expect(calls[0].userText).toMatch(/quebrado is not defined \(linha 1\)/);
    // o conserto parte do projeto com o que já deu certo
    expect((calls[0].project.tracks[0].clips[0] as { volume?: number }).volume).toBe(0.9);
    expect(scriptRuns).toBe(2);
    expect(f.repaired).toBe(true);
    expect(f.errors).toEqual([]);
    expect(f.ops.map((o) => o.op)).toEqual(['update_clip', 'add_clip']);
  });

  it('gráfico: cria o asset e põe um clipe de imagem numa trilha por cima', async () => {
    const g: MediaAsset = { id: 'g1', kind: 'image', role: 'graphic', name: 'Selo.png', mime: 'image/png', size: 10, duration: 0, width: 1920, height: 1920, svg: '<svg/>' };
    const f = await finalizeClaude(
      resp({ deferred: [{ kind: 'graphic', svg: '<svg viewBox="0 0 10 10"><circle r="4"/></svg>', name: 'Selo', start: 1, duration: 3, clip: { transform: { x: 0.8, y: 0.2, scale: 0.3 }, animationIn: { kind: 'pop', duration: 0.4 } } }] }),
      base(),
      { userText: 'selo', getAssets: () => assets, createGraphic: async () => g },
    );
    expect(f.errors).toEqual([]);
    const img = f.project.tracks.flatMap((t) => t.clips).find((c) => c.type === 'image') as ImageClip;
    expect(img).toMatchObject({ assetId: 'g1', start: 1, duration: 3 });
    expect(img.transform.scale).toBeCloseTo(0.3);
    const tr = f.project.tracks.find((t) => t.clips.includes(img))!;
    expect(tr.id).not.toBe('track_video_1');
    expect(f.project.tracks.indexOf(tr)).toBeGreaterThan(0);
  });

  it('pedido de legendas vira flag; erros sem request ficam como avisos', async () => {
    const f = await finalizeClaude(resp({ deferred: [{ kind: 'captions', language: 'en' }, { kind: 'script', code: 'x' }], droppedReasons: ['update_clip: clipe não existe'] }), base(), { userText: 'x', getAssets: () => assets });
    expect(f.captions).toEqual({ language: 'en' });
    expect(f.errors.length).toBe(2);
    expect(f.repaired).toBe(false);
  });
});

describe('exemplos de run_script do prompt rodam e geram ops válidas', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs');
  const prompt: string = fs.readFileSync(require('node:path').join(__dirname, '../../prompts/edit-system.md'), 'utf8');
  const examples = [...prompt.matchAll(/- (Contador|Zoom alternado|Corte em cada batida|Legenda palavra a palavra)[^`]*`([^`]+)`/g)].map((m) => ({ name: m[1], code: m[2] }));
  const mus: MediaAsset = { id: 'm1', kind: 'audio', role: 'music', name: 'm.mp3', mime: 'audio/mpeg', size: 1, duration: 20, beats: [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4] };
  const all = { ...assets, m1: mus };
  const proj = (): Project => applyOps(base(), [
    { op: 'add_clip', trackId: 'track_audio_1', clip: { id: 'mu', type: 'audio', assetId: 'm1', start: 0, duration: 20, in: 0, speed: 1, volume: 0.3 } },
    { op: 'set_captions', segments: [
      { id: 's1', start: 0, end: 2, text: 'olá pessoal', words: [{ id: 'w1', text: 'olá', start: 0, end: 0.8 }, { id: 'w2', text: 'pessoal', start: 0.9, end: 2 }] },
      { id: 's2', start: 2.5, end: 5, text: 'vamos lá', words: [{ id: 'w3', text: 'vamos', start: 2.5, end: 3.4 }, { id: 'w4', text: 'lá', start: 3.5, end: 5 }] },
      { id: 's3', start: 12, end: 14, text: 'fim', words: [{ id: 'w5', text: 'fim', start: 12, end: 14 }] },
    ] },
  ] as EditOp[]).project;

  it('acha os 4 exemplos', () => expect(examples.map((e) => e.name)).toEqual(['Contador', 'Zoom alternado', 'Corte em cada batida', 'Legenda palavra a palavra']));
  for (const name of ['Contador', 'Zoom alternado', 'Corte em cada batida', 'Legenda palavra a palavra']) {
    it(name, () => {
      const ex = examples.find((e) => e.name === name)!;
      const r = runSandboxed(ex.code, scriptInput(proj(), all));
      if ('error' in r) throw new Error(`${name}: ${r.error} (linha ${r.line})`);
      expect(r.ops.length).toBeGreaterThan(2);
      const s = sanitizeOps(r.ops, proj(), all, 3000);
      expect(s.dropped.map((d) => d.reason)).toEqual([]);
    });
  }
});

describe('demo: pedido não entendido sugere os 3 comandos mais parecidos', () => {
  it('similarCommands acha o comando certo mesmo com erro de digitação', async () => {
    const { similarCommands, chatIntent } = await import('./demo');
    expect(similarCommands('deixa preto e brnco')).toContain('deixa preto e branco');
    expect(similarCommands('quero uma legenda karaoke')[0]).toMatch(/karaok/);
    const r = chatIntent('faz um negócio esquisito xyz', { project: base(), assets });
    expect(r.ops).toEqual([]);
    expect(r.reply).toMatch(/Você quis dizer “.+”, “.+” ou “.+”\?/);
    expect(r.reply.length).toBeLessThan(300);
  });
});
