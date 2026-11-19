// Roteiro da principal (blink2): tocando + 6 splits, pausa + salto + applyLive (fase "paused"), depois toca 5 s.
// Uso: node blink2.js <scratch> [mobile] [rodadas]
const { chromium, devices } = require('playwright');
const SP = process.argv[2]; const MOBILE = process.argv[3] === 'mobile'; const RUNS = Number(process.argv[4] || 3);
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const res = [];
  for (let run = 0; run < RUNS; run++) {
    const ctx = await b.newContext(MOBILE ? { ...devices['Pixel 7'] } : { viewport: { width: 1280, height: 860 } });
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => console.log('PAGEERROR', e.message));
    await pg.goto('http://localhost:3100/login');
    await pg.evaluate(() => fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'teste' }) }));
    await pg.goto('http://localhost:3100/dev/preview', { waitUntil: 'networkidle' });
    await pg.setInputFiles('[data-testid=files]', [SP + '/bruto.mp4']);
    await pg.waitForFunction(() => window.__ep && window.__ep.assetsList().length > 0 && window.__ep.assetsList()[0].duration > 0);
    await pg.evaluate(() => { const ep = window.__ep; const st = ep.useEditor.getState(); const a = ep.assetsList()[0];
      st.newProject(); st.addAsset(a);
      st.dispatch({ op: 'add_clip', trackId: st.project.tracks.find((t) => t.kind === 'video').id, clip: { id: 'v1', type: 'video', assetId: a.id, start: 0, duration: a.duration, in: 0, out: a.duration, volume: 1 } });
      st.setPlayhead(0); });
    await pg.waitForTimeout(1500);
    if (MOBILE) { const cdp = await ctx.newCDPSession(pg); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }); }
    const el = pg.locator('[data-ep-preview]');
    let phase = 'play', stop = false; const cnt = { play: [0, 0], paused: [0, 0], after: [0, 0] }; const blackInfo = [];
    const sampler = (async () => { while (!stop) { try {
      const shot = await el.screenshot({ type: 'jpeg', quality: 50, animations: 'allow' });
      const L = await pg.evaluate(async (b64) => { const img = new Image(); img.src = 'data:image/jpeg;base64,' + b64; await img.decode();
        const c = document.createElement('canvas'); c.width = 8; c.height = 8; const x = c.getContext('2d'); x.drawImage(img, 0, 0, 8, 8);
        const d = x.getImageData(0, 0, 8, 8).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; return s / 64; }, shot.toString('base64'));
      const ph = phase; cnt[ph][0]++; if (L < 10) { cnt[ph][1]++;
        if (process.env.DUMP) blackInfo.push(await pg.evaluate(() => ({ ph: +window.__ep.useEditor.getState().playhead.toFixed(2), s: window.__epPreviewStats.mode + ' ' + window.__epPreviewStats.reason,
          vids: [...document.querySelectorAll('.ep-pv-host video')].map((v) => v.style.opacity + '/' + v.readyState + '/' + v.currentTime.toFixed(2) + (v.seeking ? 's' : '')).join(' ') }))); }
    } catch {} } })();
    await pg.evaluate(() => window.__ep.useEditor.getState().setPlaying(true));
    for (let i = 0; i < 6; i++) { await pg.waitForTimeout(800); await pg.evaluate(() => { const s = window.__ep.useEditor.getState(); const at = s.playhead + 0.6;
      const tr = s.project.tracks.find((t) => t.kind === 'video'); const c = tr.clips.find((c) => at > c.start && at < c.start + c.duration); if (c) s.dispatch({ op: 'split_clip', clipId: c.id, at }); }); }
    await pg.waitForTimeout(600);
    await pg.evaluate(() => window.__ep.useEditor.getState().setPlaying(false)); phase = 'paused';
    await pg.evaluate(() => window.__ep.useEditor.getState().setPlayhead(1));
    await pg.evaluate(() => window.__ep.useEditor.getState().applyLive([{ op: 'ripple_delete', start: 1.5, end: 2.2 }, { op: 'ripple_delete', start: 3.0, end: 3.6 }, { op: 'ripple_delete', start: 4.5, end: 5.0 }, { op: 'ripple_delete', start: 6.0, end: 6.4 }], { delayMs: 500 }));
    await pg.waitForTimeout(800);
    phase = 'after'; await pg.evaluate(() => { const s = window.__ep.useEditor.getState(); s.setPlayhead(0); s.setPlaying(true); });
    await pg.waitForTimeout(5000); stop = true; await sampler;
    res.push({ run, play: cnt.play.join('/'), paused: cnt.paused[1] + ' de ' + cnt.paused[0], after: cnt.after.join('/'), ...(blackInfo.length ? { pretos: blackInfo } : {}) });
    await ctx.close();
  }
  console.log((MOBILE ? '[Pixel7 4x] ' : '[desktop] ') + JSON.stringify(res));
  await b.close();
})();
