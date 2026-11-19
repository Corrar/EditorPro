// r2 biblioteca #1: texto parado não fica na fonte reserva depois que a fonte carrega (cache de bitmap).
// O CSS do Google Fonts de 'Bangers' chega atrasado 2,5 s e aponta para uma fonte local bem diferente
// (DejaVu Sans Mono). Mede a largura do texto no preview parado antes e depois da fonte.
// Uso: node fontcache.js <scratch> [mobile]
const { chromium, devices } = require('playwright');
const fs = require('fs');
const SP = process.argv[2]; const MOBILE = process.argv[3] === 'mobile';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext(MOBILE ? { ...devices['Pixel 7'] } : { viewport: { width: 1280, height: 860 } });
  const TTF = fs.readFileSync('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf');
  await ctx.route('**/fonts.googleapis.com/**', async (route) => {
    const u = route.request().url();
    if (/Bangers/.test(u)) { await new Promise((r) => setTimeout(r, 2500));
      return route.fulfill({ contentType: 'text/css', body: "@font-face{font-family:'Bangers';font-style:normal;font-weight:400;src:url(https://fonts.gstatic.com/fake/bangers.ttf) format('truetype');}" }); }
    return route.fulfill({ contentType: 'text/css', body: '' });
  });
  await ctx.route('**/fonts.gstatic.com/**', (route) => route.fulfill({ contentType: 'font/ttf', body: TTF }));
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await pg.goto('http://localhost:3100/login');
  await pg.evaluate(() => fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'teste' }) }));
  await pg.goto('http://localhost:3100/dev/preview', { waitUntil: 'networkidle' });
  await pg.waitForFunction(() => !!window.__ep);
  await pg.evaluate(() => {
    const st = window.__ep.useEditor.getState();
    st.newProject({ name: 'Fonte', aspect: '9:16' });
    st.dispatch({ op: 'set_project', patch: { background: '#202020' } });
    st.dispatch({ op: 'add_clip', trackId: 'track_text_1', clip: { id: 'tx', type: 'text', text: 'iiii llll', start: 0, duration: 10, position: { x: 0.5, y: 0.5 }, animation: 'none', animationOut: 'none',
      style: { fontFamily: 'Bangers', fontSize: 90, fontWeight: 400, color: '#ffffff', strokeColor: '#000', strokeWidth: 0, background: '', shadow: false, uppercase: false, align: 'center' } } });
    st.setPlayhead(3);
  });
  const width = async () => {
    const shot = await pg.locator('.ep-pv-frame').screenshot();
    return pg.evaluate(async (b64) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data; let x0 = 1e9, x1 = -1;
      for (let y = 0; y < c.height; y++) for (let xx = 0; xx < c.width; xx++) { const i = (y * c.width + xx) * 4; if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) { x0 = Math.min(x0, xx); x1 = Math.max(x1, xx); } }
      return x1 >= 0 ? x1 - x0 + 1 : 0;
    }, shot.toString('base64'));
  };
  await pg.waitForTimeout(700);
  const before = await width();
  await pg.waitForTimeout(5000); // fonte chegou (2,5 s) e o preview redesenhou
  const after = await width();
  // referência: mesmo texto desenhado do zero agora (mexe no texto e volta, sem cache)
  await pg.evaluate(() => { const st = window.__ep.useEditor.getState(); st.dispatch({ op: 'update_clip', clipId: 'tx', patch: { text: 'iiii llll ' } }); });
  await pg.waitForTimeout(600);
  await pg.evaluate(() => { const st = window.__ep.useEditor.getState(); st.dispatch({ op: 'update_clip', clipId: 'tx', patch: { text: 'iiii llll' } }); });
  await pg.waitForTimeout(600);
  const fresh = await width();
  console.log((MOBILE ? '[Pixel7] ' : '[desktop] ') + JSON.stringify({ antesDaFonte: before, depoisDaFonte: after, desenhoNovo: fresh, ok: after === fresh && after !== before }));
  await b.close();
})();
