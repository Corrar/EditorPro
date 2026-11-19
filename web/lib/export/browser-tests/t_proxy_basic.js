// proxy de um MP4 normal (moov no fim): sai com vídeo + áudio AAC e a duração certa; fila serializa 2 pedidos
module.exports = async () => {
  const f = await (await fetch('/sine.mp4')).blob();
  const [a, b] = await Promise.all([EPX.makePreviewProxy(f, { maxHeight: 240 }), EPX.makePreviewProxy(f, { maxHeight: 240 })]);
  const v = document.createElement('video'); v.src = URL.createObjectURL(a); v.muted = true;
  await new Promise((r) => { v.onloadedmetadata = r; v.onerror = r; });
  const ac = new AudioContext(); const buf = await ac.decodeAudioData(await a.arrayBuffer());
  return { ok: !!a && !!b && Math.abs(v.duration - 6) < 0.15 && buf.duration > 5.8, duration: v.duration, audio: buf.duration, size: a && a.size };
};
