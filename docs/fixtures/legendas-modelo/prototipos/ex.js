const { chromium } = require('playwright');
const fs = require('fs');
const D = __dirname;
const BASE = 'http://localhost:3106';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.text().slice(0, 200)); });
  await page.goto(BASE + '/login');
  await page.evaluate(async () => { await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'demo' }) }); });
  await page.goto(BASE + '/dev/preview');
  await page.waitForFunction(() => !!window.__ep);
  await page.setInputFiles('[data-testid=files]', `${D}/box.mp4`);
  await page.waitForFunction(() => window.__ep.assetsList().some((a) => a.kind === 'video' && a.duration > 0), null, { timeout: 20000 });
  const scen = {
    A: { keyframes: [{ t: 0.5, transform: { scale: 1 } }, { t: 3.5, transform: { scale: 1.2 }, easing: 'easeInOut' }] },
    B1: { keyframes: [{ t: 0.99, transform: { scale: 1 } }, { t: 1.15, transform: { scale: 1.18 }, easing: 'easeOut' }, { t: 1.95, transform: { scale: 1.18 } }, { t: 2.2, transform: { scale: 1 }, easing: 'easeInOut' }] },
    C: { effects: [{ kind: 'zoom-punch', intensity: 0.5 }] },
  };
  const which = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(scen);
  for (const name of which) {
    const fps = name.endsWith('60') ? 60 : 30;
    const sc = scen[name.replace(/60$/, '')];
    const r = await page.evaluate(async ({ sc, fps }) => {
      const ep = window.__ep; const st = ep.useEditor.getState();
      const asset = ep.assetsList().find((a) => a.kind === 'video');
      st.newProject({ name: 'motion', aspect: '9:16' });
      const p = ep.useEditor.getState().project;
      ep.useEditor.getState().dispatch([{ op: 'add_clip', trackId: 'track_video_1', clip: { id: 'v1', type: 'video', assetId: asset.id, start: 0, duration: 4, in: 0, speed: 1, volume: 0, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, filters: [], ...(sc.keyframes ? { keyframes: sc.keyframes } : {}), ...(sc.effects ? { effects: sc.effects } : {}) } }]);
      const s2 = ep.useEditor.getState();
      const t0 = performance.now();
      let fmt = 'mp4';
      let blob;
      try { blob = await ep.exportVideo(s2.project, s2.assets, { format: 'mp4', quality: 'full', fps }); }
      catch (e) { fmt = 'webm'; blob = await ep.exportVideo(s2.project, s2.assets, { format: 'webm', quality: 'full', fps }); }
      return { b64: await ep.blobToBase64(blob), fmt, ms: performance.now() - t0, w: s2.project.width, h: s2.project.height };
    }, { sc, fps });
    const f = `${D}/exp_${name}.${r.fmt}`;
    fs.writeFileSync(f, Buffer.from(r.b64, 'base64'));
    console.log(name, r.fmt, `${r.w}x${r.h}`, Math.round(r.ms) + 'ms', f);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
