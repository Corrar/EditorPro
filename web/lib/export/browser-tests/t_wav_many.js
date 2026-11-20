// r3: música longa (WAV 5 min) cortada em 12 pedaços decodifica UMA vez no mix (antes: 12× → 15,9 s e ~5 GB de pico)
module.exports = async () => {
  const asset = { id: 'w', kind: 'audio', name: 'long.wav', mime: 'audio/wav', url: '/long.wav', duration: 300 };
  const p = EPX.createProject({ aspect: '9:16' });
  const at = p.tracks.find((t) => t.kind === 'audio') || (p.tracks.push({ id: 'ta', kind: 'audio', name: 'A', clips: [] }), p.tracks[p.tracks.length - 1]);
  for (let i = 0; i < 12; i++) at.clips.push(EPX.makeAudioClip(asset, i * 5, { id: 'c' + i, duration: 5, in: i * 20 }));
  let decodes = 0;
  const orig = BaseAudioContext.prototype.decodeAudioData;
  BaseAudioContext.prototype.decodeAudioData = function (...a) { decodes++; return orig.apply(this, a); };
  const t0 = performance.now();
  const buf = await EPX.mixProjectAudio(p, { w: asset }, {});
  const ms = performance.now() - t0;
  BaseAudioContext.prototype.decodeAudioData = orig;
  return { ok: !!buf && decodes <= 1, decodes, ms: Math.round(ms), dur: buf && buf.duration };
};
