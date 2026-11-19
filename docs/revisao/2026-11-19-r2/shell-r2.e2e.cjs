// E2E da rodada r2 da Shell (Playwright). Uso: suba "DASH_PASSWORD=teste123 npm run start -- -p 3100" e rode
// node shell-r2.e2e.cjs <pasta com teste.webm> [b2|desk|all]
const { chromium, devices } = require('playwright');
const S = process.argv[2];
const which = process.argv[3] || 'all';
const res = [];
const ok = (name, cond, extra = '') => res.push(`${cond ? 'OK ' : 'FALHOU'} ${name}${extra ? ' — ' + extra : ''}`);
async function login(p) {
  await p.goto('http://localhost:3100/login'); await p.fill('#pw', 'teste123'); await p.keyboard.press('Enter');
  await p.waitForSelector('.ep-home');
}
async function emptyEditor(p) { await p.locator('.ep-qa', { hasText: 'Editor vazio' }).click(); await p.waitForSelector('.ep-app'); await p.waitForTimeout(500); }
const fire = (p, ev, d) => p.evaluate(([e, d]) => window.dispatchEvent(new CustomEvent(e, { detail: d })), [ev, d]);
const clips = (p) => p.locator('[data-ep-clip]').count();

async function b2(name, dev) {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...dev }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await login(p); await emptyEditor(p);
  const mobile = (dev.viewport?.width ?? 1440) < 900;
  if (mobile) {
    await p.locator('.ep-mtscroll').evaluate((el) => el.scrollTo(600, 0));
    await p.click('.ep-mtitem:has-text("Gerar com IA")');
  } else await fire(p, 'ep:open-tool', { tool: 'media' });
  await p.waitForTimeout(400);
  await p.setInputFiles('.ep-media [data-ep-pick=gallery]', [`${S}/teste.webm`]);
  await p.waitForFunction(() => document.querySelectorAll('[data-ep-clip]').length >= 1, null, { timeout: 25000 });
  await p.waitForTimeout(600);
  await p.locator('.ep-media .ep-asset-actions button').last().click();
  await p.locator('.ep-asset-confirm button', { hasText: 'Remover' }).click();
  await p.waitForTimeout(300);
  const afterRemove = [await clips(p), await p.locator('.ep-media .ep-asset').count()];
  await p.locator('.ep-toastact', { hasText: 'Desfazer' }).last().click();
  await p.waitForTimeout(500);
  const afterUndo = [await clips(p), await p.locator('.ep-media .ep-asset').count()];
  ok(`B2 remover mídia + Desfazer [${name}]`, afterRemove[0] === 0 && afterRemove[1] === 0 && afterUndo[0] === 1 && afterUndo[1] === 1, `após remover clipes/assets=${afterRemove} · após desfazer=${afterUndo} ${errs.join('|')}`);
  await b.close();
}

