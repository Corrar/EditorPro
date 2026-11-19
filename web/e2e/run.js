#!/usr/bin/env node
/* =====================================================================
   EditorPro — suíte de regressão E2E (sessão de QA).
   Uso:  npm run e2e                 (sobe `next start` na 3100 se preciso)
         node e2e/run.js --profiles=desktop,pixel7 --cases=flow,playback
   Pré-requisito: `npm run build` (o script e2e roda contra o build de produção).
   Saída: e2e/REPORT.md, e2e/results.json, capturas em e2e/shots/.
   ===================================================================== */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const L = require('./lib');
const { ensureMedia, analyzeExport } = require('./media');

const argv = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? '1']; }));
const PROFILE_IDS = (argv.profiles || 'desktop,pixel7,iphonese').split(',');
const CASES = (argv.cases || 'flow,playback,fluidity,export,layout,cursor,popup,formats').split(',');
const results = []; // { profile, case, status, metrics, shots, notes }
const rec = (profile, kase, status, metrics = {}, shots = [], notes = '') => {
  const r = { profile, case: kase, status, metrics, shots: shots.filter(Boolean), notes };
  results.push(r);
  console.log(`[${profile}] ${kase}: ${status.toUpperCase()} ${JSON.stringify(metrics).slice(0, 300)} ${notes}`);
  return r;
};

/* ---------------- servidor ---------------- */
async function up() { try { const r = await fetch(`${L.BASE}/login`); return r.ok; } catch { return false; } }
let server = null;
async function ensureServer() {
  if (await up()) return;
  if (!fs.existsSync(path.join(__dirname, '..', '.next', 'BUILD_ID'))) throw new Error('Sem build: rode `npm run build` antes de `npm run e2e`.');
  const port = new URL(L.BASE).port || '3100';
  server = spawn('npx', ['next', 'start', '-p', port], { cwd: path.join(__dirname, '..'), env: { ...process.env, DASH_PASSWORD: process.env.E2E_PASSWORD || 'demo', PORT: port }, stdio: 'ignore', detached: true });
  for (let i = 0; i < 60; i++) { if (await up()) return; await L.sleep(500); }
  throw new Error('servidor não subiu em 30 s');
}
function stopServer() { if (server) { try { process.kill(-server.pid); } catch {} server = null; } }

/* ---------------- passos comuns no app ---------------- */

/** rastreia o cursor da IA (caso 6) a cada 100 ms */
async function installCursorProbe(page) {
  await page.evaluate(() => {
    const q = window.__qaCursor = { polls: 0, seen: 0, out: 0, outs: [], running: 0 };
    q.timer = setInterval(() => {
      q.polls++;
      const el = document.querySelector('.ep-aicursor');
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) return;
      if (r.left < -40 && r.top < -40) return; // posição inicial fora (-100,-100) antes de mover
      q.seen++;
      const vw = innerWidth, vh = innerHeight;
      // a ponta da seta (canto sup. esquerdo) precisa estar na tela; a etiqueta pode encostar na borda
      if (r.left < -1 || r.top < -1 || r.left > vw + 1 || r.top > vh + 1) { q.out++; if (q.outs.length < 5) q.outs.push({ l: Math.round(r.left), t: Math.round(r.top), vw, vh }); }
      // balão de explicação
      const b = document.querySelector('.ep-aicursor-bubble');
      if (b) { const br = b.getBoundingClientRect(); if (br.left < -1 || br.right > vw + 1 || br.top < -1 || br.bottom > vh + 1) { q.bubbleOut = (q.bubbleOut || 0) + 1; if (!q.bubbleRect) q.bubbleRect = { l: Math.round(br.left), r: Math.round(br.right), t: Math.round(br.top), b: Math.round(br.bottom), vw, vh }; } }
    }, 100);
  });
}
async function readCursorProbe(page) {
  return page.evaluate(() => { const q = window.__qaCursor; if (!q) return null; clearInterval(q.timer); const { timer, ...rest } = q; return rest; });
}

/** Começar → descrever → anexar → Editar com IA → "Pronto!" (pula a transcrição: Whisper/HF fora do container) */
async function wizardFlow(page, file, tag) {
  const t0 = Date.now();
  await page.goto('/');
  const start = page.getByRole('button', { name: 'Começar' }).first();
  await start.waitFor({ state: 'visible', timeout: 20000 });
  await start.click();
  await page.waitForSelector('#ep-brief', { timeout: 10000 });
  await page.fill('#ep-brief', 'Reels dinâmico com cortes rápidos, legendas grandes e zoom nas frases de impacto');
  await page.locator('.ep-dz input[type=file]').first().setInputFiles(file);
  await page.waitForSelector('.ep-fchips', { timeout: 10000 });
  const shotWiz = await L.shot(page, `${tag}-wizard`);
  await installCursorProbe(page);
  await page.click('button.ep-go');
  let skipped = false;
  const deadline = Date.now() + 150000;
  let done = false;
  while (Date.now() < deadline) {
    const txt = await page.evaluate(() => document.body.innerText);
    if (/Pronto!/.test(txt)) { done = true; break; }
    if (!skipped) {
      const skip = page.getByRole('button', { name: 'Pular legendas' }).first();
      if (await skip.isVisible().catch(() => false)) { await skip.click().catch(() => {}); skipped = true; }
    }
    await L.sleep(400);
  }
  const ms = Date.now() - t0;
  const cursor = await readCursorProbe(page);
  return { done, ms, skipped, cursor, shotWiz };
}

