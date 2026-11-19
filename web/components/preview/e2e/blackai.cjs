// Regressão (principal, blink2): preview PRETO quando a IA edita ao vivo com o vídeo PAUSADO.
// 1) vídeo de 10 s; 2) tocando, split a cada 0,8 s (6 cortes); 3) pausa, playhead 1;
// 4) applyLive(ripple_delete ×4, delay 500); 5) captura [data-ep-preview] em loop durante e 800 ms depois. Luma < 10 = preto.
// Uso: node blackai.js <scratch> [mobile] [rodadas]
const { chromium, devices } = require('playwright');
const SP = process.argv[2]; const MOBILE = process.argv[3] === 'mobile'; const RUNS = Number(process.argv[4] || 3);
(async () => {
  const b = await chromium.launch();
  let tot = 0, blk = 0; const where = [];
  for (let run = 0; run < RUNS; run++) {
    const ctx = await b.newContext(MOBILE ? { ...devices['Pixel 7'] } : { viewport: { width: 1280, height: 860 } });
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => console.log('PAGEERROR', e.message));
    await pg.goto('http://localhost:3100/login');
    await pg.evaluate(() => fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'teste' }) }));
    await pg.goto('http://localhost:3100/dev/preview', { waitUntil: 'networkidle' });
    await pg.setInputFiles('[data-testid=files]', [SP + '/phone.mp4']);
    await pg.waitForFunction(() => window.__ep && window.__ep.assetsList().length > 0);
    await pg.evaluate(() => {
      const ep = window.__ep; const st = ep.useEditor.getState(); const a = ep.assetsList()[0];
      st.newProject({ name: 'B2', aspect: '9:16' }); st.addAsset(a);
      st.dispatch({ op: 'add_clip', trackId: 'track_video_1', clip: { id: 'v', type: 'video', assetId: a.id, start: 0, duration: 10, in: 0, speed: 1, volume: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, filters: [] } });
      st.setPlayhead(0);
    });
    await pg.waitForTimeout(1500);
    if (MOBILE) { const cdp = await ctx.newCDPSession(pg); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }); }
    await pg.evaluate(async () => {
      const st = window.__ep.useEditor.getState(); st.setPlaying(true);
      for (let i = 1; i <= 6; i++) {
        await new Promise((r) => setTimeout(r, 250));
        const s = window.__ep.useEditor.getState(); const at = i * 0.8 + 0.4;
        const c = s.project.tracks[0].clips.find((c) => at > c.start && at < c.start + c.duration);
        if (c) s.dispatch({ op: 'split_clip', clipId: c.id, at });
      }
      st.setPlaying(false); window.__ep.useEditor.getState().setPlayhead(1);
    });
    await pg.waitForTimeout(800);
    const p = pg.evaluate(() => window.__ep.useEditor.getState().applyLive([
      { op: 'ripple_delete', start: 1.5, end: 2.2 }, { op: 'ripple_delete', start: 3.0, end: 3.6 },
      { op: 'ripple_delete', start: 4.5, end: 5.0 }, { op: 'ripple_delete', start: 6.0, end: 6.4 }], { delayMs: 500 }).then(() => true));
    let done = false; p.then(() => { done = true; });
    const el = pg.locator('[data-ep-preview]');
    const luma = async () => { const shot = await el.screenshot(); return pg.evaluate(async (b64) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
      const c = document.createElement('canvas'); c.width = 36; c.height = 64; const x = c.getContext('2d'); x.drawImage(img, 0, 0, 36, 64);
      const d = x.getImageData(0, 0, 36, 64).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3; return s / (d.length / 4); }, shot.toString('base64')); };
    let after = 0;
    while (!done || after < 800) {
      const t0 = Date.now(); const L = await luma(); tot++;
      if (L < 10) { blk++; const st = await pg.evaluate(() => ({ ph: window.__ep.useEditor.getState().playhead, s: window.__epPreviewStats,
          vids: [...document.querySelectorAll('.ep-pv-host video')].map((v) => ({ op: v.style.opacity, vis: v.style.visibility, disp: v.style.display, rs: v.readyState, t: +v.currentTime.toFixed(3), sk: v.seeking, tr: v.style.transform.slice(0, 40), clip: v.style.clipPath || '' })),
          lum: (() => { const sm = document.createElement('canvas'); sm.width = 18; sm.height = 32; const x = sm.getContext('2d', { willReadFrequently: true });
            const m = (src) => { x.clearRect(0, 0, 18, 32); try { x.drawImage(src, 0, 0, 18, 32); } catch { return -1; } const d = x.getImageData(0, 0, 18, 32).data; let s = 0, a = 0; for (let i = 0; i < d.length; i += 4) { s += (d[i] + d[i + 1] + d[i + 2]) / 3; a += d[i + 3]; } return [Math.round(s / 576), Math.round(a / 576)]; };
            const v = [...document.querySelectorAll('.ep-pv-host video')].find((v) => v.style.opacity === '1');
            return { canvas: m(document.querySelector('[data-ep-preview]')), video: v ? m(v) : null }; })(),
          near: (() => { const s = window.__ep.useEditor.getState(); const ph = s.playhead; return { ph, bg: s.project.background, cl: s.project.tracks[0].clips.filter((c) => Math.abs(c.start - ph) < 0.6 || Math.abs(c.start + c.duration - ph) < 0.6).map((c) => [c.start, c.start + c.duration, c.start <= ph && ph < c.start + c.duration]) }; })() }));
        if (process.env.DUMP) console.log(JSON.stringify(st)); where.push({ run, L: +L.toFixed(1), ph: +st.ph.toFixed(2), mode: st.s.mode, reason: st.s.reason }); }
      if (done) after += Date.now() - t0;
    }
    await ctx.close();
  }
  console.log((MOBILE ? '[Pixel7 4x] ' : '[desktop] ') + JSON.stringify({ capturas: tot, pretas: blk, onde: where.slice(0, 8) }));
  await b.close();
})();
