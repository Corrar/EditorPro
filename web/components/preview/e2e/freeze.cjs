// r2 preview #1/#2/#3: reverso, vídeo que nunca fica pronto e mídia sem url não congelam o canvas.
// Mede, tocando 3 s, quantas vezes o canvas muda (texto com keyframe de cor/tamanho por cima) e, parado,
// se o texto aparece. Uso: node freeze.js <scratch> [mobile]
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
  if (MOBILE) { const cdp = await ctx.newCDPSession(pg); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }); }
  const run = (label, kind) => pg.evaluate(async (kind) => {
    const ep = window.__ep; const st = ep.useEditor.getState(); const a0 = ep.assetsList()[0];
    st.newProject({ name: 'F', aspect: '9:16' }); st.addAsset(a0);
    let a = a0;
    if (kind === 'broken') { a = { ...a0, id: 'bad', url: URL.createObjectURL(new Blob([new Uint8Array(5000).fill(7)], { type: 'video/mp4' })), proxyUrl: undefined }; st.addAsset(a); }
    if (kind === 'nourl') { a = { ...a0, id: 'nourl', url: '', proxyUrl: undefined }; st.addAsset(a); }
    const T = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 };
    st.dispatch([
      { op: 'add_clip', trackId: 'track_video_1', clip: { id: 'v', type: 'video', assetId: a.id, start: 0, duration: 8, in: 2, speed: 1, volume: 1, transform: T, filters: [], ...(kind === 'reverse' ? { reverse: true } : {}) } },
      { op: 'add_clip', trackId: 'track_text_1', clip: { id: 'tx', type: 'text', text: 'TEXTO', start: 0, duration: 8, position: { x: 0.5, y: 0.3 },
        style: { fontFamily: 'Anton', fontSize: 90, fontWeight: 400, color: '#ffffff', strokeColor: '#000', strokeWidth: 0, background: '', shadow: false, uppercase: true, align: 'center' },
        keyframes: [{ t: 0, transform: {}, props: { 'style.fontSize': 60, 'style.color': '#ffffff' } }, { t: 6, transform: {}, props: { 'style.fontSize': 220, 'style.color': '#ff0000' } }] } },
    ]);
    st.setPlayhead(1);
    await new Promise((r) => setTimeout(r, 3500));
    const cv = document.querySelector('.ep-pv-frame canvas');
    const sm = document.createElement('canvas'); sm.width = 36; sm.height = 64; const sx = sm.getContext('2d', { willReadFrequently: true });
    const grab = () => { sx.clearRect(0, 0, 36, 64); sx.drawImage(cv, 0, 0, 36, 64); return sx.getImageData(0, 0, 36, 64).data; };
    const lit = (d) => { let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 3] > 200) n++; return n; };
    const still = lit(grab());
    const d0 = window.__epPreviewStats.draws;
    st.setPlaying(true);
    let changes = 0, prev = grab(), maxGap = 0, lastChange = performance.now(); const t0 = performance.now();
    await new Promise((res) => { const loop = () => { const cur = grab(); let diff = 0; for (let i = 0; i < cur.length; i += 4) diff += Math.abs(cur[i] - prev[i]); const now = performance.now();
      if (diff > 200) { changes++; maxGap = Math.max(maxGap, now - lastChange); lastChange = now; } prev = cur;
      if (now - t0 < 3000) requestAnimationFrame(loop); else { maxGap = Math.max(maxGap, now - lastChange); res(); } }; requestAnimationFrame(loop); });
    st.setPlaying(false);
    const s = window.__epPreviewStats;
    return { textoParado: still, mudancasTocando: changes, maiorParadaMs: Math.round(maxGap), draws: s.draws - d0, held: s.held, mode: s.mode, playhead: +window.__ep.useEditor.getState().playhead.toFixed(2) };
  }, kind).then((r) => console.log((MOBILE ? '[Pixel7 4x] ' : '[desktop] ') + label.padEnd(26), JSON.stringify(r)));
  await run('reverso', 'reverse');
  await run('vídeo quebrado', 'broken');
  await run('mídia sem url', 'nourl');
  await run('normal (controle)', 'normal');
  await b.close();
})();
