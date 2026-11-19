#!/usr/bin/env node
/* =====================================================================
   EditorPro — testes de usabilidade por persona (sessão de QA).
   Uso: node e2e/usability.js [--personas=1,2,3,4]   (servidor como no run.js)
   Mede por persona: tempo, toques/cliques, becos sem saída, rótulos confusos e
   alvos de toque < 44 px. Saída: e2e/USABILIDADE.md + e2e/usability.json.
   Cada fricção traz passo, captura, arquivo provável e DONO do módulo.
   ===================================================================== */
const fs = require('fs');
const path = require('path');
const L = require('./lib');
const { ensureMedia } = require('./media');

const argv = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? '1']; }));
const WANT = (argv.personas || '1,2,3,4').split(',');

/* ---------------- registro ---------------- */

class Session {
  constructor(id, title, profile, page) {
    Object.assign(this, { id, title, profile, page, taps: 0, keys: 0, steps: [], frictions: [], small: new Map(), unlabeled: new Map(), t0: Date.now() });
  }
  async tap(locator, opts = {}) {
    this.taps++;
    await locator.click({ timeout: opts.timeout ?? 6000, ...(opts.force ? { force: true } : {}) });
    await L.sleep(opts.wait ?? 350);
  }
  async key(k, n = 1) { for (let i = 0; i < n; i++) { this.keys++; await this.page.keyboard.press(k); await L.sleep(60); } }
  async step(name, fn) {
    const t = Date.now(), taps0 = this.taps;
    let ok = true, note = '';
    try { note = (await fn()) || ''; } catch (e) { ok = false; note = e.message.split('\n')[0].slice(0, 200); }
    const shot = await L.shot(this.page, `ux${this.id}-${this.steps.length + 1}-${name.replace(/[^a-z0-9]+/gi, '_').slice(0, 30)}`);
    if (L.PROFILES[this.profile].mobile) await this.scanTargets(name);
    await this.scanLabels(name);
    this.steps.push({ name, ok, ms: Date.now() - t, taps: this.taps - taps0, note, shot });
    for (const f of this.frictions) if (f.shot === null) f.shot = shot;
    console.log(`  [P${this.id}] ${ok ? 'ok ' : 'ERR'} ${name} (${((Date.now() - t) / 1000).toFixed(1)} s, ${this.taps - taps0} toques) ${note}`);
    return ok;
  }
  friction(f) {
    // f: { step, kind: 'beco'|'rótulo'|'alvo'|'lento'|'bug'|'fluxo', sev: 1..3, text, file, owner, shot? }
    this.frictions.push({ persona: this.id, ...f, shot: f.shot ?? null }); // captura do passo atual é atribuída ao fim do passo
  }
  async scanTargets(step) {
    const list = await this.page.evaluate(() => {
      const out = [];
      for (const e of document.querySelectorAll('button, a[href], [role=button], [role=tab], [role=radio], [role=menuitem], input[type=range], input[type=checkbox], select')) {
        const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
        if (r.width < 1 || r.height < 1 || cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity < 0.1) continue;
        if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
        if (e.disabled) continue;
        // alvo efetivo: o próprio elemento (padding conta). < 44 em qualquer lado = pequeno
        if (Math.min(r.width, r.height) >= 44) continue;
        const label = (e.getAttribute('aria-label') || e.getAttribute('title') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
        const cls = (typeof e.className === 'string' ? e.className : '').split(' ').filter(Boolean)[0] || e.tagName.toLowerCase();
        out.push({ key: `${cls}|${label}`, cls, label, w: Math.round(r.width), h: Math.round(r.height) });
      }
      return out;
    });
    for (const it of list) if (!this.small.has(it.key)) this.small.set(it.key, { ...it, step });
  }
  async scanLabels(step) {
    const list = await this.page.evaluate(() => {
      const out = [];
      for (const e of document.querySelectorAll('button, [role=button]')) {
        const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
        if (r.width < 1 || r.height < 1 || cs.visibility === 'hidden' || cs.display === 'none') continue;
        if (r.bottom < 0 || r.top > innerHeight) continue;
        const name = (e.getAttribute('aria-label') || e.getAttribute('title') || e.textContent || '').trim();
        const cls = (typeof e.className === 'string' ? e.className : '').split(' ').filter(Boolean).slice(0, 2).join('.') || 'button';
        if (!name || /^[⋯…✕×+\-]$/.test(name)) out.push({ key: cls, cls, text: name });
      }
      return out;
    });
    for (const it of list) if (!this.unlabeled.has(it.key)) this.unlabeled.set(it.key, { ...it, step });
  }
  summary() {
    return {
      id: this.id, title: this.title, profile: this.profile, secs: Math.round((Date.now() - this.t0) / 1000), taps: this.taps, keys: this.keys,
      done: this.steps.filter((s) => s.ok).length, total: this.steps.length, steps: this.steps, frictions: this.frictions,
      small: [...this.small.values()], unlabeled: [...this.unlabeled.values()],
    };
  }
}

/* ---------------- utilitários do app ---------------- */

/** projeto salvo mais recente (IndexedDB 'editorpro'/'projects') — o app não expõe a store fora do harness */
async function readProject(page) {
  await L.sleep(1300); // autosave tem debounce
  return page.evaluate(() => new Promise((res) => {
    const q = indexedDB.open('editorpro');
    q.onerror = () => res(null);
    q.onsuccess = () => {
      try {
        const g = q.result.transaction('projects').objectStore('projects').getAll();
        g.onsuccess = () => {
          const all = (g.result || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
          const r = all[0]; if (!r) return res(null);
          const p = r.project || r;
          const clips = p.tracks.flatMap((t) => t.clips.map((c) => ({ ...c, track: t.id, trackKind: t.kind })));
          const js = JSON.stringify({ ...p, updatedAt: 0, createdAt: 0 }); let h = 0; for (let i = 0; i < js.length; i++) h = (h * 31 + js.charCodeAt(i)) | 0;
          res({
            sig: h, capStyle: JSON.stringify(p.captions?.style || {}).length,
            duration: Math.max(0, ...clips.map((c) => c.start + c.duration)),
            video: clips.filter((c) => c.type === 'video').map((c) => ({ id: c.id, start: c.start, dur: c.duration, volume: c.volume, tr: c.transitionIn?.kind, kf: (c.keyframes || []).length })),
            audio: clips.filter((c) => c.type === 'audio').length, text: clips.filter((c) => c.type === 'text').length,
            captions: (p.captions?.segments || []).length, capOn: !!p.captions?.enabled, capPreset: p.captions?.style?.preset,
          });
        };
        g.onerror = () => res(null);
      } catch { res(null); }
    };
  }));
}

const mtool = (page, lb) => page.locator('.ep-mtools .ep-mtitem', { has: page.locator('.lb', { hasText: new RegExp(`^${lb}$`) }) }).first();
const visible = (loc) => loc.isVisible().catch(() => false);

/** volta à barra principal do celular (fecha gaveta e sai dos níveis 2/contextuais) */
async function toMainBar(s) {
  for (const sel of ['.ep-toolsheet [aria-label=Fechar]', '.ep-side .ep-sheetclose']) { const b = s.page.locator(sel).first(); if (await visible(b)) await s.tap(b); }
  for (let i = 0; i < 3; i++) { const b = s.page.locator('.ep-mtback').first(); if (!(await visible(b))) break; await s.tap(b); }
}

async function waitPronto(s, { transcribe = false, timeout = 150000 } = {}) {
  const page = s.page, t0 = Date.now();
  let asked = false;
  while (Date.now() - t0 < timeout) {
    const txt = await page.evaluate(() => document.body.innerText);
    if (/Pronto!|Feito:/.test(txt) && !/está editando/i.test(txt)) return { ms: Date.now() - t0, asked };
    const go = page.getByRole('button', { name: transcribe ? /^Transcrever/ : 'Pular legendas' }).first();
    if (await visible(go)) { asked = true; await s.tap(go); }
    await L.sleep(400);
  }
  throw new Error('não chegou a "Pronto!"');
}

async function wizard(s, brief, files) {
  const page = s.page;
  await page.goto('/');
  await s.tap(page.getByRole('button', { name: 'Começar' }).first());
  await page.waitForSelector('#ep-brief');
  s.taps++; await page.fill('#ep-brief', brief);
  s.taps++; await page.locator('.ep-dz input[type=file]').first().setInputFiles(files);
  await page.waitForSelector('.ep-fchips');
}

/** clique num clipe de vídeo da timeline (por índice) */
async function tapClip(s, idx = 0) {
  const clips = s.page.locator('[data-ep-clip]');
  const n = await clips.count();
  const vids = [];
  for (let i = 0; i < n; i++) { const c = clips.nth(i); const t = (await c.innerText().catch(() => '')) || ''; if (/\.mp4|vídeo/i.test(t) || (await c.getAttribute('data-ep-kind').catch(() => null)) === 'video') vids.push(c); }
  const target = (vids.length ? vids : [clips.first()])[Math.min(idx, Math.max(0, vids.length - 1))];
  await target.scrollIntoViewIfNeeded().catch(() => {});
  await s.tap(target);
}

async function waitExport(s, timeout = 120000) {
  const page = s.page, t0 = Date.now();
  const dl = page.waitForEvent('download', { timeout }).catch(() => null);
  let state = 'timeout';
  while (Date.now() - t0 < timeout) {
    const txt = await page.locator('.ep-ex, .ep-sheet2').first().innerText().catch(() => '');
    if (/pronto|baixar|compartilhar|salvo|concluíd/i.test(txt) && !/Exportando|Mixando|Preparando|\d+%/.test(txt)) { state = 'pronto'; break; }
    if (/erro|falhou|não foi possível/i.test(txt)) { state = `erro: ${txt.replace(/\s+/g, ' ').slice(0, 120)}`; break; }
    if (!(await visible(page.locator('.ep-ex').first()))) { state = 'diálogo fechou'; break; }
    await L.sleep(500);
  }
  const d = await Promise.race([dl, L.sleep(1500).then(() => null)]);
  return { state, ms: Date.now() - t0, download: d ? d.suggestedFilename() : null };
}

/* ---------------- personas ---------------- */

/** (1) criadora iniciante no celular: Reels de 15 s com legenda, música e 1 transição */
async function persona1(media) {
  const { ctx, page } = await L.openContext('pixel7');
  const s = new Session(1, 'Criadora iniciante (Pixel 7): Reels de 15 s com legenda, música e 1 transição', 'pixel7', page);
  try {
    await s.step('Começar + descrever + anexar 2 vídeos', () => wizard(s, 'Reels de 15 segundos com legenda, música animada e uma transição', [media.h264, media.clip2]));
    let r1;
    await s.step('Editar com IA (aceita transcrever)', async () => {
      await s.tap(page.locator('button.ep-go'));
      r1 = await waitPronto(s, { transcribe: true, timeout: 120000 });
      return `${(r1.ms / 1000).toFixed(1)} s`;
    });
    if (!s.steps[s.steps.length - 1].ok) {
      const txt = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
      s.friction({ step: 'Editar com IA', kind: 'beco', sev: 3, text: `Ao aceitar "Transcrever (~41 MB)" sem acesso ao modelo, a edição não termina em 120 s. Tela: "${txt.slice(txt.search(/Transcre|Baixando|modelo/i), txt.search(/Transcre|Baixando|modelo/i) + 140)}"`, file: 'lib/ai/pipeline.ts (passo de transcrição) / lib/ai/whisper*', owner: 'ai' });
      await waitPronto(s, { timeout: 60000 }).catch(() => {});
    }
    await L.sleep(1800);
    let p = await readProject(page);
    await s.step('Conferir o que a IA fez', async () => JSON.stringify({ dur: p?.duration?.toFixed(1), legendas: p?.captions, música: p?.audio, transições: p?.video.filter((v) => v.tr).length }));
    if (p && Math.abs(p.duration - 15) > 1.5) s.friction({ step: 'Conferir o que a IA fez', kind: 'fluxo', sev: 2, text: `Pedido "Reels de 15 segundos" gerou vídeo de ${p.duration.toFixed(1)} s (material: 10 s + 6 s).`, file: 'lib/ai/demo.ts (planejador demo)', owner: 'ai' });
    if (p && !p.audio) s.friction({ step: 'Conferir o que a IA fez', kind: 'fluxo', sev: 2, text: 'Pedido citou "música animada", mas a IA (demo) não colocou música e não avisou que não há música disponível.', file: 'lib/ai/demo.ts', owner: 'ai' });
    if (p && !p.video.some((v) => v.tr)) s.friction({ step: 'Conferir o que a IA fez', kind: 'fluxo', sev: 2, text: 'Pedido citou "uma transição", mas a IA (demo) não aplicou transição entre os 2 clipes.', file: 'lib/ai/demo.ts', owner: 'ai' });

    // música
    await s.step('Adicionar música (Áudio → Músicas)', async () => {
      if (await visible(page.locator('.ep-aipop'))) { const m = page.locator('.ep-aipop [aria-label=Minimizar]').first(); if (await visible(m)) await s.tap(m); }
      await s.tap(mtool(page, 'Áudio'));
      await s.tap(mtool(page, 'Músicas'));
      const side = await page.locator('.ep-side').innerText().catch(() => '');
      if (!/Biblioteca|Faixas|Tocar|Usar|Adicionar/i.test(side) || /Nenhum áudio ainda/i.test(side)) {
        s.friction({ step: 'Adicionar música', kind: 'beco', sev: 3, text: '"Músicas" não tem catálogo: só "Importar música"/"Gravar narração" e "Nenhum áudio ainda". Iniciante sem arquivo de música fica sem saída.', file: 'components/panels (painel Áudio) / lib/library (sons)', owner: 'library' });
      }
      const imp = page.getByRole('button', { name: /Importar música/i }).first();
      const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: 6000 }), s.tap(imp)]);
      await fc.setFiles(media.music);
      await L.sleep(2500);
      p = await readProject(page);
      if (!p.audio) {
        s.friction({ step: 'Adicionar música', kind: 'fluxo', sev: 2, text: 'Música importada não foi para a timeline (ficou só na lista de áudios).', file: 'components/panels (Áudio) / lib/media/place.ts', owner: 'shell' });
        const add = page.locator('.ep-side .ep-music').first();
        if (await visible(add)) { await s.tap(add); p = await readProject(page); }
      }
      return `faixas de áudio: ${p.audio}`;
    });
    await toMainBar(s);

    // transição
    await s.step('Transição entre os clipes (Transições)', async () => {
      await s.tap(mtool(page, 'Transições'));
      const side = await page.locator('.ep-side').innerText().catch(() => '');
      if (/Selecione um clipe/i.test(side)) {
        s.friction({ step: 'Transição', kind: 'beco', sev: 2, text: '"Transições" abre vazio com "Selecione um clipe" — não há como escolher o corte ali; o usuário precisa fechar a gaveta, achar o 2º clipe na timeline e reabrir.', file: 'components/panels (Inspector transições) / components/shell/MobileToolbar.tsx', owner: 'shell' });
        // tentativa 1: com a gaveta aberta, tocar no 2º clipe (a gaveta cobre a timeline?)
        let got = false;
        try { await tapClip(s, 1); got = /Selecione um clipe/i.test(await page.locator('.ep-side').innerText().catch(() => '')) === false && await visible(page.locator('.ep-side')); } catch { got = false; }
        if (!got) {
          const c = page.locator('.ep-side .ep-sheetclose').first(); if (await visible(c)) await s.tap(c);
          await tapClip(s, 1);
          const tr = page.locator('.ep-mtools .ep-mtitem', { has: page.locator('.lb', { hasText: /Transi/ }) }).first();
          if (await visible(tr)) await s.tap(tr);
          else {
            s.friction({ step: 'Transição', kind: 'beco', sev: 3, text: 'Com o clipe selecionado, a barra contextual do clipe (Dividir, Velocidade, Volume, Animações…) não tem "Transições", e a ferramenta "Transições" da barra principal pede "Selecione um clipe" — no celular não há caminho para aplicar transição (nem botão entre clipes na timeline).', file: 'components/shell/MobileToolbar.tsx:135-170 (itens do clipe sem transitions) / components/timeline (sem botão de transição entre clipes)', owner: 'shell' });
            throw new Error('sem caminho para aplicar transição no celular');
          }
        }
      }
      const tile = page.locator('.ep-side button, .ep-toolsheet button').filter({ hasText: /Desfoque|Fade|Dissolver|Deslizar|Zoom|Slide|Wipe|Cortina|Glitch/i }).first();
      await s.tap(tile);
      p = await readProject(page);
      if (!p.video.some((v) => v.tr)) throw new Error('nenhum clipe ficou com transição');
      return `transições: ${p.video.filter((v) => v.tr).map((v) => v.tr).join(',')}`;
    });
    await toMainBar(s);

    // export
    await s.step('Exportar', async () => {
      await s.tap(page.locator('.ep-exportbtn').first());
      const txt = await page.locator('.ep-ex').innerText();
      if (/Recomendado: HD 720p/.test(txt) && /1080p/.test(await page.locator('.ep-respill').first().innerText().catch(() => '')))
        s.friction({ step: 'Exportar', kind: 'rótulo', sev: 1, text: 'O diálogo abre em 1080p (padrão da pílula) mas avisa "No celular, 1080p/4K podem ficar sem memória. Recomendado: HD 720p" — padrão contradiz a recomendação.', file: 'components/shell/exportPref.ts:17 (padrão fhd) / components/preview/ExportDialog.tsx', owner: 'shell' });
      await s.tap(page.locator('.ep-ex').getByRole('button', { name: /Exportar vídeo/ }).first());
      const r = await waitExport(s);
      if (r.state !== 'pronto' && !r.download) throw new Error(`export: ${r.state}`);
      return `${(r.ms / 1000).toFixed(1)} s · ${r.download || r.state}`;
    });
  } finally { await ctx.close(); }
  return s.summary();
}