async function desktopFlows() {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => {
    window.__micStopped = false;
    navigator.mediaDevices.getUserMedia = () => new Promise((res) => setTimeout(() => {
      const ac = new AudioContext(); const d = ac.createMediaStreamDestination(); const osc = ac.createOscillator(); osc.connect(d); osc.start();
      const s = d.stream; s.getTracks().forEach((t) => { const o = t.stop.bind(t); t.stop = () => { window.__micStopped = true; o(); }; });
      res(s);
    }, 2500));
  });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await login(p); await emptyEditor(p);
  // B1
  await fire(p, 'ep:open-tool', { tool: 'text' }); await p.waitForTimeout(400);
  await p.locator('.ep-side button', { hasText: 'Adicionar texto' }).click(); await p.waitForTimeout(300);
  await p.locator('.ep-side button', { hasText: 'Adicionar texto' }).click(); await p.waitForTimeout(400);
  const tc = (await p.locator('[data-ep-clip]').evaluateAll((els) => els.map((e) => ({ id: e.getAttribute('data-ep-clip'), x: e.getBoundingClientRect().left })))).sort((a, b) => a.x - b.x);
  const [A, B] = tc;
  await p.locator(`[data-ep-clip="${A.id}"]`).click({ position: { x: 6, y: 10 }, force: true }); await p.waitForTimeout(300);
  const inicio = p.locator('input[aria-label="Início do texto"]');
  await inicio.click(); await p.keyboard.press('Control+A'); await p.keyboard.type('0:08');
  await p.locator(`[data-ep-clip="${B.id}"]`).click({ position: { x: 6, y: 10 }, force: true }); await p.waitForTimeout(300);
  await p.mouse.click(700, 300); await p.waitForTimeout(400);
  const startOf = async (id) => { await p.locator(`[data-ep-clip="${id}"]`).click({ position: { x: 6, y: 10 }, force: true }); await p.waitForTimeout(250); return p.locator('input[aria-label="Início do texto"]').inputValue(); };
  const sA = await startOf(A.id), sB = await startOf(B.id);
  ok('B1 texto digitado não vai para o outro clipe', !/0:08/.test(sB), `A=${sA} B=${sB}`);
  // B8
  await fire(p, 'ep:open-tool', { tool: 'music' }); await p.waitForTimeout(400);
  await p.locator('.ep-side .ep-recbtn').click();
  await p.waitForTimeout(2700);
  await fire(p, 'ep:open-tool', { tool: 'text' });
  await p.waitForTimeout(3500);
  ok('B8 microfone desligado após trocar de ferramenta', await p.evaluate(() => window.__micStopped));
  // B3
  await p.waitForTimeout(1500);
  await p.locator('.ep-navitem', { hasText: 'Meus projetos' }).first().click().catch(() => {});
  await p.waitForSelector('.ep-home');
  await p.waitForTimeout(600);
  await p.locator('.ep-proj-more').first().click();
  await p.locator('.ep-proj-menu button', { hasText: 'Renomear' }).click();
  await p.fill('.ep-proj-rename', 'Projeto Renomeado R2'); await p.keyboard.press('Enter');
  await p.waitForTimeout(800);
  const listNow = await p.locator('.ep-projrow').first().textContent();
  await p.reload(); await p.waitForTimeout(2500);
  const afterReload = await p.evaluate(() => document.body.innerText.includes('Projeto Renomeado R2') || [...document.querySelectorAll('input')].some((i) => i.value === 'Projeto Renomeado R2'));
  ok('B3 renomear o projeto aberto pela Home grava', /Projeto Renomeado R2/.test(listNow || '') && afterReload, `lista=${(listNow || '').slice(0, 40)} recarregado=${afterReload}`);
  // B9
  const sw = await p.evaluate(async () => {
    if (!navigator.serviceWorker) return 'sem SW';
    await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(r, 5000))]);
    const c = await caches.open('editorpro-static');
    for (let i = 0; i < 220; i++) await c.put(`/_next/static/fake-${i}.js`, new Response('x'));
    return (await caches.keys()).join(',');
  });
  // "deploy novo": um chunk que ainda não está no cache passa pelo SW e dispara a poda
  await p.evaluate(async () => { const src = [...document.scripts].map((x) => x.src).find((x) => x.includes('/_next/static/')); await fetch(src + '?deploy=' + Date.now()); });
  await p.waitForTimeout(1500);
  const swAfter = await p.evaluate(async () => ({ keys: (await caches.keys()).join(','), n: (await (await caches.open('editorpro-static')).keys()).length, ctrl: !!navigator.serviceWorker?.controller }));
  ok('B9 service worker: sem cache v1 e estáticos ≤ 150', !/editorpro-v1/.test(swAfter.keys) && swAfter.n <= 150, `antes=${sw} depois=${JSON.stringify(swAfter)}`);
  // B5
  if (!(await p.isVisible('.ep-home'))) { await p.locator('.ep-navitem', { hasText: 'Meus projetos' }).first().click().catch(() => {}); await p.waitForSelector('.ep-home'); }
  await p.click('.ep-qa.on'); await p.waitForSelector('.ep-wiz');
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('.ep-dz >> nth=0 >> .ep-dz-hit')]);
  await fc.setFiles([`${S}/teste.webm`]);
  await p.click('.ep-exchip >> nth=0'); await p.click('.ep-go');
  await p.waitForTimeout(150);
  const backDisabled = await p.locator('.ep-wiz button[aria-label="Voltar"]').isDisabled({ timeout: 500 }).catch(() => 'sumiu');
  await p.waitForSelector('.ep-app', { timeout: 60000 });
  ok('B5 Voltar desabilitado enquanto o wizard prepara a mídia', backDisabled === true || backDisabled === 'sumiu', `disabled=${backDisabled}`);
  if (errs.length) res.push('erros de página: ' + errs.join(' | '));
  await b.close();
}

(async () => {
  if (which === 'all' || which === 'b2') {
    await b2('desktop', { viewport: { width: 1440, height: 900 } });
    await b2('Pixel 7', devices['Pixel 7']);
    await b2('iPhone SE', devices['iPhone SE']);
  }
  if (which === 'all' || which === 'desk') await desktopFlows();
  console.log(res.join('\n'));
})().catch((e) => { console.log(res.join('\n')); console.error(String(e).slice(0, 400)); process.exit(1); });
