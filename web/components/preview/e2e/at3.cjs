// Caso da IA: playhead parado EXATAMENTE em 3,0 s; clipe que começa em 3,0 com efeito 'custom' (com e sem
// intensity) e texto que começa em 3,0 (sem animação e com 'pop'). Mede inversão de cor e texto no preview.
// Uso: node at3.js <scratch> [mobile]
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
  const shot = async () => { const s = await pg.locator('.ep-pv-frame').screenshot(); return pg.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = 54; c.height = 96; const x = c.getContext('2d'); x.drawImage(img, 0, 0, 54, 96);
    return Array.from(x.getImageData(0, 0, 54, 96).data); }, s.toString('base64')); };
  const diff = (a, b, y0 = 0, y1 = 96) => { let s = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = 0; x < 54; x++) { const i = (y * 54 + x) * 4; s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); n++; } return Math.round(s / n); };
  const setup = (fx, textAnim) => pg.evaluate(({ fx, textAnim }) => {
    const ep = window.__ep; const st = ep.useEditor.getState(); const a = ep.assetsList()[0];
    st.newProject({ name: 'A3', aspect: '9:16' }); st.addAsset(a);
    const T = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 };
    const code = 'vec4 effect(vec2 uv){vec4 c=tex(uv);return vec4(1.0-c.rgb,c.a);}';
    const ops = [
      { op: 'add_clip', trackId: 'track_video_1', clip: { id: 'a', type: 'video', assetId: a.id, start: 0, duration: 3, in: 0, speed: 1, volume: 1, transform: T, filters: [] } },
      { op: 'add_clip', trackId: 'track_video_1', clip: { id: 'b', type: 'video', assetId: a.id, start: 3, duration: 3, in: 3, speed: 1, volume: 1, transform: T, filters: [],
        ...(fx === 'none' ? {} : { effects: [fx === 'semIntensity' ? { kind: 'custom', code } : { kind: 'custom', intensity: 1, code }] }) } },
    ];
    if (textAnim) ops.push({ op: 'add_clip', trackId: 'track_text_1', clip: { id: 'tx', type: 'text', text: 'TEXTO 3s', start: 3, duration: 3, position: { x: 0.5, y: 0.2 }, ...(textAnim === 'nenhuma' ? { animation: 'none' } : { animation: textAnim }),
      style: { fontFamily: 'sans-serif', fontSize: 110, fontWeight: 800, color: '#ff00ff', strokeColor: '#000', strokeWidth: 0, background: '', shadow: false, uppercase: true, align: 'center' } } });
    st.dispatch(ops); st.setPlayhead(3);
  }, { fx, textAnim });
  const L = MOBILE ? '[Pixel7 4x] ' : '[desktop] ';
  await setup('none', null); await pg.waitForTimeout(2500); const base = await shot();
  for (const fx of ['comIntensity', 'semIntensity']) {
    await setup(fx, null); await pg.waitForTimeout(2500); const s = await shot();
    console.log(L + ('custom ' + fx).padEnd(26), 'diferença p/ sem efeito:', diff(base, s), '(invertido ≈ alto)', JSON.stringify({ mode: await pg.evaluate(() => window.__epPreviewStats.mode + ' ' + window.__epPreviewStats.reason) }));
  }
  for (const anim of ['nenhuma', 'pop', 'fade']) {
    await setup('none', anim); await pg.waitForTimeout(2500); const s = await shot();
    let mag = 0; for (let i = 0; i < s.length; i += 4) if (s[i] > 200 && s[i + 1] < 80 && s[i + 2] > 200) mag++;
    console.log(L + ('texto em 3,0 anim ' + anim).padEnd(26), 'pixels magenta:', mag);
  }
  await b.close();
})();
