/* Regressão de UI da revisão r2 (bugs #5–#11), toque real via CDP em Pixel 7 / iPad Mini + desktop.
 * Uso: build + DASH_PASSWORD=perfteste npx next start -p 3100; depois: node lib/timeline/e2e/r2-ui.playwright.js */
const { chromium, devices } = require('playwright');
const BASE = 'http://localhost:3100';
const out = [];
const log = (...a) => { out.push(a.join(' ')); console.log(...a); };

async function open(browser, dev, q = '') {
  const ctx = await browser.newContext({ ...dev });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.request.post(BASE + '/api/login', { data: { password: 'perfteste' } });
  await page.goto(BASE + '/dev/timeline' + q, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-ep-clip]');
  await page.waitForTimeout(300);
  const cdp = await ctx.newCDPSession(page);
  const T = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y]) => ({ x, y })) });
  const tap = async (x, y, hold = 60) => { await T('touchStart', [[x, y]]); await page.waitForTimeout(hold); await T('touchEnd', []); await page.waitForTimeout(120); };
  const swipe = async (x0, y0, x1, y1, steps = 10) => {
    await T('touchStart', [[x0, y0]]);
    for (let i = 1; i <= steps; i++) { await T('touchMove', [[x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps]]); await page.waitForTimeout(16); }
    await T('touchEnd', []);
    await page.waitForTimeout(250);
  };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  return { ctx, page, errs, tap, swipe, ev };
}
const mainClips = () => { const p = window.__ep.getState().project; return p.tracks.find((t) => t.kind === 'video' && t.clips.length).clips.map((c) => c.id); };
const nClips = () => window.__ep.getState().project.tracks.reduce((n, t) => n + t.clips.length, 0);

