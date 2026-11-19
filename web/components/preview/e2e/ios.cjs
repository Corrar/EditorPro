// r2 preview #4/#5 com as restrições do iOS emuladas no Chromium (não há WebKit no container):
// play() com som só dentro de um gesto (por elemento) e HTMLMediaElement.volume só leitura.
// Uso: node ios.js <scratch>
const { chromium, devices } = require('playwright');
const SP = process.argv[2];
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['iPhone 13'] });
  await ctx.addInitScript(() => {
    const ok = new WeakSet(); /* iOS: elemento que já tocou com som num gesto fica liberado */ const P = HTMLMediaElement.prototype; const play0 = P.play;
    P.play = function () { if (!this.muted && navigator.userActivation.isActive) ok.add(this); if (!this.muted && !navigator.userActivation.isActive && !ok.has(this)) { window.__plays = (window.__plays || 0) + 1; return Promise.reject(new DOMException('gesto', 'NotAllowedError')); } return play0.call(this); };
    Object.defineProperty(P, 'volume', { get() { return 1; }, set() {} });
    window.__mes = 0; const AC = window.AudioContext; const c0 = AC.prototype.createMediaElementSource;
    AC.prototype.createMediaElementSource = function (el) { window.__mes++; return c0.call(this, el); };
  });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await pg.goto('http://localhost:3100/login');
  await pg.evaluate(() => fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'teste' }) }));
  await pg.goto('http://localhost:3100/dev/preview', { waitUntil: 'networkidle' });
  await pg.setInputFiles('[data-testid=files]', [SP + '/phone.mp4']);
  await pg.waitForFunction(() => window.__ep && window.__ep.assetsList().length > 0);
  await pg.evaluate(() => {
    const ep = window.__ep; const st = ep.useEditor.getState(); const a = ep.assetsList()[0];
    st.newProject({ name: 'iOS', aspect: '9:16' }); st.addAsset(a);
    const T = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 };
    st.dispatch({ op: 'add_clip', trackId: 'track_video_1', clip: { id: 'v1', type: 'video', assetId: a.id, start: 0, duration: 10, in: 0, speed: 1, volume: 1, transform: T, filters: [] } });
    st.setPlayhead(1);
  });
  await pg.waitForTimeout(1500);
  await pg.touchscreen.tap(5, 5); // 1º gesto: destrava
  await pg.waitForTimeout(500);
  // clipe novo DEPOIS do 1º toque (PiP na 2ª trilha de vídeo) → elemento criado fora de gesto
  await pg.evaluate(() => {
    const st = window.__ep.useEditor.getState(); const a = window.__ep.assetsList()[0];
    st.dispatch({ op: 'add_track', track: { id: 'track_video_2', kind: 'overlay', name: 'PiP', clips: [] } });
    st.dispatch({ op: 'add_clip', trackId: 'track_video_2', clip: { id: 'v2', type: 'video', assetId: a.id, start: 0, duration: 10, in: 15, speed: 1, volume: 1, transform: { x: 0.2, y: 0.2, scale: 0.4, rotation: 0, opacity: 1 }, filters: [] } });
  });
  await pg.waitForTimeout(6500); // passa a janela de ativação transitória (~5 s) do gesto
  const els = () => pg.evaluate(() => [...document.querySelectorAll('.ep-pv-host video')].map((v) => ({ t: +v.currentTime.toFixed(2), paused: v.paused, muted: v.muted })));
  // play SEM gesto: o evaluate do Playwright conta como gesto por ~5 s, então espera dentro da página
  const r = await pg.evaluate(async () => {
    const snap = () => [...document.querySelectorAll('.ep-pv-host video')].map((v) => ({ t: +v.currentTime.toFixed(2), paused: v.paused, muted: v.muted }));
    await new Promise((res) => setTimeout(res, 6000));
    const act = navigator.userActivation.isActive; const before = snap();
    window.__ep.useEditor.getState().setPlaying(true);
    await new Promise((res) => setTimeout(res, 2000));
    return { act, before, during: snap(), rej: window.__plays || 0 };
  });
  const advanced = r.during.filter((e, i) => r.before[i] && e.t - r.before[i].t > 1).length;
  console.log('#4 sem gesto (ativação', r.act + '): elementos', r.during.length, 'avançando', advanced, 'plays recusados', r.rej, JSON.stringify(r.during));
  await pg.touchscreen.tap(5, 5); // novo gesto: abençoa o elemento novo
  await pg.waitForTimeout(800);
  console.log('#4 depois do 2º toque:', JSON.stringify(await els()));
  // #5: volume 0.3 com volume do elemento só leitura → precisa do GainNode
  const mes0 = await pg.evaluate(() => window.__mes);
  await pg.evaluate(() => window.__ep.useEditor.getState().dispatch({ op: 'update_clip', clipId: 'v1', patch: { volume: 0.3 } }));
  await pg.waitForTimeout(800);
  console.log('#5 createMediaElementSource após volume 0.3:', (await pg.evaluate(() => window.__mes)) - mes0);
  await b.close();
})();
