// r2 #3: mix só do trecho usado (seno 440 Hz), e aviso quando o áudio existe mas não entra (AC-3 no Chromium)
module.exports = async () => {
  const freq = (buf, from, to) => { // frequência por cruzamentos de zero
    const d = buf.getChannelData(0), sr = buf.sampleRate; let z = 0;
    for (let i = Math.floor(from * sr) + 1; i < Math.floor(to * sr); i++) if ((d[i - 1] < 0) !== (d[i] < 0)) z++;
    return z / 2 / (to - from);
  };
  const run = async (url, name, clipOpts) => {
    const asset = { id: 'a', kind: 'video', name, mime: 'video/mp4', url, duration: 6 };
    const p = EPX.createProject({ aspect: '9:16' });
    const vt = p.tracks.find((t) => t.kind === 'video');
    vt.clips.push(EPX.makeVideoClip(asset, 0, { id: 'c', duration: 2, in: 1, ...clipOpts }));
    const warnings = [];
    const buf = await EPX.mixProjectAudio(p, { a: asset }, { onWarning: (m) => warnings.push(m) });
    return { buf, warnings };
  };
  const ok1 = await run('/sine.mp4', 'sine.mp4', {});
  const f1 = ok1.buf ? freq(ok1.buf, 0.2, 1.8) : 0;
  // chirp: frequência instantânea 200 + 200·t. Clipe in=1, 2 s → janela [0,2;1,8] da timeline = fonte [1,2;2,8] → média 600 Hz
  const ch = await run('/chirp.mp4', 'chirp.mp4', {});
  const fc = ch.buf ? freq(ch.buf, 0.2, 1.8) : 0;
  const bad = await run('/ac3.mp4', 'ac3.mp4', {});
  // r2 #1: velocidade 2x mantém o tom (preview usa preservesPitch). Antes: 880 Hz.
  const fast = await run('/sine.mp4', 'sine.mp4', { in: 0, speed: 2 });
  const f2 = fast.buf ? freq(fast.buf, 0.2, 1.8) : 0;
  // chirp a 2x: clipe in=1, 1 s na timeline consome a fonte [1, 3]; janela [0,2; 0,8] → fonte [1,4; 2,6] → média 600 Hz
  const chFast = await run('/chirp.mp4', 'chirp.mp4', { in: 1, speed: 2, duration: 1 });
  const fc2 = chFast.buf ? freq(chFast.buf, 0.2, 0.8) : 0;
  return {
    ok: !!ok1.buf && Math.abs(f1 - 440) < 5 && Math.abs(fc - 600) < 15 && ok1.warnings.length === 0 && bad.warnings.length === 1 && Math.abs(f2 - 440) < 8 && Math.abs(fc2 - 600) < 20,
    sineHz: Math.round(f1), speed2Hz: Math.round(f2), chirp2xHz: Math.round(fc2), chirpHz: Math.round(fc), sineDur: ok1.buf && ok1.buf.duration, warningsOk: ok1.warnings, ac3Warning: bad.warnings[0], ac3Buf: !!bad.buf,
  };
};
