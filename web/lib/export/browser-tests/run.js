// node run.js <test.js> [pixel]  — roda a função exportada no navegador com EPX carregado
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext(process.argv[3] === 'pixel' ? { ...devices['Pixel 7'] } : {});
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() !== 'debug') console.log('  [' + m.type() + '] ' + m.text().slice(0, 200)); });
  p.on('pageerror', (e) => console.log('  pageerror ' + e.message.slice(0, 200)));
  await p.goto('http://localhost:3200/index.html');
  const fn = require(require('path').resolve(process.argv[2]));
  const r = await p.evaluate(fn); console.log(JSON.stringify(r)); if (r && r.ok === false) process.exitCode = 1;
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