(async () => {
  const browser = await chromium.launch();

  /* ---------- Pixel 7 (modo centro): #5 lâmina, #10 trecho na régua, #11 ajustar ---------- */
  {
    const { ctx, page, errs, tap, swipe, ev } = await open(browser, devices['Pixel 7']);
    await ev(() => window.__tlui.getState().set({ tool: 'blade' }));
    const id = (await ev(mainClips))[1];
    const b = await page.locator(`[data-clip-id="${id}"]`).boundingBox();
    const y = b.y + b.height / 2;
    const x = Math.min(b.x + b.width / 2, 380);
    const n0 = await ev(nClips);
    const sc0 = await ev(() => document.querySelector('[data-ep-timeline]').scrollLeft);
    await swipe(x, y, x - 120, y);
    const sc1 = await ev(() => document.querySelector('[data-ep-timeline]').scrollLeft);
    const n1 = await ev(nClips);
    log('#5 Pixel 7 · arrastar com lâmina: rolou', Math.round(sc0), '→', Math.round(sc1), '· clipes', n0, '→', n1, n1 === n0 ? 'OK (não cortou)' : 'FALHOU');
    let b2 = null;
    for (const cid of await ev(mainClips)) {
      const bb = await page.locator(`[data-clip-id="${cid}"]`).boundingBox();
      if (bb && bb.x < 380 && bb.x + bb.width > 40) { b2 = bb; break; }
    }
    if (b2) {
      await tap(Math.max(b2.x + 20, 40), b2.y + b2.height / 2);
      const n2 = await ev(nClips);
      log('#5 Pixel 7 · toque parado com lâmina: clipes', n1, '→', n2, n2 === n1 + 1 ? 'OK (cortou)' : 'FALHOU');
    } else log('#5 clipe fora da tela para o toque parado');
    await ev(() => window.__tlui.getState().set({ tool: 'select' }));

    // #10 trecho na régua
    await ev(() => window.__tlui.getState().set({ rangeMode: true, range: null }));
    await page.waitForTimeout(100);
    const rb = await page.locator('.ep-tl-scale').boundingBox();
    await swipe(rb.x + 140, rb.y + rb.height / 2, rb.x + 260, rb.y + rb.height / 2);
    const range = await ev(() => window.__tlui.getState().range);
    log('#10 Pixel 7 · arrastar a régua com "Selecionar trecho":', JSON.stringify(range), range && range.end - range.start > 0.1 ? 'OK' : 'FALHOU');
    await ev(() => window.__tlui.getState().set({ rangeMode: false, range: null, rangePop: null }));

    // #11 ajustar à tela mantém o playhead
    await ev(() => { window.__ep.getState().setPlaying(false); window.__ep.getState().setPlayhead(8); });
    await page.waitForTimeout(300);
    await page.locator('.ep-tl-cmore').click();
    await page.getByRole('menuitem', { name: /Ajustar à tela/ }).click();
    await page.waitForTimeout(500);
    const ph = await ev(() => window.__ep.getState().playhead);
    log('#11 Pixel 7 · "Ajustar à tela" com playhead em 8 s →', ph.toFixed(2), Math.abs(ph - 8) < 0.05 ? 'OK' : 'FALHOU');
    log('Pixel 7 erros:', errs.length ? errs.join(' | ') : 'nenhum');
    await ctx.close();
  }

  /* ---------- iPad Mini (toque, não centro): #7 timer órfão, #8 seleção com vínculo ---------- */
  {
    const { ctx, page, errs, tap, ev } = await open(browser, devices['iPad Mini']);
    const [v1] = await ev(mainClips);
    // vincula o 1º vídeo a um áudio que comece em 0
    const audioId = await ev((v) => {
      const st = window.__ep.getState();
      const a = st.project.tracks.filter((t) => t.kind === 'audio').flatMap((t) => t.clips)[0];
      st.dispatch([{ op: 'update_clip', clipId: v, patch: { linkId: 'LK' } }, { op: 'update_clip', clipId: a.id, patch: { linkId: 'LK' } }]);
      st.select([]);
      return a.id;
    }, v1);
    await page.locator(`[data-clip-id="${v1}"]`).scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    let b = await page.locator(`[data-clip-id="${v1}"]`).boundingBox();
    await tap(b.x + 30, b.y + b.height / 2);
    const sel = await ev(() => window.__ep.getState().selection);
    log('#8 iPad · toque no vídeo vinculado seleciona', JSON.stringify(sel), sel.includes(audioId) ? 'OK' : 'FALHOU');
    // #7: trilha travada + toque rápido num clipe já selecionado não abre menu depois
    await ev((v) => {
      const st = window.__ep.getState();
      const tr = st.project.tracks.find((t) => t.clips.some((c) => c.id === v));
      st.dispatch({ op: 'update_track', trackId: tr.id, patch: { locked: true } });
      st.select([v]);
      window.__tlui.getState().set({ menu: null });
    }, v1);
    b = await page.locator(`[data-clip-id="${v1}"]`).boundingBox();
    await tap(b.x + 30, b.y + b.height / 2, 50);
    await page.waitForTimeout(800);
    const menu = await ev(() => window.__tlui.getState().menu);
    log('#7 iPad · toque rápido em clipe de trilha travada: menu', menu ? 'ABRIU (FALHOU)' : 'não abriu (OK)');
    // toque longo de verdade ainda abre o menu
    await tap(b.x + 30, b.y + b.height / 2, 700);
    const menu2 = await ev(() => window.__tlui.getState().menu);
    log('#7 iPad · toque longo ainda abre o menu:', menu2 ? 'OK' : 'FALHOU');
    log('iPad erros:', errs.length ? errs.join(' | ') : 'nenhum');
    await ctx.close();
  }

  /* ---------- Desktop: #6 texto do marcador, #9 setas após botão de ferramenta ---------- */
  {
    const { ctx, page, errs, ev } = await open(browser, { viewport: { width: 1440, height: 900 } });
    // #9
    await ev(() => window.__ep.getState().setPlayhead(2));
    await page.getByRole('radio', { name: 'Lâmina' }).click();
    await page.getByRole('radio', { name: 'Seleção' }).click();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    const ph = await ev(() => window.__ep.getState().playhead);
    await page.keyboard.press('End');
    const ph2 = await ev(() => window.__ep.getState().playhead);
    log('#9 desktop · após clicar nas ferramentas: → → =', ph.toFixed(3), '· End =', ph2.toFixed(2), ph > 2.05 && ph2 > 5 ? 'OK' : 'FALHOU');
    // #6
    const marks = await ev(() => (window.__ep.getState().project.markers || []).filter((m) => m.kind !== 'beat').map((m) => ({ id: m.id, label: m.label || '' })));
    if (marks.length >= 2) {
      const [m1, m2] = marks;
      await page.locator(`[data-marker-id="${m1.id}"]`).first().click();
      await page.waitForTimeout(150);
      const inp = page.locator('.ep-tl-mpop input, .ep-tl-mpop textarea').first();
      await inp.fill('TEXTO NOVO');
      await page.locator(`[data-marker-id="${m2.id}"]`).first().click();
      await page.waitForTimeout(250);
      const lab = await ev((id) => window.__ep.getState().project.markers.find((m) => m.id === id).label, m1.id);
      const openId = await ev(() => window.__tlui.getState().markerPop?.id);
      log('#6 desktop · digitar e clicar outro marcador: label salvo =', JSON.stringify(lab), lab === 'TEXTO NOVO' ? 'OK' : 'FALHOU', '· popover agora em', openId === m2.id ? 'o 2º (OK)' : String(openId));
    } else log('#6 sem 2 marcadores no harness');
    log('desktop erros:', errs.length ? errs.join(' | ') : 'nenhum');
    await ctx.close();
  }
  await browser.close();
})();
