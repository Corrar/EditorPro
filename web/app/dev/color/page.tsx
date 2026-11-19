'use client';
/* =====================================================================
   Harness da sessão "cor": /dev/color. Gera uma imagem de teste (barras,
   degradê, tons de pele), monta um projeto com ela e mostra o resultado
   via gradeLayer (simula a integração no draw.ts) ao lado do <ColorPanel/>.
   window.__color expõe testes de equivalência CPU×GPU e medição de tempo.
   ===================================================================== */
import { useEffect, useRef, useState } from 'react';
import ColorPanel from '@/components/color/ColorPanel';
import { useEditor } from '@/lib/store';
import { makeImageClip } from '@/lib/defaults';
import type { ColorGrade, MediaAsset } from '@/lib/types';
import { applyGradeImageData, getColorGrader, gradeLayer, ColorGrader, BUILTIN_LOOKS, getLut, resolveGrade, onCompareChanged, setCompare } from '@/lib/color';
import { scopesAsync } from '@/components/color/Scopes';

function testCard(W = 640, H = 360): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d')!;
  const bars = ['#C0C0C0', '#C0C000', '#00C0C0', '#00C000', '#C000C0', '#C00000', '#0000C0'];
  bars.forEach((b, i) => { x.fillStyle = b; x.fillRect((i * W) / 7, 0, W / 7 + 1, H * 0.45); });
  const g = x.createLinearGradient(0, 0, W, 0); g.addColorStop(0, '#000'); g.addColorStop(1, '#fff');
  x.fillStyle = g; x.fillRect(0, H * 0.45, W, H * 0.15);
  const h = x.createLinearGradient(0, 0, W, 0);
  for (let i = 0; i <= 12; i++) h.addColorStop(i / 12, `hsl(${i * 30},80%,50%)`);
  x.fillStyle = h; x.fillRect(0, H * 0.6, W, H * 0.15);
  ['#8d5524', '#c68642', '#e0ac69', '#f1c27d', '#ffdbac', '#3b2219'].forEach((s, i) => { x.fillStyle = s; x.fillRect((i * W) / 6, H * 0.75, W / 6 + 1, H * 0.25); });
  return c;
}

declare global { interface Window { __color?: unknown } }

export default function DevColor() {
  const out = useRef<HTMLCanvasElement>(null);
  const card = useRef<HTMLCanvasElement | null>(null);
  const project = useEditor((s) => s.project);
  const [ms, setMs] = useState(0);

  useEffect(() => {
    card.current = testCard();
    card.current.toBlob((b) => {
      if (!b) return;
      const url = URL.createObjectURL(b);
      const asset: MediaAsset = { id: 'asset_card', kind: 'image', role: 'source', name: 'cartela.png', mime: 'image/png', size: b.size, duration: 0, url, width: 640, height: 360 };
      const st = useEditor.getState();
      st.newProject({ name: 'Teste de cor', aspect: '16:9' });
      st.addAsset(asset);
      st.dispatch({ op: 'add_clip', trackId: 'track_video_1', clip: makeImageClip(asset, 0, 5, { id: 'clipCard' }) }, { history: false });
      st.select(['clipCard']);
    });
    const runEq = (grade: ColorGrade, W = 420, H = 100) => {
      const src = testCard(W, H);
      const g = new ColorGrader();
      g.render(src, resolveGrade(grade, getLut), W, H);
      const gpu = g.readPixels()!;
      const img = src.getContext('2d')!.getImageData(0, 0, W, H);
      applyGradeImageData(img, grade, getLut);
      let max = 0, sum = 0, at = 0, over3 = 0;
      for (let i = 0; i < gpu.length; i += 4) for (let k = 0; k < 3; k++) { const d = Math.abs(gpu[i + k] - img.data[i + k]); if (d > max) { max = d; at = i; } if (d > 3) over3++; sum += d; }
      g.loseContext();
      return { max, mean: sum / (gpu.length * 0.75), over3: over3 / (W * H * 3), at: { x: (at / 4) % W, y: Math.floor(at / 4 / W), gpu: Array.from(gpu.slice(at, at + 3)), cpu: Array.from(img.data.slice(at, at + 3)) }, webgl: g.version };
    };
    const perf = (grade: ColorGrade, W = 1280, H = 720, n = 60) => {
      const src = testCard(W, H);
      const g = getColorGrader()!;
      const R = resolveGrade(grade, getLut);
      g.render(src, R, W, H); g.readPixels();
      const t0 = performance.now();
      for (let i = 0; i < n; i++) g.render(src, R, W, H);
      const gl = g.context()!; const px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // sincroniza
      return (performance.now() - t0) / n;
    };
    const contextLoss = () => {
      const g = new ColorGrader();
      const src = testCard(64, 36);
      const a = !!g.render(src, { saturation: -1 }, 64, 36);
      g.loseContext();
      const b = g.render(src, { saturation: -1 }, 64, 36);
      return { before: a, duringLoss: b === null };
    };
    /** r2#2: Dividir não pode ir para o export (offline) */
    const splitTest = () => {
      const src = testCard(420, 100);
      const read = (offline: boolean) => {
        const out = gradeLayer(src, { saturation: -1 }, 420, 100, { offline }) as HTMLCanvasElement;
        const c = document.createElement('canvas'); c.width = 420; c.height = 100;
        const x = c.getContext('2d')!; x.drawImage(out, 0, 0);
        return { left: Array.from(x.getImageData(380, 10, 1, 1).data.slice(0, 3)).concat(Array.from(x.getImageData(250, 10, 1, 1).data.slice(0, 3))) };
      };
      setCompare({ mode: 'split', split: 0.9 });
      const preview = read(false), exp = read(true);
      setCompare({ mode: 'off' });
      return { preview, exp };
    };
    /** r2#9: escopos com worker que não responde */
    const scopesTest = async () => {
      const img = new ImageData(8, 8);
      for (let i = 0; i < 64; i++) { img.data[i * 4] = 255; img.data[i * 4 + 3] = 255; }
      const s = await scopesAsync(img);
      return { histR255: s.histR[255], pixels: s.pixels };
    };
    window.__color = { runEq, perf, contextLoss, splitTest, scopesTest, store: useEditor, looks: BUILTIN_LOOKS.map((l) => l.id) };
  }, []);

  // simula draw.ts: fonte → gradeLayer → canvas
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const c = out.current, src = card.current;
      const clip = project.tracks.flatMap((t) => t.clips).find((k) => k.id === 'clipCard');
      if (!c || !src || !clip || clip.type !== 'image') return;
      const ctx = c.getContext('2d')!;
      const t0 = performance.now();
      const graded = gradeLayer(src, clip.colorGrade, src.width, src.height);
      ctx.drawImage(graded ?? src, 0, 0, c.width, c.height);
      setMs(performance.now() - t0);
    };
    raf = requestAnimationFrame(draw);
    const off = onCompareChanged(() => { raf = requestAnimationFrame(draw); });
    return () => { cancelAnimationFrame(raf); off(); };
  }, [project]);

  return (
    <div className="ep-root" style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--ink)', padding: 16, boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 420px', minWidth: 0 }}>
          <canvas ref={out} width={640} height={360} data-testid="color-out" style={{ width: '100%', borderRadius: 18, background: '#000', display: 'block' }} />
          <p className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>gradeLayer: {ms.toFixed(2)} ms (640×360, inclui upload)</p>
        </div>
        <div style={{ flex: '1 1 360px', maxWidth: 520, minWidth: 0 }}>
          <ColorPanel />
        </div>
      </div>
    </div>
  );
}
