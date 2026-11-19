'use client';
/* =====================================================================
   Harness da sessão fx — /dev/fx. Grade com cada efeito e transição
   animando sobre uma cena de teste gerada em canvas (sem arquivos).
   window.__epFx: { benchEffects(w,h,n), benchTransitions(w,h,n), compileAll() }
   ===================================================================== */
import { useEffect, useRef, useState } from 'react';
import { EFFECT_CATALOG, TRANSITION_CATALOG, EFFECT_CATEGORIES, type EffectEntry, type TransitionEntry } from '@/lib/fx/catalog';
import { applySurfaceEffects, effectGeometry } from '@/lib/engine/effects';
import { isShaderTransition, runShaderTransition } from '@/lib/engine/shaderTransitions';
import { transitionVisual } from '@/lib/engine/transitions';
import { glStats, fxContextForTests, fxParallelCompile } from '@/lib/fx/glcore';
import { warmupEffect, warmupTransition, warmupCustom } from '@/lib/fx/warm';
import { glContextForTests, processPixels } from '@/lib/engine/gl';
import { shapeCanvas, shapeCacheStats } from '@/lib/engine/shapes';
import { canvasFilterSupported, resetCanvasFilterSupport } from '@/lib/fx/sprites';
import type { ShapeClip } from '@/lib/types';
import { checkShader, SHADER_EXAMPLES } from '@/lib/fx/customShader';
import { applyCustomEffect, runCustomTransition } from '@/lib/fx/customRender';
import type { AnyCanvas, Ctx } from '@/lib/engine/surface';

/** cena de teste: gradiente, formas e texto que se movem (dá p/ ver distorção/cor/borda) */
function scene(ctx: Ctx, W: number, H: number, t: number, hue = 20) {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, `hsl(${hue},85%,55%)`);
  g.addColorStop(1, `hsl(${hue + 180},70%,30%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = `hsl(${hue + i * 50},90%,${40 + i * 8}%)`;
    const x = W * (0.15 + 0.14 * i) + Math.sin(t * 1.5 + i) * W * 0.05;
    ctx.beginPath();
    ctx.arc(x, H * (0.3 + 0.08 * (i % 3)), Math.min(W, H) * 0.09, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#fff';
  ctx.fillRect(W * 0.1, H * 0.62, W * 0.8, H * 0.04);
  ctx.font = `800 ${Math.round(H * 0.12)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('FX', W / 2 + Math.sin(t) * W * 0.1, H * 0.85);
}

function drawEffect(ctx: Ctx, W: number, H: number, e: EffectEntry, t: number) {
  const fx = [{ kind: e.kind, intensity: 0.8, speed: 1, ...(e.defaultColor ? { color: e.defaultColor } : {}),
    ...(e.kind === 'custom' ? { code: SHADER_EXAMPLES.find((x) => x.id === 'particles')!.code, color: '#FFD23F' } : {}) }];
  const geo = effectGeometry(fx, t);
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  ctx.translate(W / 2 + geo.dx * W, H / 2 + geo.dy * H);
  ctx.rotate((geo.rotation * Math.PI) / 180);
  ctx.scale(geo.scale, geo.scale);
  ctx.translate(-W / 2, -H / 2);
  scene(ctx, W, H, t);
  ctx.restore();
  applySurfaceEffects(ctx, W, H, fx, t, { local: t % 3, duration: 3 });
}

const off = new Map<string, HTMLCanvasElement>();
function offscreen(key: string, W: number, H: number) {
  let c = off.get(key);
  if (!c) { c = document.createElement('canvas'); off.set(key, c); }
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  return c;
}

function drawTransition(ctx: Ctx, W: number, H: number, tr: TransitionEntry, p: number, t: number) {
  const a = offscreen('a', W, H), b = offscreen('b', W, H);
  scene(a.getContext('2d')!, W, H, t, 20);
  scene(b.getContext('2d')!, W, H, t, 200);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  if (isShaderTransition(tr.kind)) {
    const out = runShaderTransition(tr.kind, a, b, p, W, H, tr.kind === 'custom'
      ? { kind: 'custom', duration: 0.6, code: SHADER_EXAMPLES.find((x) => x.id === 'spiral')!.code } : undefined);
    ctx.drawImage((out ?? b) as CanvasImageSource, 0, 0, W, H);
    return;
  }
  for (const [src, role] of [[a, 'out'], [b, 'in']] as const) {
    const v = transitionVisual(tr.kind, p, role);
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, v.opacity));
    ctx.translate(W / 2 + v.dx * W, H / 2 + v.dy * H);
    ctx.rotate((v.rotation * Math.PI) / 180);
    ctx.scale(v.scale, v.scale);
    if (v.reveal && role === 'in') {
      ctx.beginPath();
      const pr = v.reveal.progress;
      if (v.reveal.kind === 'circle') ctx.arc(0, 0, Math.hypot(W, H) / 2 * pr, 0, Math.PI * 2);
      else if (v.reveal.kind === 'wipe-left') ctx.rect(W / 2 - W * pr, -H / 2, W * pr, H);
      else if (v.reveal.kind === 'wipe-right') ctx.rect(-W / 2, -H / 2, W * pr, H);
      else ctx.rect(-W / 2, H / 2 - H * pr, W, H * pr);
      ctx.clip();
    }
    ctx.drawImage(src, -W / 2, -H / 2);
    ctx.restore();
    if (role === 'in') {
      const ov = v.flash || (v.dip?.alpha ?? 0);
      if (ov > 0) { ctx.fillStyle = v.dip?.color ?? '#fff'; ctx.globalAlpha = ov; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
    }
  }
}