/** aguarda o editor ficar parado (sem live) e o canvas existir */
async function editorIdle(page) {
  await page.waitForSelector('canvas[data-ep-preview]', { timeout: 20000 });
  await L.sleep(1800); // auto-minimizar do pop-up (1,4 s) e assentar
}

/* ---------------- caso 2/3: reprodução no harness /dev/preview ---------------- */

async function loadHarness(page, file) {
  await page.goto('/dev/preview');
  await page.waitForFunction(() => !!window.__ep, null, { timeout: 20000 });
  await page.setInputFiles('[data-testid=files]', file);
  await page.waitForFunction(() => {
    const st = window.__ep.useEditor.getState();
    return st.project.tracks.some((t) => t.clips.length) && (window.__epPreviewStats?.draws || 0) > 0;
  }, null, { timeout: 30000 });
  await L.sleep(800);
  await L.installSampler(page);
}

async function samplePhase(page, label, fn) {
  await page.evaluate((l) => window.__qa.start(l), label);
  await fn();
  const res = await page.evaluate(() => window.__qa.stop());
  return L.summarizeSamples(res);
}

async function playbackCases(page, tag, profile, file) {
  await loadHarness(page, file);
  const ev = (f, a) => page.evaluate(f, a);
  const phases = {};
  // A) play limpo 5 s (projeto demo tem 5 s: toca do início ao fim)
  await ev(() => { const s = window.__ep.useEditor.getState(); s.setPlayhead(0); });
  await L.sleep(300);
  phases.play = await samplePhase(page, 'play', async () => {
    await ev(() => window.__ep.useEditor.getState().setPlaying(true));
    await L.sleep(5200);
  });
  const shotPlay = await L.shot(page, `${tag}-harness-play`);

  // B) cortes durante a reprodução: split_clip e ripple_delete no ponto à frente do playhead
  await ev(() => { window.__ep.buildDemo(window.__ep.assetsList()); });
  await L.sleep(800);
  phases.cutsPlaying = await samplePhase(page, 'cutsPlaying', async () => {
    await ev(() => { const s = window.__ep.useEditor.getState(); s.setPlayhead(0); s.setPlaying(true); });
    await L.sleep(700);
    await ev(() => { const s = window.__ep.useEditor.getState(); window.__qa.mark('split'); s.dispatch({ op: 'split_clip', clipId: 'clipA', at: Math.min(1.9, s.playhead + 0.25), newId: 'qaA2' }); });
    await L.sleep(700);
    await ev(() => { const s = window.__ep.useEditor.getState(); const t = s.playhead; window.__qa.mark('ripple'); s.dispatch({ op: 'ripple_delete', start: t + 0.2, end: t + 0.6 }); });
    await L.sleep(700);
    await ev(() => { const s = window.__ep.useEditor.getState(); const c = s.project.tracks.flatMap((x) => x.clips).find((k) => k.type === 'video' && k.start <= s.playhead + 0.3 && k.start + k.duration > s.playhead + 0.3); if (c) s.dispatch({ op: 'split_clip', clipId: c.id, at: s.playhead + 0.3 }); });
    await L.sleep(1800);
    await ev(() => window.__ep.useEditor.getState().setPlaying(false));
  });

  // C) cortes pausado (seek + split + ripple; o quadro parado não pode ficar preto)
  await ev(() => { window.__ep.buildDemo(window.__ep.assetsList()); });
  await L.sleep(800);
  phases.cutsPaused = await samplePhase(page, 'cutsPaused', async () => {
    for (const t of [0.6, 1.4, 2.6, 3.2]) {
      await ev((tt) => {
        const s = window.__ep.useEditor.getState();
        s.setPlayhead(tt);
        const c = s.project.tracks.flatMap((x) => x.clips).find((k) => k.type === 'video' && k.start < tt && k.start + k.duration > tt + 0.05);
        if (c) s.dispatch({ op: 'split_clip', clipId: c.id, at: tt });
      }, t);
      await L.sleep(450);
      await ev((tt) => window.__ep.useEditor.getState().dispatch({ op: 'ripple_delete', start: tt, end: tt + 0.2 }), t);
      await L.sleep(450);
    }
  });

  // D) applyLive com 5 ops (o que a IA faz): split, cor, ripple, transição, velocidade
  await ev(() => { window.__ep.buildDemo(window.__ep.assetsList()); });
  await L.sleep(800);
  phases.applyLive = await samplePhase(page, 'applyLive', async () => {
    await ev(() => {
      const s = window.__ep.useEditor.getState();
      window.__qaLive = s.applyLive([
        { op: 'split_clip', clipId: 'clipA', at: 1, newId: 'qaL1', explain: 'cortando' },
        { op: 'update_clip', clipId: 'clipB', patch: { colorPreset: 'warm' }, explain: 'cor' },
        { op: 'ripple_delete', start: 0.4, end: 0.7, explain: 'tirando silêncio' },
        { op: 'update_clip', clipId: 'clipC', patch: { transitionIn: { kind: 'fade', duration: 0.4 } }, explain: 'transição' },
        { op: 'update_clip', clipId: 'qaL1', patch: { speed: 1.5 }, explain: 'acelerando' },
      ], { delayMs: 450 });
    });
    await page.waitForFunction(() => !window.__ep.useEditor.getState().live.running, null, { timeout: 20000 });
    await L.sleep(400);
    // e toca logo depois das edições
    await ev(() => { const s = window.__ep.useEditor.getState(); s.setPlayhead(0); s.setPlaying(true); });
    await L.sleep(2500);
    await ev(() => window.__ep.useEditor.getState().setPlaying(false));
  });
  const shotCuts = await L.shot(page, `${tag}-harness-cuts`);

  // E) fim da reprodução: toca até o fim (sem fade-out p/ preto, que seria legítimo) e fica parado no último quadro
  await ev(() => { window.__ep.buildDemo(window.__ep.assetsList()); window.__ep.useEditor.getState().dispatch({ op: 'update_clip', clipId: 'clipC', patch: { fadeOut: 0 } }); });
  await L.sleep(800);
  phases.endOfPlayback = await samplePhase(page, 'endOfPlayback', async () => {
    await ev(() => { const s = window.__ep.useEditor.getState(); s.setPlayhead(3.6); s.setPlaying(true); });
    await L.sleep(3200); // ~1,4 s tocando + ~1,8 s parado no fim
  });
  const shotEnd = await L.shot(page, `${tag}-harness-fim`);
  // F) seek manual para o fim (arrastar a agulha até o final)
  phases.seekEnd = await samplePhase(page, 'seekEnd', async () => {
    await ev(() => window.__ep.useEditor.getState().setPlayhead(1e9));
    await L.sleep(1200);
  });
  return { phases, shots: [shotPlay, shotCuts, shotEnd] };
}

