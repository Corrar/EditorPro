module.exports = async () => {
  const asset = { id: 'a', kind: 'video', name: 'rot90.mp4', mime: 'video/mp4', url: '/rot90.mp4', duration: 6 };
  const pool = new EPX.DecodedMediaPool({ a: asset });
  const clip = (i) => ({ id: 'c' + i, type: 'video', assetId: 'a', start: i * 0.1, duration: 0.1, in: i * 0.1, speed: 1 });
  let peak = 0;
  for (let i = 0; i < 40; i++) { await pool.prepare([{ clip: clip(i), time: i * 0.1 }]); peak = Math.max(peak, pool.liveSurfaces); }
  const afterCuts = pool.liveSurfaces;
  pool.dispose();
  return { ok: peak <= 1 && pool.liveSurfaces === 0, decoded: pool.stats.decodedClips, peak, afterCuts, afterDispose: pool.liveSurfaces };
};
