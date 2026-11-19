// Fase 3 do plano: geometria nativa a cada rAF + transform scale (sem width/height por quadro).
// (1) tocando 3 s um zoom 1→1.6: quantos valores distintos de transform/s e de width; (2) parado com zoom/posição:
// diferença entre o preview nativo e o exportFrame (mesmo renderFrame do export). Uso: node geo.js <scratch> [mobile]
const { chromium, devices } = require('playwright');
const SP = process.argv[2]; const MOBILE = process.argv[3] === 'mobile';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext(MOBILE ? { ...devices['Pixel 7'] } : { viewport: { width: 1280, height: 860 } });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await pg.goto('http://localhost:3100/login');
  await pg.evaluate(() => fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'teste' }) }));
  await pg.goto('http://localhost:3100/dev/preview', { waitUntil: 'networkidle' });
  await pg.setInputFiles('[data-testid=files]', [SP + '/phone.mp4']);
  await pg.waitForFunction(() => window.__ep && window.__ep.assetsList().length > 0);
  await pg.evaluate(() => { const ep = window.__ep; const st = ep.useEditor.getState(); const a = ep.assetsList()[0];
    st.newProject({ name: 'G', aspect: '9:16' }); st.addAsset(a);
    st.dispatch({ op: 'add_clip', trackId: 'track_video_1', clip: { id: 'v', type: 'video', assetId: a.id, start: 0, duration: 10, in: 0, speed: 1, volume: 1, filters: [],
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [{ t: 0, transform: { scale: 1, x: 0 } }, { t: 10, transform: { scale: 1.6, x: 0.1, y: -0.05 } }] } });
    st.setPlayhead(0.5); });
  await pg.waitForTimeout(2000);
  if (MOBILE) { const cdp = await ctx.newCDPSession(pg); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }); }
  const r = await pg.evaluate(() => new Promise((res) => {
    const host = document.querySelector('.ep-pv-host'); const tr = new Set(), wd = new Set(); let ticks = 0, changes = 0, last = ''; const t0 = performance.now();
    window.__ep.useEditor.getState().setPlaying(true);
    const loop = () => { const v = [...host.querySelectorAll('video')].find((e) => e.style.opacity === '1'); ticks++;
      if (v) { if (v.style.transform !== last) { changes++; last = v.style.transform; } tr.add(v.style.transform); wd.add(v.style.width); }
      if (performance.now() - t0 < 3000) requestAnimationFrame(loop); else { window.__ep.useEditor.getState().setPlaying(false); res({ rafs: ticks, mudancasDeTransformPorRaf: +(changes / ticks).toFixed(2), transformsDistintos: tr.size, larguras: wd.size, mode: window.__epPreviewStats.mode }); } };
    requestAnimationFrame(loop); }));
  console.log((MOBILE ? '[Pixel7 4x] ' : '[desktop] ') + 'tocando zoom', JSON.stringify(r));
  // parado: preview nativo × exportFrame
  await pg.evaluate(() => window.__ep.useEditor.getState().setPlayhead(7.3)); await pg.waitForTimeout(1500);
  const shot = await pg.locator('.ep-pv-frame').screenshot();
  const d = await pg.evaluate(async (b64) => {
    const grab = async (src) => { const img = new Image(); img.src = src; await img.decode(); const c = document.createElement('canvas'); c.width = 90; c.height = 160; const x = c.getContext('2d'); x.drawImage(img, 0, 0, 90, 160); return x.getImageData(0, 0, 90, 160).data; };
    const a = await grab('data:image/png;base64,' + b64);
    const s = window.__ep.useEditor.getState(); const blob = await window.__ep.exportFrame(s.project, s.assets, 7.3, 'draft');
    const e = await grab(URL.createObjectURL(blob));
    let sum = 0; for (let i = 0; i < a.length; i += 4) sum += Math.abs(a[i] - e[i]) + Math.abs(a[i + 1] - e[i + 1]) + Math.abs(a[i + 2] - e[i + 2]);
    return { mode: window.__epPreviewStats.mode, difMedia: +(sum / (a.length / 4)).toFixed(1) };
  }, shot.toString('base64'));
  console.log((MOBILE ? '[Pixel7 4x] ' : '[desktop] ') + 'parado: nativo × export', JSON.stringify(d), '(desalinhado ≈ dezenas)');
  await b.close();
})();