/** (2) editor de desktop com teclado: cortar 5 trechos, volume, keyframe de zoom e exportar */
async function persona2(media) {
  const { ctx, page } = await L.openContext('desktop');
  const s = new Session(2, 'Editor de desktop com teclado: 5 cortes, volume, keyframe de zoom e exportar', 'desktop', page);
  try {
    await s.step('Abrir editor vazio e importar', async () => {
      await page.goto('/');
      await s.tap(page.getByRole('button', { name: 'Começar' }).first());
      await s.tap(page.getByRole('button', { name: 'Abrir editor vazio' }));
      const imp = page.locator('[data-ep-import]').first();
      const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: 6000 }), s.tap(imp)]);
      await fc.setFiles([media.h264, media.clip2]);
      let n = 0;
      for (let i = 0; i < 12 && n < 2; i++) { await L.sleep(1000); n = await page.locator('[data-ep-clip]').count(); }
      let p = await readProject(page);
      if (n < 2) {
        s.friction({ step: 'Importar', kind: 'fluxo', sev: 2, text: 'No editor vazio, "Importar" só coloca na biblioteca; é preciso achar o "+" pequeno no card (title "Adicionar no fim da timeline") para cada mídia.', file: 'components/media/MediaBin.tsx:93', owner: 'shell' });
        const adds = page.locator('button[title="Adicionar no fim da timeline"]');
        const n = await adds.count();
        for (let i = 0; i < n; i++) { await adds.nth(i).hover().catch(() => {}); await s.tap(adds.nth(i), { force: true }); }
        p = await readProject(page);
      }
      return `clipes: ${p?.video.length}, duração ${p?.duration?.toFixed(1)} s`;
    });
    const before = await readProject(page);
    await s.step('Cortar 5 trechos só com teclado (S, setas, Shift+Delete)', async () => {
      await page.locator('[data-ep-timeline]').first().click({ position: { x: 5, y: 5 } }).catch(() => {}); s.taps++;
      await s.key('Home');
      for (let i = 0; i < 5; i++) {
        // sempre o trecho 1 s–2 s: Home, +1 s, S, +1 s, S, clique no meio do trecho, Shift+Delete (fecha o buraco)
        await s.key('Escape'); await s.key('Home');
        await s.key('Shift+ArrowRight'); await s.key('s');
        await s.key('Shift+ArrowRight'); await s.key('s');
        const pt = await page.evaluate(() => {
          const x = window.__epTimeToClientX && window.__epTimeToClientX(1.5);
          if (typeof x !== 'number') return null;
          const hit = [...document.querySelectorAll('[data-ep-clip]')].map((e) => e.getBoundingClientRect()).filter((r) => r.left <= x && r.right >= x && r.height > 20).sort((a, b) => b.top - a.top);
          // trilha de vídeo principal: a mais baixa das trilhas visuais costuma ser a de vídeo; prefere a mais alta altura
          const v = hit.sort((a, b) => b.height - a.height)[0];
          return v ? { x, y: v.top + v.height / 2 } : null;
        });
        if (!pt) throw new Error(`corte ${i + 1}: não achei o clipe em 1,5 s`);
        await page.mouse.click(pt.x, pt.y); s.taps++;
        await s.key('Shift+Delete');
      }
      const p = await readProject(page);
      const cut = before.duration - p.duration;
      if (Math.abs(cut - 5) > 0.6) throw new Error(`duração caiu ${cut.toFixed(2)} s (esperado ~5 s)`);
      s.friction({ step: 'Cortar 5 trechos', kind: 'fluxo', sev: 1, text: 'Não há atalho para selecionar o clipe sob o cursor (ex.: D/Enter) nem para "excluir trecho entre marcas": cada corte exige 1 clique do mouse.', file: 'components/timeline/useShortcuts.ts', owner: 'timeline' });
      return `duração ${before.duration.toFixed(1)} → ${p.duration.toFixed(1)} s`;
    });
    await s.step('Ajustar volume do clipe', async () => {
      await page.locator('[data-ep-clip]').first().click(); s.taps++;
      let vol = page.getByRole('slider', { name: /^Volume/ }).first();
      if (!(await visible(vol))) {
        const audioTool = page.locator('.ep-sb, aside').getByRole('button', { name: /^Áudio$/ }).first();
        if (await visible(audioTool)) await s.tap(audioTool);
        vol = page.getByRole('slider', { name: /^Volume/ }).first();
        if (!(await visible(vol))) { const t = page.getByRole('button', { name: /^Volume$/ }).first(); if (await visible(t)) { await s.tap(t); vol = page.getByRole('slider', { name: /^Volume/ }).first(); } }
      }
      if (!(await visible(vol))) throw new Error('não achei o controle de volume do clipe');
      await vol.focus(); await s.key('ArrowLeft', 5);
      const p = await readProject(page);
      const v = p.video.find((c) => c.volume !== 1);
      if (!v) throw new Error('volume não mudou no projeto');
      return `volume ${v.volume}`;
    });
    await s.step('Keyframe de zoom (K + escala)', async () => {
      await s.key('Escape'); await s.key('Home'); await s.key('Shift+ArrowRight', 2);   // t = 2 s
      const pt = await page.evaluate(() => { const x = window.__epTimeToClientX && window.__epTimeToClientX(2.3); const r = [...document.querySelectorAll('[data-ep-clip]')].map((e) => e.getBoundingClientRect()).filter((q) => q.left <= x && q.right >= x && q.height > 20).sort((a, b) => b.height - a.height)[0]; return r ? { x, y: r.top + r.height / 2 } : null; });
      if (!pt) throw new Error('clipe em 2,3 s não encontrado');
      await page.mouse.click(pt.x, pt.y); s.taps++;
      await s.key('k');                          // keyframe em 2 s
      await s.key('Shift+ArrowRight');           // 3 s
      let sc = page.getByRole('slider', { name: /^Escala/ }).first();
      if (!(await visible(sc))) {
        const ed = page.locator('aside').getByRole('button', { name: /^Editar$/ }).first();
        if (await visible(ed)) await s.tap(ed);
        const t = page.getByRole('tab', { name: /^Posição$/ }).first();
        if (await t.count()) {
          const clipped = await t.evaluate((e) => { const r = e.getBoundingClientRect(); const pr = e.parentElement.getBoundingClientRect(); return r.right > pr.right + 1 || r.left < pr.left - 1; });
          if (clipped) s.friction({ step: 'Keyframe de zoom', kind: 'rótulo', sev: 1, text: 'No painel "Editar" do desktop, as abas (Editar, Velocidade, Volume, Anim…) passam da largura e "Posição" fica escondida, sem seta/indicador de rolagem.', file: 'components/panels/EditTab.tsx:42 (.ep-subtabs)', owner: 'shell' });
          await t.scrollIntoViewIfNeeded().catch(() => {}); await s.tap(t);
        }
        else s.friction({ step: 'Keyframe de zoom', kind: 'beco', sev: 2, text: 'Com o clipe selecionado no desktop, não há aba/atalho visível para "Posição e escala".', file: 'components/panels/EditTab.tsx', owner: 'shell' });
        sc = page.getByRole('slider', { name: /^Escala/ }).first();
      }
      if (!(await visible(sc))) throw new Error('não achei o controle de escala/zoom');
      await sc.focus(); await s.key('ArrowRight', 10);
      const p = await readProject(page);
      const kf = Math.max(...p.video.map((v) => v.kf));
      if (kf < 2) {
        s.friction({ step: 'Keyframe de zoom', kind: 'bug', sev: 3, text: 'Com 1 keyframe no clipe (K em 2 s), mover o cursor para 3 s e mudar "Escala" NÃO cria nem atualiza keyframe: o slider edita o transform base (que os keyframes sobrepõem). Não há como fazer zoom animado pelo painel; só via "Zoom punch-in aqui".', file: 'components/panels/ClipSections.tsx:406 (setTf → patch transform)', owner: 'shell' });
        throw new Error(`keyframes no clipe: ${kf} (esperado ≥ 2)`);
      }
      return `keyframes: ${kf}`;
    });
    await s.step('Exportar', async () => {
      await s.tap(page.locator('.ep-exportbtn').first());
      await s.tap(page.locator('.ep-ex').getByRole('button', { name: /Exportar vídeo/ }).first());
      const r = await waitExport(s);
      if (r.state !== 'pronto' && !r.download) throw new Error(`export: ${r.state}`);
      return `${(r.ms / 1000).toFixed(1)} s · ${r.download || r.state}`;
    });
  } finally { await ctx.close(); }
  return s.summary();
}