/* ---------------- caso 4: export ---------------- */

async function exportCase(page, tag, profile, file, quality) {
  await loadHarness(page, file);
  const info = await page.evaluate(async () => ({ webcodecs: await window.__ep.hasWebCodecs?.() }));
  // projeto demo sem fade-out final (fade p/ preto no fim é legítimo) e sem legendas
  await page.evaluate(() => {
    window.__ep.buildDemo(window.__ep.assetsList(), { captions: false });
    window.__ep.useEditor.getState().dispatch({ op: 'update_clip', clipId: 'clipC', patch: { fadeOut: 0 } });
  });
  const expected = await page.evaluate(() => { const p = window.__ep.useEditor.getState().project; return Math.max(...p.tracks.flatMap((t) => t.clips.map((c) => c.start + c.duration))); });
  const t0 = Date.now();
  const out = await page.evaluate(async (q) => {
    const st = window.__ep.useEditor.getState();
    const stages = [];
    try {
      const blob = await window.__ep.exportVideo(st.project, st.assets, { format: 'mp4', quality: q, onProgress: (f, s) => { if (!stages.length || stages[stages.length - 1] !== s) stages.push(s); } });
      return { ok: true, type: blob.type, size: blob.size, b64: await window.__ep.blobToBase64(blob), stages };
    } catch (e) { return { ok: false, err: String(e && e.message || e), stages }; }
  }, quality);
  const ms = Date.now() - t0;
  if (!out.ok) return { ok: false, ms, err: out.err, info, stages: out.stages };
  const ext = /webm/.test(out.type) ? 'webm' : 'mp4';
  const f = path.join(L.SHOTS, `${tag}-export.${ext}`);
  fs.writeFileSync(f, Buffer.from(out.b64, 'base64'));
  const a = analyzeExport(f);
  // miniatura do meio do vídeo exportado
  try { require('child_process').execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(expected / 2), '-i', f, '-frames:v', '1', '-vf', 'scale=270:-1', path.join(L.SHOTS, `${tag}-export-mid.png`)]); } catch {}
  return { ok: true, ms, size: out.size, type: out.type, expected, analysis: a, file: `shots/${path.basename(f)}`, thumb: `shots/${tag}-export-mid.png`, info, stages: out.stages };
}

/* ---------------- caso 5: layout de menus ---------------- */

const POPUP_SEL = '.ep-tl-menu, .ep-pv-menu, .ep-respop, .ep-toolsheet, .ep-sheet2, .ep-aipop, .ep-modal, [role=dialog], [role=menu]';

async function visiblePopups(page) {
  return page.evaluate((sel) => [...document.querySelectorAll(sel)].filter((e) => {
    const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05;
  }).map((e) => e.outerHTML.slice(0, 80)), POPUP_SEL);
}

