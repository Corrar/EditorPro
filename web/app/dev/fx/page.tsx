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
import { glStats } from '@/lib/fx/glcore';
import type { Ctx } from '@/lib/engine/surface';

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
  const fx = [{ kind: e.kind, intensity: 0.8, speed: 1, ...(e.defaultColor ? { color: e.defaultColor } : {}) }];
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
    const out = runShaderTransition(tr.kind, a, b, p, W, H);
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
    (window as unknown as { __epFx: unknown }).__epFx = { benchEffects, benchTransitions, compileAll, drawAllAt };
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