/** (3) só quer legendas: importar, gerar legenda, trocar estilo e exportar */
async function persona3(media) {
  const { ctx, page } = await L.openContext('iphonese');
  const s = new Session(3, 'Só quer legendas (iPhone SE): importar, gerar legenda, trocar estilo e exportar', 'iphonese', page);
  try {
    await s.step('Importar vídeo (editor vazio + galeria)', async () => {
      await page.goto('/');
      await s.tap(page.getByRole('button', { name: 'Começar' }).first());
      await s.tap(page.getByRole('button', { name: 'Abrir editor vazio' }));
      await s.tap(page.locator('button:has-text("Adicionar mídia") >> visible=true').first());
      const gal = page.locator('.ep-mpick').getByRole('button', { name: /Galeria/ }).first();
      const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: 8000 }), s.tap(gal)]);
      await fc.setFiles(media.h264);
      await L.sleep(3000);
      const pick = page.locator('.ep-mpick');
      if (await visible(pick)) { // seletor "Adicionar mídia"
        const addBtn = pick.getByRole('button', { name: /^Adicionar/ }).last();
        if (await addBtn.isDisabled().catch(() => false)) s.friction({ step: 'Importar', kind: 'fluxo', sev: 2, text: 'Depois de escolher o vídeo na "Galeria do celular", ele aparece no seletor mas NÃO fica marcado: "Adicionar" segue desabilitado e é preciso tocar de novo na miniatura.', file: 'components/media/MediaPicker.tsx', owner: 'shell' });
        const cell = pick.locator('.ep-mpick-cell[aria-label*="h264"]').first(); if (await visible(cell) && await addBtn.isDisabled().catch(() => false)) await s.tap(cell);
        const add = pick.getByRole('button', { name: /Adicionar/ }).last(); if (await visible(add)) await s.tap(add);
      }
      const p = await readProject(page);
      if (!p?.video.length) throw new Error('vídeo não entrou na timeline');
      return `clipes ${p.video.length}`;
    });
    await s.step('Gerar legendas (Legendas → Gerar com IA)', async () => {
      await s.tap(mtool(page, 'Legendas'));
      await s.tap(page.getByRole('button', { name: /Gerar legendas/i }).first());
      const t0 = Date.now();
      let txt = '';
      let pillSeen = false;
      while (Date.now() - t0 < 45000) {
        const go = page.getByRole('button', { name: /^Transcrever/ }).first();
        if (await visible(go)) await s.tap(go);
        else if (!pillSeen && /IA aguardando você/.test(await page.evaluate(() => document.body.innerText))) {
          pillSeen = true;
          s.friction({ step: 'Gerar legendas', kind: 'beco', sev: 3, text: '"Gerar legendas com IA" (gaveta Legendas) faz a pergunta "Transcrever (~41 MB)?" dentro do pop-up da IA, que não abre: a gaveta continua na frente e só aparece a pílula "IA aguardando você". Parece que nada aconteceu.', file: 'components/panels/CaptionsTab.tsx (emit generate-captions) / components/shell/AiPopupHost.tsx', owner: 'shell' });
          const pill = page.locator('.ep-ailive-main, .ep-aibadge-slot button').first();
          if (await visible(pill)) await s.tap(pill);
        }
        txt = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
        const p = await readProject(page);
        if (p?.captions > 0) return `${p.captions} legendas em ${((Date.now() - t0) / 1000).toFixed(0)} s`;
        if (/Não encontrei fala/i.test(txt)) {
          s.friction({ step: 'Gerar legendas', kind: 'fluxo', sev: 1, text: 'Vídeo sem fala: a IA responde "Não encontrei fala para legendar neste vídeo." e para — não oferece criar legendas manualmente/digitar o texto.', file: 'lib/ai/pipeline.ts (resposta sem fala)', owner: 'ai' });
          return 'transcrição ok — vídeo de teste sem fala (esperado)';
        }
        if (/não foi possível|falhou|erro|sem conexão|offline/i.test(txt)) break;
      }
      const m = txt.match(/[^.]*(não foi possível|falhou|erro|sem conexão|offline|Baixando|modelo)[^.]*\./i);
      s.friction({ step: 'Gerar legendas', kind: 'beco', sev: 3, text: `Sem acesso ao modelo Whisper (huggingface/jsdelivr bloqueados no teste), gerar legendas não conclui em 45 s. Mensagem: "${m ? m[0].trim().slice(0, 160) : 'nenhuma mensagem clara'}". Não há alternativa (ex.: legendas manuais/ditado) oferecida no mesmo lugar.`, file: 'lib/ai (transcrição) / components/panels (Legendas)', owner: 'ai' });
      throw new Error('legendas não geradas (ambiente sem acesso ao modelo)');
    });
    await s.step('Trocar estilo da legenda (Karaokê)', async () => {
      const x = page.locator('.ep-aipop [aria-label=Minimizar], .ep-aipop [aria-label=Fechar]').first();
      if (await visible(x)) await s.tap(x);
      if (!(await visible(page.locator('.ep-side')))) await s.tap(mtool(page, 'Legendas'));
      const st = page.locator('.ep-side').getByRole('button', { name: /Karaokê/i }).first();
      await st.scrollIntoViewIfNeeded().catch(() => {});
      await s.tap(st);
      const p = await readProject(page);
      if (!/karaoke/i.test(p.capPreset || '')) throw new Error(`preset salvo: ${p.capPreset}`);
      return `preset ${p.capPreset}${p.captions ? '' : ' (sem legendas para ver o efeito)'}`;
    });
    for (const sel of ['.ep-side .ep-sheetclose']) { const b = page.locator(sel).first(); if (await visible(b)) await s.tap(b); }
    await s.step('Exportar (vídeo)', async () => {
      await s.tap(page.locator('.ep-exportbtn').first());
      await s.tap(page.locator('.ep-ex').getByRole('button', { name: /Exportar vídeo/ }).first());
      const r = await waitExport(s);
      if (r.state !== 'pronto' && !r.download) throw new Error(`export: ${r.state}`);
      return `${(r.ms / 1000).toFixed(1)} s · ${r.download || r.state}`;
    });
  } finally { await ctx.close(); }
  return s.summary();
}

