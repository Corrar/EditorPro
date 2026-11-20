// r3 (retire 4 s): roteiro blink2 (mobile 4x) com sonda por rAF dentro da página: no modo nativo, algum
// <video> visível (opacidade > .5)? no canvas, pixel central preto? + linha do tempo de opacidade/remoção.
// Uso (com CPU carregada p/ deixar os seeks lentos): node burn.cjs 4 700 & node retire.cjs <dir> mobile 6
// Antes: 4 de 6 rodadas com "nativo sem video visível" (elemento exibido removido pelo prazo de 4 s); agora 0.
const { chromium, devices } = require('playwright');
const SP = process.argv[2]; const MOBILE = process.argv[3] === 'mobile'; const RUNS = Number(process.argv[4] || 3);
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
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
    await pg.evaluate(() => {
      const W = window; W.__bad = []; W.__rm = []; W.__phase = 'play';
      const host = document.querySelector('.ep-pv-host'); const cv = document.querySelector('[data-ep-preview]');
      const orig = HTMLMediaElement.prototype.remove;
      HTMLMediaElement.prototype.remove = function () { if (parseFloat(this.style.opacity || '0') > 0.5) W.__rm.push({ ph: W.__ep.useEditor.getState().playhead, phase: W.__phase, stack: new Error().stack.split('\n').slice(1, 6).join(' | ') }); return orig.call(this); };
      W.__ev = []; let idn = 0; const idOf = (v) => v.__id ?? (v.__id = ++idn);
      const mo = new MutationObserver((ms) => { for (const m of ms) {
        if (m.type === 'childList') for (const n of m.removedNodes) if (n.tagName === 'VIDEO') W.__ev.push({ t: performance.now() | 0, ph: +W.__ep.useEditor.getState().playhead.toFixed(2), ev: 'rm#' + idOf(n) + ' op' + n.style.opacity + ' ct' + n.currentTime.toFixed(2) });
        if (m.type === 'childList') for (const n of m.addedNodes) if (n.tagName === 'VIDEO') W.__ev.push({ t: performance.now() | 0, ph: +W.__ep.useEditor.getState().playhead.toFixed(2), ev: 'add#' + idOf(n) });
        if (m.type === 'attributes' && m.target.tagName === 'VIDEO') { const v = m.target; const was = /opacity: ([\d.]+)/.exec(m.oldValue || '')?.[1]; const now = v.style.opacity; if (was !== now && (parseFloat(was) > 0.5) !== (parseFloat(now) > 0.5)) W.__ev.push({ t: performance.now() | 0, ph: +W.__ep.useEditor.getState().playhead.toFixed(2), ev: 'op#' + idOf(v) + ' ' + was + '→' + now + ' rs' + v.readyState + ' ct' + v.currentTime.toFixed(2) + (v.seeking ? 's' : '') }); }
      } });
      mo.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'], attributeOldValue: true });
      const probe = () => {
        const st = W.__epPreviewStats; const vids = [...host.querySelectorAll('video')];
        const vis = vids.filter((v) => parseFloat(v.style.opacity || '0') > 0.5);
        let bad = '';
        if (st.mode === 'nativo') { if (!vis.length) bad = 'nativo sem video visível'; }
        else { const x = cv.getContext('2d').getImageData(cv.width >> 1, cv.height >> 1, 1, 1).data; if (x[0] + x[1] + x[2] < 15) bad = 'canvas preto'; }
        if (bad) W.__bad.push({ bad, ph: +W.__ep.useEditor.getState().playhead.toFixed(2), phase: W.__phase, reason: st.reason, playing: W.__ep.useEditor.getState().playing,
          vids: vids.map((v) => (v.style.opacity || '-') + '/' + v.readyState + '/' + v.currentTime.toFixed(2) + (v.seeking ? 's' : '') + (v.paused ? 'p' : '')).join(' ') });
        requestAnimationFrame(probe);
      };
      requestAnimationFrame(probe);
    });
    await pg.evaluate(() => window.__ep.useEditor.getState().setPlaying(true));
    for (let i = 0; i < 6; i++) { await pg.waitForTimeout(800); await pg.evaluate(() => { const s = window.__ep.useEditor.getState(); const at = s.playhead + 0.6;
      const tr = s.project.tracks.find((t) => t.kind === 'video'); const c = tr.clips.find((c) => at > c.start && at < c.start + c.duration); if (c) s.dispatch({ op: 'split_clip', clipId: c.id, at }); }); }
    await pg.waitForTimeout(600);
    await pg.evaluate(() => { window.__phase = 'paused'; window.__ep.useEditor.getState().setPlaying(false); });
    await pg.evaluate(() => window.__ep.useEditor.getState().setPlayhead(1));
    await pg.evaluate(() => window.__ep.useEditor.getState().applyLive([{ op: 'ripple_delete', start: 1.5, end: 2.2 }, { op: 'ripple_delete', start: 3.0, end: 3.6 }, { op: 'ripple_delete', start: 4.5, end: 5.0 }, { op: 'ripple_delete', start: 6.0, end: 6.4 }], { delayMs: 500 }));
    await pg.waitForTimeout(800);
    await pg.evaluate(() => { window.__phase = 'after'; const s = window.__ep.useEditor.getState(); s.setPlayhead(0); s.setPlaying(true); });
    await pg.waitForTimeout(5000);
    const r = await pg.evaluate(() => ({ bad: window.__bad, rm: window.__rm, ev: window.__ev }));
    // agrupa sequências
    const groups = []; for (const x of r.bad) { const g = groups[groups.length - 1]; if (g && g.bad === x.bad && g.phase === x.phase && Math.abs(g.last - x.ph) < 0.3) { g.n++; g.last = x.ph; } else groups.push({ ...x, n: 1, last: x.ph }); }
    console.log('run', run, JSON.stringify({ groups }, null, 0));
    if (groups.length) { const t0 = groups.length; console.log(r.ev.map((e) => e.t + ' ph' + e.ph + ' ' + e.ev).join('\n')); }
    await ctx.close();
  }
  await b.close();
})();
