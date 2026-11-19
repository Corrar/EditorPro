// medição de memória (não roda no run.sh): mix de 2 s do big.mp4 (285 MB). Rode com mem.sh node run.js mem_audio_big.js
module.exports = async () => {
  const asset = { id: 'a', kind: 'video', name: 'big.mp4', mime: 'video/mp4', url: '/big.mp4', duration: 60 };
  const p = EPX.createProject({ aspect: '9:16' });
  p.tracks.find((t) => t.kind === 'video').clips.push(EPX.makeVideoClip(asset, 0, { id: 'c', duration: 2, in: 30 }));
  const t0 = performance.now();
  const buf = await EPX.mixProjectAudio(p, { a: asset });
  return { secs: (performance.now() - t0) / 1000, dur: buf && buf.duration };
};
