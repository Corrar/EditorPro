// carga de CPU p/ reproduzir corridas (n processos × s segundos)
const { fork } = require('child_process');
if (process.argv[2] === 'child') { const end = Date.now() + Number(process.argv[3]) * 1000; let x = 0; while (Date.now() < end) x += Math.sqrt(x + 1); process.exit(0); }
const n = Number(process.argv[2] || 2), s = Number(process.argv[3] || 60);
for (let i = 0; i < n; i++) fork(__filename, ['child', String(s)]);
