// r2 #5: vídeo cortado com stream copy (edit list com pré-rolagem) → proxy precisa sair
module.exports = async () => {
  const errors = [];
  addEventListener('error', (e) => errors.push(String(e.message)));
  const file = await (await fetch('/preroll.mp4')).blob();
  const blob = await EPX.makePreviewProxy(file, { maxHeight: 360 });
  if (!blob) return { ok: false, proxy: null, errors: errors.length };
  const v = document.createElement('video');
  v.muted = true; v.src = URL.createObjectURL(blob);
  await new Promise((r) => { v.onloadedmetadata = r; v.onerror = r; });
  // duração esperada ≈ 8 - 1,5 = 6,5 s
  return { ok: Math.abs(v.duration - 6.5) < 0.2 && errors.length === 0, size: blob.size, duration: v.duration, w: v.videoWidth, h: v.videoHeight, errors: errors.length };
};
