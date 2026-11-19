/* =====================================================================
   EditorPro — utilitários da suíte E2E (Node puro + require('playwright')).
   Dono: sessão de QA. Nada aqui é importado pelo app.
   ===================================================================== */
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');

const ROOT = __dirname;
const SHOTS = path.join(ROOT, 'shots');
const MEDIA = path.join(ROOT, '.media');
const BASE = process.env.E2E_BASE || 'http://localhost:3100';
const PASSWORD = process.env.E2E_PASSWORD || 'demo';

/** perfis pedidos: desktop 1440×900, Pixel 7 escuro, iPhone SE claro */
const PROFILES = {
  desktop: { label: 'Desktop 1440×900', ctx: { viewport: { width: 1440, height: 900 }, colorScheme: 'light' }, mobile: false },
  pixel7: { label: 'Pixel 7 (escuro)', ctx: { ...devices['Pixel 7'], colorScheme: 'dark' }, mobile: true },
  iphonese: { label: 'iPhone SE (claro)', ctx: { ...devices['iPhone SE'], colorScheme: 'light' }, mobile: true },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ensureDirs() {
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.mkdirSync(MEDIA, { recursive: true });
}

let browser = null;
async function getBrowser() {
  if (!browser) {
    browser = await chromium.launch({
      args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
    });
  }
  return browser;
}
async function closeBrowser() { if (browser) await browser.close(); browser = null; }

/**
 * Abre um contexto já logado (POST /api/login copia o cookie p/ o contexto).
 * Retorna { ctx, page, errors } — errors acumula pageerror + console.error.
 */
async function openContext(profileId, { theme } = {}) {
  const prof = PROFILES[profileId];
  const b = await getBrowser();
  const ctx = await b.newContext({ ...prof.ctx, baseURL: BASE, acceptDownloads: true });
  // tema salvo (o app lê ep_theme; sem ele segue prefers-color-scheme)
  const t = theme ?? (prof.ctx.colorScheme === 'dark' ? 'dark' : 'light');
  await ctx.addInitScript((tt) => { try { localStorage.setItem('ep_theme', tt); } catch {} }, t);
  const r = await ctx.request.post('/api/login', { data: { password: PASSWORD } });
  if (!r.ok()) throw new Error(`login falhou: HTTP ${r.status()}`);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push({ type: 'pageerror', text: String(e && e.stack || e) }));
  page.on('console', (m) => { if (m.type() === 'error') errors.push({ type: 'console', text: m.text() }); });
  return { ctx, page, errors };
}

/** login pela tela (valida o formulário /login de verdade) */
async function loginViaForm(page) {
  await page.goto('/login');
  await page.fill('#pw', PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 }), page.click('button[type=submit]')]);
}

async function shot(page, name) {
  const file = path.join(SHOTS, `${name}.png`);
  try { await page.screenshot({ path: file, scale: 'css' }); } catch { return null; }
  return `shots/${name}.png`;
}

/** erros relevantes (ignora ruídos conhecidos de rede externa: CDN/HF bloqueados no container) */
function relevantErrors(errors) {
  return errors.filter((e) => {
    if (e.type === 'pageerror') return true;
    const t = e.text;
    if (/Failed to load resource|net::ERR_|ERR_TUNNEL|ERR_NAME|huggingface|jsdelivr|googleapis|status of 40[134]/i.test(t)) return false;
    return true;
  });
}

/* ---------------- amostragem de luminância do canvas do preview ---------------- */

/**
 * Instala no navegador um amostrador: a cada rAF lê o canvas [data-ep-preview]
 * (reduzido p/ 32×32 num canvas auxiliar) e guarda luminância média, e conta
 * draws novos de __epPreviewStats. Exposto em window.__qa.
 */