/** clica num gatilho e verifica os pop-ups NOVOS que apareceram */
async function probeMenu(page, name, locator, tag, close) {
  const before = new Set(await visiblePopups(page));
  const sideWasOpen = await page.evaluate(() => { const e = document.querySelector('.ep-side'); if (!e) return false; const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none') return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 40 && r.top < innerHeight - 40 && r.bottom > 40 && r.left < innerWidth - 40 && r.right > 40; });
  if (!(await locator.isVisible().catch(() => false))) return { name, status: 'n/a', note: 'gatilho não visível' };
  await locator.click({ timeout: 5000 }).catch((e) => null);
  await L.sleep(450);
  const checks = await L.checkInViewport(page, POPUP_SEL);
  const after = await visiblePopups(page);
  const fresh = after.filter((h) => !before.has(h));
  // considera só os novos (pela ordem, os índices batem com checks)
  const all = await page.evaluate((sel) => [...document.querySelectorAll(sel)].filter((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05; }).map((e) => e.outerHTML.slice(0, 80)), POPUP_SEL);
  let relevant = checks.filter((c, i) => fresh.includes(all[i]));
  // ferramentas que abrem o painel lateral (.ep-side vira gaveta/bottom-sheet no celular/tablet)
  if (!relevant.length && (await page.evaluate(() => { const e = document.querySelector('.ep-side'); if (!e) return false; const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none') return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 40 && r.top < innerHeight - 40 && r.bottom > 40 && r.left < innerWidth - 40 && r.right > 40; })) && !sideWasOpen) {
    relevant = await L.checkInViewport(page, '.ep-side');
  }
  const bad = relevant.filter((c) => !c.ok);
  let s = null;
  if (bad.length || !relevant.length) s = await L.shot(page, `${tag}-menu-${name.replace(/[^a-z0-9]+/gi, '_')}`);
  const hov = await L.horizontalOverflow(page);
  const lvl2 = await page.locator('.ep-mtools.lvl2').isVisible().catch(() => false);
  if (close) await close(); else { await page.keyboard.press('Escape').catch(() => {}); }
  await L.sleep(300);
  // fecha o que sobrou (sheets das ferramentas)
  for (const sel of ['.ep-toolsheet [aria-label=Fechar]', '.ep-side .ep-sheetclose', '.ep-side .ep-sideclose', '.ep-sheet2 [aria-label=Fechar]', '.ep-mtback']) {
    const b = page.locator(sel).first();
    if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); await L.sleep(250); }
  }
  if (!relevant.length && lvl2) return { name, status: 'nível 2', hov };
  if (!relevant.length) {
    // painel lateral (.ep-side) aberto como gaveta/sheet também conta
    return { name, status: 'sem-popup', shot: s, hov };
  }
  return { name, status: bad.length ? 'falha' : 'ok', bad, shot: s, count: relevant.length, hov };
}

async function layoutCase(page, tag, profile) {
  const P = L.PROFILES[profile];
  const out = [];
  out.push(await probeMenu(page, 'pilula-resolucao', page.locator('.ep-respill').first(), tag));
  out.push(await probeMenu(page, 'dialogo-exportar', page.locator('.ep-exportbtn').first(), tag, async () => {
    const c = page.locator('.ep-ex [aria-label=Fechar]').first();
    if (await c.isVisible().catch(() => false)) await c.click().catch(() => {}); else await page.keyboard.press('Escape');
  }));
  if (P.mobile) {
    out.push(await probeMenu(page, 'timeline-mais', page.locator('.ep-tl-cmore').first(), tag));
    out.push(await probeMenu(page, 'preview-mais', page.locator('.ep-pv-mbar [aria-label="Mais opções"]').first(), tag, async () => { await page.locator('.ep-pv-mbar [aria-label="Mais opções"]').first().click().catch(() => {}); }));
    out.push(await probeMenu(page, 'ia-fab2', page.locator('.ep-aifab2').first(), tag, async () => { await page.locator('.ep-aipop [aria-label=Minimizar]').first().click().catch(() => {}); }));
    // ferramentas da barra inferior (nível 1); "Sobrepor" abre seletor de arquivo: pula
    const labels = await page.$$eval('.ep-mtools .ep-mtitem .lb', (els) => els.map((e) => e.textContent.trim()));
    for (const lb of labels) {
      if (/Sobrepor/.test(lb)) continue;
      const loc = page.locator('.ep-mtools .ep-mtitem', { has: page.locator('.lb', { hasText: new RegExp(`^${lb}$`) }) }).first();
      await loc.scrollIntoViewIfNeeded().catch(() => {});
      const r = await probeMenu(page, `barra-${lb}`, loc, tag);
      // painel lateral como sheet: confere a .ep-side também
      out.push(r);
    }
  } else {
    out.push(await probeMenu(page, 'timeline-mais', page.locator('.ep-tl-bar [aria-label="Mais opções"]').first(), tag));
    out.push(await probeMenu(page, 'timeline-trilha', page.locator('.ep-tl-bar .ep-tl-pill').first(), tag));
    out.push(await probeMenu(page, 'timeline-velocidade', page.locator('.ep-tl-bar [aria-label="Velocidade"]').first(), tag));
    out.push(await probeMenu(page, 'ia-fab2', page.locator('.ep-aifab2').first(), tag));
  }
  const hov = await L.horizontalOverflow(page);
  return { menus: out, hov };
}

/* ---------------- caso 7: pop-up da IA ---------------- */

async function popupCase(page, tag, profile) {
  const steps = {};
  const fab = page.locator('.ep-aifab2').first();
  const badge = page.locator('.ep-ailive-main').first();
  if (await fab.isVisible().catch(() => false)) await fab.click();
  else if (await badge.isVisible().catch(() => false)) await badge.click();
  else return chatSideCase(page, tag);
  await L.sleep(400);
  steps.opened = await page.locator('.ep-aipop').isVisible().catch(() => false);
  const ta = page.locator('.ep-aipop textarea').first();
  steps.textarea = await ta.isVisible().catch(() => false);
  if (!steps.textarea) return { status: 'falha', steps, shot: await L.shot(page, `${tag}-popup-sem-texto`) };
  await ta.fill('deixe a legenda maior e corte os primeiros 2 segundos');
  steps.typed = (await ta.inputValue()) .length > 10;
  const msgsBefore = await page.locator('.ep-aipop .ep-ch-msg, .ep-aipop [class*="msg"]').count();
  await installCursorProbe(page);
  await page.locator('.ep-aipop .ep-ch-send').first().click();
  steps.sent = true;
  // espera a IA (demo) terminar: o envio vira "A IA está editando…" e volta
  const t0 = Date.now();
  let finished = false;
  while (Date.now() - t0 < 60000) {
    const busy = await page.locator('.ep-aipop .ep-ch-send').first().isDisabled().catch(() => true);
    const txt = await page.locator('.ep-aipop').innerText().catch(() => '');
    if (Date.now() - t0 > 1500 && !/está editando/i.test(txt) && (busy === true)) { finished = true; break; }
    await L.sleep(300);
  }
  steps.replyMs = Date.now() - t0;
  steps.cursor = await readCursorProbe(page);
  steps.edited = (steps.cursor && steps.cursor.seen > 0) || finished;
  const shotOpen = await L.shot(page, `${tag}-popup-aberto`);
  const min = page.locator('.ep-aipop [aria-label=Minimizar]').first();
  if (await min.isVisible().catch(() => false)) await min.click();
  await L.sleep(400);
  steps.minimized = !(await page.locator('.ep-aipop').isVisible().catch(() => false));
  steps.fabOrBadgeBack = (await fab.isVisible().catch(() => false)) || (await page.locator('.ep-aibadge-slot').isVisible().catch(() => false));
  const shotMin = await L.shot(page, `${tag}-popup-min`);
  const ok = steps.opened && steps.textarea && steps.typed && steps.sent && steps.edited && steps.minimized && steps.fabOrBadgeBack;
  return { status: ok ? 'ok' : 'falha', steps, shots: [shotOpen, shotMin] };
}

/** desktop: não há pop-up (.ep-aifab2 só ≤899px) — valida o chat lateral equivalente */
async function chatSideCase(page, tag) {
  const steps = { variante: 'chat lateral (desktop)' };
  const ta = page.locator('.ep-chat textarea').first();
  steps.opened = await ta.isVisible().catch(() => false);
  if (!steps.opened) return { status: 'falha', steps, shot: await L.shot(page, `${tag}-chat-sem-texto`) };
  const before = await page.locator('.ep-chat').innerText();
  const nPronto = (before.match(/Pronto!/g) || []).length;
  const nUndo = (before.match(/Edições aplicadas/g) || []).length;
  await ta.fill('deixe a legenda maior e corte os primeiros 2 segundos');
  steps.typed = (await ta.inputValue()).length > 10;
  await installCursorProbe(page);
  await page.locator('.ep-chat .ep-ch-send').first().click();
  steps.sent = true;
  const t0 = Date.now();
  let answered = false;
  while (Date.now() - t0 < 60000) {
    const txt = await page.locator('.ep-chat').innerText().catch(() => '');
    const nu = (txt.match(/Edições aplicadas/g) || []).length;
    if (Date.now() - t0 > 1000 && !/está editando/i.test(txt) && nu > nUndo) { answered = true; break; }
    await L.sleep(300);
  }
  steps.replyMs = Date.now() - t0;
  steps.cursor = await readCursorProbe(page);
  steps.edited = answered;
  steps.newPronto = ((await page.locator('.ep-chat').innerText()).match(/Pronto!/g) || []).length > nPronto;
  const shot = await L.shot(page, `${tag}-chat-resposta`);
  return { status: steps.opened && steps.typed && answered ? 'ok' : 'falha', steps, shots: [shot] };
}

/* ---------------- reprodução no editor real (pós-IA) ---------------- */
async function editorPlayback(page, tag, ms = 4000) {
  await L.installSampler(page);
  const play = page.locator('.ep-pv-mplay:visible, .ep-pv-play:visible').first();
  await page.evaluate(() => window.__qa.start('editor'));
  await play.click().catch(() => {});
  await L.sleep(ms);
  const res = await page.evaluate(() => window.__qa.stop());
  await page.keyboard.press('Space').catch(() => {}); // pausa (atalho); se não pausar, não atrapalha
  const sum = L.summarizeSamples(res);
  const s = await L.shot(page, `${tag}-editor-play`);
  return { sum, shot: s };
}

/* ---------------- orquestração por perfil ---------------- */

async function runProfile(profile, media) {
  const P = L.PROFILES[profile];
  const tag = profile;
  const want = (c) => CASES.includes(c);

  // 1 + 6 + 5 + 7 (+ reprodução no editor) — mesma sessão do app
  if (want('flow') || want('layout') || want('cursor') || want('popup')) {
    const { ctx, page, errors } = await L.openContext(profile);
    try {
      const f = await wizardFlow(page, media.h264, tag);
      await editorIdle(page).catch(() => {});
      const shotDone = await L.shot(page, `${tag}-pronto`);
      const errs = L.relevantErrors(errors);
      rec(profile, '1. Fluxo principal', f.done && !errs.some((e) => e.type === 'pageerror') ? 'ok' : 'falha',
        { 'até Pronto (s)': +(f.ms / 1000).toFixed(1), 'pulou legendas': f.skipped, pageerrors: errs.filter((e) => e.type === 'pageerror').length, 'console.error': errs.filter((e) => e.type === 'console').length },
        [f.shotWiz, shotDone], errs.slice(0, 3).map((e) => e.text.split('\n')[0].slice(0, 160)).join(' | '));
      if (want('cursor')) {
        const c = f.cursor || {};
        const ok = c.seen > 0 && c.out === 0 && !c.bubbleOut;
        rec(profile, '6. Cursor da IA', ok ? 'ok' : 'falha', { amostras: c.polls, visível: c.seen, 'fora da tela': c.out, 'balão fora': c.bubbleOut || 0 }, [], c.outs?.length ? `fora: ${JSON.stringify(c.outs)}` : c.bubbleRect ? `balão: ${JSON.stringify(c.bubbleRect)}` : (c.seen ? '' : 'cursor nunca apareceu'));
      }
      if (f.done) {
        // reprodução no editor real (complementa o caso 2)
        const ep = await editorPlayback(page, tag).catch((e) => ({ err: e.message }));
        if (ep.sum) rec(profile, '2b. Reprodução no editor (pós-IA)', ep.sum.black === 0 ? 'ok' : 'falha', { amostras: ep.sum.samples, pretos: ep.sum.black, held: ep.sum.held, 'p95 draw (ms)': ep.sum.p95 }, [ep.shot], ep.sum.black ? `playheads pretos: ${ep.sum.blackPlayheads}` : '');
        if (want('layout')) {
          const lay = await layoutCase(page, tag, profile);
          const fails = lay.menus.filter((m) => m.status === 'falha' || m.status === 'sem-popup');
          const hovBad = lay.hov.over || lay.menus.some((m) => m.hov && m.hov.over);
          const detail = lay.menus.map((m) => `${m.name}:${m.status}${m.bad && m.bad.length ? `(${m.bad.map((b) => `${b.cls.split(' ')[0]} ${JSON.stringify(b.rect)} vw${b.vw}×${b.vh}${b.lastReachable ? '' : ' último item inalcançável'}${b.scrollOk ? '' : ' sem rolagem'}`).join(';')})` : ''}`).join(', ');
          rec(profile, '5. Layout (menus + scroll horizontal)', fails.length || hovBad ? 'falha' : 'ok',
            { menus: lay.menus.length, ok: lay.menus.filter((m) => m.status === 'ok').length, falhas: fails.length, 'sem pop-up': lay.menus.filter((m) => m.status === 'sem-popup').length, 'scroll horizontal': hovBad ? `sim (${lay.hov.scrollW}>${lay.hov.clientW})` : 'não' },
            lay.menus.map((m) => m.shot), detail);
        }
        if (want('popup')) {
          const pp = await popupCase(page, tag, profile);
          rec(profile, '7. Pop-up da IA', pp.status, pp.steps, pp.shots || [pp.shot], pp.note || '');
        }
      }
    } catch (e) {
      rec(profile, '1. Fluxo principal', 'falha', {}, [await L.shot(page, `${tag}-erro-fluxo`)], `exceção: ${e.message.split('\n')[0]}`);
    } finally { await ctx.close(); }
  }

  // 2 + 3 — harness
  if (want('playback') || want('fluidity')) {
    const { ctx, page, errors } = await L.openContext(profile);
    try {
      const pb = await playbackCases(page, tag, profile, media.h264);
      const ph = pb.phases;
      const totalBlack = Object.values(ph).reduce((n, x) => n + x.black, 0);
      const totalHeld = Object.values(ph).reduce((n, x) => n + x.held, 0);
      if (want('playback')) rec(profile, '2. Reprodução sem tela preta', totalBlack === 0 ? 'ok' : 'falha',
        Object.fromEntries([...Object.entries(ph).map(([k, v]) => [`pretos ${k}`, `${v.black}/${v.samples}`]), ['held total', totalHeld], ...Object.entries(ph).map(([k, v]) => [`held ${k}`, v.held])]),
        pb.shots, totalBlack ? Object.entries(ph).filter(([, v]) => v.black).map(([k, v]) => `${k}: 1º preto em +${v.firstBlackAt}ms, playheads ${v.blackPlayheads}`).join(' | ') : '');
      if (want('fluidity')) {
        const p = ph.play;
        const target = P.mobile ? null : 50;
        const st = target == null ? (p.p95 != null ? 'info' : 'falha') : p.p95 != null && p.p95 <= target ? 'ok' : 'falha';
        rec(profile, '3. Fluidez (play 5 s)', st, { 'p95 (ms)': p.p95, 'p50 (ms)': p.p50, 'maior intervalo (ms)': p.maxGap, draws: p.draws, held: p.held }, [], target ? `meta p95 ≤ ${target} ms` : 'meta só p/ desktop (CPU emulada não reflete o aparelho)');
      }
      const errs = L.relevantErrors(errors).filter((e) => e.type === 'pageerror');
      if (errs.length) rec(profile, '2. (erros no harness)', 'falha', { pageerrors: errs.length }, [], errs[0].text.split('\n')[0]);
    } catch (e) {
      rec(profile, '2. Reprodução sem tela preta', 'falha', {}, [await L.shot(page, `${tag}-erro-harness`)], `exceção: ${e.message.split('\n')[0]}`);
    } finally { await ctx.close(); }
  }

  // 4 — export
  if (want('export')) {
    const { ctx, page } = await L.openContext(profile);
    try {
      const q = profile === 'desktop' ? 'fhd' : 'hd';
      const ex = await exportCase(page, tag, profile, media.h264, q);
      if (!ex.ok) rec(profile, '4. Export', 'falha', { 'tempo (s)': +(ex.ms / 1000).toFixed(1), webcodecs: ex.info?.webcodecs }, [], `erro: ${ex.err} (etapas: ${ex.stages?.join(' → ')})`);
      else {
        const a = ex.analysis;
        const blackDur = a.black.reduce((n, b) => n + b.dur, 0);
        const durOk = Math.abs(a.duration - ex.expected) <= 0.25;
        const audioOk = !!a.audio && a.meanVolume != null && a.meanVolume > -60;
        const ok = blackDur === 0 && !a.darkFrames && durOk && audioOk;
        rec(profile, '4. Export', ok ? 'ok' : 'falha', {
          qualidade: q, 'tempo (s)': +(ex.ms / 1000).toFixed(1), 'duração': `${a.duration.toFixed(2)}/${ex.expected.toFixed(2)} s`, vídeo: a.video ? `${a.video.codec} ${a.video.w}×${a.video.h}` : 'nenhum',
          áudio: a.audio ? `${a.audio.codec} ${a.meanVolume} dB` : 'nenhum', 'preto (s)': +blackDur.toFixed(2), 'quadros escuros (Y<20)': a.darkFrames, 'Y mín': a.minYavg, webcodecs: ex.info?.webcodecs,
        }, [ex.thumb, ex.file], [a.black.length ? `trechos pretos: ${JSON.stringify(a.black.slice(0, 4))}` : '', a.darkFrames ? `quadros escuros: ${a.firstDark}` : '', a.audio && a.audio.codec === 'opus' ? 'obs.: áudio Opus dentro de MP4 (Chromium sem AAC) — ver compatibilidade' : ''].filter(Boolean).join(' · '));
      }
    } catch (e) {
      rec(profile, '4. Export', 'falha', {}, [await L.shot(page, `${tag}-erro-export`)], `exceção: ${e.message.split('\n')[0]}`);
    } finally { await ctx.close(); }
  }

  // extra (só desktop): HEVC e 4K pelo fluxo real (ingestão com proxy do shell)
  if (want('formats') && profile === 'desktop') {
    for (const [k, label] of [['hevc', 'HEVC 1080×1920'], ['k4', '4K H.264']]) {
      if (!media[k]) continue;
      const { ctx, page, errors } = await L.openContext(profile);
      try {
        const f = await wizardFlow(page, media[k], `${tag}-${k}`);
        let ep = null;
        if (f.done) { await editorIdle(page).catch(() => {}); ep = await editorPlayback(page, `${tag}-${k}`, 3500).catch(() => null); }
        const errs = L.relevantErrors(errors).filter((e) => e.type === 'pageerror');
        const dec = await page.evaluate(() => [...document.querySelectorAll('.ep-pv-host video')].map((v) => `${v.videoWidth}×${v.videoHeight}`).join(',')).catch(() => '?');
        const ok = f.done && ep && ep.sum.black === 0 && !errs.length;
        rec(profile, `8. Mídia ${label}`, ok ? 'ok' : 'falha', { 'até Pronto (s)': +(f.ms / 1000).toFixed(1), pretos: ep ? `${ep.sum.black}/${ep.sum.samples}` : '-', held: ep ? ep.sum.held : '-', 'menor luminância': ep ? ep.sum.minMean : '-', pageerrors: errs.length, 'vídeo decodificado': dec || 'nenhum' },
          [ep && ep.shot, await L.shot(page, `${tag}-${k}-final`)], !f.done ? 'não chegou a "Pronto!"' : ep && ep.sum.black ? `playheads pretos: ${ep.sum.blackPlayheads}` : '');
      } catch (e) {
        rec(profile, `8. Mídia ${label}`, 'falha', {}, [await L.shot(page, `${tag}-${k}-erro`)], `exceção: ${e.message.split('\n')[0]}`);
      } finally { await ctx.close(); }
    }
  }
}

/* ---------------- relatório ---------------- */

function gitHash() { try { return require('child_process').execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim(); } catch { return '?'; } }

function writeReport(meta) {
  const cases = [...new Set(results.map((r) => r.case))].sort((a, b) => parseFloat(a) - parseFloat(b) || a.localeCompare(b));
  const profs = PROFILE_IDS;
  const icon = (s) => ({ ok: '✅ ok', falha: '❌ falha', info: 'ℹ️ info', 'n/a': '— n/a' }[s] || s);
  const fmtM = (m) => Object.entries(m || {}).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join('<br>');
  let md = `# Relatório E2E — EditorPro\n\n`;
  md += `- Commit: \`${meta.hash}\` · ${meta.when}\n- Alvo: ${L.BASE} (\`next start\`, modo demo da IA)\n- Navegador: Chromium ${meta.browser} (headless, sem GPU)\n- Perfis: ${profs.map((p) => L.PROFILES[p].label).join(' · ')}\n- Duração da rodada: ${meta.secs} s\n\n`;
  md += `## Resumo\n\n| Caso | ${profs.map((p) => L.PROFILES[p].label).join(' | ')} |\n|---|${profs.map(() => '---').join('|')}|\n`;
  for (const c of cases) md += `| ${c} | ${profs.map((p) => { const r = results.find((x) => x.case === c && x.profile === p); return r ? icon(r.status) : '·'; }).join(' | ')} |\n`;
  md += `\n## Detalhes\n\n`;
  for (const c of cases) {
    md += `### ${c}\n\n| Perfil | Resultado | Métricas | Capturas | Observações |\n|---|---|---|---|---|\n`;
    for (const p of profs) {
      const r = results.find((x) => x.case === c && x.profile === p);
      if (!r) continue;
      md += `| ${L.PROFILES[p].label} | ${icon(r.status)} | ${fmtM(r.metrics)} | ${r.shots.map((s) => `[${path.basename(s)}](${s})`).join('<br>')} | ${(r.notes || '').replace(/\|/g, '\\|').replace(/\n/g, ' ')} |\n`;
    }
    md += '\n';
  }
  md += `## Como rodar\n\n\`\`\`\ncd web && npm run build && npm run e2e\n# só alguns: node e2e/run.js --profiles=pixel7 --cases=flow,layout\n\`\`\`\n\nCritérios: quadro preto = luminância média < 6 e máxima < 24 (0–255) no canvas \`[data-ep-preview]\` amostrado a cada rAF; \`held\` = quadros segurados (\`__epPreviewStats.held\`); fluidez = intervalos entre *draws* do preview (resolução de 1 rAF); export = \`blackdetect\` (pix_th 0.10, pic_th 0.98, ≥ 0,03 s), \`volumedetect\` e duração ±0,25 s.\n`;
  if (meta.bugs) md += `\n${meta.bugs}\n`;
  fs.writeFileSync(path.join(__dirname, 'REPORT.md'), md);
  fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify({ meta, results }, null, 2));
}

(async () => {
  const t0 = Date.now();
  L.ensureDirs();
  const media = ensureMedia();
  await ensureServer();
  const b = await L.getBrowser();
  const browserVersion = b.version();
  for (const p of PROFILE_IDS) {
    if (!L.PROFILES[p]) { console.warn(`perfil desconhecido: ${p}`); continue; }
    await runProfile(p, media);
  }
  await L.closeBrowser();
  stopServer();
  const bugsFile = path.join(__dirname, 'BUGS.md');
  writeReport({ hash: gitHash(), when: new Date().toISOString(), browser: browserVersion, secs: Math.round((Date.now() - t0) / 1000), bugs: fs.existsSync(bugsFile) ? fs.readFileSync(bugsFile, 'utf8') : '' });
  const failed = results.filter((r) => r.status === 'falha').length;
  console.log(`\n${results.length} verificações, ${failed} falha(s). Relatório: e2e/REPORT.md`);
  process.exit(argv.strict && failed ? 1 : 0);
})().catch(async (e) => { console.error(e); await L.closeBrowser().catch(() => {}); stopServer(); process.exit(2); });
