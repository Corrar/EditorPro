// medição de memória (não roda no run.sh): gere big.mp4 (ffmpeg testsrc2 60 s 1080p -b:v 50M) e rode com mem.sh node run.js mem_proxy_big.js
module.exports = async () => { const f = await (await fetch('/big.mp4')).blob(); const t0 = performance.now(); const b = await EPX.makePreviewProxy(f, { maxHeight: 540 }); return { size: b && b.size, secs: (performance.now() - t0) / 1000 }; };