type Tab = 'efeitos' | 'transicoes';

export default function FxHarness() {
  const [tab, setTab] = useState<Tab>('efeitos');
  const [cat, setCat] = useState<string>('Todos');
  const grid = useRef<HTMLDivElement>(null);
  const items = tab === 'efeitos'
    ? EFFECT_CATALOG.filter((e) => cat === 'Todos' || e.category === cat)
    : TRANSITION_CATALOG.filter((e) => cat === 'Todos' || e.category === cat);

  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const loop = () => {
      const t = (performance.now() - t0) / 1000;
      const cells = grid.current?.querySelectorAll('canvas[data-kind]') ?? [];
      cells.forEach((c) => {
        const cv = c as HTMLCanvasElement;
        const r = cv.getBoundingClientRect();
        if (r.bottom < 0 || r.top > innerHeight) return; // só o que está na tela
        const ctx = cv.getContext('2d')!;
        const kind = cv.dataset.kind!;
        if (tab === 'efeitos') drawEffect(ctx, cv.width, cv.height, EFFECT_CATALOG.find((e) => e.kind === kind)!, t);
        else {
          const tr = TRANSITION_CATALOG.find((e) => e.kind === kind)!;
          const ph = (t % 2.4) / 2.4;
          const p = Math.min(1, Math.max(0, (ph - 0.2) / 0.6));
          drawTransition(ctx, cv.width, cv.height, tr, p, t);
        }
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [tab, cat]);

  useEffect(() => {
    /** custo médio (ms/quadro) de cada efeito numa superfície W×H */
    const benchEffects = (W = 1280, H = 720, n = 12) => {
      const c = offscreen('bench', W, H);
      const ctx = c.getContext('2d', { willReadFrequently: false })!;
      const base = offscreen('bench-base', W, H);
      scene(base.getContext('2d')!, W, H, 0.5);
      const out: { kind: string; ms: number }[] = [];
      for (const e of EFFECT_CATALOG) {
        const fx = [{ kind: e.kind, intensity: 0.8, speed: 1 }];
        const run = (i: number) => { ctx.globalCompositeOperation = 'copy'; ctx.drawImage(base, 0, 0); ctx.globalCompositeOperation = 'source-over'; applySurfaceEffects(ctx, W, H, fx, i / 30, { local: i / 30 }); };
        run(0); run(1);
        ctx.getImageData(0, 0, 1, 1); // sincroniza a GPU
        const t0 = performance.now();
        for (let i = 0; i < n; i++) run(i);
        ctx.getImageData(0, 0, 1, 1);
        out.push({ kind: e.kind, ms: +((performance.now() - t0) / n).toFixed(2) });
      }
      return out.sort((a, b) => b.ms - a.ms);
    };
    const benchTransitions = (W = 1280, H = 720, n = 8) => {
      const c = offscreen('bench', W, H);
      const ctx = c.getContext('2d')!;
      const out: { kind: string; ms: number }[] = [];
      for (const tr of TRANSITION_CATALOG) {
        drawTransition(ctx, W, H, tr, 0.5, 0);
        ctx.getImageData(0, 0, 1, 1);
        const t0 = performance.now();
        for (let i = 0; i < n; i++) drawTransition(ctx, W, H, tr, (i + 0.5) / n, i / 30);
        ctx.getImageData(0, 0, 1, 1);
        out.push({ kind: tr.kind, ms: +((performance.now() - t0) / n).toFixed(2) });
      }
      return out.sort((a, b) => b.ms - a.ms);
    };
    /** compila e roda tudo uma vez: devolve os kinds cujo shader falhou */
    const compileAll = () => {
      const failed: string[] = [];
      const c = offscreen('cmp', 160, 284);
      const ctx = c.getContext('2d')!;
      const warn = console.warn;
      const msgs: string[] = [];
      console.warn = (...a: unknown[]) => { msgs.push(a.map(String).join(' ')); };
      try {
        for (const e of EFFECT_CATALOG) {
          const before = msgs.length;
          drawEffect(ctx, 160, 284, e, 0.7);
          if (msgs.length > before) failed.push(e.kind + ': ' + msgs.slice(before).join(' | ').slice(0, 300));
        }
        for (const tr of TRANSITION_CATALOG) {
          if (!isShaderTransition(tr.kind)) continue;
          const a = offscreen('a', 160, 284);
          scene(a.getContext('2d')!, 160, 284, 0);
          const before = msgs.length;
          const out = runShaderTransition(tr.kind, a, a, 0.5, 160, 284);
          if (!out || msgs.length > before) failed.push(tr.kind + ': ' + msgs.slice(before).join(' | ').slice(0, 300));
        }
      } finally { console.warn = warn; }
      return { failed, stats: { ...glStats } };
    };
    /** desenha todas as células visíveis da aba de transições no progresso p (capturas) */
    const drawAllAt = (p: number) => {
      document.querySelectorAll('canvas[data-kind]').forEach((c) => {
        const cv = c as HTMLCanvasElement;
        const tr = TRANSITION_CATALOG.find((e) => e.kind === cv.dataset.kind);
        if (tr) drawTransition(cv.getContext('2d')!, cv.width, cv.height, tr, p, 0.5);
      });
    };
    /** compila todos os SHADER_EXAMPLES na GPU + casos de erro (linha relativa ao código) */
    const checkExamples = () => ({
      examples: SHADER_EXAMPLES.map((x) => ({ id: x.id, ...checkShader(x.code, x.stage) })),
      undeclared: checkShader('vec4 effect(vec2 uv){\n  vec4 c = tex(uv);\n  return c * foo;\n}', 'effect'),
      typeError: checkShader('vec4 transition(vec2 uv){\n  float x = getToColor(uv);\n  return vec4(x);\n}', 'transition'),
      intLiteral: checkShader('vec4 effect(vec2 uv){\n  float k = 1;\n  return tex(uv) * k;\n}', 'effect'),
    });
    /** os pixels mudam com cada exemplo? (diferença média 0..255 vs. o quadro original, 160×284) */
    const exampleDiffs = () => {
      const W = 160, H = 284;
      const base = offscreen('ex-base', W, H); scene(base.getContext('2d')!, W, H, 0.5);
      const ref = base.getContext('2d')!.getImageData(0, 0, W, H).data;
      const b2 = offscreen('ex-b2', W, H); scene(b2.getContext('2d')!, W, H, 0.5, 200);
      return SHADER_EXAMPLES.map((x) => {
        const c = offscreen('ex-out', W, H); const ctx = c.getContext('2d')!;
        if (x.stage === 'effect') {
          ctx.globalCompositeOperation = 'copy'; ctx.drawImage(base, 0, 0); ctx.globalCompositeOperation = 'source-over';
          applyCustomEffect(ctx, W, H, { kind: 'custom', intensity: 1, speed: 1, code: x.code, color: '#22E6FF', params: [120, 1] }, 0.37, { local: 0.37, duration: 3 });
        } else {
          const out = runCustomTransition({ kind: 'custom', duration: 0.6, code: x.code }, base, b2, 0.5, W, H);
          ctx.globalCompositeOperation = 'copy'; ctx.drawImage(out as CanvasImageSource, 0, 0); ctx.globalCompositeOperation = 'source-over';
        }
        const d = ctx.getImageData(0, 0, W, H).data; let s = 0;
        for (let i = 0; i < d.length; i += 4) s += (Math.abs(d[i] - ref[i]) + Math.abs(d[i + 1] - ref[i + 1]) + Math.abs(d[i + 2] - ref[i + 2])) / 3;
        return { id: x.id, diff: +(s / (W * H)).toFixed(2) };
      });
    };
    /** ms/quadro do efeito custom (simples: ondas; pesado: partículas com laço de 40) */
    const benchCustom = (W = 1280, H = 720, n = 20) => {
      const c = offscreen('bench', W, H); const ctx = c.getContext('2d')!;
      const base = offscreen('bench-base', W, H); scene(base.getContext('2d')!, W, H, 0.5);
      const out: Record<string, number> = {};
      for (const id of ['waves', 'neon-scanline', 'gradient-bg', 'rain', 'particles']) {
        const code = SHADER_EXAMPLES.find((x) => x.id === id)!.code;
        const run = (i: number) => { ctx.globalCompositeOperation = 'copy'; ctx.drawImage(base, 0, 0); ctx.globalCompositeOperation = 'source-over'; applyCustomEffect(ctx, W, H, { kind: 'custom', intensity: 1, code }, i / 30, { local: i / 30, duration: 5 }); };
        run(0); ctx.getImageData(0, 0, 1, 1);
        const t0 = performance.now();
        for (let i = 0; i < n; i++) run(i);
        ctx.getImageData(0, 0, 1, 1);
        out[id] = +((performance.now() - t0) / n).toFixed(2);
      }
      return out;
    };
    /** regressão r2: casos que precisam de navegador/WebGL */
    const r2 = async () => {
      const out: Record<string, unknown> = {};
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const W = 200, H = 200;
      // #7 efeito em camada pequena (40×40) não pinta fora dela
      const leak: Record<string, number> = {};
      for (const kind of ['light-sweep', 'film-grain', 'vhs', 'disco', 'vignette-pulse', 'invert', 'strobe-color', 'freeze-flash'] as const) {
        const c = offscreen('leak', W, H); const ctx = c.getContext('2d')!;
        ctx.clearRect(0, 0, W, H); ctx.fillStyle = '#3080ff'; ctx.fillRect(80, 80, 40, 40);
        applySurfaceEffects(ctx, W, H, [{ kind, intensity: 1 }], 0.37, { local: 0.05, duration: 2 });
        const d = ctx.getImageData(0, 0, W, H).data; let n = 0;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (x >= 80 && x < 120 && y >= 80 && y < 120) continue; if (d[(y * W + x) * 4 + 3] > 2) n++; }
        leak[kind] = n;
      }
      out.leakOutside = leak;
      // #3 coração: fração do quadro que já mostra B (verde) ao longo do progresso
      const A = offscreen('hA', 120, 120), Bc = offscreen('hB', 120, 120);
      A.getContext('2d')!.fillStyle = '#f00'; A.getContext('2d')!.fillRect(0, 0, 120, 120);
      Bc.getContext('2d')!.fillStyle = '#0f0'; Bc.getContext('2d')!.fillRect(0, 0, 120, 120);
      const heart: number[] = [];
      for (const pr of [0.25, 0.5, 0.75, 0.99]) {
        const o = runShaderTransition('luma-heart', A, Bc, pr, 120, 120)!;
        const t = offscreen('hO', 120, 120); const tc = t.getContext('2d')!; tc.drawImage(o as CanvasImageSource, 0, 0);
        const d = tc.getImageData(0, 0, 120, 120).data; let g = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 1] > 128 && d[i] < 128) g++;
        heart.push(+((100 * g) / (120 * 120)).toFixed(1));
      }
      out.heartPctB = heart;
      // #5 forma com escala animada: cache limitado
      const clip = { id: 's', type: 'shape', shape: 'rounded-rect', fill: '#F2681F', start: 0, duration: 5, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 } } as ShapeClip;
      for (let i = 0; i <= 120; i++) shapeCanvas(clip, 1296 * (1 + i / 120));
      out.shapeCache = shapeCacheStats();
      // #6 detecção de ctx.filter: real aqui; falsa sem o atributo no protótipo
      resetCanvasFilterSupport();
      const real = canvasFilterSupported();
      const proto = Object.getPrototypeOf(document.createElement('canvas').getContext('2d')!);
      const protoOff = typeof OffscreenCanvasRenderingContext2D !== 'undefined' ? OffscreenCanvasRenderingContext2D.prototype : null;
      const desc = Object.getOwnPropertyDescriptor(proto, 'filter'), descOff = protoOff && Object.getOwnPropertyDescriptor(protoOff, 'filter');
      delete (proto as { filter?: unknown }).filter; if (protoOff) delete (protoOff as { filter?: unknown }).filter;
      resetCanvasFilterSupport();
      const without = canvasFilterSupported();
      if (desc) Object.defineProperty(proto, 'filter', desc); if (protoOff && descOff) Object.defineProperty(protoOff, 'filter', descOff);
      resetCanvasFilterSupport();
      out.filterDetect = { real, withoutAttr: without, restored: canvasFilterSupported() };
      // #1 perda de contexto no gl.ts (recorte): o clipe não pode sumir
      const src = offscreen('glsrc', 64, 64); const sc = src.getContext('2d')!; sc.fillStyle = '#ff8800'; sc.fillRect(0, 0, 64, 64);
      const alphaOf = (cv: AnyCanvas | null) => { if (!cv) return -1; const t = offscreen('gla', 32, 32); const tc = t.getContext('2d')!; tc.clearRect(0, 0, 32, 32); tc.drawImage(cv as CanvasImageSource, 0, 0, 32, 32); return tc.getImageData(16, 16, 1, 1).data[3]; };
      const crop = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 };
      const before = alphaOf(processPixels(src, 64, 64, 32, 32, { crop }));
      const gl = glContextForTests();
      const ext = gl?.getExtension('WEBGL_lose_context');
      ext?.loseContext(); await sleep(50);
      const during = alphaOf(processPixels(src, 64, 64, 32, 32, { crop }));
      await sleep(1100);
      const after = alphaOf(processPixels(src, 64, 64, 32, 32, { crop, sharpen: 0.2 }));
      out.glLoss = { before, during, after, newContext: glContextForTests() !== gl };
      // perda no contexto compartilhado do fx: efeito não quebra e volta a funcionar
      const fgl = fxContextForTests();
      fgl?.getExtension('WEBGL_lose_context')?.loseContext(); await sleep(50);
      const e1 = offscreen('fxl', 64, 64); const ec = e1.getContext('2d')!; ec.fillStyle = '#336699'; ec.fillRect(0, 0, 64, 64);
      let threw = false; try { applySurfaceEffects(ec, 64, 64, [{ kind: 'invert', intensity: 1 }], 0); } catch { threw = true; }
      const duringFx = Array.from(ec.getImageData(32, 32, 1, 1).data);
      await sleep(1100);
      ec.fillStyle = '#336699'; ec.fillRect(0, 0, 64, 64);
      applySurfaceEffects(ec, 64, 64, [{ kind: 'invert', intensity: 1 }], 0);
      out.fxLoss = { threw, duringFx, afterFx: Array.from(ec.getImageData(32, 32, 1, 1).data), newContext: fxContextForTests() !== fgl };
      return out;
    };
    /** aquecimento: custo da chamada (deve ser pequeno) e se o uso real encontra o programa pronto */
    const warmTest = async () => {
      const kinds = EFFECT_CATALOG.filter((e) => e.render === 'gl' && e.kind !== 'custom').map((e) => e.kind);
      const trs = TRANSITION_CATALOG.filter((t) => t.render === 'shader' && t.kind !== 'custom').map((t) => t.kind);
      const t0 = performance.now(); let maxCall = 0;
      const start = (f: () => string) => { const a = performance.now(); const r = f(); maxCall = Math.max(maxCall, performance.now() - a); return r; };
      kinds.forEach((k) => start(() => warmupEffect(k)));
      trs.forEach((k) => start(() => warmupTransition(k)));
      start(() => warmupCustom(SHADER_EXAMPLES[0].code, 'effect'));
      const firstPass = performance.now() - t0;
      let pending = 1, rounds = 0;
      while (pending && rounds < 200) {
        await new Promise((r) => setTimeout(r, 16)); rounds++;
        pending = [...kinds.map((k) => warmupEffect(k)), ...trs.map((k) => warmupTransition(k))].filter((x) => x === 'pending').length;
      }
      const states = [...kinds.map((k) => warmupEffect(k)), ...trs.map((k) => warmupTransition(k))];
      const before = glStats.programs;
      const c = offscreen('w', 64, 64); const ctx = c.getContext('2d')!; ctx.fillStyle = '#888'; ctx.fillRect(0, 0, 64, 64);
      const r0 = performance.now();
      applySurfaceEffects(ctx, 64, 64, [{ kind: 'crt', intensity: 1 }], 0);
      const useMs = performance.now() - r0;
      return { parallel: fxParallelCompile(), count: kinds.length + trs.length, firstPassMs: +firstPass.toFixed(1), maxCallMs: +maxCall.toFixed(1), rounds,
        ready: states.filter((x) => x === 'ready').length, failed: states.filter((x) => x === 'failed').length, programsCompiledOnUse: glStats.programs - before, firstUseMs: +useMs.toFixed(1) };
    };
    (window as unknown as { __epFx: unknown }).__epFx = { warmTest, r2, benchEffects, benchTransitions, compileAll, drawAllAt, checkExamples, exampleDiffs, benchCustom };
  }, []);

  const cats = tab === 'efeitos' ? ['Todos', ...EFFECT_CATEGORIES] : ['Todos', ...new Set(TRANSITION_CATALOG.map((t) => t.category))];
  return (
    <main style={{ padding: 16, fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif', background: 'var(--bg, #f4f4f5)', minHeight: '100vh', color: '#1c1f22' }}>
      <h1 style={{ fontSize: 22, margin: '0 0 12px' }}>Efeitos e transições — /dev/fx</h1>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        {(['efeitos', 'transicoes'] as Tab[]).map((k) => (
          <button key={k} onClick={() => { setTab(k); setCat('Todos'); }} data-tab={k}
            style={{ minHeight: 44, padding: '0 18px', borderRadius: 14, border: 0, fontWeight: 700, background: tab === k ? '#F2681F' : '#e4e4e7', color: tab === k ? '#fff' : '#1c1f22' }}>
            {k === 'efeitos' ? `Efeitos (${EFFECT_CATALOG.length})` : `Transições (${TRANSITION_CATALOG.length})`}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 8, marginBottom: 8 }}>
        {cats.map((c) => (
          <button key={c} onClick={() => setCat(c)} style={{ minHeight: 44, padding: '0 14px', borderRadius: 12, border: 0, whiteSpace: 'nowrap', background: cat === c ? '#1c1f22' : '#e4e4e7', color: cat === c ? '#fff' : '#1c1f22' }}>{c}</button>
        ))}
      </div>
      <div ref={grid} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10 }}>
        {items.map((it) => (
          <figure key={it.kind} style={{ margin: 0, background: '#fff', borderRadius: 16, padding: 6 }}>
            <canvas data-kind={it.kind} width={160} height={284} style={{ width: '100%', borderRadius: 12, display: 'block', background: '#000' }} />
            <figcaption style={{ fontSize: 12, fontWeight: 600, padding: '6px 2px 2px' }}>{it.label}</figcaption>
            <div style={{ fontSize: 10, color: '#71717a' }}>{it.kind} · custo {it.cost}</div>
          </figure>
        ))}
      </div>
    </main>
  );
}