async function installSampler(page) {
  await page.evaluate(() => {
    if (window.__qa) return;
    const aux = document.createElement('canvas');
    aux.width = 32; aux.height = 32;
    const actx = aux.getContext('2d', { willReadFrequently: true });
    const qa = {
      running: false, samples: [], drawTimes: [], lastDraws: 0, marks: [],
      start(label) {
        qa.samples = []; qa.drawTimes = []; qa.marks = []; qa.running = true; qa.label = label;
        const st = window.__epPreviewStats || { draws: 0, held: 0 };
        qa.lastDraws = st.draws; qa.held0 = st.held; qa.draws0 = st.draws;
        const loop = () => {
          if (!qa.running) return;
          const now = performance.now();
          const s = window.__epPreviewStats || { draws: 0, held: 0 };
          if (s.draws !== qa.lastDraws) { qa.drawTimes.push(now); qa.lastDraws = s.draws; }
          const cv = document.querySelector('canvas[data-ep-preview]');
          if (cv && cv.width && cv.height) {
            try {
              actx.drawImage(cv, 0, 0, 32, 32);
              const d = actx.getImageData(0, 0, 32, 32).data;
              let sum = 0, max = 0;
              for (let i = 0; i < d.length; i += 4) { const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; sum += y; if (y > max) max = y; }
              const mean = sum / (d.length / 4);
              const ed = window.__ep?.useEditor?.getState?.();
              qa.samples.push({ t: now, mean, max, ph: ed ? ed.playhead : null, playing: ed ? ed.playing : null });
            } catch (e) { qa.samples.push({ t: now, err: String(e) }); }
          }
          requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
      },
      mark(name) { qa.marks.push({ t: performance.now(), name }); },
      stop() {
        qa.running = false;
        const st = window.__epPreviewStats || { draws: 0, held: 0 };
        return { samples: qa.samples, drawTimes: qa.drawTimes, marks: qa.marks, held: st.held - qa.held0, draws: st.draws - qa.draws0, stats: { ...st } };
      },
    };
    window.__qa = qa;
  });
}

/** quadro "preto": média < 6 e máximo < 24 (0..255). testsrc2 nunca chega perto disso. */
const BLACK_MEAN = 6, BLACK_MAX = 24;
function summarizeSamples(res) {
  const valid = res.samples.filter((s) => s.mean !== undefined);
  const black = valid.filter((s) => s.mean < BLACK_MEAN && s.max < BLACK_MAX);
  const gaps = [];
  for (let i = 1; i < res.drawTimes.length; i++) gaps.push(res.drawTimes[i] - res.drawTimes[i - 1]);
  return {
    samples: valid.length, black: black.length, firstBlackAt: black[0] ? Math.round(black[0].t - (valid[0]?.t ?? 0)) : null,
    blackPlayheads: black.slice(0, 5).map((s) => s.ph != null ? `${s.ph.toFixed(2)}s` : `+${Math.round(s.t - (valid[0]?.t ?? 0))}ms`),
    minMean: valid.length ? +Math.min(...valid.map((s) => s.mean)).toFixed(1) : null,
    held: res.held, draws: res.draws, gaps,
    p95: pct(gaps, 95), p50: pct(gaps, 50), maxGap: gaps.length ? Math.round(Math.max(...gaps)) : null,
  };
}
function pct(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] * 10) / 10;
}

/* ---------------- layout ---------------- */

/** retângulo de um elemento vs viewport (com tolerância de 1px) e se rola por dentro com último item alcançável */
async function checkInViewport(page, selector) {
  return page.evaluate((sel) => {
    const vw = window.visualViewport?.width ?? innerWidth, vh = window.visualViewport?.height ?? innerHeight;
    const els = [...document.querySelectorAll(sel)].filter((e) => {
      const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    });
    return els.map((e) => {
      const r = e.getBoundingClientRect();
      const inside = r.left >= -1 && r.top >= -1 && r.right <= vw + 1 && r.bottom <= vh + 1;
      // rolagem interna: se o conteúdo passa da caixa, o elemento (ou um filho) precisa rolar
      let scrollOk = true;
      const scroller = [e, ...e.querySelectorAll('*')].find((x) => x.scrollHeight > x.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(x).overflowY));
      const overflowing = e.scrollHeight > e.clientHeight + 2;
      if (overflowing && !scroller) scrollOk = false;
      // último item alcançável: rola tudo e vê se o último filho interativo fica dentro da viewport
      let lastReachable = true;
      if (scroller) {
        scroller.scrollTop = scroller.scrollHeight;
        const items = scroller.querySelectorAll('button, a, input, [role=menuitem], [role=menuitemcheckbox]');
        const last = items[items.length - 1];
        if (last) { const lr = last.getBoundingClientRect(); lastReachable = lr.bottom <= vh + 1 && lr.top >= -1; }
        scroller.scrollTop = 0;
      }
      return {
        cls: (e.className && e.className.baseVal === undefined ? String(e.className) : '').slice(0, 60),
        rect: { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) },
        vw: Math.round(vw), vh: Math.round(vh),
        ok: inside && scrollOk && lastReachable, inside, scrollOk, lastReachable,
      };
    });
  }, selector);
}

async function horizontalOverflow(page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    return { scrollW: de.scrollWidth, clientW: de.clientWidth, over: de.scrollWidth > de.clientWidth + 1 };
  });
}

module.exports = {
  ROOT, SHOTS, MEDIA, BASE, PROFILES, sleep, ensureDirs, getBrowser, closeBrowser, openContext, loginViaForm, shot,
  relevantErrors, installSampler, summarizeSamples, pct, checkInViewport, horizontalOverflow,
};
