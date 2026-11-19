// r2 biblioteca #3: 'Amei ❤️' com animação letra a letra mantém o coração colorido (pixels vermelhos).
// Uso: node emoji.js <scratch> [mobile]
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
  await pg.waitForFunction(() => !!window.__ep);
  const red = (anim, text) => pg.evaluate(async ({ anim, text }) => {
    const ep = window.__ep; const st = ep.useEditor.getState();
    st.newProject({ name: 'E', aspect: '9:16' }); st.dispatch({ op: 'set_project', patch: { background: '#202020' } });
    st.dispatch({ op: 'add_clip', trackId: 'track_text_1', clip: { id: 'tx', type: 'text', text, start: 0, duration: 10, position: { x: 0.5, y: 0.5 }, animation: anim, animationOut: 'none',
      style: { fontFamily: 'sans-serif', fontSize: 120, fontWeight: 700, color: '#ffffff', strokeColor: '#000', strokeWidth: 0, background: '', shadow: false, uppercase: false, align: 'center' } } });
    const blob = await ep.exportFrame(ep.useEditor.getState().project, {}, 5, 'draft');
    const img = new Image(); img.src = URL.createObjectURL(blob); await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data; let n = 0, other = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i] > 180 && d[i + 1] < 90 && d[i + 2] < 90) n++; else if (Math.abs(d[i] - d[i + 1]) > 60 || Math.abs(d[i + 1] - d[i + 2]) > 60) other++; }
    return { vermelho: n, outrasCores: other };
  }, { anim, text });
  const L = MOBILE ? '[Pixel7] ' : '[desktop] ';
  console.log(L + 'fade       ❤️ ', JSON.stringify(await red('fade', 'Amei ❤️')));
  console.log(L + 'char-fade  ❤️ ', JSON.stringify(await red('char-fade', 'Amei ❤️')));
  console.log(L + 'fade       👍🏽🇧🇷', JSON.stringify(await red('fade', 'Top 👍🏽🇧🇷')));
  console.log(L + 'char-pop   👍🏽🇧🇷', JSON.stringify(await red('char-pop', 'Top 👍🏽🇧🇷')));
  await b.close();
})();