/** (4) quem usa a IA: 3 edições no pop-up e desfazer uma */
async function persona4(media) {
  const { ctx, page } = await L.openContext('pixel7');
  const s = new Session(4, 'Usa a IA (Pixel 7): 3 pedidos no pop-up e desfazer um', 'pixel7', page);
  try {
    await s.step('Wizard → Editar com IA', async () => {
      await wizard(s, 'Reels com legendas grandes', [media.h264]);
      await s.tap(page.locator('button.ep-go'));
      const r = await waitPronto(s); return `${(r.ms / 1000).toFixed(1)} s`;
    });
    await L.sleep(1800);
    const asks = ['deixe a legenda maior', 'corte os primeiros 2 segundos', 'deixe as cores mais quentes'];
    const states = [await readProject(page)];
    for (const [i, q] of asks.entries()) {
      await s.step(`Pedido ${i + 1}: "${q}"`, async () => {
        if (!(await visible(page.locator('.ep-aipop')))) {
          const fab = page.locator('.ep-aifab2, .ep-ailive-main').first();
          await s.tap(fab);
        }
        const ta = page.locator('.ep-aipop textarea').first();
        s.taps++; await ta.fill(q);
        const pre = await page.locator('.ep-aipop').innerText().catch(() => '');
        await s.tap(page.locator('.ep-aipop .ep-ch-send').first());
        const t0 = Date.now();
        let started = false;
        while (Date.now() - t0 < 45000) {
          const txt = await page.locator('.ep-aipop').innerText().catch(() => '');
          if (/está editando|Aplicando|Pensando/i.test(txt)) started = true;
          else if ((started || Date.now() - t0 > 2500) && (/Feito|Pronto|Desfazer/.test(txt) || (txt !== pre && Date.now() - t0 > 2500))) break;
          if (Date.now() - t0 > 3000 && !/está editando/i.test(txt)) { const q2 = await readProject(page); if (q2 && q2.sig !== states[states.length - 1].sig) break; }
          await L.sleep(250);
        }
        const p = await readProject(page); states.push(p);
        const changed = p.sig !== states[states.length - 2].sig;
        if (!changed) {
          const txt = (await page.locator('.ep-aipop').innerText().catch(() => '')).replace(/\s+/g, ' ');
          if (/entendo comandos/.test(txt)) s.friction({ step: `Pedido ${i + 1}`, kind: 'bug', sev: 3, text: `"${q}" não foi entendido (resposta: lista de comandos), embora a própria IA sugira "corta os primeiros 2 s". O regex só aceita "corta/cortar/tira/remove/apaga", não o imperativo "corte/tire/remova/apague".`, file: 'lib/ai/demo.ts:784-785', owner: 'ai' });
          throw new Error('projeto não mudou');
        }
        return `${((Date.now() - t0) / 1000).toFixed(1)} s`;
      });
    }
    await s.step('Desfazer a 2ª edição ("Desfazer esta edição")', async () => {
      const undo = page.locator('.ep-aipop').getByRole('button', { name: /^Desfazer/ });
      const n = await undo.count();
      if (n < 2) s.friction({ step: 'Desfazer', kind: 'fluxo', sev: 2, text: `O pop-up mostra só a última resposta (${n} botão "Desfazer"): para desfazer uma edição anterior específica é preciso abrir a conversa completa.`, file: 'components/chat/AiPopup.tsx', owner: 'ai' });
      let target = n >= 2 ? undo.nth(n - 2) : null;
      let via = 'pop-up';
      if (!target) {
        // abre a conversa completa para achar o "Desfazer" da 2ª edição
        const full = page.getByRole('button', { name: /Abrir conversa completa/ }).first();
        if (await visible(full)) { await s.tap(full); via = 'conversa completa'; }
        const u2 = page.locator('.ep-chat').getByRole('button', { name: /^Desfazer/ });
        const m = await u2.count();
        if (m >= 2) target = u2.nth(m - 2);
        else { s.friction({ step: 'Desfazer', kind: 'beco', sev: 2, text: `Nem na conversa completa há "Desfazer" para edições anteriores (${m} botão): só a última pode ser desfeita.`, file: 'components/chat/ChatPanel.tsx', owner: 'ai' }); target = u2.last(); }
      }
      await target.scrollIntoViewIfNeeded().catch(() => {});
      await s.tap(target);
      const p = await readProject(page);
      const back = p.sig !== states[3].sig;
      if (!back) throw new Error('projeto não voltou');
      return `desfez via ${via}`;
    });
  } finally { await ctx.close(); }
  return s.summary();
}

