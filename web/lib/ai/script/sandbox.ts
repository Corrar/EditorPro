/* =====================================================================
   Núcleo do "script de edição" (run_script). Esta função é serializada
   (Function.prototype.toString) e roda DENTRO de um Web Worker isolado;
   também roda direto em testes. Não pode usar nada de fora do próprio corpo.
   - entrada: { code, input: { project, assets, words, beats, duration } }
   - saída:   { ops } | { error, line }
   O código da IA recebe `ep` (API) e `project` (cópia); rede e
   armazenamento ficam sombreados por parâmetros `undefined`.
   ===================================================================== */
export interface ScriptInput {
  project: unknown;
  assets: { id: string; kind: string; role: string; name: string; duration: number; width?: number; height?: number; beats?: number[] }[];
  words: { id?: string; text: string; start: number; end: number }[];
  beats: number[];
  duration: number;
}
export type SandboxResult = { ops: unknown[]; logs: string[] } | { error: string; line?: number; logs: string[] };

export function runSandboxed(code: string, input: ScriptInput, maxOps = 3000): SandboxResult {
  const logs: string[] = [];
  const ops: unknown[] = [];
  let n = 0;
  const P = input.project as { tracks: { id: string; kind: string; name?: string; clips: Record<string, unknown>[] }[]; captions: { segments: { id: string; start: number; end: number; text: string; words?: unknown[] }[] }; width: number; height: number; aspect: string };
  const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
  const push = (op: Record<string, unknown>) => {
    if (ops.length >= maxOps) throw new Error(`limite de ${maxOps} operações`);
    if (!op || typeof op !== 'object' || typeof op.op !== 'string') throw new Error('op inválida (precisa de { op: "..." })');
    ops.push(op);
    return op;
  };
  let firstLine = 4;
  const trackOf = (kind: string) => P.tracks.find((t) => t.kind === kind)?.id;
  const ep = {
    project: P,
    duration: input.duration,
    width: P.width, height: P.height, aspect: P.aspect,
    assets: input.assets,
    tracks: () => P.tracks.map((t) => ({ id: t.id, kind: t.kind, name: t.name, clips: t.clips.length })),
    trackOf,
    clips: (filter?: { type?: string; track?: string; kind?: string }) => P.tracks.flatMap((t) => t.clips.map((c) => ({ ...c, trackId: t.id, trackKind: t.kind }) as Record<string, unknown>))
      .filter((c) => (!filter?.type || c.type === filter.type) && (!filter?.track || c.trackId === filter.track) && (!filter?.kind || c.trackKind === filter.kind))
      .sort((a, b) => (a.start as number) - (b.start as number)),
    videoClips: () => ep.clips({ type: 'video' }),
    captions: () => clone(P.captions.segments),
    words: () => clone(input.words),
    beats: () => input.beats.slice(),
    uid: (prefix = 'clip') => `${prefix}_s${Date.now().toString(36)}${(n++).toString(36)}`,
    log: (...a: unknown[]) => { if (logs.length < 50) logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ').slice(0, 300)); },
    // ---- construtores de ops ----
    op: (o: Record<string, unknown>) => push(o),
    add: (clip: Record<string, unknown>, trackId?: string, explain?: string) => push({ op: 'add_clip', clip, ...(trackId ? { trackId } : {}), explain: explain ?? `Adicionando ${clip.type ?? 'clipe'}` }),
    text: (o: Record<string, unknown>) => push({ op: 'add_clip', clip: { type: 'text', id: ep.uid('txt'), ...o }, explain: (o.explain as string) ?? `Texto “${String(o.text ?? '').slice(0, 30)}”` }),
    shape: (o: Record<string, unknown>) => push({ op: 'add_clip', clip: { type: 'shape', id: ep.uid('shp'), ...o }, explain: (o.explain as string) ?? 'Forma' }),
    sticker: (o: Record<string, unknown>) => push({ op: 'add_clip', clip: { type: 'sticker', id: ep.uid('stk'), ...o }, explain: (o.explain as string) ?? `Sticker ${o.emoji ?? ''}` }),
    update: (clipId: string, patch: Record<string, unknown>, explain?: string) => push({ op: 'update_clip', clipId, patch, explain: explain ?? 'Ajustando clipe' }),
    split: (clipId: string, at: number, newId?: string, explain?: string) => { const id = newId ?? ep.uid('clip'); push({ op: 'split_clip', clipId, at, newId: id, explain: explain ?? `Corte em ${at.toFixed(2)} s` }); return id; },
    remove: (clipId: string, explain?: string) => push({ op: 'remove_clip', clipId, explain: explain ?? 'Removendo clipe' }),
    ripple: (start: number, end: number, explain?: string) => push({ op: 'ripple_delete', start, end, explain: explain ?? `Cortando ${start.toFixed(2)}–${end.toFixed(2)} s` }),
    captionStyle: (style: Record<string, unknown>, explain?: string) => push({ op: 'set_caption_style', style, explain: explain ?? 'Estilo da legenda' }),
    kf: (t: number, transform: Record<string, unknown> = {}, props?: Record<string, unknown>, easing?: string) => ({ t, transform, ...(props ? { props } : {}), ...(easing ? { easing } : {}) }),
  };
  try {
    // sombreia rede/armazenamento/escape dentro do escopo do script
    const blocked = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'BroadcastChannel', 'localStorage', 'sessionStorage', 'navigator', 'postMessage', 'self', 'globalThis', 'window', 'document', 'Worker', 'SharedWorker', 'open', 'close'];
    // calibra a linha: quantas linhas o wrapper de Function acrescenta antes do corpo
    // a linha 2 do corpo (onde começa o código da IA, depois do "use strict") cai na linha `firstLine` do stack
    try { new Function('a', '"use strict";\nthrow new Error("x")')(); } catch (e) { const m = /<anonymous>:(\d+)/.exec(String((e as Error).stack)); if (m) firstLine = Number(m[1]); }
    const fn = new Function('ep', 'project', ...blocked, `"use strict";\n${code}`);
    const ret = fn(ep, P, ...blocked.map(() => undefined));
    if (Array.isArray(ret)) for (const o of ret) push(o as Record<string, unknown>);
    return { ops, logs };
  } catch (e) {
    const err = e as Error;
    const m = /<anonymous>:(\d+)(?::\d+)?/.exec(String(err?.stack ?? ''));
    // linha relativa ao código da IA (desconta o wrapper + a linha "use strict")
    const line = m ? Math.max(1, Number(m[1]) - firstLine + 1) : undefined;
    return { error: `${err?.name ?? 'Erro'}: ${err?.message ?? String(e)}`.slice(0, 400), ...(line ? { line } : {}), logs };
  }
}