/* ---------------- relatório ---------------- */

const OWNER_HINT = { timeline: 'components/timeline/**', engine: 'lib/engine/**, components/preview/**', export: 'lib/export/**', ai: 'app/api/**, lib/ai/**, components/chat/**', shell: 'components/{shell,media,panels}/**', library: 'lib/library/**', fx: 'efeitos', cor: 'cor' };

function ownerOfClass(cls) {
  if (/^ep-tl|^ep-clip|ep-tl-/.test(cls)) return 'timeline';
  if (/^ep-pv|ep-pv-/.test(cls)) return 'engine';
  if (/^ep-ch|^ep-aip|ep-ai/.test(cls)) return 'ai';
  if (/^ep-lib/.test(cls)) return 'library';
  return 'shell';
}

function writeReport(results, hash) {
  const all = results.flatMap((r) => r.frictions);
  for (const r of results) {
    if (r.small.length) {
      const byOwner = {};
      for (const sm of r.small) (byOwner[ownerOfClass(sm.cls)] ||= []).push(sm);
      for (const [owner, list] of Object.entries(byOwner)) {
        all.push({ persona: r.id, step: 'vários', kind: 'alvo', sev: list.length > 6 ? 2 : 1, owner, file: OWNER_HINT[owner],
          text: `${list.length} alvo(s) de toque < 44 px: ${list.slice(0, 8).map((x) => `${x.label || x.cls} (${x.w}×${x.h})`).join(', ')}${list.length > 8 ? '…' : ''}` });
      }
    }
    if (r.unlabeled.length) all.push({ persona: r.id, step: 'vários', kind: 'rótulo', sev: 1, owner: ownerOfClass(r.unlabeled[0].cls), file: '-', text: `Botões sem nome acessível: ${r.unlabeled.slice(0, 6).map((x) => `.${x.cls}${x.text ? ` "${x.text}"` : ''}`).join(', ')}` });
    for (const st of r.steps.filter((x) => !x.ok)) {
      if (!all.some((f) => f.persona === r.id && st.name.startsWith(f.step.split(' ')[0]))) all.push({ persona: r.id, step: st.name, kind: 'beco', sev: 2, owner: '?', file: '-', text: `Passo não concluído: ${st.note}`, shot: st.shot });
    }
  }
  all.sort((a, b) => b.sev - a.sev || a.owner.localeCompare(b.owner));
  const sev = (n) => ['', 'baixa', 'média', 'alta'][n];
  let md = `# Usabilidade por persona — EditorPro\n\n- Commit: \`${hash}\` · ${new Date().toISOString()}\n- Ambiente: Chromium headless, IA em modo demo, sem acesso a huggingface/jsdelivr (transcrição indisponível).\n- Métricas: tempo total, toques/cliques (inclui seleção de arquivo e digitação como 1 toque), teclas, passos concluídos, alvos < 44 px (só celular) e botões sem nome.\n\n`;
  md += `## Resumo\n\n| Persona | Perfil | Passos ok | Tempo | Toques | Teclas | Alvos < 44 px | Fricções |\n|---|---|---|---|---|---|---|---|\n`;
  for (const r of results) md += `| ${r.title} | ${L.PROFILES[r.profile].label} | ${r.done}/${r.total} | ${r.secs} s | ${r.taps} | ${r.keys} | ${r.small.length} | ${all.filter((f) => f.persona === r.id).length} |\n`;
  md += `\n## Fricções priorizadas\n\n| # | Sev. | Dono | Persona | Passo | Tipo | Descrição | Arquivo provável | Captura |\n|---|---|---|---|---|---|---|---|---|\n`;
  all.forEach((f, i) => { md += `| ${i + 1} | ${sev(f.sev)} | **${f.owner}** | P${f.persona} | ${f.step} | ${f.kind} | ${String(f.text).replace(/\|/g, '\\|')} | ${f.file || '-'} | ${f.shot ? `[img](${f.shot})` : ''} |\n`; });
  md += `\n## Por dono\n\n`;
  const owners = [...new Set(all.map((f) => f.owner))];
  for (const o of owners) md += `- **${o}**: ${all.filter((f) => f.owner === o).map((f) => `#${all.indexOf(f) + 1}`).join(', ')}\n`;
  md += `\n## Passo a passo\n\n`;
  for (const r of results) {
    md += `### P${r.id} — ${r.title}\n\n| Passo | Resultado | Tempo | Toques | Nota | Captura |\n|---|---|---|---|---|---|\n`;
    for (const st of r.steps) md += `| ${st.name} | ${st.ok ? '✅' : '❌'} | ${(st.ms / 1000).toFixed(1)} s | ${st.taps} | ${String(st.note).replace(/\|/g, '\\|')} | ${st.shot ? `[img](${st.shot})` : ''} |\n`;
    if (r.small.length) md += `\nAlvos < 44 px: ${r.small.map((x) => `\`${x.label || x.cls}\` ${x.w}×${x.h}`).join(' · ')}\n`;
    md += '\n';
  }
  if (fs.existsSync(path.join(__dirname, 'USABILIDADE-notas.md'))) md += fs.readFileSync(path.join(__dirname, 'USABILIDADE-notas.md'), 'utf8');
  fs.writeFileSync(path.join(__dirname, 'USABILIDADE.md'), md);
  fs.writeFileSync(path.join(__dirname, 'usability.json'), JSON.stringify({ hash, results, frictions: all }, null, 2));
}

(async () => {
  L.ensureDirs();
  const media = ensureMedia();
  const results = [];
  const fns = { 1: persona1, 2: persona2, 3: persona3, 4: persona4 };
  for (const id of WANT) {
    console.log(`persona ${id}…`);
    try { results.push(await fns[id](media)); }
    catch (e) { console.error(`persona ${id} quebrou:`, e.message); }
  }
  await L.closeBrowser();
  let hash = '?'; try { hash = require('child_process').execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim(); } catch {}
  writeReport(results, hash);
  console.log('USABILIDADE.md gerado');
})();
